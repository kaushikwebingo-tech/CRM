import { Injectable } from '@nestjs/common';
import { adminAudit } from '../db/schema';

export interface AdminAuditEntry {
  orgId: string;
  actorId?: string | null;
  actorType?: 'user' | 'system' | 'automation';
  entityType: 'module' | 'field' | 'pipeline' | 'stage' | 'view' | 'role' | 'user' | 'automation';
  entityId?: string | null;
  action: 'created' | 'updated' | 'deleted' | 'reordered';
  before?: unknown;
  after?: unknown;
}


@Injectable()
export class AuditService {
  async record(tx: { insert: (table: typeof adminAudit) => any }, entry: AdminAuditEntry): Promise<void> {
    await tx
      .insert(adminAudit)
      .values({
        orgId: entry.orgId,
        actorId: entry.actorId ?? null,
        actorType: entry.actorType ?? 'user',
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        action: entry.action,
        before: (entry.before ?? null) as never,
        after: (entry.after ?? null) as never,
      });
  }
}
