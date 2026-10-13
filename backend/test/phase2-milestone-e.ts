import assert from 'assert';

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:9000/api';

async function run() {
  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@webingo.com',
      password: 'admin123',
    }),
  });

  assert.ok(loginRes.status === 200 || loginRes.status === 201, `Login failed: status ${loginRes.status}`);
  const setCookie = loginRes.headers.get('set-cookie');
  assert.ok(setCookie, 'No set-cookie header received from login');
  const sessionCookie = setCookie.split(';')[0];
  const loginData = await loginRes.json();
  const currentUserId = loginData.id;
  const currentOrgId = loginData.orgId;
  assert.ok(currentUserId, 'Missing user id in login response');

  const authHeaders = {
    'Content-Type': 'application/json',
    Cookie: sessionCookie,
  };

  const schemaRes = await fetch(`${BASE_URL}/schema`, {
    headers: authHeaders,
  });
  assert.strictEqual(schemaRes.status, 200, 'Failed to fetch schema');
  const schema = await schemaRes.json();
  const leadModule = schema.modules.find((m: any) => m.key === 'lead');
  assert.ok(leadModule, 'Lead module not found in schema');

  await fetch(`${BASE_URL}/notifications/device-token`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      token: 'fcm_owner_device_token_xyz_987',
      platform: 'android',
    }),
  });

  const createSourceRes = await fetch(`${BASE_URL}/capture/sources`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: 'Website Lead Capture Form',
      type: 'form',
      targetModuleKey: 'lead',
      fieldMapping: {
        full_name: 'display_name',
        contact_email: 'email',
        contact_phone: 'phone',
        company_name: 'company',
        notes: 'requirement',
      },
      defaults: {
        source: 'Website',
      },
      dedupeOn: ['email'],
      onDuplicate: 'update_existing',
      assignTo: {
        strategy: 'fixed',
        userId: currentUserId,
      },
      config: {
        title: 'Contact Webingo Sales',
        description: 'Drop your project requirements',
        submitButtonText: 'Submit Inquiry',
        successMessage: 'Thank you! A sales representative will connect within 10 minutes.',
      },
    }),
  });

  assert.strictEqual(createSourceRes.status, 201, 'Failed to create lead source');
  const source = await createSourceRes.json();
  assert.ok(source.id, 'Source ID missing');
  assert.strictEqual(source.name, 'Website Lead Capture Form');
  assert.strictEqual(source.target_module_key, 'lead');

  const publicSpecRes = await fetch(`${BASE_URL}/public/forms/${source.id}`);
  assert.strictEqual(publicSpecRes.status, 200, 'Failed to fetch public form definition');
  const publicSpec = await publicSpecRes.json();
  assert.strictEqual(publicSpec.sourceId, source.id);
  assert.strictEqual(publicSpec.title, 'Contact Webingo Sales');
  assert.ok(Array.isArray(publicSpec.fields), 'Public form fields array missing');
  assert.ok(publicSpec.fields.length > 0, 'Public form fields empty');

  const t0 = Date.now();
  const testEmail = `lead_${Date.now()}@milestone-e-test.com`;

  const submitRes = await fetch(`${BASE_URL}/public/forms/${source.id}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      full_name: 'Aarav Mehta',
      contact_email: testEmail,
      contact_phone: '+91 99887 76655',
      company_name: 'Apex Solutions Private Ltd',
      notes: 'Interested in enterprise cloud deployment',
    }),
  });

  const durationMs = Date.now() - t0;
  assert.ok(durationMs < 10000, `Speed-to-lead exceeded 10 seconds: took ${durationMs}ms`);

  assert.ok(submitRes.status === 200 || submitRes.status === 201, `Submission failed: ${submitRes.status}`);
  const submitData = await submitRes.json();
  assert.strictEqual(submitData.success, true);
  assert.ok(submitData.recordId, 'Record ID missing from submission response');
  assert.strictEqual(submitData.assignedOwnerId, currentUserId, 'Lead not assigned to owner');

  const createdLeadRes = await fetch(`${BASE_URL}/modules/lead/records/${submitData.recordId}`, {
    headers: authHeaders,
  });
  assert.strictEqual(createdLeadRes.status, 200, 'Failed to fetch created lead');
  const createdLead = await createdLeadRes.json();
  assert.strictEqual(createdLead.display_name, 'Aarav Mehta');
  assert.strictEqual(createdLead.owner_id, currentUserId);
  assert.strictEqual(createdLead.data.email, testEmail);
  assert.strictEqual(createdLead.data.company, 'Apex Solutions Private Ltd');
  assert.strictEqual(createdLead.data.source, 'Website');

  const notifRes = await fetch(`${BASE_URL}/notifications`, {
    headers: authHeaders,
  });
  assert.strictEqual(notifRes.status, 200, 'Failed to fetch notifications');
  const notifData = await notifRes.json();
  const leadNotif = notifData.items.find(
    (n: any) => n.data?.recordId === submitData.recordId || (n.title && n.title.includes('Aarav Mehta')),
  );
  assert.ok(leadNotif, 'Owner did not receive lead notification');
  assert.strictEqual(leadNotif.eventType, 'lead_assigned');
  assert.ok(leadNotif.title.includes('Aarav Mehta'));

  const dedupSubmitRes = await fetch(`${BASE_URL}/public/forms/${source.id}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      full_name: 'Aarav Mehta (Updated)',
      contact_email: testEmail,
      contact_phone: '+91 99887 76655',
      company_name: 'Apex Solutions International',
      notes: 'Updated requirements: urgent kickoff',
    }),
  });

  assert.strictEqual(dedupSubmitRes.status, 200, 'Duplicate submission failed');
  const dedupSubmitData = await dedupSubmitRes.json();
  assert.strictEqual(dedupSubmitData.success, true);
  assert.strictEqual(dedupSubmitData.isDuplicate, true);
  assert.strictEqual(dedupSubmitData.recordId, submitData.recordId);

  const updatedLeadRes = await fetch(`${BASE_URL}/modules/lead/records/${submitData.recordId}`, {
    headers: authHeaders,
  });
  const updatedLead = await updatedLeadRes.json();
  assert.strictEqual(updatedLead.data.company, 'Apex Solutions International');

  const rejectSourceRes = await fetch(`${BASE_URL}/capture/sources`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: 'Reject Duplicates Form',
      type: 'form',
      targetModuleKey: 'lead',
      fieldMapping: { email: 'email', name: 'display_name' },
      dedupeOn: ['email'],
      onDuplicate: 'reject',
      assignTo: { strategy: 'fixed', userId: currentUserId },
    }),
  });
  assert.strictEqual(rejectSourceRes.status, 201);
  const rejectSource = await rejectSourceRes.json();

  const rejectSubmitRes = await fetch(`${BASE_URL}/public/forms/${rejectSource.id}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: testEmail,
      name: 'Should Reject Duplicate',
    }),
  });
  const rejectData = await rejectSubmitRes.json();
  assert.strictEqual(rejectData.success, false);
  assert.strictEqual(rejectData.isDuplicate, true);

  const botSubmitRes = await fetch(`${BASE_URL}/public/forms/${source.id}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      full_name: 'Spam Bot',
      contact_email: 'spambot@spam.com',
      _hp: 'malicious bot filling hidden input',
    }),
  });
  assert.strictEqual(botSubmitRes.status, 200);
  const botData = await botSubmitRes.json();
  assert.strictEqual(botData.success, true);

  const makeReqRes = await fetch(`${BASE_URL}/modules/lead/fields/email`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({
      isRequired: true,
    }),
  });
  assert.strictEqual(makeReqRes.status, 200, 'Failed to set email field as required');

  const badPayloadRes = await fetch(`${BASE_URL}/public/forms/${source.id}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      full_name: 'Lead Missing Email',
      company_name: 'Broken Co',
    }),
  });

  const badData = await badPayloadRes.json();
  assert.strictEqual(badData.success, false);
  assert.strictEqual(badData.quarantined, true);
  assert.ok(badData.quarantineId, 'Missing quarantineId in bad payload response');

  const quarantineListRes = await fetch(`${BASE_URL}/capture/quarantine`, {
    headers: authHeaders,
  });
  assert.strictEqual(quarantineListRes.status, 200);
  const quarantineList = await quarantineListRes.json();
  const quarantinedItem = quarantineList.find((q: any) => q.id === badData.quarantineId);
  assert.ok(quarantinedItem, 'Parked payload not found in quarantine list');
  assert.strictEqual(quarantinedItem.status, 'quarantined');
  assert.ok(quarantinedItem.errorReason.includes('Missing required field'));

  const replayedEmail = `replayed_${Date.now()}@milestone-e-test.com`;
  const replayRes = await fetch(`${BASE_URL}/capture/quarantine/${quarantinedItem.id}/replay`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      overrides: {
        contact_email: replayedEmail,
      },
    }),
  });
  assert.strictEqual(replayRes.status, 200, 'Quarantine replay request failed');
  const replayResult = await replayRes.json();
  assert.strictEqual(replayResult.success, true);
  assert.ok(replayResult.recordId, 'Replay did not create recordId');

  const checkReplayedLead = await fetch(`${BASE_URL}/modules/lead/records/${replayResult.recordId}`, {
    headers: authHeaders,
  });
  assert.strictEqual(checkReplayedLead.status, 200);
  const replayedLead = await checkReplayedLead.json();
  assert.strictEqual(replayedLead.data.email, replayedEmail);

  const quarantineAfterRes = await fetch(`${BASE_URL}/capture/quarantine`, {
    headers: authHeaders,
  });
  const quarantineAfterList = await quarantineAfterRes.json();
  const replayedQItem = quarantineAfterList.find((q: any) => q.id === quarantinedItem.id);
  assert.ok(replayedQItem);
  assert.strictEqual(replayedQItem.status, 'replayed');
  assert.strictEqual(replayedQItem.replayedRecordId, replayResult.recordId);

  await fetch(`${BASE_URL}/modules/lead/fields/email`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({
      isRequired: false,
    }),
  });

  const createTaskRes = await fetch(`${BASE_URL}/activities`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      activityType: 'task',
      title: 'Follow up on cloud pricing proposal',
      relatedToModule: 'lead',
      relatedToId: submitData.recordId,
      dueDate: new Date(Date.now() + 86400000).toISOString(),
      priority: 'high',
      body: 'Call client to review enterprise tier discounting',
    }),
  });
  assert.strictEqual(createTaskRes.status, 201, 'Failed to create task activity');
  const createdTask = await createTaskRes.json();
  assert.strictEqual(createdTask.activityType, 'task');
  assert.strictEqual(createdTask.title, 'Follow up on cloud pricing proposal');
  assert.strictEqual(createdTask.relatedToId, submitData.recordId);

  const createMeetingRes = await fetch(`${BASE_URL}/activities`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      activityType: 'meeting',
      title: 'Product Architecture Review',
      relatedToModule: 'lead',
      relatedToId: submitData.recordId,
      dueDate: new Date(Date.now() + 172800000).toISOString(),
      priority: 'urgent',
      body: 'Review security compliance and VPC requirements',
    }),
  });
  assert.strictEqual(createMeetingRes.status, 201, 'Failed to create meeting activity');
  const createdMeeting = await createMeetingRes.json();
  assert.strictEqual(createdMeeting.activityType, 'meeting');

  const leadActivitiesRes = await fetch(`${BASE_URL}/activities?relatedToId=${submitData.recordId}`, {
    headers: authHeaders,
  });
  const leadActBody = await leadActivitiesRes.json();
  assert.strictEqual(leadActivitiesRes.status, 200, `Failed to list lead activities: ${JSON.stringify(leadActBody)}`);
  const activities = leadActBody;
  assert.strictEqual(activities.length, 2, 'Expected 2 activities for this lead');

  const updateActRes = await fetch(`${BASE_URL}/activities/${createdTask.id}`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({
      outcome: 'Client approved pricing draft',
      priority: 'medium',
    }),
  });
  assert.strictEqual(updateActRes.status, 200, 'Failed to update activity');
  const updatedAct = await updateActRes.json();
  assert.strictEqual(updatedAct.data.priority, 'medium');

  const timelineRes = await fetch(`${BASE_URL}/modules/lead/records/${submitData.recordId}/timeline`, {
    headers: authHeaders,
  });
  assert.strictEqual(timelineRes.status, 200, 'Failed to fetch timeline');
  const timelineEvents = await timelineRes.json();
  const activityEvent = timelineEvents.find((e: any) => e.type === 'activity.logged');
  assert.ok(activityEvent, 'Activity not logged to record timeline');

  console.log('Milestone E test suite passed successfully!');
}

run().catch((err) => {
  console.error('Milestone E test failed:', err);
  process.exit(1);
});
