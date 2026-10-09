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
  const stageNew = pipeline.stages[0];
  const stageContacted = pipeline.stages[1];

  const uniqueName = `M6 Enterprise ${Date.now()}`;
  const createRecRes = await fetch(`${BASE_URL}/modules/lead/records`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({
      display_name: uniqueName,
      stage_id: stageNew.id,
      pipeline_id: pipeline.id,
      data: {
        budget: 500000,
        city: 'Kolkata',
        requirement: 'High priority CRM setup',
      },
    }),
  });
  assert.strictEqual(createRecRes.status, 201, 'Record creation must succeed');
  const createdRecord = await createRecRes.json();
  assert.strictEqual(createdRecord.display_name, uniqueName);

  await new Promise((r) => setTimeout(r, 50));

  const updateRecRes = await fetch(`${BASE_URL}/modules/lead/records/${createdRecord.id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({
      display_name: `${uniqueName} Updated`,
      data: {
        budget: 750000,
        city: 'Salt Lake',
      },
    }),
  });
  assert.strictEqual(updateRecRes.status, 200, 'Record update must succeed');
  const updatedRecord = await updateRecRes.json();
  assert.strictEqual(updatedRecord.display_name, `${uniqueName} Updated`);

  await new Promise((r) => setTimeout(r, 50));

  const moveStageRes = await fetch(`${BASE_URL}/modules/lead/records/${createdRecord.id}/stage`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({
      stage_id: stageContacted.id,
    }),
  });
  assert.strictEqual(moveStageRes.status, 200, 'Stage change must succeed');

  await new Promise((r) => setTimeout(r, 50));

  const noteRes = await fetch(`${BASE_URL}/modules/lead/records/${createdRecord.id}/notes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({
      content: 'Met with the VP of Engineering. Requirements finalized.',
      attachments: [
        {
          name: 'specs.pdf',
          url: '/api/files/sample-spec.pdf',
          size: 2048,
        },
      ],
    }),
  });
  assert.strictEqual(noteRes.status, 201, 'Adding note must succeed');
  const noteEvent = await noteRes.json();
  assert.strictEqual(noteEvent.type, 'note');
  assert.strictEqual(noteEvent.actor_name, adminUser.fullName);

  const fileBlob = new Blob(['Test file attachment content for M6 verification'], { type: 'text/plain' });
  const formData = new FormData();
  formData.append('file', fileBlob, 'agreement-draft.txt');

  const uploadRes = await fetch(`${BASE_URL}/files/upload`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: formData,
  });
  assert.strictEqual(uploadRes.status, 201, 'File upload must succeed');
  const uploadedFileInfo = await uploadRes.json();
  assert.ok(uploadedFileInfo.key, 'Uploaded file must have key');
  assert.strictEqual(uploadedFileInfo.name, 'agreement-draft.txt');
  assert.ok(uploadedFileInfo.url, 'Uploaded file must have url');

  const fileDownloadRes = await fetch(`http://localhost:9000${uploadedFileInfo.url}`, {
    headers: { Cookie: cookie },
  });
  assert.strictEqual(fileDownloadRes.status, 200, 'File retrieval must succeed');
  const fileContent = await fileDownloadRes.text();
  assert.strictEqual(fileContent, 'Test file attachment content for M6 verification');

  const attachRes = await fetch(`${BASE_URL}/modules/lead/records/${createdRecord.id}/attachments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify(uploadedFileInfo),
  });
  assert.strictEqual(attachRes.status, 201, 'Adding attachment must succeed');
  const attachEvent = await attachRes.json();
  assert.strictEqual(attachEvent.type, 'attachment');
  assert.strictEqual(attachEvent.actor_name, adminUser.fullName);

  const timelineRes = await fetch(`${BASE_URL}/modules/lead/records/${createdRecord.id}/timeline`, {
    headers: { Cookie: cookie },
  });
  assert.strictEqual(timelineRes.status, 200, 'Timeline fetch must succeed');
  const events = await timelineRes.json();

  assert.ok(events.length >= 5, `Expected at least 5 timeline events, got ${events.length}`);

  const createdEv = events.find((e: any) => e.type === 'created');
  assert.ok(createdEv, 'Timeline must contain created event');
  assert.strictEqual(createdEv.actor_name, adminUser.fullName);

  const updatedEv = events.find((e: any) => e.type === 'updated');
  assert.ok(updatedEv, 'Timeline must contain updated event');
  assert.strictEqual(updatedEv.actor_name, adminUser.fullName);
  assert.ok(updatedEv.changes, 'Updated event must have changes');
  assert.strictEqual(updatedEv.changes.city.from, 'Kolkata', 'Old city must match Kolkata');
  assert.strictEqual(updatedEv.changes.city.to, 'Salt Lake', 'New city must match Salt Lake');
  assert.strictEqual(updatedEv.changes.budget.from, 500000, 'Old budget must match 500000');
  assert.strictEqual(updatedEv.changes.budget.to, 750000, 'New budget must match 750000');
  assert.strictEqual(updatedEv.changes.display_name.from, uniqueName, 'Old display_name must match');
  assert.strictEqual(updatedEv.changes.display_name.to, `${uniqueName} Updated`, 'New display_name must match');

  const stageEv = events.find((e: any) => e.type === 'stage_changed');
  assert.ok(stageEv, 'Timeline must contain stage_changed event');
  assert.strictEqual(stageEv.actor_name, adminUser.fullName);
  assert.strictEqual(stageEv.changes.stage_id.from, stageNew.id, 'Old stage must match stageNew');
  assert.strictEqual(stageEv.changes.stage_id.to, stageContacted.id, 'New stage must match stageContacted');

  const noteEv = events.find((e: any) => e.type === 'note');
  assert.ok(noteEv, 'Timeline must contain note event');
  assert.strictEqual(noteEv.actor_name, adminUser.fullName);
  assert.ok(noteEv.payload.content.includes('Met with the VP of Engineering'));

  const attachEv = events.find((e: any) => e.type === 'attachment');
  assert.ok(attachEv, 'Timeline must contain attachment event');
  assert.strictEqual(attachEv.actor_name, adminUser.fullName);
  assert.strictEqual(attachEv.payload.file.name, 'agreement-draft.txt');

  const searchStart = Date.now();
  const searchPrefixRes = await fetch(`${BASE_URL}/search?q=M6+Enter`, {
    headers: { Cookie: cookie },
  });
  const searchPrefixDuration = Date.now() - searchStart;
  assert.strictEqual(searchPrefixRes.status, 200, 'Prefix search must succeed');
  const searchPrefixResults = await searchPrefixRes.json();
  assert.ok(searchPrefixDuration < 200, `Prefix search took ${searchPrefixDuration}ms (< 200ms target)`);
  const foundInPrefix = searchPrefixResults.find((r: any) => r.id === createdRecord.id);
  assert.ok(foundInPrefix, 'Record must be found in short prefix search');
  assert.strictEqual(foundInPrefix.module_key, 'lead');

  const searchDynamicStart = Date.now();
  const searchDynamicRes = await fetch(`${BASE_URL}/search?q=Salt+Lake`, {
    headers: { Cookie: cookie },
  });
  const searchDynamicDuration = Date.now() - searchDynamicStart;
  assert.strictEqual(searchDynamicRes.status, 200, 'Dynamic field search must succeed');
  const searchDynamicResults = await searchDynamicRes.json();
  assert.ok(searchDynamicDuration < 200, `Dynamic field search took ${searchDynamicDuration}ms (< 200ms target)`);
  const foundInDynamic = searchDynamicResults.find((r: any) => r.id === createdRecord.id);
  assert.ok(foundInDynamic, 'Record must be found when searching dynamic searchable field');

  console.log('Milestone 6 verification PASSED:');
  console.log('- Record created, field-updated, stage-moved, note added, file attached');
  console.log('- Every change visible on timeline with actor name and old value (verified full diff)');
  console.log(`- Global prefix search responded in ${searchPrefixDuration}ms (< 200ms target)`);
  console.log(`- Global dynamic field search responded in ${searchDynamicDuration}ms (< 200ms target)`);
}

run().catch((err) => {
  console.error('Milestone 6 verification FAILED:', err);
  process.exit(1);
});
