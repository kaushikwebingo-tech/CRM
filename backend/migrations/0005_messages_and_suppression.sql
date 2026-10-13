CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  record_id uuid REFERENCES records(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL,
  channel text NOT NULL,
  direction text NOT NULL,
  connector_id uuid REFERENCES connectors(id),
  from_address text NOT NULL,
  to_address text NOT NULL,
  subject text,
  body_text text,
  body_html text,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  template_id uuid REFERENCES templates(id) ON DELETE SET NULL,
  provider_message_id text,
  in_reply_to text,
  status text NOT NULL,
  status_detail text,
  sent_by uuid REFERENCES users(id) ON DELETE SET NULL,
  automation_run_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connector_id, provider_message_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_record ON messages(org_id, record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(org_id, thread_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_provider_msg_id ON messages(connector_id, provider_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_in_reply_to ON messages(org_id, in_reply_to);

CREATE TABLE IF NOT EXISTS suppression_list (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  address text NOT NULL,
  channel text NOT NULL DEFAULT 'email',
  reason text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, address, channel)
);

CREATE INDEX IF NOT EXISTS idx_suppression_lookup ON suppression_list(org_id, address, channel);
