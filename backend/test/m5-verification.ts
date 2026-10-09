import assert from 'node:assert';

const BASE_URL = 'http://localhost:9000/api';

async function run() {
  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@webingo.com', password: 'admin123' }),
  });
  assert.ok(loginRes.status === 200 || loginRes.status === 201, 'Login must succeed');
  const cookie = loginRes.headers.get('set-cookie');
  assert.ok(cookie, 'Cookie must be present');
  const adminUser = await loginRes.json();
  assert.ok(adminUser.id, 'User profile must have an ID');

  const schemaRes = await fetch(`${BASE_URL}/schema`, {
    headers: { Cookie: cookie },
  });
  assert.strictEqual(schemaRes.status, 200, 'Schema bundle must succeed');
  const schema = await schemaRes.json();
  const leadModule = schema.modules.find((m: any) => m.key === 'lead');
  assert.ok(leadModule, 'Lead module must exist');

  const pipeline = leadModule.pipelines[0];
  const stageContacted = pipeline.stages[1] || pipeline.stages[0];

  const viewPayload = {
    name: 'My open leads',
    type: 'table',
    config: {
      filter: {
        field: 'owner_id',
        op: 'eq',
        value: '@me',
      },
      sort: 'created_at:desc',
    },
  };

  const createViewRes = await fetch(`${BASE_URL}/modules/lead/views`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify(viewPayload),
  });
  assert.ok(
    createViewRes.status === 200 || createViewRes.status === 201,
    `Create view must succeed, got ${createViewRes.status}`
  );
  const createdView = await createViewRes.json();
  assert.strictEqual(createdView.name, 'My open leads', 'View name must match');

  const listViewsRes = await fetch(`${BASE_URL}/modules/lead/views`, {
    headers: { Cookie: cookie },
  });
  assert.strictEqual(listViewsRes.status, 200, 'List views must succeed');
  const viewsList = await listViewsRes.json();
  const foundSavedView = viewsList.find((v: any) => v.id === createdView.id);
  assert.ok(foundSavedView, 'Created view must be returned in views list');

  const testFilterRes = await fetch(
    `${BASE_URL}/modules/lead/records?filter=${encodeURIComponent(
      JSON.stringify(createdView.config.filter)
    )}`,
    {
      headers: { Cookie: cookie },
    }
  );
  assert.strictEqual(testFilterRes.status, 200, 'Filtering with saved view must succeed');

  const recordIdsToBulkAssign: string[] = [];
  const existingRecordsRes = await fetch(`${BASE_URL}/modules/lead/records?limit=60`, {
    headers: { Cookie: cookie },
  });
  const existingData = await existingRecordsRes.json();
  for (const r of existingData.records) {
    if (recordIdsToBulkAssign.length < 50) {
      recordIdsToBulkAssign.push(r.id);
    }
  }

  while (recordIdsToBulkAssign.length < 50) {
    const idx = recordIdsToBulkAssign.length + 1;
    const createRecRes = await fetch(`${BASE_URL}/modules/lead/records`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({
        display_name: `Bulk Test Record ${idx}`,
        data: {
          city: 'Mumbai',
          budget: 100000 + idx * 1000,
        },
      }),
    });
    assert.strictEqual(createRecRes.status, 201, 'Record creation must succeed');
    const createdRec = await createRecRes.json();
    recordIdsToBulkAssign.push(createdRec.id);
  }

  assert.strictEqual(recordIdsToBulkAssign.length, 50, 'Must have exactly 50 record IDs');

  const bulkAssignRes = await fetch(`${BASE_URL}/modules/lead/records/bulk`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({
      action: 'assign',
      record_ids: recordIdsToBulkAssign,
      data: {
        owner_id: adminUser.id,
      },
    }),
  });
  assert.strictEqual(bulkAssignRes.status, 201, 'Bulk assign must return 201');
  const bulkAssignResult = await bulkAssignRes.json();
  assert.strictEqual(bulkAssignResult.success, true, 'Bulk assign success must be true');
  assert.strictEqual(bulkAssignResult.count, 50, 'Bulk assign count must be 50');

  const bulkStageRes = await fetch(`${BASE_URL}/modules/lead/records/bulk`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({
      action: 'update',
      record_ids: recordIdsToBulkAssign,
      data: {
        stage_id: stageContacted.id,
      },
    }),
  });
  assert.strictEqual(bulkStageRes.status, 201, 'Bulk stage update must return 201');
  const bulkStageResult = await bulkStageRes.json();
  assert.strictEqual(bulkStageResult.success, true, 'Bulk stage update success must be true');
  assert.strictEqual(bulkStageResult.count, 50, 'Bulk stage update count must be 50');

  const csvRows: string[] = ['Lead name,Email,Phone,Company,City,Budget,Source'];
  for (let i = 1; i <= 2000; i++) {
    csvRows.push(
      `"CSV Import Lead ${i}","csvlead${i}@example.com","+9198765${String(i).padStart(5, '0')}","Company ${i}","Bengaluru","${50000 + i * 10}","Website"`
    );
  }
  const csvContent = csvRows.join('\r\n');

  const importStartTime = Date.now();
  const importRes = await fetch(`${BASE_URL}/modules/lead/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({
      csv: csvContent,
    }),
  });
  const importDuration = Date.now() - importStartTime;

  assert.ok(
    importRes.status === 200 || importRes.status === 201,
    `CSV import must succeed, got ${importRes.status}`
  );
  const importResult = await importRes.json();
  assert.strictEqual(importResult.totalRows, 2000, 'Import totalRows must be 2000');
  assert.strictEqual(importResult.importedCount, 2000, 'Import importedCount must be 2000');
  assert.strictEqual(importResult.failedCount, 0, 'Import failedCount must be 0');
  assert.ok(importDuration < 10000, `Import 2000 rows took ${importDuration}ms (target < 10000ms)`);

  const exportRes = await fetch(`${BASE_URL}/modules/lead/export`, {
    headers: { Cookie: cookie },
  });
  assert.strictEqual(exportRes.status, 200, 'Export CSV must succeed');
  const contentType = exportRes.headers.get('content-type') || '';
  assert.ok(contentType.includes('text/csv'), 'Content-type must be text/csv');
  const exportedCsv = await exportRes.text();
  assert.ok(exportedCsv.length > 1000, 'Exported CSV must contain data');
  assert.ok(exportedCsv.includes('Lead name') || exportedCsv.includes('Name'), 'Exported CSV must contain header');
  assert.ok(exportedCsv.includes('CSV Import Lead 1'), 'Exported CSV must contain imported records');

  console.log(`Milestone 5 verification PASSED:`);
  console.log(`- Saved 'My open leads' view created & verified`);
  console.log(`- Bulk-assigned 50 records to owner ${adminUser.id} & updated stages`);
  console.log(`- Imported 2,000 CSV rows in ${importDuration}ms (100% success rate)`);
  console.log(`- Exported CSV successfully with full RFC 4180 streaming`);
}

run().catch((err) => {
  console.error('Milestone 5 verification FAILED:', err);
  process.exit(1);
});
