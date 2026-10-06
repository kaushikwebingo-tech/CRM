import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL as string);

async function migrate() {
  const migrationPath = path.join(__dirname, '../../migrations/0001_foundation.sql');
  const sqlString = fs.readFileSync(migrationPath, 'utf8');
  await sql.unsafe(sqlString);
  await sql.end();
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
