import { Injectable, Inject } from '@nestjs/common';
import postgres from 'postgres';
import Redis from 'ioredis';
import { PG_CLIENT } from '../db/connection';
import { REDIS } from '../auth/session.service';
import { NotFoundError, ValidationError } from '../common/errors';
import { CredentialVault } from './credential-vault';
import { getProvider, getAllProviders } from './provider-registry';
import { ConnectorModel } from './provider.interface';
import { SmtpProvider } from './providers/smtp.provider';

export interface CreateConnectorDto {
  providerKey: string;
  name: string;
  config: Record<string, any>;
  credentials: Record<string, any>;
  isActive?: boolean;
}

export interface UpdateConnectorDto {
  name?: string;
  config?: Record<string, any>;
  credentials?: Record<string, any>;
  isActive?: boolean;
}

@Injectable()
export class ConnectorsService {
  constructor(
    @Inject(PG_CLIENT) private readonly sql: postgres.Sql,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async list(orgId: string): Promise<ConnectorModel[]> {
    const rows = await this.sql<any[]>`
      SELECT id, org_id, provider_key, name, config, is_active, created_at
      FROM connectors
      WHERE org_id = ${orgId}
      ORDER BY created_at DESC
    `;

    return rows.map((r) => ({
      id: r.id,
      orgId: r.org_id,
      providerKey: r.provider_key,
      name: r.name,
      config: r.config || {},
      isActive: r.is_active,
      createdAt: r.created_at,
    }));
  }

  async getById(orgId: string, id: string): Promise<ConnectorModel> {
    const [row] = await this.sql<any[]>`
      SELECT id, org_id, provider_key, name, config, is_active, created_at
      FROM connectors
      WHERE id = ${id} AND org_id = ${orgId}
    `;

    if (!row) {
      throw new NotFoundError(`Connector ${id} not found`);
    }

    return {
      id: row.id,
      orgId: row.org_id,
      providerKey: row.provider_key,
      name: row.name,
      config: row.config || {},
      isActive: row.is_active,
      createdAt: row.created_at,
    };
  }

  async getInternalWithCredentials(id: string): Promise<{ connector: ConnectorModel; credentials: any }> {
    const [row] = await this.sql<any[]>`
      SELECT *
      FROM connectors
      WHERE id = ${id}
    `;

    if (!row) {
      throw new NotFoundError(`Connector ${id} not found`);
    }

    const decrypted = CredentialVault.decrypt(row.credentials);
    return {
      connector: {
        id: row.id,
        orgId: row.org_id,
        providerKey: row.provider_key,
        name: row.name,
        config: row.config || {},
        isActive: row.is_active,
        createdAt: row.created_at,
      },
      credentials: decrypted,
    };
  }

  async create(orgId: string, dto: CreateConnectorDto): Promise<ConnectorModel> {
    const provider = getProvider(dto.providerKey);
    if (!provider) {
      throw new ValidationError(`Unknown provider: ${dto.providerKey}`, [
        { field: 'providerKey', message: `Unknown provider: ${dto.providerKey}` },
      ]);
    }

    const parsedConfig = provider.configSchema.safeParse(dto.config || {});
    if (!parsedConfig.success) {
      throw new ValidationError('Invalid connector configuration', [
        { field: 'config', message: parsedConfig.error.message },
      ]);
    }

    const parsedCreds = provider.credentialSchema.safeParse(dto.credentials || {});
    if (!parsedCreds.success) {
      throw new ValidationError('Invalid connector credentials', [
        { field: 'credentials', message: parsedCreds.error.message },
      ]);
    }

    const encryptedCredentials = CredentialVault.encrypt(parsedCreds.data);

    let healthStatus = { ok: true, detail: 'Not checked yet', lastCheckedAt: new Date().toISOString() };
    try {
      const hc = await provider.healthCheck({
        config: parsedConfig.data,
        credentials: parsedCreds.data,
      });
      healthStatus = {
        ok: hc.ok,
        detail: hc.detail || (hc.ok ? 'Healthy' : 'Health check failed'),
        lastCheckedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      healthStatus = {
        ok: false,
        detail: err.message || 'Health check error',
        lastCheckedAt: new Date().toISOString(),
      };
    }

    const finalConfig = {
      ...parsedConfig.data,
      _health: healthStatus,
    };

    const [created] = await this.sql<any[]>`
      INSERT INTO connectors (
        org_id,
        provider_key,
        name,
        credentials,
        config,
        is_active
      ) VALUES (
        ${orgId},
        ${dto.providerKey},
        ${dto.name.trim()},
        ${encryptedCredentials},
        ${JSON.stringify(finalConfig)}::text::jsonb,
        ${dto.isActive ?? true}
      )
      RETURNING id, org_id, provider_key, name, config, is_active, created_at
    `;

    return {
      id: created.id,
      orgId: created.org_id,
      providerKey: created.provider_key,
      name: created.name,
      config: created.config,
      isActive: created.is_active,
      createdAt: created.created_at,
    };
  }

  async update(orgId: string, id: string, dto: UpdateConnectorDto): Promise<ConnectorModel> {
    const [current] = await this.sql<any[]>`
      SELECT *
      FROM connectors
      WHERE id = ${id} AND org_id = ${orgId}
    `;

    if (!current) {
      throw new NotFoundError(`Connector ${id} not found`);
    }

    const provider = getProvider(current.provider_key);
    if (!provider) {
      throw new NotFoundError(`Provider ${current.provider_key} not registered`);
    }

    let credentialsToStore = current.credentials;
    let rawCredentials = CredentialVault.decrypt(current.credentials);

    if (dto.credentials && Object.keys(dto.credentials).length > 0) {
      const parsedCreds = provider.credentialSchema.safeParse(dto.credentials);
      if (!parsedCreds.success) {
        throw new ValidationError('Invalid credentials', [
          { field: 'credentials', message: parsedCreds.error.message },
        ]);
      }
      credentialsToStore = CredentialVault.encrypt(parsedCreds.data);
      rawCredentials = parsedCreds.data;
    }

    const nextConfig = dto.config ? { ...current.config, ...dto.config } : current.config;
    delete nextConfig._health;

    let healthStatus = current.config?._health;
    try {
      const hc = await provider.healthCheck({
        config: nextConfig,
        credentials: rawCredentials,
      });
      healthStatus = {
        ok: hc.ok,
        detail: hc.detail || (hc.ok ? 'Healthy' : 'Health check failed'),
        lastCheckedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      healthStatus = {
        ok: false,
        detail: err.message || 'Health check error',
        lastCheckedAt: new Date().toISOString(),
      };
    }

    const finalConfig = {
      ...nextConfig,
      _health: healthStatus,
    };

    const nextName = dto.name !== undefined ? dto.name.trim() : current.name;
    const nextIsActive = dto.isActive !== undefined ? dto.isActive : current.is_active;

    const [updated] = await this.sql<any[]>`
      UPDATE connectors
      SET
        name = ${nextName},
        credentials = ${credentialsToStore},
        config = ${JSON.stringify(finalConfig)}::text::jsonb,
        is_active = ${nextIsActive}
      WHERE id = ${id} AND org_id = ${orgId}
      RETURNING id, org_id, provider_key, name, config, is_active, created_at
    `;

    return {
      id: updated.id,
      orgId: updated.org_id,
      providerKey: updated.provider_key,
      name: updated.name,
      config: updated.config,
      isActive: updated.is_active,
      createdAt: updated.created_at,
    };
  }

  async delete(orgId: string, id: string): Promise<void> {
    await this.getById(orgId, id);
    await this.sql`
      DELETE FROM connectors
      WHERE id = ${id} AND org_id = ${orgId}
    `;
  }

  async runHealthCheck(orgId: string, id: string): Promise<{ ok: boolean; detail?: string }> {
    const [row] = await this.sql<any[]>`
      SELECT *
      FROM connectors
      WHERE id = ${id} AND org_id = ${orgId}
    `;

    if (!row) {
      throw new NotFoundError(`Connector ${id} not found`);
    }

    const provider = getProvider(row.provider_key);
    if (!provider) {
      throw new NotFoundError(`Provider ${row.provider_key} not found`);
    }

    const credentials = CredentialVault.decrypt(row.credentials);
    let result: { ok: boolean; detail?: string } = { ok: false, detail: 'Failed' };
    try {
      result = await provider.healthCheck({
        config: row.config,
        credentials,
      });
    } catch (err: any) {
      result = { ok: false, detail: err.message || 'Health check error' };
    }

    const updatedConfig = {
      ...row.config,
      _health: {
        ok: result.ok,
        detail: result.detail,
        lastCheckedAt: new Date().toISOString(),
      },
    };

    await this.sql`
      UPDATE connectors
      SET config = ${JSON.stringify(updatedConfig)}::text::jsonb
      WHERE id = ${id}
    `;

    return result;
  }

  async sendTestEmail(
    orgId: string,
    id: string,
    options: { toEmail: string; subject?: string; text?: string },
  ): Promise<{ success: boolean; messageId: string }> {
    const [row] = await this.sql<any[]>`
      SELECT *
      FROM connectors
      WHERE id = ${id} AND org_id = ${orgId}
    `;

    if (!row) {
      throw new NotFoundError(`Connector ${id} not found`);
    }

    const provider = getProvider(row.provider_key);
    if (!provider || !provider.capabilities.includes('send_email')) {
      throw new ValidationError('Connector does not support send_email capability', [
        { field: 'providerKey', message: 'Connector cannot send emails' },
      ]);
    }

    const credentials = CredentialVault.decrypt(row.credentials);
    const smtp = provider as SmtpProvider;

    const res = await smtp.sendMail(row.config, credentials, {
      to: options.toEmail,
      subject: options.subject || 'Test Email from CRM Connector',
      text: options.text || 'This is a test email sent from your CRM connector setup.',
    });

    return {
      success: true,
      messageId: res.messageId,
    };
  }

  async acquireRateLimit(connectorId: string, limitPerSecond: number): Promise<boolean> {
    const key = `crm:ratelimit:${connectorId}:${Math.floor(Date.now() / 1000)}`;
    const current = await this.redis.incr(key);
    if (current === 1) {
      await this.redis.expire(key, 2);
    }
    return current <= limitPerSecond;
  }

  async recordCircuitFailure(connectorId: string): Promise<boolean> {
    const failKey = `crm:circuit:fail:${connectorId}`;
    const failures = await this.redis.incr(failKey);
    if (failures === 1) {
      await this.redis.expire(failKey, 3600);
    }
    if (failures >= 10) {
      await this.redis.set(`crm:circuit:open:${connectorId}`, '1', 'EX', 300);
      return false;
    }
    return true;
  }

  async isCircuitOpen(connectorId: string): Promise<boolean> {
    const open = await this.redis.get(`crm:circuit:open:${connectorId}`);
    return Boolean(open);
  }

  getProviders() {
    return getAllProviders().map((p) => ({
      key: p.key,
      label: p.label,
      category: p.category,
      icon: p.icon,
      capabilities: p.capabilities,
      rateLimit: p.rateLimit,
      auth: p.auth,
    }));
  }
}
