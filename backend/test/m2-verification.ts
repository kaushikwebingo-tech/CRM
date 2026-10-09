import 'dotenv/config';
import postgres from 'postgres';

const BASE_URL = 'http://localhost:9000/api';
const sql = postgres(process.env.DATABASE_URL as string);

interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
}

const results: TestResult[] = [];

async function login(): Promise<string> {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@webingo.com', password: 'admin123' }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.statusText}`);
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('No cookie received');
  return setCookie.split(';')[0];
}

async function runHostileInputTests(cookie: string) {
  const tests = [
    {
      name: 'SQL injection in field name',
      filter: { field: "'; DROP TABLE records; --", op: 'eq', value: 'bad' },
      expectedStatus: 400,
    },
    {
      name: 'Unknown field rejected',
      filter: { field: 'fake_field_never_exists', op: 'eq', value: 'bad' },
      expectedStatus: 400,
    },
    {
      name: 'Illegal operator for type rejected',
      filter: { field: 'budget', op: 'contains', value: 'bad' },
      expectedStatus: 400,
    },
    {
      name: 'Nesting depth exceeded rejected',
      filter: {
        and: [{
          and: [{
            and: [{
              and: [{
                and: [{
                  and: [{ field: 'city', op: 'eq', value: 'Kolkata' }]
                }]
              }]
            }]
          }]
        }]
      },
      expectedStatus: 400,
    },
    {
      name: 'Array size limit in filter rejected',
      filter: {
        field: 'city',
        op: 'in',
        value: Array.from({ length: 1005 }, (_, i) => String(i)),
      },
      expectedStatus: 400,
    },
  ];

  for (const t of tests) {
    const url = `${BASE_URL}/modules/lead/records?filter=${encodeURIComponent(JSON.stringify(t.filter))}`;
    const res = await fetch(url, { headers: { Cookie: cookie } });
    const passed = res.status === t.expectedStatus;
    results.push({
      name: t.name,
      passed,
      detail: `HTTP status: ${res.status} (expected ${t.expectedStatus})`,
    });
  }
}

async function runCrudAndEventsTest(cookie: string) {
  const createRes = await fetch(`${BASE_URL}/modules/lead/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      display_name: 'Aditi Roy',
      data: {
        email: 'aditi@example.com',
        phone: '+919876543210',
        city: 'Kolkata',
        budget: 750000,
        source: 'website',
      },
    }),
  });

  if (!createRes.ok) {
    results.push({ name: 'Record Creation', passed: false, detail: `Status: ${createRes.status}` });
    return;
  }

  const created = await createRes.json();
  const recordId = created.id;
  results.push({ name: 'Record Creation', passed: true, detail: `Created record ID: ${recordId}` });

  const getRes = await fetch(`${BASE_URL}/modules/lead/records/${recordId}`, {
    headers: { Cookie: cookie },
  });
  const fetched = await getRes.json();
  const getPassed = fetched.id === recordId && fetched.data.city === 'Kolkata';
  results.push({ name: 'Record Read', passed: getPassed, detail: `Fetched display_name: ${fetched.display_name}` });

  const patchRes = await fetch(`${BASE_URL}/modules/lead/records/${recordId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      data: { budget: 900000, city: 'Bengaluru' },
    }),
  });
  const patched = await patchRes.json();
  const patchPassed = patched.data.budget === 900000 && patched.data.city === 'Bengaluru';
  results.push({ name: 'Record Partial Update', passed: patchPassed, detail: `New budget: ${patched.data.budget}` });

  const auditRows = await sql`
    SELECT type, changes FROM record_events
    WHERE record_id = ${recordId}
    ORDER BY created_at ASC
  `;
  const auditPassed = auditRows.length >= 2;
  results.push({
    name: 'Transactional Audit Trail (record_events)',
    passed: auditPassed,
    detail: `Logged events: ${auditRows.map((r: any) => r.type).join(', ')}`,
  });

  const outboxRows = await sql`
    SELECT event_type FROM outbox_events
    WHERE aggregate_id = ${recordId}
    ORDER BY created_at ASC
  `;
  const outboxPassed = outboxRows.length >= 2;
  results.push({
    name: 'Transactional Outbox (outbox_events)',
    passed: outboxPassed,
    detail: `Logged outbox events: ${outboxRows.map((r: any) => r.event_type).join(', ')}`,
  });

  const deleteRes = await fetch(`${BASE_URL}/modules/lead/records/${recordId}`, {
    method: 'DELETE',
    headers: { Cookie: cookie },
  });
  results.push({ name: 'Record Soft Delete', passed: deleteRes.ok, detail: `Status: ${deleteRes.status}` });
}

