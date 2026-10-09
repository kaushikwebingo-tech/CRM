import 'dotenv/config';
import postgres from 'postgres';
import * as argon2 from 'argon2';


const sql = postgres(process.env.DATABASE_URL as string, { max: 1 });

const SYSTEM_ROLES = [
  {
    name: 'Owner',
    permissions: { all: true },
  },
  {
    name: 'Admin',
    permissions: {
      defaultModule: { read: 'all', create: true, update: 'all', delete: 'all', fields: {} },
      modules: {},
      admin: {
        manageModules: true,
        manageUsers: true,
        manageAutomations: true,
        manageViews: true,
        import: true,
        export: true,
      },
    },
  },
  {
    name: 'Manager',
    permissions: {
      defaultModule: { read: 'all', create: true, update: 'team', delete: 'none', fields: {} },
      modules: {},
      admin: { manageViews: true, export: true, import: true },
    },
  },
  {
    name: 'Sales Executive',
    permissions: {
      defaultModule: { read: 'team', create: true, update: 'own', delete: 'none', fields: {} },
      modules: {},
      admin: {},
    },
  },
  {
    name: 'Read Only',
    permissions: {
      defaultModule: { read: 'all', create: false, update: 'none', delete: 'none', fields: {} },
      modules: {},
      admin: { export: true },
    },
  },
];

const SOURCE_OPTIONS = [
  { id: 'opt_website', label: 'Website', color: 'blue' },
  { id: 'opt_referral', label: 'Referral', color: 'green' },
  { id: 'opt_whatsapp', label: 'WhatsApp', color: 'emerald' },
  { id: 'opt_phone', label: 'Phone call', color: 'violet' },
  { id: 'opt_walkin', label: 'Walk-in', color: 'amber' },
  { id: 'opt_event', label: 'Event', color: 'rose' },
  { id: 'opt_linkedin', label: 'LinkedIn', color: 'sky' },
  { id: 'opt_other', label: 'Other', color: 'slate' },
];


const LEAD_FIELDS = [
  {
    key: 'source', label: 'Source', type: 'select', section: 'General', position: 1,
    config: { options: SOURCE_OPTIONS, allowOther: false },
    isIndexed: true,
  },
  {
    key: 'email', label: 'Email', type: 'email', section: 'Contact', position: 2,
    config: {}, isUnique: true, isSearchable: true, isIndexed: true,
  },
  {
    key: 'phone', label: 'Phone', type: 'phone', section: 'Contact', position: 3,
    config: { defaultCountry: 'IN' }, isSearchable: true, isIndexed: true,
  },
  {
    key: 'company', label: 'Company', type: 'text', section: 'Contact', position: 4,
    config: { maxLength: 200 }, isSearchable: true,
  },
  {
    key: 'city', label: 'City', type: 'text', section: 'Contact', position: 5,
    config: { maxLength: 120 }, isIndexed: true,
  },
  {
    key: 'budget', label: 'Budget', type: 'currency', section: 'Qualification', position: 6,
    config: { currencyCode: 'INR' }, isIndexed: true,
  },
  {
    key: 'requirement', label: 'Requirement', type: 'long_text', section: 'Qualification', position: 7,
    config: {}, isSearchable: true,
  },
  {
    key: 'follow_up_on', label: 'Follow up on', type: 'date', section: 'Qualification', position: 8,
    config: {}, isIndexed: true,
  },
  {
    key: 'tags', label: 'Tags', type: 'tags', section: 'Qualification', position: 9,
    config: {}, isSearchable: true,
  },
  {
    // read-only: the server allocates it from field_sequences
    key: 'lead_no', label: 'Lead no.', type: 'auto_number', section: 'System', position: 10,
    config: { startingNumber: 1 }, isSystem: true,
  },
];

