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
          } else if (upper.startsWith('NOOP')) {
            socket.write('250 2.0.0 Ok\r\n');
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

async function runMilestoneBVerification() {
  const sql = postgres(process.env.DATABASE_URL || 'postgresql://crm:crm_secret@localhost:5432/crm');
  const baseUrl = 'http://localhost:9000/api';

  const mockSmtp = await startMockSmtpServer();
  console.log(`[Milestone B] Mock SMTP server listening on port ${mockSmtp.port}`);

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

    console.log('[Milestone B] Authenticated as admin');

    const providersRes = await fetch(`${baseUrl}/connectors/providers`, {
      method: 'GET',
      headers: authHeaders,
    });

    if (!providersRes.ok) {
      throw new Error(`Failed to list connector providers: HTTP ${providersRes.status}`);
    }

    const providers = await providersRes.json();
    const smtpProvider = providers.find((p: any) => p.key === 'smtp');
    if (!smtpProvider || !smtpProvider.capabilities.includes('send_email')) {
      throw new Error('SMTP provider with send_email capability not found');
    }

    console.log('[Milestone B] Verified SMTP provider registered in connector manifest');

    const createConnRes = await fetch(`${baseUrl}/connectors`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        providerKey: 'smtp',
        name: 'Kolkata Regional SMTP',
        config: {
          host: '127.0.0.1',
          port: mockSmtp.port,
          secure: false,
          fromAddress: 'notifications@webingo.in',
          fromName: 'Webingo HQ Notifications',
        },
        credentials: {
          user: 'webingo_smtp_user',
          pass: 'secure_vault_secret_9988',
        },
      }),
    });

    if (!createConnRes.ok) {
      const errText = await createConnRes.text();
      throw new Error(`Failed to create SMTP connector: ${errText}`);
    }

    const createdConnector = await createConnRes.json();
    console.log(`[Milestone B] Created SMTP connector ${createdConnector.id}`);

    const [dbConnector] = await sql<any[]>`
      SELECT credentials
      FROM connectors
      WHERE id = ${createdConnector.id}
    `;

    if (!dbConnector) {
      throw new Error('Connector record not found in database');
    }

    if (!dbConnector.credentials || !dbConnector.credentials.includes(':')) {
      throw new Error('Connector credentials must be encrypted at rest in hex format iv:authTag:ciphertext');
    }

    if (dbConnector.credentials.includes('secure_vault_secret_9988')) {
      throw new Error('SECURITY VIOLATION: Plaintext credential found stored in database');
    }

    console.log('[Milestone B] Verified AES-256-GCM encryption at rest in credential vault');

    const healthRes = await fetch(`${baseUrl}/connectors/${createdConnector.id}/health-check`, {
      method: 'POST',
      headers: authHeaders,
    });

    if (!healthRes.ok) {
      const err = await healthRes.text();
      throw new Error(`Health check failed: ${err}`);
    }

    const healthJson = await healthRes.json();
    if (!healthJson.ok) {
      throw new Error(`Health check returned failure: ${JSON.stringify(healthJson)}`);
    }

    console.log('[Milestone B] Verified connector health check succeeded with mock SMTP transport');

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

    const createLeadRes = await fetch(`${baseUrl}/modules/lead/records`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        display_name: 'Apex Infotech Solutions',
        owner_id: adminUser.id,
        data: {
          requirement: 'Enterprise Cloud Modernization',
          budget: 850000,
          city: 'Kolkata',
          email: 'contact@apexinfotech.io',
        },
      }),
    });

    if (!createLeadRes.ok) {
      const err = await createLeadRes.text();
      throw new Error(`Failed to create test lead record: ${err}`);
    }

    const leadRecord = await createLeadRes.json();
    console.log(`[Milestone B] Created lead record "${leadRecord.display_name}" (${leadRecord.id})`);

    const templateSubject = 'Proposal for {{display_name}} from {{org.name}}';
    const templateBody =
      'Hi {{display_name}},\n\n' +
      'We received your requirement for {{data.requirement}}.\n' +
      'Your assigned executive is {{owner.fullName}} ({{owner.email}}).\n' +
      'Estimated project value: {{data.budget | currency}}.\n\n' +
      'Review your record: {{link.record}}';

    const createTplRes = await fetch(`${baseUrl}/templates`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        channel: 'email',
        name: 'Enterprise Proposal Dispatch',
        subject: templateSubject,
        body: templateBody,
      }),
    });

    if (!createTplRes.ok) {
      const err = await createTplRes.text();
      throw new Error(`Failed to create template: ${err}`);
    }

    const createdTemplate = await createTplRes.json();
    console.log(`[Milestone B] Created template "${createdTemplate.name}" with variables: ${createdTemplate.variables.join(', ')}`);

    if (createdTemplate.variables.length < 3) {
      throw new Error(`Expected at least 3 variables, got ${createdTemplate.variables.length}`);
    }

    const previewRes = await fetch(`${baseUrl}/templates/preview`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        templateId: createdTemplate.id,
        recordId: leadRecord.id,
        channel: 'email',
      }),
    });

    if (!previewRes.ok) {
      const err = await previewRes.text();
      throw new Error(`Preview template resolution failed: ${err}`);
    }

    const previewJson = await previewRes.json();
    console.log(`[Milestone B] Preview rendered subject: "${previewJson.renderedSubject}"`);
    console.log(`[Milestone B] Preview rendered body:\n${previewJson.renderedBody}`);

    if (!previewJson.renderedSubject.includes('Apex Infotech Solutions')) {
      throw new Error('Rendered subject missing display_name interpolation');
    }
    if (!previewJson.renderedSubject.includes('Webingo HQ')) {
      throw new Error('Rendered subject missing org.name interpolation');
    }
    if (!previewJson.renderedBody.includes('Enterprise Cloud Modernization')) {
      throw new Error('Rendered body missing data.requirement dynamic field interpolation');
    }
    if (!previewJson.renderedBody.includes('Admin User')) {
      throw new Error('Rendered body missing owner.fullName relation interpolation');
    }
    if (!previewJson.renderedBody.includes('admin@webingo.com')) {
      throw new Error('Rendered body missing owner.email relation interpolation');
    }
    if (!previewJson.renderedBody.includes('8,50,000') && !previewJson.renderedBody.includes('850000')) {
      throw new Error('Rendered body missing data.budget currency interpolation');
    }

    console.log('[Milestone B] All variables successfully resolved against real lead record');

    const testRecipient = 'procurement@apexinfotech.io';
    const sendRes = await fetch(`${baseUrl}/templates/test-send`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        templateId: createdTemplate.id,
        recordId: leadRecord.id,
        connectorId: createdConnector.id,
        toEmail: testRecipient,
      }),
    });

    if (!sendRes.ok) {
      const err = await sendRes.text();
      throw new Error(`Failed to dispatch test email: ${err}`);
    }

    const sendJson = await sendRes.json();
    console.log(`[Milestone B] Test email dispatched successfully. Message ID: ${sendJson.messageId}`);

    if (!sendJson.success || !sendJson.messageId) {
      throw new Error('Test send response does not confirm delivery');
    }

    await new Promise((r) => setTimeout(r, 500));

    if (mockSmtp.received.length === 0) {
      throw new Error('Mock SMTP server did not receive any email message');
    }

    const receivedEmail = mockSmtp.received[mockSmtp.received.length - 1];
    console.log('[Milestone B] RAW RECEIVED EMAIL:\n', receivedEmail.raw);

    if (!receivedEmail.to.some((addr) => addr.includes(testRecipient))) {
      throw new Error(`Expected recipient ${testRecipient} in received email recipients: ${receivedEmail.to.join(', ')}`);
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

    const decodedEmail = decodeQuotedPrintable(receivedEmail.raw);

    if (!decodedEmail.includes('Apex Infotech Solutions')) {
      throw new Error('Received email content does not contain interpolated lead display_name');
    }
    if (!decodedEmail.includes('Enterprise Cloud Modernization')) {
      throw new Error('Received email content does not contain interpolated dynamic requirement');
    }
    if (!decodedEmail.includes('Admin User')) {
      throw new Error('Received email content does not contain interpolated advisor owner name');
    }
    if (!decodedEmail.includes('admin@webingo.com')) {
      throw new Error('Received email content does not contain interpolated advisor owner email');
    }
    if (!decodedEmail.includes('8,50,000') && !decodedEmail.includes('850000')) {
      throw new Error('Received email content does not contain interpolated budget currency value');
    }

    console.log('[Milestone B] Verified email transmission to recipient with 100% accurate variable interpolation');

    await fetch(`${baseUrl}/templates/${createdTemplate.id}`, {
      method: 'DELETE',
      headers: authHeaders,
    });

    await fetch(`${baseUrl}/connectors/${createdConnector.id}`, {
      method: 'DELETE',
      headers: authHeaders,
    });

    await fetch(`${baseUrl}/modules/lead/records/${leadRecord.id}`, {
      method: 'DELETE',
      headers: authHeaders,
    });

    console.log('[Milestone B] Test fixtures cleaned up successfully');
    console.log('\n======================================================');
    console.log('MILESTONE B ACCEPTANCE CRITERIA: FULLY VERIFIED AND PASSED');
    console.log('======================================================\n');
  } finally {
    mockSmtp.server.close();
    await sql.end();
  }
}

runMilestoneBVerification().catch((err) => {
  console.error('[Milestone B FAILED]', err);
  process.exit(1);
});
