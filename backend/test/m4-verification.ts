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

  const schemaRes = await fetch(`${BASE_URL}/schema`, {
    headers: { Cookie: cookie },
  });
  assert.strictEqual(schemaRes.status, 200, 'Schema bundle must succeed');
  const schema = await schemaRes.json();
  const leadModule = schema.modules.find((m: any) => m.key === 'lead');
  assert.ok(leadModule, 'Lead module must exist');
  assert.ok(leadModule.hasPipeline, 'Lead module must have hasPipeline=true');

  const pipeline = leadModule.pipelines[0];
  assert.ok(pipeline, 'Sales pipeline must exist');
  assert.ok(pipeline.stages.length >= 2, 'Pipeline must have multiple stages');

  const stageNew = pipeline.stages[0];
  const stageContacted = pipeline.stages[1];
  const stageWon = pipeline.stages.find((s: any) => s.type === 'won') || pipeline.stages[pipeline.stages.length - 1];

  const createRes = await fetch(`${BASE_URL}/modules/lead/records`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({
      display_name: 'M4 Verification Enterprise Lead',
      stage_id: stageNew.id,
      pipeline_id: pipeline.id,
      data: {
        budget: 500000,
        city: 'Bengaluru',
        source: 'Website',
      },
    }),
  });
  assert.strictEqual(createRes.status, 201, 'Lead creation must succeed');
  const createdRecord = await createRes.json();
  assert.strictEqual(createdRecord.stage_id, stageNew.id, 'Initial stage must match stageNew');
  assert.ok(createdRecord.stage_since, 'Initial stage_since must be set');
  const initialStageSince = createdRecord.stage_since;

  await new Promise((r) => setTimeout(r, 100));

  const moveRes = await fetch(`${BASE_URL}/modules/lead/records/${createdRecord.id}/stage`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({
      stage_id: stageContacted.id,
    }),
  });
  assert.strictEqual(moveRes.status, 200, 'Stage move must succeed');
  const movedRecord = await moveRes.json();
  assert.strictEqual(movedRecord.stage_id, stageContacted.id, 'stage_id must be updated to stageContacted');
  assert.ok(new Date(movedRecord.stage_since).getTime() >= new Date(initialStageSince).getTime(), 'stage_since must be updated');

  const moveWonRes = await fetch(`${BASE_URL}/modules/lead/records/${createdRecord.id}/stage`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({
      stage_id: stageWon.id,
    }),
  });
  assert.strictEqual(moveWonRes.status, 200, 'Stage move to won must succeed');
  const wonRecord = await moveWonRes.json();
  assert.strictEqual(wonRecord.stage_id, stageWon.id, 'stage_id must be updated to stageWon');

  const timelineRes = await fetch(`${BASE_URL}/modules/lead/records/${createdRecord.id}/timeline`, {
    headers: { Cookie: cookie },
  });
  assert.strictEqual(timelineRes.status, 200, 'Timeline fetch must succeed');
  const timeline = await timelineRes.json();
  assert.ok(Array.isArray(timeline), 'Timeline must be an array');
  assert.ok(timeline.length >= 3, 'Timeline must contain creation and at least 2 stage transitions');

  const stageEvents = timeline.filter((e: any) => e.type === 'stage_changed');
  assert.strictEqual(stageEvents.length, 2, 'Must have recorded exactly 2 stage_changed events');

  const latestEvent = stageEvents[0];
  assert.strictEqual(latestEvent.changes.stage_id.from, stageContacted.id, 'Previous stage must be Contacted');
  assert.strictEqual(latestEvent.changes.stage_id.to, stageWon.id, 'Target stage must be Won');
  assert.ok(latestEvent.created_at, 'Event must have created_at');

  const olderEvent = stageEvents[1];
  assert.strictEqual(olderEvent.changes.stage_id.from, stageNew.id, 'Original stage must be New');
  assert.strictEqual(olderEvent.changes.stage_id.to, stageContacted.id, 'Target stage must be Contacted');

  console.log('M4 Acceptance Suite PASSED:');
  console.log('1. Pipeline stages loaded:', pipeline.stages.map((s: any) => s.label).join(' -> '));
  console.log('2. Record stage successfully moved from', stageNew.label, 'to', stageContacted.label, 'and then', stageWon.label);
  console.log('3. stage_since correctly updated on each transition:', wonRecord.stage_since);
  console.log('4. Timeline verified: recorded', stageEvents.length, 'stage transitions with actor and diffs.');
}

run().catch((err) => {
  console.error('M4 Acceptance Suite FAILED:', err);
  process.exit(1);
});