const PIPELINE_STAGES = [
  { key: 'new', label: 'New', type: 'open', probability: 10, color: 'slate' },
  { key: 'contacted', label: 'Contacted', type: 'open', probability: 25, color: 'sky' },
  { key: 'qualified', label: 'Qualified', type: 'open', probability: 50, color: 'blue' },
  { key: 'proposal', label: 'Proposal sent', type: 'open', probability: 70, color: 'violet' },
  { key: 'negotiation', label: 'Negotiation', type: 'open', probability: 85, color: 'amber' },
  { key: 'won', label: 'Won', type: 'won', probability: 100, color: 'emerald' },
  { key: 'lost', label: 'Lost', type: 'lost', probability: 0, color: 'rose' },
];


function leadViews(openStageIds: string[]) {
  return [
    {
      name: 'All leads',
      type: 'table',
      isDefault: true,
      position: 0,
      config: {
        columns: ['display_name', 'stage_id', 'owner_id', 'source', 'phone', 'budget', 'created_at'],
        sort: 'created_at:desc',
      },
    },
    {
      name: 'My open leads',
      type: 'table',
      isDefault: false,
      position: 1,
      config: {
        columns: ['display_name', 'stage_id', 'source', 'phone', 'budget', 'follow_up_on'],
        sort: 'created_at:desc',
        filter: {
          and: [
            { field: 'owner_id', op: 'eq', value: '@me' },
            { field: 'stage_id', op: 'in', value: openStageIds },
          ],
        },
      },
    },
    {
      name: 'Follow-ups due',
      type: 'table',
      isDefault: false,
      position: 2,
      config: {
        columns: ['display_name', 'stage_id', 'owner_id', 'follow_up_on', 'phone'],
        sort: 'follow_up_on:asc',
        filter: {
          or: [
            { field: 'follow_up_on', op: 'within', value: 'overdue' },
            { field: 'follow_up_on', op: 'within', value: 'today' },
          ],
        },
      },
    },
    {
      name: 'Pipeline',
      type: 'kanban',
      isDefault: false,
      position: 3,
      config: { groupBy: 'stage_id', cardFields: ['owner_id', 'budget', 'phone'] },
    },
  ];
}

