import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import postgres from 'postgres';

const MIGRATIONS_DIR = path.join(__dirname, '../../migrations');


async function migrate() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }

  const sql = postgres(databaseUrl, { max: 1 });

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    const applied = new Set<string>(
      (await sql<{ version: string }[]>`SELECT version FROM schema_migrations`).map((r) => r.version),
    );

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let count = 0;
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      if (applied.has(version)) continue;

      const body = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const outsideTransaction = file.endsWith('.noTx.sql');

      if (outsideTransaction) {
        await sql.unsafe(body);
        await sql`INSERT INTO schema_migrations (version) VALUES (${version})`;
      } else {
        await sql.begin(async (tx) => {
          await tx.unsafe(body);
          await tx`INSERT INTO schema_migrations (version) VALUES (${version})`;
        });
      }

      console.log(`applied ${version}`);
      count += 1;
    }

    console.log(count === 0 ? 'no pending migrations' : `applied ${count} migration(s)`);
  } finally {
    await sql.end();
  }
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
