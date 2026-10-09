import { Injectable, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import * as crypto from 'crypto';

export const REDIS = Symbol('REDIS');

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // the plan's 30-day sliding expiry

export interface SessionData {
  userId: string;
  orgId: string;
}

/**
 * Sessions in Redis, with a per-user index.
 *
 * Plan Section 13 chooses server-side sessions over JWTs specifically because
 * "revoking a user's access is a Redis delete, which a stateless JWT cannot
 * give you" — but with only `session:<id>` keys there was no way to find a
 * user's sessions, so deactivating someone left every one of their existing
 * sessions valid for up to thirty days. The `user_sessions:<userId>` set is
 * what makes the stated advantage real.
 */
@Injectable()
export class SessionService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async createSession(userId: string, orgId: string): Promise<string> {
    const sessionId = crypto.randomUUID();
    await this.redis
      .multi()
      .set(`session:${sessionId}`, JSON.stringify({ userId, orgId }), 'EX', SESSION_TTL_SECONDS)
      .sadd(`user_sessions:${userId}`, sessionId)
      .expire(`user_sessions:${userId}`, SESSION_TTL_SECONDS)
      .exec();
    return sessionId;
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    if (typeof sessionId !== 'string' || !sessionId) return null;
    const data = await this.redis.get(`session:${sessionId}`);
    if (!data) return null;
    try {
      const parsed = JSON.parse(data) as SessionData;
      return parsed?.userId && parsed?.orgId ? parsed : null;
    } catch {
      // A corrupt value must log the user out, not crash the request.
      await this.redis.del(`session:${sessionId}`);
      return null;
    }
  }

  async destroySession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    const pipeline = this.redis.multi().del(`session:${sessionId}`);
    if (session) pipeline.srem(`user_sessions:${session.userId}`, sessionId);
    await pipeline.exec();
  }

  /** Revokes every session a user holds — deactivation, or "sign out everywhere". */
  async destroyUserSessions(userId: string): Promise<number> {
    const ids = await this.redis.smembers(`user_sessions:${userId}`);
    if (ids.length === 0) return 0;
    await this.redis
      .multi()
      .del(...ids.map((id) => `session:${id}`))
      .del(`user_sessions:${userId}`)
      .exec();
    return ids.length;
  }

  async touchSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    const pipeline = this.redis.multi().expire(`session:${sessionId}`, SESSION_TTL_SECONDS);
    if (session) pipeline.expire(`user_sessions:${session.userId}`, SESSION_TTL_SECONDS);
    await pipeline.exec();
  }
}
