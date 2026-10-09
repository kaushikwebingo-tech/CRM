import { pgTable, uuid, text, jsonb, timestamp, boolean, integer, numeric, bigint, bigserial, uniqueIndex, index, unique } from 'drizzle-orm/pg-core';
import { isNull, sql } from 'drizzle-orm';

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  settings: jsonb('settings').default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  email: text('email').notNull(),
  passwordHash: text('password_hash'),
  fullName: text('full_name').notNull(),
  avatarUrl: text('avatar_url'),
  roleId: uuid('role_id'),
  isActive: boolean('is_active').default(true).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => {
  return {
    orgEmailUnique: unique('unique_org_email').on(table.orgId, table.email),
  };
});

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  name: text('name').notNull(),
  isSystem: boolean('is_system').default(false).notNull(),
  permissions: jsonb('permissions').default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const modules = pgTable('modules', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  key: text('key').notNull(),
  labelSingular: text('label_singular').notNull(),
  labelPlural: text('label_plural').notNull(),
  icon: text('icon'),
  color: text('color'),
  isSystem: boolean('is_system').default(false).notNull(),
  hasPipeline: boolean('has_pipeline').default(false).notNull(),
  nameFieldLabel: text('name_field_label').default('Name').notNull(),
  titleTemplate: text('title_template'),
  position: integer('position').default(0).notNull(),
  schemaVersion: integer('schema_version').default(1).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => {
  return {
    orgKeyUnique: unique('unique_org_key').on(table.orgId, table.key),
  };
});

export const fields = pgTable('fields', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  moduleId: uuid('module_id').references(() => modules.id, { onDelete: 'cascade' }).notNull(),
  key: text('key').notNull(),
  label: text('label').notNull(),
  type: text('type').notNull(),
  config: jsonb('config').default({}).notNull(),
  isRequired: boolean('is_required').default(false).notNull(),
  isUnique: boolean('is_unique').default(false).notNull(),
  isSystem: boolean('is_system').default(false).notNull(),
  isIndexed: boolean('is_indexed').default(false).notNull(),
  isSearchable: boolean('is_searchable').default(false).notNull(),
  defaultValue: jsonb('default_value'),
  helpText: text('help_text'),
  section: text('section').default('General').notNull(),
  position: integer('position').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => {
  return {
    moduleKeyUnique: unique('unique_module_key').on(table.moduleId, table.key),
  };
});

export const pipelines = pgTable('pipelines', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  moduleId: uuid('module_id').references(() => modules.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  isDefault: boolean('is_default').default(false).notNull(),
  position: integer('position').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const pipelineStages = pgTable('pipeline_stages', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  pipelineId: uuid('pipeline_id').references(() => pipelines.id, { onDelete: 'cascade' }).notNull(),
  key: text('key').notNull(),
  label: text('label').notNull(),
  color: text('color'),
  type: text('type').default('open').notNull(),
  probability: numeric('probability', { precision: 5, scale: 2 }),
  position: integer('position').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => {
  return {
    pipelineKeyUnique: unique('unique_pipeline_key').on(table.pipelineId, table.key),
  };
});

export const records = pgTable('records', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  moduleId: uuid('module_id').references(() => modules.id).notNull(),
  displayName: text('display_name').notNull(),
  ownerId: uuid('owner_id').references(() => users.id),
  pipelineId: uuid('pipeline_id').references(() => pipelines.id),
  stageId: uuid('stage_id').references(() => pipelineStages.id),
  stageSince: timestamp('stage_since', { withTimezone: true }),
  data: jsonb('data').default({}).notNull(),
  searchTsv: text('search_tsv'),
  createdBy: uuid('created_by').references(() => users.id),
  updatedBy: uuid('updated_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => {
  return {
    idxRecordsList: index('idx_records_list').on(table.orgId, table.moduleId, table.createdAt).where(isNull(table.deletedAt)),
    idxRecordsStage: index('idx_records_stage').on(table.orgId, table.moduleId, table.stageId).where(isNull(table.deletedAt)),
    idxRecordsOwner: index('idx_records_owner').on(table.orgId, table.moduleId, table.ownerId).where(isNull(table.deletedAt)),
  };
});

export const recordLinks = pgTable('record_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  sourceRecordId: uuid('source_record_id').references(() => records.id, { onDelete: 'cascade' }).notNull(),
  sourceFieldKey: text('source_field_key').notNull(),
  targetRecordId: uuid('target_record_id').references(() => records.id, { onDelete: 'cascade' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => {
  return {
    uniqueLink: unique('unique_record_link').on(table.sourceRecordId, table.sourceFieldKey, table.targetRecordId),
  };
});

export const views = pgTable('views', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  moduleId: uuid('module_id').references(() => modules.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  type: text('type').default('table').notNull(),
  config: jsonb('config').default({}).notNull(),
  ownerId: uuid('owner_id').references(() => users.id),
  isDefault: boolean('is_default').default(false).notNull(),
  position: integer('position').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const recordEvents = pgTable('record_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  recordId: uuid('record_id').references(() => records.id, { onDelete: 'cascade' }).notNull(),
  moduleId: uuid('module_id').references(() => modules.id).notNull(),
  type: text('type').notNull(),
  actorId: uuid('actor_id'),
  actorType: text('actor_type').default('user').notNull(),
  changes: jsonb('changes'),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const outboxEvents = pgTable('outbox_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  eventType: text('event_type').notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  payload: jsonb('payload').notNull(),
  status: text('status').default('pending').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  lastError: text('last_error'),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
});

export const automations = pgTable('automations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  moduleId: uuid('module_id').references(() => modules.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  isActive: boolean('is_active').default(false).notNull(),
  trigger: jsonb('trigger').notNull(),
  conditions: jsonb('conditions'),
  actions: jsonb('actions').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const automationRuns = pgTable('automation_runs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  automationId: uuid('automation_id').references(() => automations.id, { onDelete: 'cascade' }).notNull(),
  recordId: uuid('record_id'),
  status: text('status').notNull(),
  log: jsonb('log'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

export const connectors = pgTable('connectors', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  providerKey: text('provider_key').notNull(),
  name: text('name').notNull(),
  credentials: text('credentials').notNull(),
  config: jsonb('config').default({}).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const templates = pgTable('templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  channel: text('channel').notNull(),
  name: text('name').notNull(),
  subject: text('subject'),
  body: text('body').notNull(),
  variables: jsonb('variables').default([]).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});


export const adminAudit = pgTable('admin_audit', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  orgId: uuid('org_id').notNull(),
  actorId: uuid('actor_id'),
  actorType: text('actor_type').notNull().default('user'),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id'),
  action: text('action').notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});


export const fieldSequences = pgTable('field_sequences', {
  orgId: uuid('org_id').notNull(),
  fieldId: uuid('field_id').notNull(),
  nextValue: bigint('next_value', { mode: 'number' }).notNull().default(1),
});


export const idempotencyKeys = pgTable('idempotency_keys', {
  orgId: uuid('org_id').notNull(),
  key: text('key').notNull(),
  endpoint: text('endpoint').notNull(),
  requestHash: text('request_hash').notNull(),
  statusCode: integer('status_code').notNull(),
  response: jsonb('response'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});


export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const teamMembers = pgTable('team_members', {
  orgId: uuid('org_id').notNull(),
  teamId: uuid('team_id').notNull(),
  userId: uuid('user_id').notNull(),
});
