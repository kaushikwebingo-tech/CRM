import { Injectable, Inject } from '@nestjs/common';
import { DATABASE } from '../db/connection';
import { views } from '../db/schema';
import { eq, and, isNull, asc } from 'drizzle-orm';
import { NotFoundError, ForbiddenError } from '../common/errors';
import { z } from 'zod';

/** Only these columns may come from a request body. */
const viewSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(['table', 'kanban', 'calendar']).optional(),
  config: z.record(z.unknown()).optional(),
  position: z.number().int().min(0).max(10_000).optional(),
  isShared: z.boolean().optional(),
});

@Injectable()
export class ViewsService {
  constructor(@Inject(DATABASE) private readonly db: any) {}

  async list(orgId: string, moduleId: string) {
    // orgId was accepted and then not used, so a known module id from another
    // organisation would list its views.
    return this.db
      .select()
      .from(views)
      .where(and(eq(views.orgId, orgId), eq(views.moduleId, moduleId), isNull(views.deletedAt)))
      .orderBy(asc(views.position));
  }

  async create(orgId: string, moduleId: string, input: unknown, ownerId?: string | null) {
    const data = viewSchema.parse(input ?? {});
    const [view] = await this.db
      .insert(views)
      .values({
        orgId,
        moduleId,
        name: data.name,
        type: data.type ?? 'table',
        config: data.config ?? {},
        // null means shared with the org (Plan Section 4).
        ownerId: data.isShared ? null : (ownerId ?? null),
        isDefault: false,
        position: data.position ?? 0,
      })
      .returning();
    return view;
  }

  private async assertCanModify(
    orgId: string,
    viewId: string,
    actor: { id: string; canManageViews: boolean },
  ) {
    const [view] = await this.db
      .select()
      .from(views)
      .where(and(eq(views.id, viewId), eq(views.orgId, orgId), isNull(views.deletedAt)))
      .limit(1);
    if (!view) throw new NotFoundError('View not found');

    const isOwner = view.ownerId && view.ownerId === actor.id;
    if (!isOwner && !actor.canManageViews) {
      throw new ForbiddenError(
        view.ownerId
          ? 'This view belongs to another user'
          : 'You do not have permission to change shared views',
      );
    }
    return view;
  }

  async update(
    orgId: string,
    viewId: string,
    input: unknown,
    actor: { id: string; canManageViews: boolean },
  ) {
    await this.assertCanModify(orgId, viewId, actor);
    const data = viewSchema.partial().parse(input ?? {});
    const [view] = await this.db
      .update(views)
      .set({
        ...(data.name !== undefined && { name: data.name }),
        ...(data.type !== undefined && { type: data.type }),
        ...(data.config !== undefined && { config: data.config }),
        ...(data.position !== undefined && { position: data.position }),
      })
      .where(and(eq(views.id, viewId), eq(views.orgId, orgId), isNull(views.deletedAt)))
      .returning();
    if (!view) throw new NotFoundError('View not found');
    return view;
  }

  async softDelete(
    orgId: string,
    viewId: string,
    actor: { id: string; canManageViews: boolean },
  ) {
    const view = await this.assertCanModify(orgId, viewId, actor);
    if (view.isDefault) {
      throw new ForbiddenError('The default view cannot be deleted');
    }
    await this.db
      .update(views)
      .set({ deletedAt: new Date() })
      .where(and(eq(views.id, viewId), eq(views.orgId, orgId)));
  }
}
