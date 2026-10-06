# CRM Foundation Plan — Metadata-Driven Architecture

Oct 6, 2026 · @Webingo HQ

## Scope

This plan covers one thing: the metadata kernel that makes modules, fields, pipelines and views configurable at runtime, plus the record engine that stores and queries against it. Build this correctly and the rest of the CRM becomes configuration rather than code.

Only one field on a record is fixed: `display_name`. Everything else a user sees on a lead, a deal or a contact is a row in the `fields` table.

**In scope**

- Metadata layer: modules, fields, field types, pipelines, stages, saved views
- Record engine: CRUD against any module, validated from metadata
- Filter, sort and search over dynamic fields
- Frontend that renders forms, tables and kanban boards entirely from metadata
- Module builder UI so an admin adds a module or a field without a developer
- Auth, roles, record ownership, field-level visibility
- Event substrate: every write emits a durable event through an outbox table
- Audit trail and per-record timeline
- CSV import and export

**Deferred, but not blocked**

| Deferred feature | What the foundation must already provide |
| --- | --- |
| Automation builder | Event stream, filter DSL, action interface (Section 10) |
| Email service | Connector registry and credential store |
| WhatsApp service | Same connector registry, plus template entity |
| Template engine | Variable resolution against record data |
| Formula and rollup fields | Field type registry that accepts new types (Section 5) |
| Reports and dashboards | Filter DSL already compiles to SQL aggregates |
| Mobile app | Same REST API, no separate backend |

**How to use this document**

Hand it to the implementing agent as the single source of truth. Sections 4 to 8 are the contract — data model, field types, schema compiler, API, filter DSL — and should be implemented exactly as written. Section 15 gives the build order. Section 17 lists the rules that must not be broken, because breaking them is what turns a dynamic CRM into a rewrite eighteen months later.

## The metadata kernel

The whole system rests on one idea: what a lead *is* lives in database rows, not in code. A `modules` row says a Lead exists; `fields` rows say what a Lead has; `pipeline_stages` rows say how it moves. A compiler turns those rows into validators, SQL expressions and form definitions, and every other part of the system reads only the compiled result.

&#91;embedded content: metadata kernel · 3 layers, one compiler\]

Nothing below the compiler knows what a lead is. The API validates a lead because the compiler handed it a schema; the UI draws a lead form because the compiler handed it a field list. Add a module and all three layers pick it up with no deploy.

**The one static field.** Every record has `display_name` — the thing you see in a list, a search result and a kanban card. It is a real column because every screen needs it and every sort and search touches it. Everything else a user defines lives in `data`.

**What this buys.** Adding "Site Visit" with eight fields and a four-stage pipeline is an admin task, not a sprint. The cost is that the first two months are spent building a kernel rather than screens, which is why the milestones in Section 15 deliberately put a usable Lead module in front of the team early.

## Tech stack

TypeScript end to end, PostgreSQL as the only database, one small VPS. The team already works in MERN and Flutter, so the only real change from house habit is Postgres instead of MongoDB — and that change is the one that makes a dynamic CRM viable.

| Layer | Choice | Why this one |
| --- | --- | --- |
| Runtime | Node 22 LTS, TypeScript strict | Team's existing language; one language across API, worker and UI |
| API framework | NestJS | Opinionated structure keeps many hands and AI agents consistent; guards and interceptors map cleanly onto permissions and audit |
| Database | PostgreSQL 16 | JSONB for dynamic fields, relational integrity for everything else, full-text search built in — no second datastore |
| Query layer | Drizzle ORM | SQL-first, no query-engine binary, \~0 runtime overhead, and it lets us build dynamic SQL safely — Prisma fights both JSONB and runtime-built queries |
| Validation | Zod | One schema shape shared by API validation, form rendering and the filter builder |
| Cache and queue | Redis 7 + BullMQ | Metadata cache, sessions, and the job runner the automation engine will need |
| Frontend | React 18 + Vite | Static bundle, no SSR server to pay for or operate |
| UI kit | Tailwind + shadcn/ui (Radix) | Accessible primitives, fully owned code, no component-library lock-in; this is what makes it feel like a product rather than an admin panel |
| Tables | TanStack Table + TanStack Virtual | 50,000 rows scroll at 60fps because only visible rows mount |
| Server state | TanStack Query | Caching, optimistic updates and background refetch out of the box |
| Forms | react-hook-form + zod resolver | Uncontrolled inputs mean a 40-field dynamic form does not re-render on every keystroke |
| Drag and drop | dnd-kit | Kanban, field reordering, layout builder |
| Files | Cloudflare R2 | S3-compatible, no egress charges |
| Mobile, later | Flutter | Same REST API, team already builds in it |

**Why PostgreSQL and not MongoDB.** The instinct for "all fields dynamic" is a document database, and it is the wrong instinct here. A CRM is relational at its core: leads belong to owners, link to companies, move through stages, and every list view is a filtered, sorted, joined query. Postgres gives schemaless storage through `JSONB` while keeping foreign keys, transactions, joins and aggregates. A record write that must update a record, append an audit entry and enqueue an event has to be one transaction, and that is a weak spot in Mongo. Postgres also indexes inside JSONB — `CREATE INDEX ON records ((data->>'city'))` performs like a real column.

**Rejected, with reasons**

| Rejected | Reason |
| --- | --- |
| Next.js | Internal app behind login, no SEO value; an SSR process costs RAM and deploy complexity for nothing |
| EAV tables (one row per field value) | Every list view becomes a self-join per column; it is the classic choice that makes a CRM unusably slow at 100k records |
| One physical table per module | Runtime `CREATE TABLE` and migrations on user action; brittle, hard to back up, hard to reason about |
| Prisma | Heavier runtime, poor fit for queries built at runtime from metadata |
| Supabase / Firebase | Fast start, but the filter engine and permission model we need are exactly what you lose control of |
| Microservices | A single API process and a single worker process is the correct shape at this size |

## Data model

One `records` table holds every record of every module. Core columns that every record has are real columns; everything an admin defines lives in a `JSONB` column called `data`. This is the single decision the whole system rests on.

`org_id` appears on every table from day one. It costs one column and one index prefix now, and it is the difference between this staying internal and being sellable later.

### Identity and tenancy

