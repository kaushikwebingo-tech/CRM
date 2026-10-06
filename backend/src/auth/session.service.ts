import { Injectable, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import * as crypto from 'crypto';

export const REDIS = Symbol('REDIS');

@Injectable()
export class SessionService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async createSession(userId: string, orgId: string): Promise<string> {
    const sessionId = crypto.randomUUID();
    await this.redis.set(
      `session:${sessionId}`,
      JSON.stringify({ userId, orgId }),
      'EX',
      30 * 24 * 60 * 60
    );
    return sessionId;
  }

  async getSession(sessionId: string): Promise<{ userId: string; orgId: string } | null> {
    const data = await this.redis.get(`session:${sessionId}`);
    if (!data) return null;
    return JSON.parse(data);
  }

  async destroySession(sessionId: string): Promise<void> {
    await this.redis.del(`session:${sessionId}`);
  }

  async touchSession(sessionId: string): Promise<void> {
    await this.redis.expire(`session:${sessionId}`, 30 * 24 * 60 * 60);
  }
}
