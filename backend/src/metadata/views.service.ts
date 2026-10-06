import { Injectable, Inject } from '@nestjs/common';
import { DATABASE } from '../db/connection';
import { views } from '../db/schema';
import { eq, and, isNull, asc } from 'drizzle-orm';
import { NotFoundError } from '../common/errors';

@Injectable()
export class ViewsService {
  constructor(@Inject(DATABASE) private readonly db: any) {}

  async list(orgId: string, moduleId: string) {
    return this.db.select().from(views).where(and(eq(views.moduleId, moduleId), isNull(views.deletedAt))).orderBy(asc(views.position));
  }

  async create(orgId: string, moduleId: string, data: any) {
    const [view] = await this.db.insert(views).values({ orgId, moduleId, ...data }).returning();
    return view;
  }

  async update(orgId: string, viewId: string, data: any) {
    const [view] = await this.db.update(views).set(data).where(and(eq(views.id, viewId), eq(views.orgId, orgId))).returning();
    if (!view) throw new NotFoundError('View not found');
    return view;
  }

  async softDelete(orgId: string, viewId: string) {
    await this.db.update(views).set({ deletedAt: new Date() }).where(and(eq(views.id, viewId), eq(views.orgId, orgId)));
  }
}