```sql
create extension if not exists "pgcrypto";
create extension if not exists "citext";
create extension if not exists "pg_trgm";

create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique not null,
  settings    jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

create table users (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id),
  email         citext not null,
  password_hash text,
  full_name     text not null,
  avatar_url    text,
  role_id       uuid,
  is_active     boolean not null default true,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (org_id, email)
);
```

### Metadata layer

```sql
create table modules (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id),
  key              text not null,          -- 'lead', 'deal' — immutable after creation
  label_singular   text not null,
  label_plural     text not null,
  icon             text,
  color            text,
  is_system        boolean not null default false,
  has_pipeline     boolean not null default false,
  name_field_label text not null default 'Name',  -- label shown for display_name
  title_template   text,                   -- optional, e.g. '{{first_name}} {{last_name}}'
  position         integer not null default 0,
  schema_version   integer not null default 1,    -- bumped on ANY field change
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  unique (org_id, key)
);

create table fields (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  module_id     uuid not null references modules(id) on delete cascade,
  key           text not null,             -- snake_case, immutable, = the JSONB key
  label         text not null,             -- freely renameable
  type          text not null,             -- see the field type registry
  config        jsonb not null default '{}',
  is_required   boolean not null default false,
  is_unique     boolean not null default false,
  is_system     boolean not null default false,
  is_indexed    boolean not null default false,  -- true => build an expression index
  is_searchable boolean not null default false,  -- true => feed search_tsv
  default_value jsonb,
  help_text     text,
  section       text not null default 'General',
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  unique (module_id, key)
);
```

Select options live inside `fields.config` as an ordered array, each with a stable id:

```json
{ "options": [
  { "id": "opt_7f3a", "label": "Website",  "color": "blue" },
  { "id": "opt_9b21", "label": "Referral", "color": "green" }
] }
```

Records store the option **id**, never the label. Renaming "Website" to "Organic" then updates one metadata row and no records.

### Pipelines

```sql
create table pipelines (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  module_id  uuid not null references modules(id) on delete cascade,
  name       text not null,
  is_default boolean not null default false,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table pipeline_stages (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  pipeline_id uuid not null references pipelines(id) on delete cascade,
  key         text not null,
  label       text not null,
  color       text,
  type        text not null default 'open',   -- 'open' | 'won' | 'lost'
  probability numeric(5,2),
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (pipeline_id, key)
);
```

### The records table

```sql
create table records (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id),
  module_id    uuid not null references modules(id),
  display_name text not null,                      -- the ONE static field
  owner_id     uuid references users(id),
  pipeline_id  uuid references pipelines(id),
  stage_id     uuid references pipeline_stages(id),
  stage_since  timestamptz,                        -- powers "days in stage"
  data         jsonb not null default '{}',        -- every dynamic field
  search_tsv   tsvector,
  created_by   uuid references users(id),
  updated_by   uuid references users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index idx_records_list   on records (org_id, module_id, created_at desc) where deleted_at is null;
create index idx_records_stage  on records (org_id, module_id, stage_id)        where deleted_at is null;
create index idx_records_owner  on records (org_id, module_id, owner_id)        where deleted_at is null;
create index idx_records_data   on records using gin (data jsonb_path_ops);
create index idx_records_search on records using gin (search_tsv);
create index idx_records_name   on records using gin (display_name gin_trgm_ops);
```

**Hot field promotion.** When an admin flags a field as indexed, a background job runs one whitelisted statement:

```sql
create index concurrently idx_rec_lead_email
  on records ((data->>'email'))
  where module_id = '…' and deleted_at is null;
```

This is the only runtime DDL the system is allowed to issue, it only ever creates or drops an index, and the identifier is built from a validated `module.key` and `field.key`. Nothing else may generate DDL.

### Relations

A lookup field stores the target uuid inside `data`. A mirror table keeps reverse lookups fast, written in the same transaction as the record.

```sql
create table record_links (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null,
  source_record_id uuid not null references records(id) on delete cascade,
  source_field_key text not null,
  target_record_id uuid not null references records(id) on delete cascade,
  created_at       timestamptz not null default now(),
  unique (source_record_id, source_field_key, target_record_id)
);
create index idx_links_target on record_links (target_record_id, source_field_key);
```

### Views, timeline, outbox

```sql
create table views (
  id        uuid primary key default gen_random_uuid(),
  org_id    uuid not null,
  module_id uuid not null references modules(id) on delete cascade,
  name      text not null,
  type      text not null default 'table',   -- 'table' | 'kanban' | 'calendar'
  config    jsonb not null default '{}',     -- columns, widths, sort, group_by, filter
  owner_id  uuid references users(id),       -- null = shared with the org
  is_default boolean not null default false,
  position  integer not null default 0,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table record_events (                 -- audit trail and record timeline
  id         bigserial primary key,
  org_id     uuid not null,
  record_id  uuid not null references records(id) on delete cascade,
  module_id  uuid not null,
  type       text not null,                  -- created | updated | stage_changed | note | email_sent
  actor_id   uuid,
  actor_type text not null default 'user',   -- user | system | automation
  changes    jsonb,                          -- { field_key: { from, to } }
  payload    jsonb,
  created_at timestamptz not null default now()
);
create index idx_events_record on record_events (record_id, created_at desc);

create table outbox_events (
  id           bigserial primary key,
  org_id       uuid not null,
  event_type   text not null,
  aggregate_id uuid not null,
  payload      jsonb not null,
  status       text not null default 'pending',  -- pending | processing | done | failed
  attempts     integer not null default 0,
  last_error   text,
  available_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);
create index idx_outbox_pending on outbox_events (available_at) where status = 'pending';
```

### Tables defined now, used later

Create these in the first migration even though nothing writes to them until the automation phase. Defining them now forces the write path to be shaped correctly from the start.

```sql
create table automations (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  module_id  uuid references modules(id) on delete cascade,
  name       text not null,
  is_active  boolean not null default false,
  trigger    jsonb not null,    -- { type: 'record.updated', fieldKeys: ['stage_id'] }
  conditions jsonb,             -- filter DSL, same grammar as list views
  actions    jsonb not null,    -- ordered [{ type, config }]
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table automation_runs (
  id            bigserial primary key,
  org_id        uuid not null,
  automation_id uuid not null references automations(id) on delete cascade,
  record_id     uuid,
  status        text not null,   -- running | success | failed | skipped
  log           jsonb,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create table connectors (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  provider_key text not null,     -- 'smtp' | 'sendgrid' | 'whatsapp_cloud' | 'webhook'
  name         text not null,
  credentials  bytea not null,    -- encrypted at rest, never returned by the API
  config       jsonb not null default '{}',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create table templates (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  channel    text not null,       -- email | whatsapp | sms
  name       text not null,
  subject    text,
  body       text not null,       -- {{display_name}}, {{data.city}}
  variables  jsonb not null default '[]',
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
```

