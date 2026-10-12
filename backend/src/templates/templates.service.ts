import { Injectable, Inject } from '@nestjs/common';
import postgres from 'postgres';
import { PG_CLIENT } from '../db/connection';
import { NotFoundError, ValidationError } from '../common/errors';
import { TemplateEngine, TemplateContext } from './template-engine';
import { ConnectorsService } from '../connectors/connectors.service';

export interface CreateTemplateDto {
  channel: 'email' | 'whatsapp' | 'sms';
  name: string;
  subject?: string;
  body: string;
  moduleId?: string;
}

export interface UpdateTemplateDto {
  channel?: 'email' | 'whatsapp' | 'sms';
  name?: string;
  subject?: string;
  body?: string;
}

export interface PreviewTemplateDto {
  templateId?: string;
  recordId: string;
  subject?: string;
  body?: string;
  channel?: 'email' | 'whatsapp' | 'sms';
}

export interface TestSendTemplateDto {
  templateId?: string;
  recordId: string;
  connectorId: string;
  toEmail: string;
  subject?: string;
  body?: string;
}

export interface TemplateModel {
  id: string;
  orgId: string;
  channel: string;
  name: string;
  subject: string | null;
  body: string;
  variables: string[];
  createdAt: string;
  deletedAt: string | null;
}

@Injectable()
export class TemplatesService {
  constructor(
    @Inject(PG_CLIENT) private readonly sql: postgres.Sql,
    private readonly connectorsService: ConnectorsService,
  ) {}

  async list(orgId: string, channel?: string): Promise<TemplateModel[]> {
    const rows = channel
      ? await this.sql<TemplateModel[]>`
          SELECT *
          FROM templates
          WHERE org_id = ${orgId}
            AND channel = ${channel}
            AND deleted_at IS NULL
          ORDER BY created_at DESC
        `
      : await this.sql<TemplateModel[]>`
          SELECT *
          FROM templates
          WHERE org_id = ${orgId}
            AND deleted_at IS NULL
          ORDER BY created_at DESC
        `;
    return rows;
  }

  async getById(orgId: string, id: string): Promise<TemplateModel> {
    const [row] = await this.sql<TemplateModel[]>`
      SELECT *
      FROM templates
      WHERE id = ${id}
        AND org_id = ${orgId}
        AND deleted_at IS NULL
    `;
    if (!row) {
      throw new NotFoundError(`Template ${id} not found`);
    }
    return row;
  }

  async create(orgId: string, dto: CreateTemplateDto): Promise<TemplateModel> {
    if (!dto.name || !dto.name.trim()) {
      throw new ValidationError('Name is required', [{ field: 'name', message: 'Name is required' }]);
    }
    if (!dto.body || !dto.body.trim()) {
      throw new ValidationError('Body is required', [{ field: 'body', message: 'Body is required' }]);
    }

    const bodyVars = TemplateEngine.extractVariables(dto.body);
    const subjectVars = dto.subject ? TemplateEngine.extractVariables(dto.subject) : [];
    const allVars = Array.from(new Set([...bodyVars, ...subjectVars]));

    const [created] = await this.sql<TemplateModel[]>`
      INSERT INTO templates (
        org_id,
        channel,
        name,
        subject,
        body,
        variables
      ) VALUES (
        ${orgId},
        ${dto.channel || 'email'},
        ${dto.name.trim()},
        ${dto.subject || null},
        ${dto.body},
        ${JSON.stringify(allVars)}::text::jsonb
      )
      RETURNING *
    `;

    return created;
  }

  async update(orgId: string, id: string, dto: UpdateTemplateDto): Promise<TemplateModel> {
    const current = await this.getById(orgId, id);

    const nextName = dto.name !== undefined ? dto.name.trim() : current.name;
    const nextSubject = dto.subject !== undefined ? dto.subject : current.subject;
    const nextBody = dto.body !== undefined ? dto.body : current.body;
    const nextChannel = dto.channel !== undefined ? dto.channel : current.channel;

    const bodyVars = TemplateEngine.extractVariables(nextBody);
    const subjectVars = nextSubject ? TemplateEngine.extractVariables(nextSubject) : [];
    const allVars = Array.from(new Set([...bodyVars, ...subjectVars]));

    const [updated] = await this.sql<TemplateModel[]>`
      UPDATE templates
      SET
        name = ${nextName},
        channel = ${nextChannel},
        subject = ${nextSubject},
        body = ${nextBody},
        variables = ${JSON.stringify(allVars)}::text::jsonb
      WHERE id = ${id} AND org_id = ${orgId} AND deleted_at IS NULL
      RETURNING *
    `;

    if (!updated) {
      throw new NotFoundError(`Template ${id} not found`);
    }
    return updated;
  }

