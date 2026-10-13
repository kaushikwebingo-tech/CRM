CREATE TABLE IF NOT EXISTS consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  record_id uuid NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  channel text NOT NULL,
  purpose text NOT NULL,
  status text NOT NULL,
  source text NOT NULL,
  evidence jsonb DEFAULT '{}'::jsonb,
  granted_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, record_id, channel, purpose)
);

CREATE INDEX IF NOT EXISTS idx_consents_lookup ON consents(org_id, record_id, channel, purpose);
CREATE INDEX IF NOT EXISTS idx_consents_status ON consents(org_id, status);

ALTER TABLE templates ADD COLUMN IF NOT EXISTS dlt_template_id text;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS dlt_header text;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS approval_status text DEFAULT 'approved';
ALTER TABLE templates ADD COLUMN IF NOT EXISTS category text DEFAULT 'utility';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