## Field type registry

A field type is declared once, in one file, and the rest of the system reads it. Adding currency, or a formula field two years from now, means writing one definition and one React component — not touching the API, the filter engine or the form renderer.

```ts
export interface FieldTypeDef<TConfig = unknown, TValue = unknown> {
  key: string;                       // 'select', 'currency'
  label: string;
  group: 'basic' | 'advanced' | 'relation' | 'system';

  configSchema: ZodType<TConfig>;    // validates fields.config on creation
  valueSchema(config: TConfig): ZodType<TValue>;  // validates a stored value

  sqlType: 'text' | 'numeric' | 'boolean' | 'timestamptz' | 'uuid' | 'jsonb';
  operators: FilterOperator[];       // which filters the UI may offer

  normalize(input: unknown, config: TConfig): TValue | null;  // what is written to data
  toSearchText(value: TValue, config: TConfig): string;       // feeds search_tsv
  toExportString(value: TValue, config: TConfig): string;     // CSV
  parseImport(raw: string, config: TConfig): TValue | null;   // CSV

  formComponent: string;             // key into the frontend component registry
  cellComponent: string;
  filterComponent: string;

  isSortable: boolean;
  canBeIndexed: boolean;
  canBeUnique: boolean;
}
```

**Ship these in v1**

| Type | Stored as | Notes |
| --- | --- | --- |
| `text` | string | max length in config |
| `long_text` | string | textarea, optional rich text later |
| `number` | number | precision in config |
| `currency` | number | currency code in config, stored as a plain number |
| `percent` | number | stored 0–100 |
| `date` | ISO date string | no timezone |
| `datetime` | ISO timestamp | stored UTC, rendered in org timezone |
| `boolean` | boolean |  |
| `select` | option id | options in config |
| `multi_select` | array of option ids |  |
| `email` | string | format-validated, click to compose |
| `phone` | string | E.164 normalised; WhatsApp depends on this |
| `url` | string |  |
| `user` | uuid | references `users` |
| `lookup` | uuid | references another module's record; mirrored to `record_links` |
| `file` | array of `{ key, name, size, mime }` | R2 object keys |
| `tags` | array of strings | free-form, suggests existing values |
| `auto_number` | number | sequence per module, read-only |

**Deliberately not in v1:** `formula`, `rollup`, `geo`, `signature`, `rating`. Each is a new `FieldTypeDef` plus one component when the time comes, and `formula` additionally needs a safe expression evaluator — a project of its own.

**Config shapes.** The registry validates `fields.config` against `configSchema`, so a malformed field definition is rejected at creation rather than at render time. For example:

```ts
const selectConfig = z.object({
  options: z.array(z.object({
    id: z.string().regex(/^opt_[a-z0-9]{4,}$/),
    label: z.string().min(1).max(80),
    color: z.string().optional(),
  })).min(1).max(200),
  allowOther: z.boolean().default(false),
});

const lookupConfig = z.object({
  targetModuleKey: z.string(),
  displayFieldKey: z.string().optional(),   // what to show on the chip
  onDelete: z.enum(['set_null', 'restrict']).default('set_null'),
});
```

**Rules the registry enforces.** A field's `key` is immutable once created, because records already store data under it. A field's `type` is immutable too — changing type means creating a new field and migrating values through an explicit job, never an in-place cast. Deleting a field is a soft delete: the metadata row is marked deleted and the data stays in `records.data`, so an accidental delete is recoverable by an admin.

## Schema compiler

The schema compiler turns metadata rows into the runtime objects the rest of the system needs. It runs once per module per schema version, caches the result, and everything else — validation, SQL, forms, filters, imports — reads from that cache instead of hitting the metadata tables.

```ts
export interface CompiledModule {
  id: string;
  key: string;
  schemaVersion: number;
  labels: { singular: string; plural: string };
  hasPipeline: boolean;

  fields: CompiledField[];
  fieldsByKey: Map<string, CompiledField>;

  createSchema: ZodObject;        // validates a POST body
  updateSchema: ZodObject;        // same, all keys optional
  sqlColumns: Map<string, SqlExpr>;  // field key -> SQL expression + cast
  searchableKeys: string[];
  uniqueKeys: string[];
  defaults: Record<string, unknown>;
}

export interface SqlExpr {
  sql: string;        // "r.owner_id"  or  "(r.data->>'budget')::numeric"
  type: 'text' | 'numeric' | 'boolean' | 'timestamptz' | 'uuid' | 'jsonb';
  nullable: boolean;
}
```

**How a field becomes SQL.** Core fields map to real columns; dynamic fields map to a JSONB path plus the cast declared by their type. This map is the only place in the codebase that is allowed to produce a column expression.

| Field | SQL expression |
| --- | --- |
| `display_name` | `r.display_name` |
| `owner_id` | `r.owner_id` |
| `stage_id` | `r.stage_id` |
| `created_at` | `r.created_at` |
| `email` (text) | `(r.data->>'email')` |
| `budget` (currency) | `(r.data->>'budget')::numeric` |
| `follow_up` (date) | `(r.data->>'follow_up')::date` |
| `is_qualified` (boolean) | `(r.data->>'is_qualified')::boolean` |
| `tags` (multi\_select) | `(r.data->'tags')` with `jsonb` containment operators |

### Caching and invalidation

`modules.schema_version` is incremented inside the same transaction as any change to that module's fields or stages. The compiled object is cached in two layers:

1. In-process `Map`, keyed by `moduleId:schemaVersion` — a cache hit costs nothing.
2. Redis, same key, so a restarted process or a second API instance warms instantly.

On a metadata write, the API publishes `schema.invalidated` on a Redis pub/sub channel. Every process drops that module from its in-process map. No TTL guessing, no stale forms.

### The schema bundle

