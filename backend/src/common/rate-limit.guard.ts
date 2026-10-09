import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '../auth/session.service';
import { AppError } from './errors';


const USER_LIMIT = Number(process.env.RATE_LIMIT_USER_PER_MIN || 300);
const ORG_LIMIT = Number(process.env.RATE_LIMIT_ORG_PER_MIN || 3000);

class TooManyRequestsError extends AppError {
  constructor(retryAfterSeconds: number) {
    super(
      429,
      'rate_limited',
      'Too Many Requests',
      `Rate limit exceeded. Try again in ${retryAfterSeconds}s.`,
    );
  }
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as { id?: string; orgId?: string } | undefined;
    if (!user?.id || !user?.orgId) return true;

    const window = Math.floor(Date.now() / 60_000);

    const [userCount, orgCount] = await Promise.all([
      this.bump(`crm:rl:u:${user.id}:${window}`),
      this.bump(`crm:rl:o:${user.orgId}:${window}`),
    ]);

    if (userCount === null || orgCount === null) {
      return true;
    }

    if (userCount > USER_LIMIT || orgCount > ORG_LIMIT) {
      const retryAfter = 60 - Math.floor((Date.now() % 60_000) / 1000);
      const response = context.switchToHttp().getResponse();
      response.setHeader?.('Retry-After', String(retryAfter));
      throw new TooManyRequestsError(retryAfter);
    }

    return true;
  }

  private async bump(key: string): Promise<number | null> {
    try {
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, 120);
      return count;
    } catch {
      return null;
    }
  }
}
