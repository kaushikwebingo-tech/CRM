CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  email text NOT NULL,
  password_hash text,
  full_name text NOT NULL,
  avatar_url text,
  role_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_org_email UNIQUE (org_id, email)
);

CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  key text NOT NULL,
  label_singular text NOT NULL,
  label_plural text NOT NULL,
  icon text,
  color text,
  is_system boolean NOT NULL DEFAULT false,
  has_pipeline boolean NOT NULL DEFAULT false,
  name_field_label text NOT NULL DEFAULT 'Name',
  title_template text,
  position integer NOT NULL DEFAULT 0,
  schema_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT unique_org_key UNIQUE (org_id, key)
);

CREATE TABLE IF NOT EXISTS fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  module_id uuid NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  type text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_required boolean NOT NULL DEFAULT false,
  is_unique boolean NOT NULL DEFAULT false,
  is_system boolean NOT NULL DEFAULT false,
  is_indexed boolean NOT NULL DEFAULT false,
  is_searchable boolean NOT NULL DEFAULT false,
  default_value jsonb,
  help_text text,
  section text NOT NULL DEFAULT 'General',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT unique_module_key UNIQUE (module_id, key)
);

CREATE TABLE IF NOT EXISTS pipelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  module_id uuid NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  pipeline_id uuid NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  color text,
  type text NOT NULL DEFAULT 'open',
  probability numeric(5,2),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT unique_pipeline_key UNIQUE (pipeline_id, key)
);

CREATE TABLE IF NOT EXISTS records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  module_id uuid NOT NULL REFERENCES modules(id),
  display_name text NOT NULL,
  owner_id uuid REFERENCES users(id),
  pipeline_id uuid REFERENCES pipelines(id),
  stage_id uuid REFERENCES pipeline_stages(id),
  stage_since timestamptz,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  search_tsv text,
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_records_list ON records (org_id, module_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_records_stage ON records (org_id, module_id, stage_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_records_owner ON records (org_id, module_id, owner_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_records_data ON records USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_records_search ON records USING GIN (search_tsv gin_trgm_ops);

CREATE TABLE IF NOT EXISTS record_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  source_record_id uuid NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  source_field_key text NOT NULL,
  target_record_id uuid NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_record_link UNIQUE (source_record_id, source_field_key, target_record_id)
);

CREATE TABLE IF NOT EXISTS views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  module_id uuid NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'table',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  owner_id uuid REFERENCES users(id),
  is_default boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS record_events (
  id bigserial PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  record_id uuid NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES modules(id),
  type text NOT NULL,
  actor_id uuid,
  actor_type text NOT NULL DEFAULT 'user',
  changes jsonb,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id bigserial PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  event_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  available_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE TABLE IF NOT EXISTS automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  module_id uuid REFERENCES modules(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  trigger jsonb NOT NULL,
  conditions jsonb,
  actions jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id bigserial PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  automation_id uuid NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  record_id uuid,
  status text NOT NULL,
  log jsonb,
  started_at timestamptz NOT NULL,
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS connectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  provider_key text NOT NULL,
  name text NOT NULL,
  credentials text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  channel text NOT NULL,
  name text NOT NULL,
  subject text,
  body text NOT NULL,
  variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