The frontend never queries metadata table by table. On boot it fetches one bundle:

```http
GET /api/schema
ETag: "org_8f2a:v47"
```

The response carries every module, its fields, its pipelines and stages, and the user's permission map. The ETag is the org's aggregate schema version, so a returning user gets a `304` and the app renders from `localStorage` with no spinner. This single request is what makes a fully dynamic UI feel instant rather than chatty.

### One compiler, four consumers

| Consumer | What it takes from the compiled module |
| --- | --- |
| API validation | `createSchema` / `updateSchema` |
| Filter engine | `sqlColumns` and each type's allowed operators |
| Form renderer | field list, types, config, sections, order |
| Automation engine | the same `sqlColumns` for conditions, the same field list for actions |

The fourth row is the point. When automations arrive, they do not need a parallel notion of what a field is.

## API surface

There is no `/api/leads` controller. There is one generic record controller that takes a module key, and the module key is data. Adding a module adds zero backend code.

### Metadata

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/schema` | The whole bundle: modules, fields, pipelines, permissions. ETag cached |
| `GET` | `/api/modules` | List modules |
| `POST` | `/api/modules` | Create a module (seeds a default view and, if `has_pipeline`, a default pipeline) |
| `PATCH` | `/api/modules/:key` | Rename, reorder, change icon |
| `DELETE` | `/api/modules/:key` | Soft delete; blocked for `is_system` modules |
| `GET` | `/api/modules/:key/fields` | Field definitions |
| `POST` | `/api/modules/:key/fields` | Add a field |
| `PATCH` | `/api/modules/:key/fields/:fieldKey` | Change label, help text, required, position, options |
| `DELETE` | `/api/modules/:key/fields/:fieldKey` | Soft delete |
| `POST` | `/api/modules/:key/fields/reorder` | Bulk position update |
| `GET POST PATCH DELETE` | `/api/modules/:key/pipelines[/:id]` | Pipelines |
| `GET POST PATCH DELETE` | `/api/pipelines/:id/stages[/:id]` | Stages |
| `GET POST PATCH DELETE` | `/api/modules/:key/views[/:id]` | Saved views |

### Records

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/modules/:key/records` | List. Query params: `view`, `filter`, `sort`, `cursor`, `limit`, `q`, `fields` |
| `POST` | `/api/modules/:key/records` | Create |
| `GET` | `/api/modules/:key/records/:id` | Single record, with expanded lookups |
| `PATCH` | `/api/modules/:key/records/:id` | Partial update; only the keys sent are touched |
| `DELETE` | `/api/modules/:key/records/:id` | Soft delete |
| `POST` | `/api/modules/:key/records/bulk` | Bulk update, bulk delete, bulk assign |
| `PATCH` | `/api/modules/:key/records/:id/stage` | Move stage; writes `stage_since` and a timeline entry |
| `GET` | `/api/modules/:key/records/:id/timeline` | Audit and activity feed |
| `POST` | `/api/modules/:key/records/:id/notes` | Add a note |
| `GET` | `/api/modules/:key/records/count` | Count with the same filter grammar, for kanban headers |
| `POST` | `/api/modules/:key/import` | CSV import, returns a job id |
| `GET` | `/api/modules/:key/export` | CSV export, streamed |

### Request and response shape

Create is deliberately flat — core fields at the top level, dynamic fields inside `data`:

```json
POST /api/modules/lead/records
{
  "display_name": "Ananya Sharma",
  "owner_id": "…",
  "stage_id": "…",
  "data": {
    "email": "ananya@acme.in",
    "phone": "+919830012345",
    "source": "opt_7f3a",
    "budget": 450000
  }
}
```

List responses use keyset pagination, never `OFFSET`:

```json
{
  "records": [ … ],
  "nextCursor": "eyJjIjoiMjAyNi0xMC0wNlQwOTowMDowMFoiLCJpZCI6IjkxYTIifQ",
  "hasMore": true,
  "schemaVersion": 47
}
```

The cursor encodes the sort key plus the record id. `schemaVersion` lets the client notice its cached schema is stale and refetch the bundle.

### Conventions

- Errors are RFC 7807 problem documents with a `fields` array for validation failures, keyed by field key so the form can mark the right input.
- Every mutating request takes an `Idempotency-Key` header; replays return the original response. This matters once automations start calling the API.
- `PATCH` is a merge on `data`, not a replace. Sending `{"data":{"city":"Kolkata"}}` leaves the other 30 keys alone.
- Write `null` explicitly to clear a field; omitting the key means "do not touch".
- Rate limit per user and per org at the edge; 300 requests per minute is generous for a CRM and stops a runaway import from starving everyone.

## Filter and query DSL

One JSON grammar expresses every filter in the system: a list view, a kanban column, a report, and later an automation condition. It is written once and compiled to parameterised SQL.

```json
{
  "and": [
    { "field": "stage_id", "op": "in", "value": ["stg_new", "stg_contacted"] },
    { "field": "owner_id", "op": "eq", "value": "@me" },
    { "or": [
      { "field": "city",   "op": "eq",  "value": "Kolkata" },
      { "field": "budget", "op": "gte", "value": 500000 }
    ]},
    { "field": "follow_up", "op": "within", "value": "next_7_days" }
  ]
}
```

Nesting is unlimited in grammar but capped at depth 5 in the validator. `field` is a field key — never a column name, never a path the client invents.

### Operators by type

| Type group | Operators |
| --- | --- |
| text, long\_text, email, url, phone | `eq` `neq` `contains` `not_contains` `starts_with` `ends_with` `is_empty` `is_not_empty` |
| number, currency, percent | `eq` `neq` `gt` `gte` `lt` `lte` `between` `is_empty` `is_not_empty` |
| date, datetime | `eq` `before` `after` `between` `within` `is_empty` `is_not_empty` |
| boolean | `is_true` `is_false` `is_empty` |
| select, user, lookup | `eq` `neq` `in` `not_in` `is_empty` `is_not_empty` |
| multi\_select, tags | `has_any` `has_all` `has_none` `is_empty` `is_not_empty` |

`within` takes a relative token rather than a date, so a saved view stays correct tomorrow: `today`, `yesterday`, `this_week`, `last_7_days`, `next_7_days`, `this_month`, `last_month`, `this_quarter`, `overdue`.

