import * as http from 'http';
import postgres from 'postgres';

interface WebhookRequestRecord {
  attempt: number;
  timestamp: number;
  body: any;
  headers: http.IncomingHttpHeaders;
}

async function runM7Verification() {
  const sql = postgres(process.env.DATABASE_URL || 'postgresql://crm:crm_secret@localhost:5432/crm');

  const webhookPort = 3999;
  let attemptsReceived = 0;
  const requestsReceived: WebhookRequestRecord[] = [];
  let successfulDeliveryTime: number | null = null;

  const mockServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/webhook') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        attemptsReceived++;
        const rawBody = Buffer.concat(chunks).toString('utf-8');
        let parsedBody: any = null;
        try {
          parsedBody = JSON.parse(rawBody);
        } catch {
          parsedBody = rawBody;
        }

        const record: WebhookRequestRecord = {
          attempt: attemptsReceived,
          timestamp: Date.now(),
          body: parsedBody,
          headers: req.headers,
        };
        requestsReceived.push(record);

        if (attemptsReceived <= 2) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Simulated failure on attempt ${attemptsReceived}` }));
        } else {
          successfulDeliveryTime = Date.now();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Delivered successfully' }));
        }
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve) => {
    mockServer.listen(webhookPort, '127.0.0.1', () => resolve());
  });

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

  const automationRes = await fetch(`${baseUrl}/automations`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: 'M7 Acceptance Verification Webhook',
      moduleKey: 'lead',
      isActive: true,
      trigger: {
        eventType: 'record.created',
        moduleKey: 'lead',
      },
      actions: [
        {
          type: 'webhook',
          config: {
            url: `http://127.0.0.1:${webhookPort}/webhook`,
            method: 'POST',
            timeoutMs: 3000,
          },
        },
      ],
    }),
  });

  if (!automationRes.ok) {
    const errText = await automationRes.text();
    throw new Error(`Failed to create automation: ${errText}`);
  }

  const createdAutomation = await automationRes.json();
  const automationId = createdAutomation.id;

  const leadCreationStartTime = Date.now();

  const createLeadRes = await fetch(`${baseUrl}/modules/lead/records`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      display_name: 'M7 Verification Enterprise Lead',
      data: {
        email: 'm7enterprise@webhooktest.org',
        company: 'M7 Systems Ltd',
        city: 'Kolkata',
      },
    }),
  });

  if (!createLeadRes.ok) {
    const errText = await createLeadRes.text();
    throw new Error(`Failed to create lead record: ${errText}`);
  }

  const createdLead = await createLeadRes.json();
  const leadId = createdLead.id;

  const maxWaitMs = 5000;
  const pollIntervalMs = 50;
  let elapsedMs = 0;

  while (successfulDeliveryTime === null && elapsedMs < maxWaitMs) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    elapsedMs = Date.now() - leadCreationStartTime;
  }

  if (successfulDeliveryTime === null) {
    throw new Error(
      `Milestone 7 Acceptance Test FAILED: Webhook was NOT delivered within 5 seconds. Elapsed: ${elapsedMs}ms, Attempts received: ${attemptsReceived}`
    );
  }

  const totalDeliveryDuration = successfulDeliveryTime - leadCreationStartTime;

  if (totalDeliveryDuration > 5000) {
    throw new Error(
      `Milestone 7 Acceptance Test FAILED: Total delivery time ${totalDeliveryDuration}ms exceeded the 5-second criterion.`
    );
  }

  if (attemptsReceived < 3) {
    throw new Error(
      `Milestone 7 Acceptance Test FAILED: Expected at least 3 attempts (2 failed attempts followed by retry success), but got ${attemptsReceived}`
    );
  }

  const thirdRequest = requestsReceived[2];
  if (!thirdRequest || thirdRequest.body.displayName !== 'M7 Verification Enterprise Lead') {
    throw new Error(
      `Webhook payload mismatch on attempt 3: ${JSON.stringify(thirdRequest?.body)}`
    );
  }

  const [outboxEventRow] = await sql`
    SELECT id, status, attempts, last_error, processed_at
    FROM outbox_events
    WHERE aggregate_id = ${leadId}
      AND event_type = 'record.created'
  `;

  if (!outboxEventRow || outboxEventRow.status !== 'completed') {
    throw new Error(
      `Database verification failed: outbox_events row not marked completed. Row: ${JSON.stringify(outboxEventRow)}`
    );
  }

  if (outboxEventRow.attempts < 2) {
    throw new Error(
      `Database verification failed: expected outbox_events attempts >= 2, got ${outboxEventRow.attempts}`
    );
  }

  const runs = await sql`
    SELECT id, status, log, started_at, finished_at
    FROM automation_runs
    WHERE automation_id = ${automationId}
      AND record_id = ${leadId}
    ORDER BY id ASC
  `;

  const hasSuccessfulRun = runs.some((r) => r.status === 'success');
  if (!hasSuccessfulRun) {
    throw new Error(
      `Database verification failed: no successful automation_runs recorded. Runs: ${JSON.stringify(runs)}`
    );
  }

  await fetch(`${baseUrl}/modules/lead/records/${leadId}`, {
    method: 'DELETE',
    headers: authHeaders,
  });

  await fetch(`${baseUrl}/automations/${automationId}`, {
    method: 'DELETE',
    headers: authHeaders,
  });

  await new Promise<void>((resolve) => {
    mockServer.close(() => resolve());
  });

  await sql.end();

  console.log('------------------------------------------------------------');
  console.log('MILESTONE 7 ACCEPTANCE CRITERIA VERIFICATION: 100% PASSED');
  console.log('------------------------------------------------------------');
  console.log(`Lead Created ID: ${leadId}`);
  console.log(`Automation ID: ${automationId}`);
  console.log(`Total Attempts Received: ${attemptsReceived}`);
  console.log(`Attempts 1 & 2: Returned HTTP 500 (Receiver Down simulation)`);
  console.log(`Attempt 3: Returned HTTP 200 (Success)`);
  console.log(`Delivery Time Elapsed: ${totalDeliveryDuration} ms (within 5000 ms limit)`);
  console.log(`Outbox Event Status: ${outboxEventRow.status}`);
  console.log(`Recorded Outbox Attempts: ${outboxEventRow.attempts}`);
  console.log(`Automation Runs Count: ${runs.length} (contains status = success)`);
  console.log('------------------------------------------------------------');
}

runM7Verification().catch((err) => {
  console.error('M7 Verification Failed:', err);
  process.exit(1);
});