async function runBenchmark(cookie: string) {
  const [countRow] = await sql`
    SELECT count(*)::int as count FROM records
    WHERE module_id = (SELECT id FROM modules WHERE key = 'lead')
      AND deleted_at IS NULL
  `;
  const currentCount = countRow ? countRow.count : 0;

  if (currentCount < 10000) {
    const toInsert = 10000 - currentCount;
    process.stdout.write(`Seeding ${toInsert} records for 10k benchmark... `);

    const [leadMod] = await sql`SELECT id, org_id FROM modules WHERE key = 'lead'`;
    const cities = ['Kolkata', 'Mumbai', 'Delhi', 'Bengaluru', 'Hyderabad', 'Chennai', 'Pune'];
    const sources = ['website', 'referral', 'whatsapp', 'phone', 'walkin', 'event', 'linkedin', 'other'];

    const batchSize = 1000;
    for (let batch = 0; batch < toInsert; batch += batchSize) {
      const recordsToBatch = Math.min(batchSize, toInsert - batch);
      const rows = [];
      for (let i = 0; i < recordsToBatch; i++) {
        const idx = batch + i;
        const city = cities[idx % cities.length];
        const source = sources[idx % sources.length];
        const budget = 100000 + (idx % 20) * 50000;
        rows.push({
          org_id: leadMod.org_id,
          module_id: leadMod.id,
          display_name: `Benchmark Lead ${idx}`,
          data: JSON.stringify({
            city,
            source,
            budget,
            email: `lead_${idx}@benchmark.org`,
            phone: `+9198000${String(idx).padStart(5, '0')}`,
          }),
          search_tsv: `Benchmark Lead ${idx} ${city} lead_${idx}@benchmark.org`,
        });
      }

      await sql`
        INSERT INTO records ${sql(rows, 'org_id', 'module_id', 'display_name', 'data', 'search_tsv')}
      `;
    }
    process.stdout.write('Done.\n');
  }

  const filter = {
    and: [
      { field: 'city', op: 'eq', value: 'Kolkata' },
      { field: 'budget', op: 'gte', value: 300000 },
      { field: 'source', op: 'eq', value: 'website' },
    ],
  };

  const iterations = 10;
  const timings: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const res = await fetch(`${BASE_URL}/modules/lead/records?filter=${encodeURIComponent(JSON.stringify(filter))}&limit=50`, {
      headers: { Cookie: cookie },
    });
    const duration = performance.now() - start;
    if (res.ok) {
      timings.push(duration);
    }
  }

  timings.sort((a, b) => a - b);
  const p50 = timings[Math.floor(timings.length * 0.5)];
  const p95 = timings[Math.floor(timings.length * 0.95)];

  const passed = p95 < 120;
  results.push({
    name: '10,000 Records 3-Field Dynamic Query Benchmark',
    passed,
    detail: `p50: ${p50.toFixed(1)}ms | p95: ${p95.toFixed(1)}ms (Target: < 120ms)`,
  });
}

async function main() {
  const cookie = await login();

  await runHostileInputTests(cookie);
  await runCrudAndEventsTest(cookie);
  await runBenchmark(cookie);

  let allPassed = true;
  for (const r of results) {
    const mark = r.passed ? 'PASS' : 'FAIL';
    console.log(`[${mark}] ${r.name}: ${r.detail}`);
    if (!r.passed) allPassed = false;
  }

  await sql.end();
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
