import assert from 'assert';
import postgres from 'postgres';

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:9000/api';
const DB_URL = process.env.DATABASE_URL || 'postgresql://crm:crm_secret@localhost:5432/crm';

async function runMilestoneFVerification() {
  const sql = postgres(DB_URL);

  try {
    const loginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@webingo.com',
        password: 'admin123',
      }),
    });

    assert.ok(loginRes.status === 200 || loginRes.status === 201, `Admin login failed: ${loginRes.status}`);
    const setCookie = loginRes.headers.get('set-cookie');
    assert.ok(setCookie, 'Missing set-cookie header from login response');
    const sessionCookie = setCookie.split(';')[0];
    const loginData = await loginRes.json();
    const orgId = loginData.orgId;
    const adminUserId = loginData.id;

    const authHeaders = {
      'Content-Type': 'application/json',
      Cookie: sessionCookie,
    };

    const schemaRes = await fetch(`${BASE_URL}/schema`, { headers: authHeaders });
    assert.strictEqual(schemaRes.status, 200, 'Failed to fetch schema bundle');
    const schema = await schemaRes.json();
    const leadModule = schema.modules.find((m: any) => m.key === 'lead');
    assert.ok(leadModule, 'Lead module missing in schema');
    const defaultPipeline = leadModule.pipelines.find((p: any) => p.isDefault) || leadModule.pipelines[0];
    assert.ok(defaultPipeline, 'Default pipeline missing in lead module');
    const stages = defaultPipeline.stages.sort((a: any, b: any) => a.position - b.position);
    assert.ok(stages.length >= 3, 'Expected at least 3 pipeline stages');
    const stageNew = stages[0];
    const stageContacted = stages[1];
    const stageQualified = stages[2];

    const [userA] = await sql<any[]>`
      INSERT INTO users (org_id, email, full_name, is_active)
      VALUES (${orgId}, 'agent_alpha@webingo.com', 'Agent Alpha', true)
      ON CONFLICT (org_id, email) DO UPDATE SET is_active = true
      RETURNING id
    `;
    const [userB] = await sql<any[]>`
      INSERT INTO users (org_id, email, full_name, is_active)
      VALUES (${orgId}, 'agent_beta@webingo.com', 'Agent Beta', true)
      ON CONFLICT (org_id, email) DO UPDATE SET is_active = true
      RETURNING id
    `;
    const [managerUser] = await sql<any[]>`
      INSERT INTO users (org_id, email, full_name, is_active)
      VALUES (${orgId}, 'sales_manager@webingo.com', 'Sales Manager Lead', true)
      ON CONFLICT (org_id, email) DO UPDATE SET is_active = true
      RETURNING id
    `;
    const [fallbackUser] = await sql<any[]>`
      INSERT INTO users (org_id, email, full_name, is_active)
      VALUES (${orgId}, 'oncall_duty@webingo.com', 'On-Call Fallback Officer', true)
      ON CONFLICT (org_id, email) DO UPDATE SET is_active = true
      RETURNING id
    `;

    console.log('[Milestone F] Prepared organizational users and calendar context');

    const updateCalendarRes = await fetch(`${BASE_URL}/routing/calendar`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        timezone: 'Asia/Kolkata',
        workingDays: [1, 2, 3, 4, 5],
        startTime: '09:00',
        endTime: '18:00',
        holidays: ['2026-12-25', '2026-01-26'],
      }),
    });
    assert.strictEqual(updateCalendarRes.status, 200, 'Failed to update organization calendar');
    const calendar = await updateCalendarRes.json();
    assert.strictEqual(calendar.timezone, 'Asia/Kolkata');
    assert.strictEqual(calendar.start_time, '09:00');
    assert.strictEqual(calendar.end_time, '18:00');

    const createRrRuleRes = await fetch(`${BASE_URL}/routing/rules`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'Inbound Leads Round Robin with Working Hours',
        moduleId: leadModule.id,
        kind: 'assignment',
        conditions: {
          all: [
            { field: 'company', operator: 'is_not_empty' },
          ],
        },
        config: {
          strategy: 'round_robin',
          pool: [userA.id, userB.id],
          respectWorkingHours: true,
          fallbackOwnerId: fallbackUser.id,
        },
        priority: 100,
        isActive: true,
      }),
    });
    assert.strictEqual(createRrRuleRes.status, 201, 'Failed to create round-robin assignment rule');
    const rrRule = await createRrRuleRes.json();
    assert.ok(rrRule.id, 'Missing rule id');

    const workHoursEval1 = await fetch(`${BASE_URL}/routing/assignments/evaluate`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        moduleId: leadModule.id,
        recordData: { company: 'Acme Global Ltd', source: 'Website' },
        evaluationDate: '2026-10-12T06:00:00.000Z',
      }),
    });
    assert.strictEqual(workHoursEval1.status, 201, 'Working hours evaluation request 1 failed');
    const evalResult1 = await workHoursEval1.json();
    assert.strictEqual(evalResult1.strategy, 'round_robin', 'Strategy should be round_robin during working hours');
    assert.ok([userA.id, userB.id].includes(evalResult1.ownerId), 'Selected owner must be from round robin pool');

    const workHoursEval2 = await fetch(`${BASE_URL}/routing/assignments/evaluate`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        moduleId: leadModule.id,
        recordData: { company: 'Wayne Corp', source: 'Website' },
        evaluationDate: '2026-10-12T06:05:00.000Z',
      }),
    });
    assert.strictEqual(workHoursEval2.status, 201, 'Working hours evaluation request 2 failed');
    const evalResult2 = await workHoursEval2.json();
    assert.strictEqual(evalResult2.strategy, 'round_robin');
    assert.ok([userA.id, userB.id].includes(evalResult2.ownerId), 'Selected owner must be from round robin pool');
    assert.notStrictEqual(evalResult1.ownerId, evalResult2.ownerId, 'Round robin pool should alternate owners consecutively');

    const offHoursEval = await fetch(`${BASE_URL}/routing/assignments/evaluate`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        moduleId: leadModule.id,
        recordData: { company: 'Stark Enterprises', source: 'Website' },
        evaluationDate: '2026-10-11T14:30:00.000Z',
      }),
    });
    assert.strictEqual(offHoursEval.status, 201, 'Off hours evaluation request failed');
    const offHoursResult = await offHoursEval.json();
    assert.strictEqual(offHoursResult.strategy, 'fallback_outside_working_hours', 'Must respect working hours and fall back');
    assert.strictEqual(offHoursResult.ownerId, fallbackUser.id, 'Must assign to configured fallback owner during off hours');

    console.log('[Milestone F] Round robin respecting working hours and rotating active pool successfully validated');

    const createSlaRuleRes = await fetch(`${BASE_URL}/routing/rules`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'Urgent Lead First Response SLA',
        moduleId: leadModule.id,
        kind: 'sla',
        conditions: {
          and: [
            { field: 'company', op: 'eq', value: 'Aarav Enterprises' },
          ],
        },
        config: {
          targetMinutes: 30,
          businessHoursOnly: false,
          stopOn: {
            field: 'stage_id',
            op: 'neq',
            value: stageNew.id,
          },
          escalations: [
            {
              atPercent: 80,
              notify: ['owner'],
            },
            {
              atPercent: 100,
              reassign: managerUser.id,
              notify: ['owner', 'manager'],
            },
          ],
        },
        priority: 90,
        isActive: true,
      }),
    });
    assert.strictEqual(createSlaRuleRes.status, 201, 'Failed to create SLA rule');
    const slaRule = await createSlaRuleRes.json();
    assert.ok(slaRule.id, 'SLA rule ID missing');

    const createRecordRes = await fetch(`${BASE_URL}/modules/${leadModule.key}/records`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        display_name: 'Aarav VIP Lead',
        owner_id: userA.id,
        stage_id: stageNew.id,
        data: {
          company: 'Aarav Enterprises',
          source: 'Website',
          email: `aarav_${Date.now()}@test.org`,
        },
      }),
    });
    assert.strictEqual(createRecordRes.status, 201, 'Failed to create record for SLA testing');
    const recordPayload = await createRecordRes.json();
    const targetLead = recordPayload.record || recordPayload;
    assert.ok(targetLead.id, 'Record ID missing');
    assert.strictEqual(targetLead.owner_id || targetLead.ownerId, userA.id, 'Record initial owner must be User A');

    const attachSlaRes = await fetch(`${BASE_URL}/routing/slas/attach`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        moduleId: leadModule.id,
        record: targetLead,
      }),
    });
    assert.strictEqual(attachSlaRes.status, 201, 'Failed to attach SLA rule to record');

    const slaRecordCheckRes = await fetch(`${BASE_URL}/routing/slas/record/${targetLead.id}`, {
      headers: authHeaders,
    });
    assert.strictEqual(slaRecordCheckRes.status, 200, 'Failed to fetch SLA instances for record');
    const slaInstances = await slaRecordCheckRes.json();
    assert.ok(slaInstances.length > 0, 'No active SLA instance attached to record');
    const targetSlaInstance = slaInstances[0];
    assert.strictEqual(targetSlaInstance.status, 'active');
    assert.strictEqual(targetSlaInstance.targetMinutes, 30);

    const simulatedNowAt100 = new Date(new Date(targetSlaInstance.targetAt).getTime() + 60000).toISOString();
    const evalSlaRes = await fetch(`${BASE_URL}/routing/slas/evaluate`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        simulatedDate: simulatedNowAt100,
      }),
    });
    assert.strictEqual(evalSlaRes.status, 201, 'Failed to trigger SLA evaluation at 100%');
    const evalSlaSummary = await evalSlaRes.json();
    assert.ok(evalSlaSummary.breached >= 1, 'Expected at least 1 SLA breach recorded at 100% threshold');

    const postBreachSlasRes = await fetch(`${BASE_URL}/routing/slas/record/${targetLead.id}`, {
      headers: authHeaders,
    });
    assert.strictEqual(postBreachSlasRes.status, 200);
    const postBreachSlas = await postBreachSlasRes.json();
    assert.strictEqual(postBreachSlas[0].status, 'breached', 'SLA instance status must transition to breached');
    assert.ok(Array.isArray(postBreachSlas[0].escalationsFired), 'escalationsFired must be an array');
    assert.ok(postBreachSlas[0].escalationsFired.includes(100), 'escalationsFired must contain 100% trigger');

    const [updatedLead] = await sql<any[]>`
      SELECT id, owner_id FROM records WHERE id = ${targetLead.id}
    `;
    assert.strictEqual(updatedLead.owner_id, managerUser.id, 'Record must be escalated and reassigned to manager user at 100%');

    const [escalatedEvent] = await sql<any[]>`
      SELECT * FROM record_events
      WHERE record_id = ${targetLead.id} AND type = 'sla.escalated'
      ORDER BY created_at DESC LIMIT 1
    `;
    assert.ok(escalatedEvent, 'sla.escalated record event must be logged');

    const [breachedEvent] = await sql<any[]>`
      SELECT * FROM record_events
      WHERE record_id = ${targetLead.id} AND type = 'sla.breached'
      ORDER BY created_at DESC LIMIT 1
    `;
    assert.ok(breachedEvent, 'sla.breached record event must be logged');

    console.log('[Milestone F] SLA 100% escalation, breach handling, and owner reassignment successfully validated');

    const funnelLead1 = await fetch(`${BASE_URL}/modules/${leadModule.key}/records`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        display_name: 'Funnel Stage 1 Prospect',
        stage_id: stageNew.id,
        data: { company: 'Prospect Alpha Corp', source: 'Website' },
      }),
    });
    assert.strictEqual(funnelLead1.status, 201);
    const body1 = await funnelLead1.json();
    const fLead1 = body1.record || body1;

    const funnelLead2 = await fetch(`${BASE_URL}/modules/${leadModule.key}/records`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        display_name: 'Funnel Stage 2 Prospect',
        stage_id: stageContacted.id,
        data: { company: 'Prospect Beta Corp', source: 'Website' },
      }),
    });
    assert.strictEqual(funnelLead2.status, 201);

    const funnelLead3 = await fetch(`${BASE_URL}/modules/${leadModule.key}/records`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        display_name: 'Funnel Stage 3 Prospect',
        stage_id: stageQualified.id,
        data: { company: 'Prospect Gamma Corp', source: 'Website' },
      }),
    });
    assert.strictEqual(funnelLead3.status, 201);

    const createReportRes = await fetch(`${BASE_URL}/reports`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'Sales Pipeline Conversion Funnel',
        moduleKey: leadModule.key,
        type: 'funnel',
        config: {
          pipelineId: defaultPipeline.id,
        },
      }),
    });
    assert.strictEqual(createReportRes.status, 201, 'Failed to create funnel report');
    const reportObj = await createReportRes.json();
    assert.ok(reportObj.id, 'Report ID missing');
    assert.strictEqual(reportObj.type, 'funnel');

    const runReportRes = await fetch(`${BASE_URL}/reports/${reportObj.id}/run?bypassCache=true`, {
      headers: authHeaders,
    });
    assert.strictEqual(runReportRes.status, 200, 'Failed to execute funnel report computation');
    const runResult = await runReportRes.json();
    assert.strictEqual(runResult.reportId, reportObj.id);
    assert.ok(Array.isArray(runResult.stages), 'Funnel report result stages must be an array');
    assert.ok(runResult.totalRecords > 0, 'Total records in funnel must be greater than zero');

    const stageNewReportItem = runResult.stages.find((s: any) => s.stageId === stageNew.id);
    assert.ok(stageNewReportItem, 'New stage item missing in funnel stages');
    assert.ok(stageNewReportItem.count >= 1, 'Stage New should have at least 1 record');
    assert.strictEqual(typeof stageNewReportItem.dropoffRate, 'number', 'Drop-off rate must be a numeric percentage');

    const drillthroughRes = await fetch(
      `${BASE_URL}/reports/${reportObj.id}/drillthrough?bucketKey=${stageNew.id}&limit=50`,
      { headers: authHeaders },
    );
    assert.strictEqual(drillthroughRes.status, 200, 'Drillthrough query failed');
    const drillthroughRecords = await drillthroughRes.json();
    assert.ok(Array.isArray(drillthroughRecords), 'Drillthrough response must be an array of records');
    assert.ok(drillthroughRecords.length >= 1, 'Drillthrough should return at least 1 record in stage New');

    const matchedDrillLead = drillthroughRecords.find((r: any) => r.id === fLead1.id || r.displayName === 'Funnel Stage 1 Prospect');
    assert.ok(matchedDrillLead, 'Created lead must be present in drillthrough records for stage New');
    assert.strictEqual(matchedDrillLead.stageId, stageNew.id, 'Drillthrough record stageId must match filtered stage');
    assert.ok(matchedDrillLead.displayName, 'Drillthrough record must include displayName');

    console.log('[Milestone F] Funnel computation, drop-off rate arithmetic, and widget drill-through successfully validated');
    console.log('[Milestone F] ALL ACCEPTANCE CRITERIA SATISFIED SUCCESSFULLY');
  } finally {
    await sql.end();
  }
}

runMilestoneFVerification().catch((err) => {
  console.error('[Milestone F] Verification failure:', err);
  process.exit(1);
});