async function seed() {
  const [org] = await sql`
    INSERT INTO organizations (name, slug, settings)
    VALUES ('Webingo HQ', 'webingo', ${JSON.stringify({ timezone: 'Asia/Kolkata', currency: 'INR' })}::text::jsonb)
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `;

  const roleIds: Record<string, string> = {};
  for (const role of SYSTEM_ROLES) {
    const [existing] = await sql`
      SELECT id FROM roles WHERE org_id = ${org.id} AND name = ${role.name} LIMIT 1
    `;
    if (existing) {
      await sql`
        UPDATE roles SET permissions = ${JSON.stringify(role.permissions)}::text::jsonb, is_system = true
        WHERE id = ${existing.id}
      `;
      roleIds[role.name] = existing.id;
    } else {
      const [created] = await sql`
        INSERT INTO roles (org_id, name, is_system, permissions)
        VALUES (${org.id}, ${role.name}, true, ${JSON.stringify(role.permissions)}::text::jsonb)
        RETURNING id
      `;
      roleIds[role.name] = created.id;
    }
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@webingo.com';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'admin123';
  const hash = await argon2.hash(adminPassword, { type: argon2.argon2id });

  await sql`
    INSERT INTO users (org_id, email, password_hash, full_name, role_id)
    VALUES (${org.id}, ${adminEmail}, ${hash}, 'Admin User', ${roleIds['Owner']})
    ON CONFLICT (org_id, email) DO UPDATE
      SET role_id = EXCLUDED.role_id, is_active = true
  `;

  let [leadMod] = await sql`
    SELECT id FROM modules WHERE org_id = ${org.id} AND key = 'lead' LIMIT 1
  `;

  if (!leadMod) {
    [leadMod] = await sql`
      INSERT INTO modules (
        org_id, key, label_singular, label_plural, icon, color,
        has_pipeline, name_field_label, is_system, position
      )
      VALUES (
        ${org.id}, 'lead', 'Lead', 'Leads', 'user-round-search', 'blue',
        true, 'Lead name', true, 0
      )
      RETURNING id
    `;
  }

  for (const field of LEAD_FIELDS) {
    await sql`
      INSERT INTO fields (
        org_id, module_id, key, label, type, config, section, position,
        is_required, is_unique, is_system, is_indexed, is_searchable
      )
      VALUES (
        ${org.id}, ${leadMod.id}, ${field.key}, ${field.label}, ${field.type},
        ${JSON.stringify(field.config)}::text::jsonb, ${field.section}, ${field.position},
        ${false}, ${field.isUnique ?? false}, ${field.isSystem ?? false},
        ${field.isIndexed ?? false}, ${field.isSearchable ?? false}
      )
      ON CONFLICT (module_id, key) DO UPDATE SET
        label         = EXCLUDED.label,
        config        = EXCLUDED.config,
        section       = EXCLUDED.section,
        position      = EXCLUDED.position,
        is_unique     = EXCLUDED.is_unique,
        is_system     = EXCLUDED.is_system,
        is_indexed    = EXCLUDED.is_indexed,
        is_searchable = EXCLUDED.is_searchable,
        updated_at    = now()
    `;
  }

  let [pipeline] = await sql`
    SELECT id FROM pipelines WHERE org_id = ${org.id} AND module_id = ${leadMod.id} AND name = 'Sales' LIMIT 1
  `;
  if (!pipeline) {
    [pipeline] = await sql`
      INSERT INTO pipelines (org_id, module_id, name, is_default, position)
      VALUES (${org.id}, ${leadMod.id}, 'Sales', true, 0)
      RETURNING id
    `;
  }

  for (const [index, stage] of PIPELINE_STAGES.entries()) {
    await sql`
      INSERT INTO pipeline_stages (org_id, pipeline_id, key, label, type, probability, color, position)
      VALUES (
        ${org.id}, ${pipeline.id}, ${stage.key}, ${stage.label}, ${stage.type},
        ${stage.probability}, ${stage.color}, ${index}
      )
      ON CONFLICT (pipeline_id, key) DO UPDATE SET
        label       = EXCLUDED.label,
        type        = EXCLUDED.type,
        probability = EXCLUDED.probability,
        color       = EXCLUDED.color,
        position    = EXCLUDED.position
    `;
  }

  const openStages = await sql`
    SELECT id FROM pipeline_stages
    WHERE pipeline_id = ${pipeline.id} AND type = 'open' AND deleted_at IS NULL
    ORDER BY position
  `;
  const openStageIds = openStages.map((row) => row.id as string);

  for (const view of leadViews(openStageIds)) {
    const [existing] = await sql`
      SELECT id FROM views
      WHERE org_id = ${org.id} AND module_id = ${leadMod.id} AND name = ${view.name}
      LIMIT 1
    `;
    if (existing) {
      await sql`
        UPDATE views
        SET type = ${view.type}, config = ${JSON.stringify(view.config)}::text::jsonb,
            is_default = ${view.isDefault}, position = ${view.position}
        WHERE id = ${existing.id}
      `;
    } else {
      await sql`
        INSERT INTO views (org_id, module_id, name, type, config, is_default, position)
        VALUES (
          ${org.id}, ${leadMod.id}, ${view.name}, ${view.type},
          ${JSON.stringify(view.config)}::text::jsonb, ${view.isDefault}, ${view.position}
        )
      `;
    }
  }

  console.log(`seeded org ${org.id}: 5 roles, lead module with ${LEAD_FIELDS.length} fields, ` +
    `${PIPELINE_STAGES.length} stages, 4 views`);
  console.log(`admin login: ${adminEmail}`);
}

seed()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error(err);
    await sql.end().catch(() => {});
    process.exit(1);
  });
