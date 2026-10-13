import * as http from 'http';
import postgres from 'postgres';

interface DispatchedMessage {
  headers: http.IncomingHttpHeaders;
  url?: string;
  method?: string;
  body: any;
}

function startMockMessagingServer(): Promise<{
  server: http.Server;
  port: number;
  dispatchedWhatsApp: DispatchedMessage[];
  dispatchedSms: DispatchedMessage[];
}> {
  return new Promise((resolve, reject) => {
    const dispatchedWhatsApp: DispatchedMessage[] = [];
    const dispatchedSms: DispatchedMessage[] = [];

    const server = http.createServer((req, res) => {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
      });

      req.on('end', () => {
        const url = req.url || '';
        let parsedBody: any = null;
        if (data.length > 0) {
          try {
            parsedBody = JSON.parse(data);
          } catch {
            parsedBody = data;
          }
        }

        if (url.includes('/whatsapp-api/') && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: '911234567890', verified_name: 'Webingo CRM' }));
          return;
        }

        if (url.includes('/whatsapp-api/') && req.method === 'POST') {
          dispatchedWhatsApp.push({
            headers: req.headers,
            url,
            method: req.method,
            body: parsedBody,
          });
          const recipientWaId = parsedBody?.to || '919876543210';
          const msgId = `wamid.outbound_${Date.now()}`;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              messaging_product: 'whatsapp',
              contacts: [{ input: recipientWaId, wa_id: recipientWaId }],
              messages: [{ id: msgId }],
            }),
          );
          return;
        }

        if (url.includes('/msg91-api/') && req.method === 'POST') {
          dispatchedSms.push({
            headers: req.headers,
            url,
            method: req.method,
            body: parsedBody,
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              type: 'success',
              message: 'SMS submitted successfully',
              request_id: `msg91_${Date.now()}`,
            }),
          );
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      resolve({
        server,
        port: addr.port,
        dispatchedWhatsApp,
        dispatchedSms,
      });
    });

    server.on('error', reject);
  });
}

