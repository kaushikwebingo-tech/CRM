import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, from, of, switchMap, tap } from 'rxjs';
import postgres from 'postgres';
import { createHash } from 'crypto';
import { PG_CLIENT } from '../db/connection';
import { ConflictError } from './errors';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle();
  }
}


@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(PG_CLIENT) private readonly sql: postgres.Sql) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const method = String(request.method || '').toUpperCase();

    if (method !== 'POST' && method !== 'PATCH' && method !== 'PUT' && method !== 'DELETE') {
      return next.handle();
    }

    const key = this.headerValue(request.headers?.['idempotency-key']);
    const orgId: string | undefined = request.user?.orgId;
    if (!key || !orgId) {
      return next.handle();
    }
    if (key.length > 255) {
      return next.handle();
    }

    const concretePath = (request.originalUrl ?? request.url ?? '').split('?')[0];
    const endpoint = `${method} ${concretePath || request.route?.path || ''}`;
    const requestHash = createHash('sha256')
      .update(JSON.stringify(request.body ?? null))
      .digest('hex');

    return from(this.lookup(orgId, key, endpoint)).pipe(
      switchMap((existing) => {
        if (existing) {
          if (existing.request_hash !== requestHash) {
            throw new ConflictError(
              'This Idempotency-Key was already used with a different request body',
            );
          }
          const response = context.switchToHttp().getResponse();
          response.status(existing.status_code);
          return of(existing.response);
        }

        return next.handle().pipe(
          tap((body) => {
            const response = context.switchToHttp().getResponse();
            void this.remember(orgId, key, endpoint, requestHash, response.statusCode ?? 200, body);
          }),
        );
      }),
    );
  }

  private headerValue(raw: unknown): string | undefined {
    if (typeof raw === 'string') return raw.trim() || undefined;
    if (Array.isArray(raw)) return this.headerValue(raw[raw.length - 1]);
    return undefined;
  }

  private async lookup(orgId: string, key: string, endpoint: string) {
    try {
      const [row] = await this.sql`
        SELECT status_code, response, request_hash
        FROM idempotency_keys
        WHERE org_id = ${orgId} AND key = ${key} AND endpoint = ${endpoint}
        LIMIT 1
      `;
      return row ?? null;
    } catch {
      return null;
    }
  }

  private async remember(
    orgId: string,
    key: string,
    endpoint: string,
    requestHash: string,
    statusCode: number,
    body: unknown,
  ) {
    try {
      await this.sql`
        INSERT INTO idempotency_keys (org_id, key, endpoint, request_hash, status_code, response)
        VALUES (
          ${orgId}, ${key}, ${endpoint}, ${requestHash}, ${statusCode},
          ${JSON.stringify(body ?? null)}::text::jsonb
        )
        ON CONFLICT (org_id, key, endpoint) DO NOTHING
      `;
    } catch {
      // Recording the replay is best-effort; the write itself already committed.
    }
  }
}