`@me` resolves to the requesting user, so "My open leads" is one shared view instead of one per salesperson.

### Compilation rules

The compiler is the single place in the codebase that builds SQL fragments, and it follows four rules without exception.

1. **Resolve, never trust.** `field` is looked up in `CompiledModule.fieldsByKey`. An unknown key is a `400`, not an empty result. The SQL expression comes from `sqlColumns`, which the compiler built — the client's string never reaches the query.
2. **Operator must be legal for the type.** `contains` on a currency field is rejected before any SQL exists.
3. **Values are always bound.** Every literal becomes `$1`, `$2`. There is no string concatenation of values anywhere, for any reason.
4. **Sort is whitelisted the same way.** `sort=budget:desc` resolves through `sqlColumns` and the type's `isSortable` flag, then appends `, r.id desc` so keyset pagination is deterministic.

A worked example:

```sql
-- { "and": [ {stage_id in [...]}, {budget gte 500000} ] }
select r.*
from records r
where r.org_id = $1
  and r.module_id = $2
  and r.deleted_at is null
  and r.stage_id = any($3::uuid[])
  and (r.data->>'budget')::numeric >= $4
  and (r.created_at, r.id) < ($5, $6)      -- keyset cursor
order by r.created_at desc, r.id desc
limit $7;
```

### Search

Free text search (`?q=`) runs against `search_tsv`, which is rebuilt on write from `display_name` plus every field whose `is_searchable` is true, using each type's `toSearchText`. Short queries under three characters fall back to a trigram prefix match on `display_name`, so the global search box responds while the user is still typing.

### Guarding against the obvious failure

The risk in a dynamic filter engine is a user-supplied string reaching SQL. The defence is structural, not a sanitiser: the compiler accepts a typed AST, resolves every identifier against compiled metadata, and binds every value. Write one test suite that feeds the compiler hostile input — unknown fields, SQL in field names, 50-deep nesting, arrays of 100,000 ids — and asserts a rejection rather than a query.

## Pipelines and stages

A module with `has_pipeline = true` gains a kanban view and stage tracking. Stages are rows, so an admin builds "New → Contacted → Qualified → Proposal → Won / Lost" in the UI and renames or reorders it later without a deploy.

**Multiple pipelines per module.** A lead module may carry a Domestic pipeline and an Export pipeline with different stages. The record stores both `pipeline_id` and `stage_id`, and the API rejects a stage that does not belong to the record's pipeline.

**Stage types drive behaviour.** Each stage is `open`, `won` or `lost`. The kanban hides won and lost columns behind a toggle, reports count only `won` as conversion, and "days in stage" stops accruing once a record reaches a terminal stage. One column, three behaviours, no hardcoded stage names.

**Moving a stage is its own endpoint.** `PATCH /records/:id/stage` is not a generic field update, because moving a stage must do four things atomically:

1. Update `stage_id` and set `stage_since = now()`
2. Write a `stage_changed` entry to `record_events` with the from and to stage
3. Enqueue a `record.stage_changed` outbox event
4. Return the updated record so the kanban card settles without a refetch

**Reordering within a column.** Cards carry a `position` inside `data` as a fractional index — dropping between `1.0` and `2.0` writes `1.5`. This avoids renumbering every card in the column on each drag, which is what makes a kanban feel laggy at 200 cards.

**Deleting a stage.** Blocked while records sit in it. The UI asks the admin to pick a destination stage, moves those records in one bulk update, then soft-deletes the stage. Never orphan a record's `stage_id`.

**Kanban loading.** Each column is its own keyset-paginated query with a separate count, loading 25 cards and fetching more as the column scrolls. Loading every record of every stage at once is the single most common reason a CRM kanban feels slow.

## Events and the automation substrate

Build this now, expose it later. The automation builder is deferred, but the plumbing underneath it is not, because retrofitting an event stream into a system that already has 40 write paths is the expensive version of this work.

**One write path.** Every record mutation — API, CSV import, bulk action, and later an automation itself — goes through `RecordService`. Controllers do no writing. That single funnel is what makes the event stream trustworthy.

**Transactional outbox.** In one transaction, a write updates `records`, appends to `record_events`, and inserts into `outbox_events`. Either all three land or none do. A separate worker polls the outbox and dispatches. This is why a dropped Redis connection can never lose an automation trigger.

&#91;embedded content: write path · synchronous transaction, asynchronous dispatch\]

The request returns as soon as the transaction commits. Dispatch happens after, so a slow webhook or a WhatsApp timeout never shows up to the user as a slow save.

### The event envelope

```ts
interface DomainEvent {
  id: string;
  orgId: string;
  type: 'record.created' | 'record.updated' | 'record.deleted'
      | 'record.stage_changed' | 'record.owner_changed';
  moduleKey: string;
  recordId: string;
  actor: { id: string | null; type: 'user' | 'system' | 'automation' };
  occurredAt: string;
  changes?: Record<string, { from: unknown; to: unknown }>;  // changed keys only
  snapshot: { display_name: string; data: Record<string, unknown>; stage_id?: string };
}
```

`changes` carries only the keys that actually changed. That is what lets a future automation trigger on "when Budget changes" without inspecting the whole record.

### The action interface

Define this interface in the foundation and ship exactly one implementation — `webhook` — so the shape is proven end to end before email and WhatsApp arrive.

```ts
interface ActionHandler<TConfig> {
  key: string;                       // 'send_email', 'send_whatsapp', 'update_field'
  label: string;
  configSchema: ZodType<TConfig>;    // renders the action's settings form
  requiresConnector?: string;        // 'smtp' | 'whatsapp_cloud'
  execute(ctx: ActionContext, config: TConfig): Promise<ActionResult>;
}

interface ActionContext {
  orgId: string;
  event: DomainEvent;
  record: CompiledRecord;
  resolve(template: string): string;   // '{{display_name}}' -> 'Ananya Sharma'
  logger: Logger;
}
```

An action's settings form is rendered from `configSchema` by the same machinery that renders a record form. Adding WhatsApp later is one handler file plus one connector entry — no changes to the builder UI.

### Planned actions