  async delete(orgId: string, id: string): Promise<void> {
    await this.getById(orgId, id);
    await this.sql`
      UPDATE templates
      SET deleted_at = now()
      WHERE id = ${id} AND org_id = ${orgId}
    `;
  }

  async buildContext(orgId: string, recordId: string): Promise<{ context: TemplateContext; record: any }> {
    const [rec] = await this.sql<any[]>`
      SELECT id, display_name, data, stage_id, pipeline_id, owner_id, created_at
      FROM records
      WHERE id = ${recordId} AND org_id = ${orgId} AND deleted_at IS NULL
    `;

    if (!rec) {
      throw new NotFoundError(`Record ${recordId} not found`);
    }

    let ownerObj: any = undefined;
    if (rec.owner_id) {
      const [u] = await this.sql<any[]>`
        SELECT id, full_name, email
        FROM users
        WHERE id = ${rec.owner_id}
      `;
      if (u) {
        ownerObj = {
          id: u.id,
          fullName: u.full_name,
          email: u.email,
        };
      }
    }

    const [org] = await this.sql<any[]>`
      SELECT name, slug
      FROM organizations
      WHERE id = ${orgId}
    `;

    const context: TemplateContext = {
      record: {
        id: rec.id,
        displayName: rec.display_name,
        data: rec.data || {},
        createdAt: rec.created_at,
      },
      owner: ownerObj,
      org: {
        name: org?.name || 'CRM',
        slug: org?.slug || 'crm',
      },
      link: {
        record: `http://localhost:5173/records/${rec.id}`,
        unsubscribe: `http://localhost:5173/unsubscribe?token=${rec.id}`,
      },
    };

    return { context, record: rec };
  }

  async preview(orgId: string, dto: PreviewTemplateDto) {
    let subjectToRender = dto.subject || '';
    let bodyToRender = dto.body || '';
    const channel = dto.channel || 'email';

    if (dto.templateId) {
      const tpl = await this.getById(orgId, dto.templateId);
      if (!dto.subject && tpl.subject) subjectToRender = tpl.subject;
      if (!dto.body) bodyToRender = tpl.body;
    }

    const { context, record } = await this.buildContext(orgId, dto.recordId);

    const renderedSubject = TemplateEngine.render(subjectToRender, context);
    const renderedBody = TemplateEngine.render(bodyToRender, context, {
      escapeHtml: channel === 'email',
    });

    const vars = Array.from(
      new Set([
        ...TemplateEngine.extractVariables(subjectToRender),
        ...TemplateEngine.extractVariables(bodyToRender),
      ]),
    );

    return {
      recordId: record.id,
      displayName: record.display_name,
      renderedSubject,
      renderedBody,
      variablesUsed: vars,
    };
  }

  async testSend(orgId: string, dto: TestSendTemplateDto) {
    let subjectToRender = dto.subject || '';
    let bodyToRender = dto.body || '';

    if (dto.templateId) {
      const tpl = await this.getById(orgId, dto.templateId);
      if (!dto.subject && tpl.subject) subjectToRender = tpl.subject;
      if (!dto.body) bodyToRender = tpl.body;
    }

    const { context, record } = await this.buildContext(orgId, dto.recordId);

    const renderedSubject = TemplateEngine.render(subjectToRender || 'Test Email Notification', context);
    const renderedBody = TemplateEngine.render(bodyToRender, context);

    const emailResult = await this.connectorsService.sendTestEmail(orgId, dto.connectorId, {
      toEmail: dto.toEmail,
      subject: renderedSubject,
      text: renderedBody,
    });

    return {
      success: true,
      messageId: emailResult.messageId,
      renderedSubject,
      renderedBody,
      record: {
        id: record.id,
        displayName: record.display_name,
      },
    };
  }
}
