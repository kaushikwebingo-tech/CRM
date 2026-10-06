import 'dotenv/config';
import postgres from 'postgres';
import * as argon2 from 'argon2';

const sql = postgres(process.env.DATABASE_URL as string);

async function seed() {
  const [org] = await sql`
    INSERT INTO organizations (name, slug)
    VALUES ('Webingo HQ', 'webingo')
    ON CONFLICT (slug) DO UPDATE SET name = 'Webingo HQ'
    RETURNING id
  `;

  const roles = [
    { name: 'Owner', is_system: true, permissions: '{"all": true}' },
    { name: 'Admin', is_system: true, permissions: '{"manage_modules": true, "manage_users": true, "read_all": true, "write_all": true}' },
    { name: 'Manager', is_system: true, permissions: '{"read_all": true, "write_team": true}' },
    { name: 'Sales Executive', is_system: true, permissions: '{"read_team": true, "write_own": true}' },
    { name: 'Read Only', is_system: true, permissions: '{"read_all": true}' }
  ];

  const roleIds: Record<string, string> = {};
  for (const role of roles) {
    const [r] = await sql`
      INSERT INTO roles (org_id, name, is_system, permissions)
      VALUES (${org.id}, ${role.name}, ${role.is_system}, ${role.permissions}::jsonb)
      RETURNING id
    `;
    roleIds[role.name] = r.id;
  }

  const hash = await argon2.hash('admin123');
  const [user] = await sql`
    INSERT INTO users (org_id, email, password_hash, full_name, role_id)
    VALUES (${org.id}, 'admin@webingo.com', ${hash}, 'Admin User', ${roleIds['Owner']})
    ON CONFLICT (org_id, email) DO NOTHING
    RETURNING id
  `;

  let [leadMod] = await sql`
    SELECT id FROM modules WHERE org_id = ${org.id} AND key = 'lead'
  `;

  if (!leadMod) {
    [leadMod] = await sql`
      INSERT INTO modules (org_id, key, label_singular, label_plural, has_pipeline, name_field_label, is_system)
      VALUES (${org.id}, 'lead', 'Lead', 'Leads', true, 'Lead name', true)
      RETURNING id
    `;

    const sourceOptions = [
      { id: 'website', label: 'Website' },
      { id: 'referral', label: 'Referral' },
      { id: 'whatsapp', label: 'WhatsApp' },
      { id: 'phone', label: 'Phone call' },
      { id: 'walkin', label: 'Walk-in' },
      { id: 'event', label: 'Event' },
      { id: 'linkedin', label: 'LinkedIn' },
      { id: 'other', label: 'Other' }
    ];

    await sql`
      INSERT INTO fields (org_id, module_id, key, label, type, config, position) VALUES
      (${org.id}, ${leadMod.id}, 'source', 'Source', 'select', ${JSON.stringify({ options: sourceOptions })}::jsonb, 1),
      (${org.id}, ${leadMod.id}, 'email', 'Email', 'email', '{}'::jsonb, 2),
      (${org.id}, ${leadMod.id}, 'phone', 'Phone', 'phone', '{}'::jsonb, 3),
      (${org.id}, ${leadMod.id}, 'company', 'Company', 'text', '{}'::jsonb, 4),
      (${org.id}, ${leadMod.id}, 'city', 'City', 'text', '{}'::jsonb, 5),
      (${org.id}, ${leadMod.id}, 'budget', 'Budget', 'currency', ${JSON.stringify({ currencyCode: 'INR' })}::jsonb, 6),
      (${org.id}, ${leadMod.id}, 'requirement', 'Requirement', 'long_text', '{}'::jsonb, 7),
      (${org.id}, ${leadMod.id}, 'follow_up_on', 'Follow Up On', 'date', '{}'::jsonb, 8),
      (${org.id}, ${leadMod.id}, 'tags', 'Tags', 'tags', '{}'::jsonb, 9),
      (${org.id}, ${leadMod.id}, 'lead_no', 'Lead No', 'auto_number', '{}'::jsonb, 10)
    `;

    const [pipeline] = await sql`
      INSERT INTO pipelines (org_id, module_id, name, is_default)
      VALUES (${org.id}, ${leadMod.id}, 'Sales', true)
      RETURNING id
    `;

    await sql`
      INSERT INTO pipeline_stages (org_id, pipeline_id, key, label, type, probability, position) VALUES
      (${org.id}, ${pipeline.id}, 'new', 'New', 'open', 10, 1),
      (${org.id}, ${pipeline.id}, 'contacted', 'Contacted', 'open', 25, 2),
      (${org.id}, ${pipeline.id}, 'qualified', 'Qualified', 'open', 50, 3),
      (${org.id}, ${pipeline.id}, 'proposal', 'Proposal sent', 'open', 70, 4),
      (${org.id}, ${pipeline.id}, 'negotiation', 'Negotiation', 'open', 85, 5),
      (${org.id}, ${pipeline.id}, 'won', 'Won', 'won', 100, 6),
      (${org.id}, ${pipeline.id}, 'lost', 'Lost', 'lost', 0, 7)
    `;

    await sql`
      INSERT INTO views (org_id, module_id, name, type, config, is_default) VALUES
      (${org.id}, ${leadMod.id}, 'All leads', 'table', '{}'::jsonb, true),
      (${org.id}, ${leadMod.id}, 'My open leads', 'table', ${JSON.stringify({ filter: { owner_id: '{me}', stage_type: 'open' } })}::jsonb, false),
      (${org.id}, ${leadMod.id}, 'Follow-ups due', 'table', ${JSON.stringify({ filter: { follow_up_on: { before: '{today}' } } })}::jsonb, false),
      (${org.id}, ${leadMod.id}, 'Pipeline', 'kanban', '{}'::jsonb, false)
    `;
  }

  await sql.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