async function runMilestoneDVerification() {
  const sql = postgres(process.env.DATABASE_URL || 'postgresql://crm:crm_secret@localhost:5432/crm');
  const baseUrl = 'http://localhost:9000/api';

  const mockServer = await startMockMessagingServer();
  console.log(`[Milestone D] Mock Meta WhatsApp and MSG91 server listening on port ${mockServer.port}`);

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
      throw new Error(`Admin login failed: ${loginRes.status}`);
    }

    const setCookieHeader = loginRes.headers.get('set-cookie');
    if (!setCookieHeader) {
      throw new Error('No session cookie returned from login');
    }

    const cookieVal = setCookieHeader.split(';')[0];
    const authHeaders = {
      Cookie: cookieVal,
      'Content-Type': 'application/json',
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

    const [adminUser] = await sql<any[]>`
      SELECT id, full_name, email
      FROM users
      WHERE email = 'admin@webingo.com'
    `;

    const [leadPipeline] = await sql<any[]>`
      SELECT id
      FROM pipelines
      WHERE org_id = ${orgId} AND module_id = ${leadModule.id} AND deleted_at IS NULL
      ORDER BY is_default DESC, position ASC
      LIMIT 1
    `;

    const stages = await sql<any[]>`
      SELECT id, key, label
      FROM pipeline_stages
      WHERE org_id = ${orgId} AND pipeline_id = ${leadPipeline.id} AND deleted_at IS NULL
      ORDER BY position ASC
    `;

    const newStage = stages.find((s) => s.key === 'new') || stages[0];
    const contactedStage = stages.find((s) => s.key === 'contacted') || stages[1];

    const createWaConnectorRes = await fetch(`${baseUrl}/connectors`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'Meta WhatsApp Cloud Official',
        providerKey: 'whatsapp_cloud',
        config: {
          phoneNumberId: '911234567890',
          wabaId: 'waba_solaris_1234',
          verifyToken: 'solaris_meta_webhook_secret_9988',
          apiUrl: `http://127.0.0.1:${mockServer.port}/whatsapp-api`,
        },
        credentials: {
          accessToken: 'meta_graph_secret_access_token_123',
        },
      }),
    });

    if (!createWaConnectorRes.ok) {
      const err = await createWaConnectorRes.text();
      throw new Error(`Failed to create WhatsApp connector: ${err}`);
    }

    const waConnector = await createWaConnectorRes.json();
    console.log(`[Milestone D] Created Meta WhatsApp Cloud connector (${waConnector.id})`);

    const waHealthRes = await fetch(`${baseUrl}/connectors/${waConnector.id}/health-check`, {
      method: 'POST',
      headers: authHeaders,
    });
    if (!waHealthRes.ok) {
      const err = await waHealthRes.text();
      throw new Error(`WhatsApp health check failed: ${err}`);
    }
    const waHealthJson = await waHealthRes.json();
    if (!waHealthJson.ok) {
      throw new Error(`WhatsApp health check reported unhealthy: ${JSON.stringify(waHealthJson)}`);
    }
    console.log('[Milestone D] Verified WhatsApp Cloud connector health check succeeded');

    const createSmsConnectorRes = await fetch(`${baseUrl}/connectors`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'MSG91 DLT SMS Gateway',
        providerKey: 'msg91',
        config: {
          senderId: 'WBINGO',
          route: '4',
          apiUrl: `http://127.0.0.1:${mockServer.port}/msg91-api/flow`,
        },
        credentials: {
          authKey: 'msg91_secure_key_12345',
        },
      }),
    });

    if (!createSmsConnectorRes.ok) {
      const err = await createSmsConnectorRes.text();
      throw new Error(`Failed to create MSG91 connector: ${err}`);
    }

    const smsConnector = await createSmsConnectorRes.json();
    console.log(`[Milestone D] Created MSG91 SMS connector (${smsConnector.id})`);

    const createLeadRes = await fetch(`${baseUrl}/modules/lead/records`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        display_name: 'Solaris Energy Group',
        owner_id: adminUser.id,
        stage_id: newStage.id,
        data: {
          phone: '+919876543210',
          requirement: 'Rooftop Solar EPC Solution',
          budget: 1500000,
          city: 'Bengaluru',
        },
      }),
    });

    if (!createLeadRes.ok) {
      const err = await createLeadRes.text();
      throw new Error(`Failed to create test lead record: ${err}`);
    }

    const leadRecord = await createLeadRes.json();
    console.log(`[Milestone D] Created test lead record "${leadRecord.display_name}" (${leadRecord.id}) with phone +919876543210`);

    const marketingWaNoConsentRes = await fetch(`${baseUrl}/messaging/whatsapp/send`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        recordId: leadRecord.id,
        text: 'Mega Festive Discount: 25% off solar installations this weekend!',
        purpose: 'marketing',
        connectorId: waConnector.id,
      }),
    });

    if (marketingWaNoConsentRes.ok) {
      throw new Error('Outbound marketing WhatsApp send succeeded without consent! It must be refused.');
    }

    const waNoConsentErr = await marketingWaNoConsentRes.json();
    console.log(`[Milestone D] Refused WhatsApp marketing without consent: "${waNoConsentErr.detail || waNoConsentErr.title}"`);
    if (
      !String(waNoConsentErr.detail || waNoConsentErr.title).includes('Consent is required for marketing') &&
      !String(waNoConsentErr.detail || waNoConsentErr.title).includes('Consent is required')
    ) {
      throw new Error(`Unexpected error message for missing consent: ${JSON.stringify(waNoConsentErr)}`);
    }

    const marketingSmsNoConsentRes = await fetch(`${baseUrl}/messaging/sms/send`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        recordId: leadRecord.id,
        text: 'Limited Period Solar Rebate available for your unit.',
        purpose: 'marketing',
        connectorId: smsConnector.id,
      }),
    });

    if (marketingSmsNoConsentRes.ok) {
      throw new Error('Outbound marketing SMS send succeeded without consent! It must be refused.');
    }

    const smsNoConsentErr = await marketingSmsNoConsentRes.json();
    console.log(`[Milestone D] Refused SMS marketing without consent: "${smsNoConsentErr.detail || smsNoConsentErr.title}"`);
    if (
      !String(smsNoConsentErr.detail || smsNoConsentErr.title).includes('Consent is required for marketing') &&
      !String(smsNoConsentErr.detail || smsNoConsentErr.title).includes('Consent is required')
    ) {
      throw new Error(`Unexpected error message for missing SMS consent: ${JSON.stringify(smsNoConsentErr)}`);
    }

    const checkWindowRes1 = await fetch(`${baseUrl}/messaging/whatsapp/session-window/${leadRecord.id}`, {
      method: 'GET',
      headers: authHeaders,
    });
    if (!checkWindowRes1.ok) {
      throw new Error(`Session window check failed: ${checkWindowRes1.status}`);
    }
    const windowJson1 = await checkWindowRes1.json();
    if (windowJson1.isOpen) {
      throw new Error('WhatsApp session window should be CLOSED when no inbound customer message exists');
    }
    console.log('[Milestone D] Verified session window is initially closed (isOpen: false)');

    const freeformOutsideWindowRes = await fetch(`${baseUrl}/messaging/whatsapp/send`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        recordId: leadRecord.id,
        text: 'Hi Solaris, wanted to follow up on your rooftop query.',
        purpose: 'utility',
        connectorId: waConnector.id,
      }),
    });

    if (freeformOutsideWindowRes.ok) {
      throw new Error('Free-form WhatsApp send succeeded outside the 24-hour session window! It must be refused.');
    }

    const outsideWindowErr = await freeformOutsideWindowRes.json();
    console.log(`[Milestone D] Refused free-form WhatsApp message outside session window: "${outsideWindowErr.detail || outsideWindowErr.title}"`);
    if (
      !String(outsideWindowErr.detail || outsideWindowErr.title).includes('24-hour customer session window')
    ) {
      throw new Error(`Expected rejection mentioning 24-hour customer session window, got: ${JSON.stringify(outsideWindowErr)}`);
    }

    const challengeCode = 'challenge_token_solaris_random_9944';
    const verifyChallengeRes = await fetch(
      `${baseUrl}/inbound/${waConnector.id}?hub.mode=subscribe&hub.challenge=${challengeCode}&hub.verify_token=solaris_meta_webhook_secret_9988&orgId=${orgId}`,
      { method: 'GET' },
    );

    if (!verifyChallengeRes.ok) {
      const err = await verifyChallengeRes.text();
      throw new Error(`Webhook verification challenge failed: ${err}`);
    }

    const returnedChallenge = await verifyChallengeRes.text();
    if (returnedChallenge !== challengeCode && !returnedChallenge.includes(challengeCode)) {
      throw new Error(`Webhook challenge response mismatch. Expected ${challengeCode}, got ${returnedChallenge}`);
    }
    console.log('[Milestone D] Verified Meta WhatsApp webhook subscription challenge verification');

    const customerInitialWamid = `wamid.customer_inbound_${Date.now()}`;
    const inboundWebhookRes = await fetch(`${baseUrl}/inbound/${waConnector.id}?orgId=${orgId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: {
                    display_phone_number: '911234567890',
                  },
                  messages: [
                    {
                      from: '919876543210',
                      id: customerInitialWamid,
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      type: 'text',
                      text: {
                        body: 'Hello Webingo team, can you share the EPC specifications for our solar project?',
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    });

    if (!inboundWebhookRes.ok) {
      const err = await inboundWebhookRes.text();
      throw new Error(`Inbound WhatsApp webhook failed: ${err}`);
    }

    const inboundResult = await inboundWebhookRes.json();
    console.log('[Milestone D] Inbound WhatsApp message processed successfully:', JSON.stringify(inboundResult));

    const [inboundDbMessage] = await sql<any[]>`
      SELECT *
      FROM messages
      WHERE provider_message_id = ${customerInitialWamid}
    `;

    if (!inboundDbMessage) {
      throw new Error('Inbound WhatsApp message not recorded in messages table');
    }

    if (inboundDbMessage.record_id !== leadRecord.id) {
      throw new Error(`Inbound message linked to record ${inboundDbMessage.record_id}, expected ${leadRecord.id}`);
    }

    console.log(`[Milestone D] Verified inbound message linked to lead record. Thread ID: ${inboundDbMessage.thread_id}`);

    const [inboundTimelineEvent] = await sql<any[]>`
      SELECT *
      FROM record_events
      WHERE org_id = ${orgId}
        AND record_id = ${leadRecord.id}
        AND type = 'message.received'
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (!inboundTimelineEvent) {
      throw new Error('Timeline event "message.received" not found for inbound customer WhatsApp message');
    }

    console.log('[Milestone D] Verified inbound customer message logged on lead record timeline');

    const checkWindowRes2 = await fetch(`${baseUrl}/messaging/whatsapp/session-window/${leadRecord.id}`, {
      method: 'GET',
      headers: authHeaders,
    });
    const windowJson2 = await checkWindowRes2.json();
    if (!windowJson2.isOpen || windowJson2.remainingMinutes <= 0) {
      throw new Error(`Session window should now be OPEN, got: ${JSON.stringify(windowJson2)}`);
    }
    console.log(`[Milestone D] Verified 24-hour customer session window is now OPEN (${windowJson2.remainingMinutes} minutes remaining)`);

    const chaseRulePayload = {
      name: 'Chase Stalled Lead on WhatsApp',
      moduleId: leadModule.id,
      trigger: {
        eventType: 'record.updated',
        moduleKey: 'lead',
      },
      conditions: {
        field: 'stage_id',
        op: 'eq',
        value: contactedStage.id,
      },
      actions: [
        {
          id: 'action-chase-whatsapp',
          type: 'action',
          handler: 'send_whatsapp',
          config: {
            connectorId: waConnector.id,
            toPhone: '{{data.phone}}',
            message: 'Hi {{display_name}}, following up on your {{data.requirement}} requirement. Did you have a chance to review the specifications?',
            purpose: 'utility',
          },
        },
      ],
      isActive: true,
    };

    const createAutoRes = await fetch(`${baseUrl}/automations`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(chaseRulePayload),
    });

    if (!createAutoRes.ok) {
      const err = await createAutoRes.text();
      throw new Error(`Failed to create chase automation: ${err}`);
    }

    const automation = await createAutoRes.json();
    console.log(`[Milestone D] Created lead chasing automation rule "${automation.name}" (${automation.id})`);

    const initialWhatsAppDispatchedCount = mockServer.dispatchedWhatsApp.length;

    const updateLeadRes = await fetch(`${baseUrl}/modules/lead/records/${leadRecord.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        stage_id: contactedStage.id,
      }),
    });

    if (!updateLeadRes.ok) {
      const err = await updateLeadRes.text();
      throw new Error(`Failed to update lead stage to contacted: ${err}`);
    }

    console.log(`[Milestone D] Moved lead "${leadRecord.display_name}" to stage "${contactedStage.label}" to trigger chase rule`);

    const maxWaitMs = 8000;
    const pollStart = Date.now();
    let automationTriggered = false;

    while (Date.now() - pollStart < maxWaitMs) {
      if (mockServer.dispatchedWhatsApp.length > initialWhatsAppDispatchedCount) {
        automationTriggered = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    if (!automationTriggered) {
      const runsRes = await fetch(`${baseUrl}/automations/${automation.id}/runs`, {
        method: 'GET',
        headers: authHeaders,
      });
      const runs = await runsRes.json().catch(() => []);
      throw new Error(`Automation did not dispatch WhatsApp chase within timeout. Runs: ${JSON.stringify(runs)}`);
    }

    const dispatchedChaseMsg = mockServer.dispatchedWhatsApp[mockServer.dispatchedWhatsApp.length - 1];
    console.log('[Milestone D] Mock Meta WhatsApp API received outbound chase message:', JSON.stringify(dispatchedChaseMsg.body));

    if (!dispatchedChaseMsg.body.text?.body?.includes('Solaris Energy Group')) {
      throw new Error('Chase message body is missing interpolated lead display_name');
    }
    if (!dispatchedChaseMsg.body.text?.body?.includes('Rooftop Solar EPC Solution')) {
      throw new Error('Chase message body is missing interpolated data.requirement dynamic field');
    }

    const [outboundDbMessage] = await sql<any[]>`
      SELECT *
      FROM messages
      WHERE org_id = ${orgId}
        AND record_id = ${leadRecord.id}
        AND channel = 'whatsapp'
        AND direction = 'outbound'
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (!outboundDbMessage) {
      throw new Error('Outbound chase message not found in messages table');
    }

    console.log(`[Milestone D] Outbound chase message saved in messages table. Thread ID: ${outboundDbMessage.thread_id}, Status: ${outboundDbMessage.status}`);

    const [timelineSentEvent] = await sql<any[]>`
      SELECT *
      FROM record_events
      WHERE org_id = ${orgId}
        AND record_id = ${leadRecord.id}
        AND type = 'message.sent'
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (!timelineSentEvent) {
      throw new Error('Timeline event "message.sent" not found for outbound WhatsApp chase');
    }

    console.log('[Milestone D] Verified outbound chase message logged on lead timeline');

    const customerReplyWamid = `wamid.customer_reply_${Date.now()}`;
    const customerReplyText = 'Yes, we reviewed the EPC specifications! Can we schedule a site survey this Thursday?';

    const replyWebhookRes = await fetch(`${baseUrl}/inbound/${waConnector.id}?orgId=${orgId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: {
                    display_phone_number: '911234567890',
                  },
                  messages: [
                    {
                      from: '919876543210',
                      id: customerReplyWamid,
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      type: 'text',
                      context: {
                        id: outboundDbMessage.provider_message_id,
                      },
                      text: {
                        body: customerReplyText,
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    });

    if (!replyWebhookRes.ok) {
      const err = await replyWebhookRes.text();
      throw new Error(`Customer reply webhook failed: ${err}`);
    }

    const replyResult = await replyWebhookRes.json();
    console.log('[Milestone D] Customer reply processed:', JSON.stringify(replyResult));

    const [replyDbMessage] = await sql<any[]>`
      SELECT *
      FROM messages
      WHERE provider_message_id = ${customerReplyWamid}
    `;

    if (!replyDbMessage) {
      throw new Error('Customer reply not found in messages table');
    }

    if (replyDbMessage.record_id !== leadRecord.id) {
      throw new Error(`Customer reply linked to record ${replyDbMessage.record_id}, expected ${leadRecord.id}`);
    }

    if (replyDbMessage.thread_id !== outboundDbMessage.thread_id) {
      throw new Error(`Thread ID mismatch! Outbound: ${outboundDbMessage.thread_id}, Reply: ${replyDbMessage.thread_id}`);
    }

    console.log('[Milestone D] Verified customer reply threaded correctly to same conversation thread and lead record');

    const [replyTimelineEvent] = await sql<any[]>`
      SELECT *
      FROM record_events
      WHERE org_id = ${orgId}
        AND record_id = ${leadRecord.id}
        AND type = 'message.received'
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (!replyTimelineEvent) {
      throw new Error('Timeline event "message.received" not found for customer reply');
    }

    console.log('[Milestone D] Verified customer reply logged on lead timeline in record_events');

    const getMessagesRes = await fetch(`${baseUrl}/email/records/${leadRecord.id}`, {
      method: 'GET',
      headers: authHeaders,
    });
    if (!getMessagesRes.ok) {
      throw new Error(`Failed to fetch record messages: ${getMessagesRes.status}`);
    }
    const threadMessages = await getMessagesRes.json();
    if (threadMessages.length < 3) {
      throw new Error(`Expected at least 3 messages in lead thread (initial inbound, chase outbound, reply inbound), got ${threadMessages.length}`);
    }
    console.log(`[Milestone D] Verified record timeline conversation history has ${threadMessages.length} messages`);

    const deliveryStatusRes = await fetch(`${baseUrl}/inbound/${waConnector.id}?orgId=${orgId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  statuses: [
                    {
                      id: outboundDbMessage.provider_message_id,
                      status: 'delivered',
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      recipient_id: '919876543210',
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    });

    if (!deliveryStatusRes.ok) {
      throw new Error('Delivery status webhook failed');
    }

    const [updatedOutboundMsg] = await sql<any[]>`
      SELECT status
      FROM messages
      WHERE id = ${outboundDbMessage.id}
    `;

    if (updatedOutboundMsg.status !== 'delivered') {
      throw new Error(`Expected message status "delivered", got "${updatedOutboundMsg.status}"`);
    }
    console.log('[Milestone D] Verified Meta delivery receipt updated outbound message status to "delivered"');

    const optoutWamid = `wamid.stop_${Date.now()}`;
    const stopWebhookRes = await fetch(`${baseUrl}/inbound/${waConnector.id}?orgId=${orgId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: '919876543210',
                      id: optoutWamid,
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      type: 'text',
                      text: { body: 'STOP' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    });

    if (!stopWebhookRes.ok) {
      throw new Error('Stop keyword webhook failed');
    }

    const [withdrawnConsent] = await sql<any[]>`
      SELECT *
      FROM consents
      WHERE org_id = ${orgId}
        AND record_id = ${leadRecord.id}
        AND channel = 'whatsapp'
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (!withdrawnConsent || withdrawnConsent.status !== 'withdrawn') {
      throw new Error('Inbound STOP keyword failed to automatically withdraw consent in consents table');
    }
    console.log('[Milestone D] Verified inbound "STOP" keyword automatically withdrew consent in consents table');

    const sendAfterOptoutRes = await fetch(`${baseUrl}/messaging/whatsapp/send`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        recordId: leadRecord.id,
        text: 'Follow-up after optout attempt',
        purpose: 'utility',
        connectorId: waConnector.id,
      }),
    });

    if (sendAfterOptoutRes.ok) {
      throw new Error('Outbound send succeeded after customer opted out with STOP! It must be refused.');
    }

    const optoutRejection = await sendAfterOptoutRes.json();
    console.log(`[Milestone D] Refused send after STOP opt-out: "${optoutRejection.detail || optoutRejection.title}"`);
    const optoutDetail = String(optoutRejection.detail || optoutRejection.title).toLowerCase();
    if (!optoutDetail.includes('opted out') && !optoutDetail.includes('withdrawn')) {
      throw new Error(`Expected rejection stating opt-out or withdrawn consent, got: ${JSON.stringify(optoutRejection)}`);
    }

    await fetch(`${baseUrl}/automations/${automation.id}`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    await fetch(`${baseUrl}/connectors/${waConnector.id}`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    await fetch(`${baseUrl}/connectors/${smsConnector.id}`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    await fetch(`${baseUrl}/modules/lead/records/${leadRecord.id}`, {
      method: 'DELETE',
      headers: authHeaders,
    });

    await sql`
      DELETE FROM consents
      WHERE record_id = ${leadRecord.id}
    `;

    await sql`
      DELETE FROM messages
      WHERE record_id = ${leadRecord.id}
    `;

    console.log('[Milestone D] Test fixtures cleaned up successfully');
    console.log('\n================================================================');
    console.log('MILESTONE D ACCEPTANCE CRITERIA: FULLY VERIFIED AND PASSED');
    console.log('================================================================\n');
  } finally {
    mockServer.server.close();
    await sql.end();
  }
}

runMilestoneDVerification().catch((err) => {
  console.error('[Milestone D FAILED]', err);
  process.exit(1);
});
