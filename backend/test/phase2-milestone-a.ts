import postgres from 'postgres';

interface StepLog {
  nodeId: string;
  type: string;
  handler?: string;
  status: string;
  outcome?: boolean;
  nextNodeId?: string | null;
  output?: any;
  error?: string;
}

async function runMilestoneAVerification() {
  const sql = postgres(process.env.DATABASE_URL || 'postgresql://crm:crm_secret@localhost:5432/crm');
  const baseUrl = 'http://localhost:9000/api';

  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@webingo.com',
      password: 'admin123',
    }),
  });

  if (!loginRes.ok) {
    throw new Error(`Login failed with status ${loginRes.status}`);
  }

  const setCookie = loginRes.headers.get('set-cookie');
  if (!setCookie) {
    throw new Error('No session cookie returned from login');
  }

  const sessionCookie = setCookie.split(';')[0];
  const authHeaders = {
    'Content-Type': 'application/json',
    Cookie: sessionCookie,
  };

  const [leadModule] = await sql<any[]>`
    SELECT id, org_id
    FROM modules
    WHERE key = 'lead' AND deleted_at IS NULL
  `;

  if (!leadModule) {
    throw new Error('Lead module not found in database');
  }

  const orgId = leadModule.org_id;

  const createRecRes = await fetch(`${baseUrl}/modules/lead/records`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      display_name: 'Milestone A Enterprise Deal',
      data: {
        city: 'Kolkata',
        budget: 150000,
        source: 'Website',
        requirement: 'Initial Inquiry',
      },
    }),
  });

  if (!createRecRes.ok) {
    const err = await createRecRes.text();
    throw new Error(`Failed to create test lead record: ${err}`);
  }

  const testRecord = await createRecRes.json();
  const recordId = testRecord.id;

  const graphNodes = [
    {
      id: 'node_branch_1',
      type: 'branch',
      conditions: {
        field: 'budget',
        op: 'gte',
        value: 100000,
      },
      onTrue: 'node_action_high',
      onFalse: 'node_action_low',
    },
    {
      id: 'node_action_high',
      type: 'action',
      handler: 'update_field',
      config: {
        fieldKey: 'requirement',
        value: 'High Priority Tier',
      },
      next: 'node_wait_1',
    },
    {
      id: 'node_action_low',
      type: 'action',
      handler: 'update_field',
      config: {
        fieldKey: 'requirement',
        value: 'Standard Tier',
      },
      next: 'node_wait_1',
    },
    {
      id: 'node_wait_1',
      type: 'wait',
      mode: 'duration',
      config: {
        durationMinutes: 10,
      },
      next: 'node_action_post_wait',
    },
    {
      id: 'node_action_post_wait',
      type: 'action',
      handler: 'update_field',
      config: {
        fieldKey: 'city',
        value: 'Kolkata Confirmed',
      },
      next: null,
    },
  ];

  const ruleDraft = {
    name: 'Milestone A High Budget Branch & Wait',
    moduleId: leadModule.id,
    isActive: true,
    trigger: {
      eventType: 'record.updated',
      moduleKey: 'lead',
    },
    conditions: {
      field: 'city',
      op: 'eq',
      value: 'Kolkata',
    },
    actions: {
      nodes: graphNodes,
    },
  };

  const dryRunRes = await fetch(`${baseUrl}/automations/test`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      recordId,
      rule: ruleDraft,
    }),
  });

  if (!dryRunRes.ok) {
    const err = await dryRunRes.text();
    throw new Error(`Dry run request failed: ${err}`);
  }

  const dryRunData = await dryRunRes.json();

  if (!dryRunData.success) {
    throw new Error(`Dry run reported failure: ${dryRunData.message}`);
  }

  if (!dryRunData.conditionsPassed) {
    throw new Error('Dry run conditions check failed unexpectedly');
  }

  const stepBranch = dryRunData.steps.find((s: StepLog) => s.nodeId === 'node_branch_1');
  if (!stepBranch || stepBranch.outcome !== true) {
    throw new Error('Dry run branch node evaluation failed or did not match true branch');
  }

  const stepHigh = dryRunData.steps.find((s: StepLog) => s.nodeId === 'node_action_high');
  if (!stepHigh || stepHigh.status !== 'simulated') {
    throw new Error('Dry run action high node was not simulated');
  }

  const stepWait = dryRunData.steps.find((s: StepLog) => s.nodeId === 'node_wait_1');
  if (!stepWait || stepWait.status !== 'simulated') {
    throw new Error('Dry run wait node was not simulated');
  }

  const stepPostWait = dryRunData.steps.find((s: StepLog) => s.nodeId === 'node_action_post_wait');
  if (!stepPostWait || stepPostWait.status !== 'simulated') {
    throw new Error('Dry run post-wait action was not simulated');
  }

  const [dbRecordBefore] = await sql<any[]>`
    SELECT data
    FROM records
    WHERE id = ${recordId}
  `;

  if (dbRecordBefore.data?.requirement === 'High Priority Tier') {
    throw new Error('Dry run mutated the database unexpectedly');
  }

  const saveRuleRes = await fetch(`${baseUrl}/automations`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(ruleDraft),
  });

  if (!saveRuleRes.ok) {
    const err = await saveRuleRes.text();
    throw new Error(`Failed to activate automation rule: ${err}`);
  }

  const savedRule = await saveRuleRes.json();
  const automationId = savedRule.id;

  const updateRecRes = await fetch(`${baseUrl}/modules/lead/records/${recordId}`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({
      data: {
        budget: 160000,
      },
    }),
  });

  if (!updateRecRes.ok) {
    const err = await updateRecRes.text();
    throw new Error(`Failed to trigger record update: ${err}`);
  }

  let waitingRun: any = null;
  const startTime = Date.now();

  while (Date.now() - startTime < 8000) {
    const runsRes = await fetch(`${baseUrl}/automations/${automationId}/runs`, {
      method: 'GET',
      headers: authHeaders,
    });

    if (runsRes.ok) {
      const runs = await runsRes.json();
      if (runs.length > 0) {
        waitingRun = runs[0];
        if (waitingRun.status === 'waiting') {
          break;
        }
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  if (!waitingRun) {
    throw new Error('No automation run recorded by engine');
  }

  if (waitingRun.status !== 'waiting') {
    throw new Error(`Expected run status "waiting", received "${waitingRun.status}"`);
  }

  const singleRunRes = await fetch(`${baseUrl}/automations/runs/${waitingRun.id}`, {
    method: 'GET',
    headers: authHeaders,
  });

  if (!singleRunRes.ok) {
    throw new Error('Failed to fetch detailed run log');
  }

  const singleRun = await singleRunRes.json();
  const runSteps: StepLog[] = singleRun.log?.steps || [];

  const runBranch = runSteps.find((s) => s.nodeId === 'node_branch_1');
  if (!runBranch || runBranch.outcome !== true) {
    throw new Error('Real execution branch node step missing or outcome incorrect');
  }

  const runHigh = runSteps.find((s) => s.nodeId === 'node_action_high');
  if (!runHigh || runHigh.status !== 'success') {
    throw new Error('Real execution action high node step missing or failed');
  }

  const runWait = runSteps.find((s) => s.nodeId === 'node_wait_1');
  if (!runWait || runWait.status !== 'waiting') {
    throw new Error('Real execution wait node step missing or not in waiting state');
  }

  const [dbRecordMid] = await sql<any[]>`
    SELECT data
    FROM records
    WHERE id = ${recordId}
  `;

  if (dbRecordMid.data?.requirement !== 'High Priority Tier') {
    throw new Error(`Expected record data requirement to be "High Priority Tier", found "${dbRecordMid.data?.requirement}"`);
  }

  await sql`
    UPDATE records
    SET data = jsonb_set(data, '{city}', '"Mumbai"')
    WHERE id = ${recordId}
  `;

  await sql`
    UPDATE automation_runs
    SET log = jsonb_set(log, '{resumeAt}', to_jsonb(now() - interval '10 seconds'))
    WHERE id = ${waitingRun.id}
  `;

  let abortedRun: any = null;
  const recheckStartTime = Date.now();

  while (Date.now() - recheckStartTime < 8000) {
    const checkRes = await fetch(`${baseUrl}/automations/runs/${waitingRun.id}`, {
      method: 'GET',
      headers: authHeaders,
    });

    if (checkRes.ok) {
      const run = await checkRes.json();
      if (run.status === 'cancelled') {
        abortedRun = run;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  if (!abortedRun) {
    throw new Error('Wait resume did not re-evaluate conditions or did not cancel invalidated deal');
  }

  const cancelReason = abortedRun.log?.reason || '';
  if (!cancelReason.includes('Conditions failed')) {
    throw new Error(`Unexpected cancel reason: ${cancelReason}`);
  }

  const createRec2Res = await fetch(`${baseUrl}/modules/lead/records`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      display_name: 'Second Deal for Full Resume',
      data: {
        city: 'Kolkata',
        budget: 120000,
        source: 'Website',
      },
    }),
  });

  if (!createRec2Res.ok) {
    throw new Error('Failed to create second test lead record');
  }

  const rec2 = await createRec2Res.json();

  const triggerUpdate2 = await fetch(`${baseUrl}/modules/lead/records/${rec2.id}`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({
      data: {
        budget: 130000,
      },
    }),
  });

  if (!triggerUpdate2.ok) {
    throw new Error('Failed to update second lead');
  }

  let secondRun: any = null;
  const startSecond = Date.now();

  while (Date.now() - startSecond < 8000) {
    const runsRes = await fetch(`${baseUrl}/automations/${automationId}/runs`, {
      method: 'GET',
      headers: authHeaders,
    });

    if (runsRes.ok) {
      const runs = await runsRes.json();
      const match = runs.find((r: any) => (r.record_id === rec2.id || r.recordId === rec2.id) && r.status === 'waiting');
      if (match) {
        secondRun = match;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  if (!secondRun) {
    throw new Error('Second run did not enter waiting state');
  }

  await sql`
    UPDATE automation_runs
    SET log = jsonb_set(log, '{resumeAt}', to_jsonb(now() - interval '10 seconds'))
    WHERE id = ${secondRun.id}
  `;

  let completedRun: any = null;
  const resumeStartTime = Date.now();

  while (Date.now() - resumeStartTime < 8000) {
    const checkRes = await fetch(`${baseUrl}/automations/runs/${secondRun.id}`, {
      method: 'GET',
      headers: authHeaders,
    });

    if (checkRes.ok) {
      const run = await checkRes.json();
      if (run.status === 'success') {
        completedRun = run;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  if (!completedRun) {
    throw new Error('Run did not successfully resume and complete post-wait actions');
  }

  const [dbRecordFinal] = await sql<any[]>`
    SELECT data
    FROM records
    WHERE id = ${rec2.id}
  `;

  if (dbRecordFinal.data?.city !== 'Kolkata Confirmed') {
    throw new Error(`Expected resumed record to update city to "Kolkata Confirmed", found "${dbRecordFinal.data?.city}"`);
  }

  await fetch(`${baseUrl}/automations/${automationId}`, {
    method: 'DELETE',
    headers: authHeaders,
  });

  await sql`DELETE FROM records WHERE id = ${recordId}`.catch(() => {});
  await sql`DELETE FROM records WHERE id = ${rec2.id}`.catch(() => {});
  await sql.end();

  console.log('PHASE 2 MILESTONE A VERIFICATION PASSED: ALL ACCEPTANCE CRITERIA SATISFIED');
}

runMilestoneAVerification().catch((err) => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
