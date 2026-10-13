import * as net from 'net';
import postgres from 'postgres';

interface ReceivedEmail {
  from?: string;
  to: string[];
  raw: string;
}

function startMockSmtpServer(): Promise<{ server: net.Server; port: number; received: ReceivedEmail[] }> {
  return new Promise((resolve, reject) => {
    const received: ReceivedEmail[] = [];
    const server = net.createServer((socket) => {
      let state = 'INIT';
      let currentEmail: ReceivedEmail = { to: [], raw: '' };
      let dataBuffer = '';

      socket.write('220 mock-smtp-service ready\r\n');

      socket.on('data', (chunk) => {
        const text = chunk.toString();

        if (state === 'DATA') {
          dataBuffer += text;
          if (dataBuffer.includes('\r\n.\r\n') || dataBuffer.endsWith('.\r\n') || dataBuffer === '.\n') {
            currentEmail.raw = dataBuffer;
            received.push({ ...currentEmail });
            state = 'INIT';
            dataBuffer = '';
            currentEmail = { to: [], raw: '' };
            socket.write('250 2.0.0 Ok: queued\r\n');
          }
          return;
        }

        const lines = text.split('\r\n').filter((l) => l.trim().length > 0);
        for (const line of lines) {
          const upper = line.toUpperCase();

          if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
            socket.write('250-localhost\r\n250-AUTH LOGIN PLAIN\r\n250-8BITMIME\r\n250 OK\r\n');
          } else if (upper.startsWith('AUTH LOGIN')) {
            state = 'AUTH_USER';
            socket.write('334 VXNlcm5hbWU6\r\n');
          } else if (state === 'AUTH_USER') {
            state = 'AUTH_PASS';
            socket.write('334 UGFzc3dvcmQ6\r\n');
          } else if (state === 'AUTH_PASS') {
            state = 'AUTH_DONE';
            socket.write('235 2.7.0 Authentication successful\r\n');
          } else if (upper.startsWith('AUTH PLAIN')) {
            socket.write('235 2.7.0 Authentication successful\r\n');
          } else if (upper.startsWith('MAIL FROM:')) {
            currentEmail.from = line.substring(10).trim().replace(/[<>]/g, '');
            socket.write('250 2.1.0 Ok\r\n');
          } else if (upper.startsWith('RCPT TO:')) {
            currentEmail.to.push(line.substring(8).trim().replace(/[<>]/g, ''));
            socket.write('250 2.1.5 Ok\r\n');
          } else if (upper.startsWith('DATA')) {
            state = 'DATA';
            dataBuffer = '';
            socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
          } else if (upper.startsWith('QUIT')) {
            socket.write('221 2.0.0 Bye\r\n');
            socket.end();
          } else if (upper.startsWith('RSET')) {
            state = 'INIT';
            currentEmail = { to: [], raw: '' };
            dataBuffer = '';
            socket.write('250 2.0.0 Reset ok\r\n');
          } else {
            socket.write('250 2.0.0 Ok\r\n');
          }
        }
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      resolve({ server, port: addr.port, received });
    });

    server.on('error', reject);
  });
}

function decodeQuotedPrintable(input: string): string {
  const unwrapped = input.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < unwrapped.length; i++) {
    if (unwrapped[i] === '=' && i + 2 < unwrapped.length && /^[0-9A-Fa-f]{2}$/.test(unwrapped.slice(i + 1, i + 3))) {
      bytes.push(parseInt(unwrapped.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(unwrapped.charCodeAt(i));
    }
  }
  return Buffer.from(bytes).toString('utf-8');
}

async function runMilestoneCVerification() {
  const sql = postgres(process.env.DATABASE_URL || 'postgresql://crm:crm_secret@localhost:5432/crm');
  const baseUrl = 'http://localhost:9000/api';

  const mockSmtp = await startMockSmtpServer();
  console.log(`[Milestone C] Mock SMTP server listening on port ${mockSmtp.port}`);

  try {
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@webingo.com',
        password: 'admin123',
      }),
    });

    if (!loginRes.ok) {
      throw new Error(`Login failed with HTTP status ${loginRes.status}`);
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

    console.log('[Milestone C] Authenticated as admin');

    const createConnRes = await fetch(`${baseUrl}/connectors`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        providerKey: 'smtp',
        name: 'Enterprise Inbound/Outbound SMTP',
        config: {
          host: '127.0.0.1',
          port: mockSmtp.port,
          secure: false,
          fromAddress: 'notifications@webingo.in',
          fromName: 'Webingo HQ Notifications',
        },
        credentials: {
          user: 'smtp_admin_user',
          pass: 'smtp_vault_secret_123',
        },
      }),
    });

    if (!createConnRes.ok) {
      const err = await createConnRes.text();
      throw new Error(`Failed to create SMTP connector: ${err}`);
    }

    const connector = await createConnRes.json();
    console.log(`[Milestone C] Created SMTP connector ${connector.id}`);

    const [leadModule] = await sql<any[]>`
      SELECT id, org_id
      FROM modules
      WHERE key = 'lead' AND deleted_at IS NULL
    `;

    if (!leadModule) {
      throw new Error('Lead module not found in database');
    }

    const [adminUser] = await sql<any[]>`
      SELECT id, full_name, email
      FROM users
      WHERE email = 'admin@webingo.com'
    `;

    const createTplRes = await fetch(`${baseUrl}/templates`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        channel: 'email',
        name: 'Automated Onboarding Dispatch',
        subject: 'Welcome {{display_name}} to Webingo Cloud',
        body:
          'Hi {{display_name}},\n\n' +
          'Thank you for selecting Webingo for {{data.requirement}}.\n' +
          'Your dedicated engineer is {{owner.fullName}} ({{owner.email}}).\n\n' +
          'Best regards,\nWebingo HQ',
      }),
    });

    if (!createTplRes.ok) {
      const err = await createTplRes.text();
      throw new Error(`Failed to create template: ${err}`);
    }

    const template = await createTplRes.json();
    console.log(`[Milestone C] Created email template "${template.name}" (${template.id})`);

    const createAutoRes = await fetch(`${baseUrl}/automations`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'Auto-Send Welcome Email on Lead Creation',
        moduleId: leadModule.id,
        trigger: {
          eventType: 'record.created',
          moduleKey: 'lead',
        },
        actions: [
          {
            id: 'action-node-1',
            type: 'action',
            handler: 'send_email',
            config: {
              connectorId: connector.id,
              templateId: template.id,
            },
          },
        ],
        isActive: true,
      }),
    });

    if (!createAutoRes.ok) {
      const err = await createAutoRes.text();
      throw new Error(`Failed to create automation: ${err}`);
    }

    const automation = await createAutoRes.json();
    console.log(`[Milestone C] Created automation rule "${automation.name}" (${automation.id})`);

    const createLeadRes = await fetch(`${baseUrl}/modules/lead/records`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        display_name: 'Apex Aerospace Ltd',
        owner_id: adminUser.id,
        data: {
          email: 'contact@apexaerospace.in',
          requirement: 'Flight Control Avionics Software',
          city: 'Kolkata',
          budget: 1500000,
        },
      }),
    });

    if (!createLeadRes.ok) {
      const err = await createLeadRes.text();
      throw new Error(`Failed to create lead record: ${err}`);
    }

    const leadRecord = await createLeadRes.json();
    console.log(`[Milestone C] Created lead record "${leadRecord.display_name}" (${leadRecord.id})`);

    const dryRunRes = await fetch(`${baseUrl}/automations/${automation.id}/test`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        recordId: leadRecord.id,
      }),
    });

    if (!dryRunRes.ok) {
      const err = await dryRunRes.text();
      throw new Error(`Failed to execute automation dry-run: ${err}`);
    }

    const dryRunResult = await dryRunRes.json();
    console.log(`[Milestone C] Automation dry-run validated: success=${dryRunResult.success}`);

    if (!dryRunResult.success) {
      throw new Error(`Automation dry-run failed: ${JSON.stringify(dryRunResult)}`);
    }

    for (let i = 0; i < 30; i++) {
      if (mockSmtp.received.length > 0) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    if (mockSmtp.received.length === 0) {
      throw new Error('Mock SMTP server did not receive outbound email from automation');
    }

    const outboundSmtpMail = mockSmtp.received[mockSmtp.received.length - 1];
    const decodedOutbound = decodeQuotedPrintable(outboundSmtpMail.raw);

    console.log(`[Milestone C] Mock SMTP received outbound message. To: ${outboundSmtpMail.to.join(', ')}`);

    if (!outboundSmtpMail.to.some((addr) => addr.includes('contact@apexaerospace.in'))) {
      throw new Error('Outbound email was not sent to lead address');
    }

    if (!decodedOutbound.includes('Welcome Apex Aerospace Ltd to Webingo Cloud')) {
      throw new Error('Outbound email missing interpolated subject');
    }

    if (!decodedOutbound.includes('Flight Control Avionics Software')) {
      throw new Error('Outbound email missing interpolated dynamic requirement');
    }

    const [outboundDbMessage] = await sql<any[]>`
      SELECT *
      FROM messages
      WHERE org_id = ${leadModule.org_id}
        AND record_id = ${leadRecord.id}
        AND direction = 'outbound'
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (!outboundDbMessage) {
      throw new Error('Outbound message not recorded in messages table');
    }

    console.log(`[Milestone C] Outbound message recorded in messages table. Thread ID: ${outboundDbMessage.thread_id}, Message ID: ${outboundDbMessage.provider_message_id}`);

    const [timelineOutboundEvent] = await sql<any[]>`
      SELECT *
      FROM record_events
      WHERE org_id = ${leadModule.org_id}
        AND record_id = ${leadRecord.id}
        AND type = 'message.sent'
      LIMIT 1
    `;

    if (!timelineOutboundEvent) {
      throw new Error('Timeline event for outbound message not found in record_events');
    }

    console.log('[Milestone C] Verified outbound email logged on lead timeline');

    const customerReplyText =
      'Thank you for the quick follow up. When can we schedule a technical walkthrough with the avionics team?\n\n' +
      'On Mon, 12 Oct 2026, Webingo HQ wrote:\n' +
      '> Hi Apex Aerospace Ltd,\n' +
      '> Thank you for selecting Webingo for Flight Control Avionics Software.';

    const customerMessageId = `<reply-msg-7788@apexaerospace.in>`;

    const inboundWebhookRes = await fetch(`${baseUrl}/inbound/${connector.id}?orgId=${leadModule.org_id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'contact@apexaerospace.in',
        to: 'notifications@webingo.in',
        subject: 'Re: Welcome Apex Aerospace Ltd to Webingo Cloud',
        text: customerReplyText,
        messageId: customerMessageId,
        inReplyTo: outboundDbMessage.provider_message_id,
        references: outboundDbMessage.provider_message_id,
      }),
    });

    if (!inboundWebhookRes.ok) {
      const err = await inboundWebhookRes.text();
      throw new Error(`Inbound webhook failed: ${err}`);
    }

    const inboundResult = await inboundWebhookRes.json();
    console.log(`[Milestone C] Inbound customer reply processed: Message ID ${inboundResult.messageId}, Thread ID ${inboundResult.threadId}`);

    if (inboundResult.threadId !== outboundDbMessage.thread_id) {
      throw new Error(
        `Thread ID mismatch! Outbound: ${outboundDbMessage.thread_id}, Inbound: ${inboundResult.threadId}. Two-way email must maintain conversation thread.`,
      );
    }

    if (inboundResult.recordId !== leadRecord.id) {
      throw new Error(`Inbound message was not linked to the lead record. Expected ${leadRecord.id}, got ${inboundResult.recordId}`);
    }

    console.log('[Milestone C] Verified customer reply threaded correctly to same conversation thread and lead record');

    const [inboundDbMessage] = await sql<any[]>`
      SELECT *
      FROM messages
      WHERE id = ${inboundResult.messageId}
    `;

    if (!inboundDbMessage) {
      throw new Error('Inbound message not found in database');
    }

    if (inboundDbMessage.body_text.includes('On Mon, 12 Oct 2026, Webingo HQ wrote:')) {
      throw new Error('Quoted history was not stripped from inbound reply!');
    }

    if (!inboundDbMessage.body_text.includes('When can we schedule a technical walkthrough')) {
      throw new Error('Inbound message text body is missing new customer text');
    }

    console.log('[Milestone C] Verified quote history stripped and clean customer message saved');

    const [timelineInboundEvent] = await sql<any[]>`
      SELECT *
      FROM record_events
      WHERE org_id = ${leadModule.org_id}
        AND record_id = ${leadRecord.id}
        AND type = 'message.received'
      LIMIT 1
    `;

    if (!timelineInboundEvent) {
      throw new Error('Inbound reply was not logged to lead timeline in record_events');
    }

    console.log('[Milestone C] Verified customer reply landed on lead timeline');

    const getMessagesRes = await fetch(`${baseUrl}/email/records/${leadRecord.id}`, {
      method: 'GET',
      headers: authHeaders,
    });

    if (!getMessagesRes.ok) {
      throw new Error(`Failed to get record messages: HTTP ${getMessagesRes.status}`);
    }

    const threadMessages = await getMessagesRes.json();
    if (threadMessages.length < 2) {
      throw new Error(`Expected at least 2 messages in lead thread, got ${threadMessages.length}`);
    }

    const directions = threadMessages.map((m: any) => m.direction);
    if (!directions.includes('outbound') || !directions.includes('inbound')) {
      throw new Error(`Expected thread to have both outbound and inbound messages, got: ${directions.join(', ')}`);
    }

    console.log('[Milestone C] Verified timeline message history returns complete two-way conversation');

    const bounceTargetEmail = 'bounced-prospect@unreachable-domain.com';
    const bounceRes = await fetch(`${baseUrl}/inbound/${connector.id}/bounce?orgId=${leadModule.org_id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: bounceTargetEmail,
        bounceType: 'hard',
        reason: '550 5.1.1 Mailbox does not exist',
        diagnosticCode: 'smtp; 550 5.1.1 User unknown',
        messageId: customerMessageId,
      }),
    });

    if (!bounceRes.ok) {
      const err = await bounceRes.text();
      throw new Error(`Bounce ingest failed: ${err}`);
    }

    const bounceResult = await bounceRes.json();
    console.log(`[Milestone C] Hard bounce processed: ${JSON.stringify(bounceResult)}`);

    const [suppressedRow] = await sql<any[]>`
      SELECT *
      FROM suppression_list
      WHERE org_id = ${leadModule.org_id}
        AND address = ${bounceTargetEmail}
        AND channel = 'email'
    `;

    if (!suppressedRow) {
      throw new Error(`Address ${bounceTargetEmail} was not found in suppression_list table`);
    }

    if (suppressedRow.reason !== 'hard_bounce') {
      throw new Error(`Expected suppression reason 'hard_bounce', got ${suppressedRow.reason}`);
    }

    console.log('[Milestone C] Verified hard bounce registered in suppression list');

    const initialMockCount = mockSmtp.received.length;

    const blockedSendRes = await fetch(`${baseUrl}/email/send`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        connectorId: connector.id,
        toEmail: bounceTargetEmail,
        subject: 'Attempted send to bounced address',
        bodyText: 'This message should never be dispatched to SMTP.',
      }),
    });

    if (blockedSendRes.ok) {
      throw new Error('SECURITY / DELIVERABILITY VIOLATION: Send to hard-bounced address was not refused!');
    }

    const blockedErrJson = await blockedSendRes.json();
    console.log(`[Milestone C] Outbound send to suppressed address correctly rejected: ${blockedErrJson.detail || blockedErrJson.message || 'Suppressed'}`);

    if (mockSmtp.received.length !== initialMockCount) {
      throw new Error('SMTP message was dispatched despite address being on suppression list!');
    }

    console.log('[Milestone C] Confirmed send path strictly blocks suppressed addresses before hitting transport');

    await fetch(`${baseUrl}/automations/${automation.id}`, {
      method: 'DELETE',
      headers: authHeaders,
    });

    await fetch(`${baseUrl}/templates/${template.id}`, {
      method: 'DELETE',
      headers: authHeaders,
    });

    await fetch(`${baseUrl}/connectors/${connector.id}`, {
      method: 'DELETE',
      headers: authHeaders,
    });

    await fetch(`${baseUrl}/modules/lead/records/${leadRecord.id}`, {
      method: 'DELETE',
      headers: authHeaders,
    });

    await sql`
      DELETE FROM suppression_list
      WHERE org_id = ${leadModule.org_id} AND address = ${bounceTargetEmail}
    `;

    console.log('[Milestone C] Test fixtures cleaned up successfully');
    console.log('\n======================================================');
    console.log('MILESTONE C ACCEPTANCE CRITERIA: FULLY VERIFIED AND PASSED');
    console.log('======================================================\n');
  } finally {
    mockSmtp.server.close();
    await sql.end();
  }
}

runMilestoneCVerification().catch((err) => {
  console.error('[Milestone C FAILED]', err);
  process.exit(1);
});