| Action | Phase | Needs |
| --- | --- | --- |
| `webhook` | Foundation | Nothing — proves the loop |
| `update_field` | Automation phase | Guard against loops |
| `assign_owner` | Automation phase | Round-robin or rule |
| `create_record` | Automation phase | Target module key |
| `send_email` | Email phase | SMTP or SendGrid connector, template |
| `send_whatsapp` | WhatsApp phase | Cloud API connector, approved template |
| `wait` | Later | A delayed BullMQ job |
| `http_request` | Later | Outbound allowlist |

### Loop protection, from day one

An automation that updates a field fires `record.updated`, which can fire the same automation. Three guards, all cheap, all much easier to build now than to retrofit:

1. Every event carries a `causationChain` of automation ids. An automation already in the chain is skipped.
2. A chain longer than 10 is dropped and logged as a failed run.
3. Per record, a maximum of 50 automation executions per hour, tracked in Redis.

### Worker shape

One worker process, BullMQ queues on Redis, concurrency 5. Jobs are idempotent by `outbox_events.id`. Failures retry with exponential backoff — 1s, 10s, 60s, 5m, 30m — then land in a dead-letter queue an admin can inspect and replay. The worker is a separate process from the API so a slow webhook never blocks a page load.

## Frontend architecture

The frontend hardcodes exactly one field name: `display_name`. Everything else it draws comes from the schema bundle. The whole app is roughly a dozen screens that take a module key as a parameter.

### The component registry

```ts
export const FIELD_COMPONENTS: Record<string, FieldComponentSet> = {
  text:         { Input: TextInput,     Cell: TextCell,     Filter: TextFilter },
  currency:     { Input: CurrencyInput, Cell: CurrencyCell, Filter: NumberFilter },
  select:       { Input: SelectInput,   Cell: BadgeCell,    Filter: SelectFilter },
  multi_select: { Input: MultiInput,    Cell: BadgeListCell,Filter: MultiFilter },
  lookup:       { Input: LookupInput,   Cell: LinkCell,     Filter: LookupFilter },
  // …one entry per field type
};
```

`<DynamicForm module={m} />` maps over `m.fields`, groups by `section`, and renders `FIELD_COMPONENTS[field.type].Input`. `<DynamicTable />` does the same with `Cell`. A new field type is one registry entry and one component.

### Route map

| Route | Screen |
| --- | --- |
| `/m/:moduleKey` | List or kanban, driven by the active view |
| `/m/:moduleKey/:recordId` | Record detail with tabs: Details, Timeline, Notes, Related |
| `/m/:moduleKey/views/:viewId` | A saved view |
| `/settings/modules` | Module list, create module |
| `/settings/modules/:key/fields` | Field builder — add, reorder, configure |
| `/settings/modules/:key/pipelines` | Pipeline and stage builder |
| `/settings/users` | Users and roles |
| `/search` | Global search across modules |

### State

- **Server state:** TanStack Query. Query keys are `[moduleKey, 'records', filterHash, cursor]`, so switching views is a cache hit on the way back.
- **Schema:** fetched once, held in a React context, persisted to `localStorage` keyed by schema version, revalidated with the ETag on focus.
- **UI state:** Zustand for sidebar collapse, selected rows, open panels. No Redux.
- **Forms:** react-hook-form with a Zod resolver built at runtime from field metadata. Uncontrolled inputs mean a 40-field form does not re-render while typing.

### What makes it feel like a product

- Optimistic updates everywhere: inline edits, stage drags and checkbox toggles paint instantly and roll back on error with a toast.
- Skeletons that match the final layout, never a centred spinner, and never a layout shift when data lands.
- Inline editing in the table — click a cell, edit, tab to the next. Salespeople live in the grid, not in forms.
- Command palette on `Cmd/Ctrl+K` for search, record creation and navigation.
- Keyboard: `j`/`k` to move between rows, `e` to edit, `Esc` to close. This is what separates professional software from an admin panel.
- Toasts carry an Undo for destructive actions, backed by soft delete.
- A real empty state per module — an icon, a line of copy, and a primary action.
- 150–200ms transitions, nothing slower; motion should acknowledge, not perform.

### Module builder UI

The settings screens are the product, not an afterthought — this is what makes the system dynamic in practice rather than in theory. Adding a field is a side panel: pick a type from a grid of icons, give it a label, the key is slugged automatically and shown as read-only, configure type-specific options, drag it into position. Live preview of the form beside the builder. Changing a field label updates every view immediately because they all read the same bundle.

## Auth and permissions

Session cookies, not JWTs in `localStorage`. A signed, `httpOnly`, `SameSite=Lax` cookie holds a session id; the session lives in Redis with a 30-day sliding expiry. Revoking a user's access is a Redis delete, which a stateless JWT cannot give you.

Password hashing with Argon2id. TOTP two-factor available per user and enforceable per org.

### Roles

Roles are rows, so an admin can create "Sales Executive" or "Regional Head" without a deploy.

```sql
create table roles (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  name        text not null,
  is_system   boolean not null default false,
  permissions jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
```

```json
{
  "modules": {
    "lead": {
      "read":   "team",        "create": true,
      "update": "own",         "delete": "none",
      "fields": {
        "budget":        { "read": true,  "write": false },
        "internal_note": { "read": false, "write": false }
      }
    }
  },
  "admin": { "manageModules": false, "manageUsers": false, "manageAutomations": false }
}
```

**Record scope** is one of `all`, `team`, `own`, `none`. It compiles into a `WHERE` clause appended by the same query builder that handles filters — `own` becomes `r.owner_id = $n`, `team` resolves through a team membership table. Permission is never applied by filtering results in application code after the fetch; that approach breaks pagination counts and leaks row totals.

**Field-level permission** is applied in two places. The schema bundle omits fields the user cannot read, so the UI never renders them. The API strips them from responses and rejects writes to read-only fields. Both, because the first is for usability and the second is for security.

**System roles seeded on install:** Owner, Admin, Manager, Sales Executive, Read Only. `is_system` roles cannot be deleted, only duplicated and edited.

**Audit.** Every write records actor, timestamp and the changed keys in `record_events`. Metadata changes — a field added, a stage renamed, a role edited — go to a separate `admin_audit` table. When someone asks in six months why a field disappeared, the answer should be in the database.

## Performance budget

These are targets to test against, not aspirations. A dynamic system is slower by default than a hardcoded one, so the budget has to be explicit or it will quietly be lost.

| Measure | Target | Hard ceiling |
| --- | --- | --- |
| List view, 50 rows, p95 | 120 ms | 300 ms |
| Record detail, p95 | 100 ms | 250 ms |
| Record save, p95 | 150 ms | 400 ms |
| Kanban column load | 150 ms | 350 ms |
| Global search, first result | 200 ms | 500 ms |
| Initial JS bundle, gzipped | 180 KB | 250 KB |
| Time to interactive, cold, 4G | 1.8 s | 3 s |
| Grid scroll | 60 fps at 50,000 rows | no dropped frames below 30 |
| API memory, steady | 300 MB | 500 MB |

### The rules that hold the budget

**Never offset.** Keyset pagination throughout. `OFFSET 10000` reads 10,000 rows to throw them away.

**Never N+1.** A list view with three lookup columns must resolve all referenced records in one batched query, not one per row. Build a DataLoader-style batcher in the record service and make it the only way lookups are expanded.

**Select what is needed.** `?fields=display_name,email,stage_id` lets the list view ask for six columns instead of a 40-key `data` blob. The table view sends this automatically from the view's column config.

**Count cheaply.** An exact count on a filtered 200k-row table is expensive on every page. Use the planner's estimate above 10,000 rows and show "2,000+", the way fast CRMs do.

**Cache the schema, not the data.** Compiled metadata is cached hard because it changes rarely and is read on every request. Record data is not cached, because stale records in a CRM destroy trust.

**Promote hot fields.** Any field used in a saved view's filter or sort should carry `is_indexed`. Surface this in the admin UI: if a view filters an unindexed field and the module has more than 10,000 records, show a one-click "Add index".

**Virtualize anything over 50 rows.** The DOM, not the database, is what makes a grid stutter.

**Watch the right thing.** `pg_stat_statements` on from day one. A weekly look at the top 10 queries by total time catches regressions before users report them.

### Capacity on the recommended server

A 2 vCPU / 4 GB VPS, correctly indexed, comfortably handles around 500,000 records across all modules and 50 concurrent users. The first scaling move is vertical, to 4 vCPU / 8 GB, which roughly quadruples that. Only past that does splitting Postgres onto its own machine become worthwhile, and the application needs no change for it.

## Infrastructure and cost

One VPS, five containers, Docker Compose. No Kubernetes, no managed services, no per-seat SaaS in the critical path.

```yaml
services:
  caddy:     # TLS + static SPA + reverse proxy to api     ~50 MB
  api:       # NestJS                                      ~300 MB
  worker:    # BullMQ consumer                             ~200 MB
  postgres:  # 16-alpine                                   ~1 GB
  redis:     # 7-alpine, maxmemory 256mb, allkeys-lru       ~256 MB
```

Caddy serves the built React bundle directly from disk and proxies `/api` to the API container, so there is no Node process in the path of a page load. TLS certificates renew themselves.

**Postgres tuning for 4 GB** — the defaults assume a far smaller machine and will cost you a factor of several on list queries:

```
shared_buffers = 1GB
effective_cache_size = 3GB
work_mem = 16MB
maintenance_work_mem = 256MB
random_page_cost = 1.1          # SSD
max_connections = 50            # the API pools at 20
```

### Monthly cost

| Item | Choice | Monthly |
| --- | --- | --- |
| Application server | Hetzner CPX21, 3 vCPU / 4 GB / 80 GB | \~₹650 |
| Object storage | Cloudflare R2, first 10 GB | ₹0 |
| Off-site backups | Backblaze B2, \~20 GB | \~₹50 |
| Domain and DNS | Cloudflare | \~₹100 |
| Email sending, later | Amazon SES, 50k mails | \~₹450 |
| Error tracking | Sentry free tier | ₹0 |
| Uptime monitoring | Uptime Kuma on the same box | ₹0 |
| **Total before email** |  | **\~₹800/month** |

If Hetzner's EU latency is a concern for a Kolkata-based team, DigitalOcean Bangalore at 2 vCPU / 4 GB is roughly ₹2,000/month and worth the difference for a daily-use internal tool. Latency to Europe adds roughly 120–150 ms to every request, which is most of the list-view budget.

### Operational basics

- **Backups:** `pg_dump` nightly to B2, retained 30 days, plus WAL archiving once the data matters. Restore tested monthly — an untested backup is not a backup.
- **Deploys:** GitHub Actions builds images, pushes to GHCR, SSHes in and runs `docker compose up -d`. Migrations run as a pre-start job. Under 3 minutes end to end.
- **Environments:** production and a staging compose file on the same box with a separate database. A second server is not justified yet.
- **Secrets:** a `.env` file with 600 permissions, and connector credentials encrypted in the database with a key from the environment. Not Vault, not at this size.
- **Logs:** JSON to stdout, collected by Docker, rotated at 100 MB. Add Loki only when grep stops being enough.

## Build order

Nine milestones in three phases. The implementing agent should stop at each acceptance criterion for review rather than running the whole sequence unattended — a wrong turn in M1 is cheap, the same turn discovered in M6 is not.

&#91;embedded content: build order · 9 milestones, 3 gates\]

The middle phase is marked because that is where the system first earns its keep. Get the sales team onto the Lead module at the end of M5 and three weeks of real use will tell you more about what the module builder needs than any amount of further planning.

| # | Milestone | Done when |
| --- | --- | --- |
| M0 | Repo, Docker Compose, CI, auth | A developer clones, runs one command, logs in as a seeded admin, and sees an empty shell |
| M1 | Metadata CRUD + schema compiler + `/api/schema` | Creating a module and five fields of five types through the API returns a correct compiled bundle with a bumped version |
| M2 | Record engine: CRUD, validation, filter DSL, search | 10,000 seeded leads filter on three dynamic fields in under 120 ms, and the hostile-input test suite passes |
| M3 | Dynamic form + dynamic table | Adding a field in the database makes it appear in the form and the grid on refresh, with no frontend change |
| M4 | Pipelines, stages, kanban | A lead drags between stages, `stage_since` updates, the timeline records the move |
| M5 | Saved views, bulk actions, CSV import and export | A salesperson saves "My open leads", bulk-assigns 50 records, and imports a 2,000-row CSV |
| M6 | Timeline, notes, file attachments, global search | Every change to a record is visible on its timeline with the actor and the old value |
| M7 | Outbox, worker, webhook action | Creating a lead delivers a webhook within 5 seconds, and it still delivers when the receiver was down for the first two attempts |
| M8 | Module builder UI, roles UI | An admin builds a "Site Visit" module with six field types and a three-stage pipeline, start to finish, in the browser |

**Rough effort, as an estimate rather than a commitment.** With two full-time developers who know the stack, Phase 1 is around four weeks, Phase 2 around five, Phase 3 around four — so roughly three months to M8. M1 and M2 carry most of the risk, because every later milestone inherits their decisions. Budget review time there rather than speed.

## Seed data: the default Lead module

The installer seeds one module so the system is usable on first login, and so the implementing agent has a concrete target. Every row below is seed data, not code — an admin can rename, reorder or delete any of it except `display_name`.

**Module:** `lead` · Lead / Leads · `has_pipeline = true` · `name_field_label = "Lead name"` · `is_system = true`

| Field key | Label | Type | Section | Flags |
| --- | --- | --- | --- | --- |
| `display_name` | Lead name | *core, static* | General | required |
| `owner_id` | Owner | *core* | General | indexed |
| `stage_id` | Stage | *core* | General | indexed |
| `source` | Source | select | General | indexed |
| `email` | Email | email | Contact | unique, searchable, indexed |
| `phone` | Phone | phone | Contact | searchable, indexed |
| `company` | Company | text | Contact | searchable |
| `city` | City | text | Contact | indexed |
| `budget` | Budget | currency (INR) | Qualification | indexed |
| `requirement` | Requirement | long\_text | Qualification | searchable |
| `follow_up_on` | Follow up on | date | Qualification | indexed |
| `tags` | Tags | tags | Qualification | — |
| `lead_no` | Lead no. | auto\_number | System | read-only |

**Source options** (ids abbreviated): Website, Referral, WhatsApp, Phone call, Walk-in, Event, LinkedIn, Other.

**Default pipeline:** Sales

| Stage | Type | Probability |
| --- | --- | --- |
| New | open | 10 |
| Contacted | open | 25 |
| Qualified | open | 50 |
| Proposal sent | open | 70 |
| Negotiation | open | 85 |
| Won | won | 100 |
| Lost | lost | 0 |

**Default views**

- *All leads* — table; columns: lead name, stage, owner, source, phone, budget, created; sorted newest first.
- *My open leads* — table; filter `owner_id eq @me` and `stage.type eq open`.
- *Follow-ups due* — table; filter `follow_up_on within overdue` or `today`.
- *Pipeline* — kanban grouped by stage.

**Acceptance test for the whole foundation.** With this seed in place, an admin should be able to add a module called "Site Visit" with six fields of six different types, build a three-stage pipeline for it, create a saved view filtered on two of those fields, and have a salesperson use it — without a developer touching the repository. If that works, the foundation is done.

## Guardrails

These are the rules that keep a dynamic system from decaying into a hardcoded one. Each exists because violating it is the cheap option in the moment and the expensive one six months later. Give this list to the implementing agent as non-negotiable.

**Data model**

1. No EAV table. Values live in `records.data`, never one row per field value.
2. No table per module. One `records` table, always.
3. No runtime DDL except whitelisted `CREATE INDEX` / `DROP INDEX` on `records`, built from validated module and field keys.
4. A field's `key` and `type` are immutable after creation. Labels change freely.
5. Select values are stored as option ids, never labels.
6. Soft delete everywhere. No `DELETE FROM records` in application code.

**Backend**

7. All SQL is parameterised. The filter compiler is the only module that builds SQL fragments, and only from metadata-resolved identifiers.
8. Every record write goes through `RecordService`, in one transaction that also writes `record_events` and `outbox_events`. No controller, job or script writes to `records` directly.
9. No module-specific endpoint. If you find yourself writing `LeadController`, the design has been abandoned.
10. No business logic in controllers. Controllers validate, delegate, serialise.
11. Permissions are applied in the query, never by filtering fetched rows in JavaScript.
12. Every mutating endpoint accepts `Idempotency-Key`.

**Frontend**

13. `display_name` is the only field key that may appear in a component. Everything else comes from the schema bundle.
14. No `if (field.key === 'email')`. Behaviour belongs to the field *type*, in the registry.
15. No `if (moduleKey === 'lead')`. Behaviour belongs to module *metadata* — add a flag to the module if one is genuinely needed.
16. Any list over 50 rows is virtualised.
17. No blocking spinner on a route that has cached data; render stale, revalidate.

**Process**

18. Every milestone ships with its migration, its tests and its seed data. No "we'll add indexes later".
19. The filter compiler's hostile-input test suite is written in the same milestone as the compiler, not after.
20. When a requirement seems to need a hardcoded field, the correct move is to make metadata expressive enough to describe it. Every exception granted here compounds.

## Open decisions

Seven questions where the plan takes a default. Confirm or change each before M1; most are cheap now and expensive later.

| # | Question | Default taken here | Why it matters |
| --- | --- | --- | --- |
| 1 | Internal tool only, or a product you may sell? | `org_id` on every table, single org in use | Retrofitting tenancy later touches every query |
| 2 | Hetzner (EU) or DigitalOcean Bangalore? | Hetzner for cost | \~130 ms added latency per request from Europe |
| 3 | Team hierarchy for the `team` permission scope? | Flat — owner or everyone | Changes the roles model and the query builder |
| 4 | Does the sales team need this on mobile in phase one? | No; Flutter app after the foundation | Affects API shape and offline needs |
| 5 | WhatsApp provider when that phase arrives | Meta Cloud API direct | Gupshup or Interakt is faster to approve, costlier per message |
| 6 | Email sending: your own SMTP or SES? | SES | Deliverability for cold outreach is a different problem from transactional mail |
| 7 | Migrating existing lead data from somewhere? | Assumed none | An import of real data in M5 changes the field seed |

**One recommendation beyond the questions.** Resist adding Deals, Contacts, Companies and Activities as separate system modules in the foundation. Ship Lead alone, use it internally for three weeks, then create the others *through the module builder*. If building Deals requires a developer, the foundation has failed, and three weeks is a far cheaper time to learn that than three months.

**What to hand the coding agent.** This document in full, plus the instruction to work milestone by milestone from Section 15 and to stop at each acceptance criterion for review rather than running M0 to M8 unattended.
