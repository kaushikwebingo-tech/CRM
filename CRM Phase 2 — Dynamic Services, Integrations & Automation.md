# CRM Phase 2 — Dynamic Services, Integrations & Automation

Oct 8, 2026 · @Webingo HQ

Phase 1 built a CRM where every module, field and pipeline is data. Phase 2 applies the same rule to everything that acts on that data: every trigger, every condition, every action, every connected service and every metric is a row an admin can create, not code a developer ships.

## Scope

Phase 2 turns a working record system into an operating system for sales. Twelve service areas, every one of them configured rather than coded.

**What Phase 2 delivers**

| Area | What an admin can do without a developer |
| --- | --- |
| Automation engine | Build a rule: when any field changes, if any condition holds, do any sequence of actions |
| Connector framework | Add a service (email, WhatsApp, SMS, webhook, any future API) and authenticate it |
| Template engine | Write message templates that pull any field of any module |
| Messaging | Send and receive email, WhatsApp and SMS against any record |
| Lead capture | Publish a web form from a module, and ingest leads from ads and inboxes |
| Activities | Tasks, calls, meetings, reminders, calendar sync |
| Routing rules | Assignment, round robin, SLA escalation, lead scoring, duplicate merge |
| Reports | Define a metric, chart it, schedule it to an inbox |
| Advanced fields | Formula, rollup, conditional visibility, validation rules |
| Open platform | API keys, outbound webhooks, so other systems extend the CRM |
| Governance | Quotas, run logs, consent, retention |

**What the foundation must already provide.** This plan builds directly on the Phase 1 contract. Before starting, confirm all six exist, because every section here assumes them:

1. `RecordService` as the single write path, wrapping record, audit entry and outbox insert in one transaction
2. `outbox_events` with a worker that dispatches with retry and backoff
3. The `DomainEvent` envelope carrying `changes` — only the keys that actually changed
4. The filter DSL compiler, reusable for automation conditions
5. The compiled schema cache (`CompiledModule`) with `fieldsByKey` and `sqlColumns`
6. The `ActionHandler` interface with `webhook` already working end to end

If any of those is missing or was shortcut during the foundation build, fix it before Phase 2 rather than working around it. Every service below plugs into exactly these six points, and that is what keeps twelve features from becoming twelve codebases.

**Stack assumption.** Written against the Phase 1 stack — PostgreSQL, NestJS, Redis, BullMQ. If you went with a backend-as-a-service for auth and storage instead, only two things change: Section 14's credential vault uses that platform's secret store, and Section 8's calendar sync may reuse its OAuth. Everything else is unaffected, because it all sits above the record engine.

**How the implementing agent should use this.** Build in the milestone order of Section 15, not document order. Sections 3 to 5 are the spine and must be complete before any channel is attempted — building WhatsApp before the connector framework is how a dynamic system acquires its first hardcoded service. Each milestone has an acceptance criterion; stop at each one for review.

## At a glance

Phase 2 adds no new architecture. It adds four registries on top of the foundation, and every one of the twelve services below is an entry in one of them.

&#91;embedded content: Phase 2 architecture · four registries, twelve services\]

This is the structural test for the whole phase: if a feature cannot be expressed as a registry entry plus configuration rows, it does not belong in Phase 2 — either the registry is too narrow and should be widened, or the feature is a Phase 3 product in its own right.

| Registry | Adding one means | Nothing else changes |
| --- | --- | --- |
| Action handlers | A new thing automations can do | The engine, the builder UI, the run log |
| Providers | A new external service | The action handlers that use its capability |
| Field types | A new kind of data | Forms, grids, filters, imports, public forms |
| Rule kinds | A new way to judge a record | The rules table, the condition editor |

Four registries, one event stream, one filter language, one template resolver. Everything else is rows.

## Automation engine

An automation is one row: a trigger, a condition tree, and an ordered action graph. All three sides are dynamic — the trigger names a field key, the condition is filter DSL, the action is a registry key. Nothing about Lead, Budget or WhatsApp appears in the engine's code.

&#91;embedded content: automation anatomy · 5 nodes, 3 dynamic sides\]

Read the right-hand column as the test for each part: every choice an admin makes comes from a registry or from compiled metadata, which is what keeps the engine from learning any field or vendor name.

```ts
interface Automation {
  id: string;
  orgId: string;
  moduleKey: string | null;        // null = cross-module or scheduled
  name: string;
  isActive: boolean;
  trigger: TriggerDef;
  conditions: FilterNode | null;    // the Phase 1 filter DSL, unchanged
  nodes: AutomationNode[];          // ordered graph, not a flat list
  settings: {
    runOnce: boolean;               // once per record, ever
    reentrant: boolean;             // may re-run on later matching events
    maxRunsPerRecordPerDay: number;
  };
}
```

### Triggers

Seven trigger types cover everything a CRM needs. Each is validated against module metadata, so a trigger can never name a field that does not exist.

| Trigger | Fires on | Config |
| --- | --- | --- |
| `record.created` | New record in a module | — |
| `record.updated` | Any update | `fieldKeys[]` — empty means any field |
| `record.field_changed` | A specific field changes to a specific value | `fieldKey`, optional `toValue` |
| `record.stage_changed` | Stage move | `fromStageIds[]`, `toStageIds[]` |
| `record.deleted` | Soft delete | — |
| `date.reached` | A date field arrives | `fieldKey`, `offsetDays`, `timeOfDay` |
| `schedule.cron` | Clock, not a record | `cron`, plus a filter that selects records to act on |
| `inbound.received` | A message, form or webhook arrives | `channel`, `sourceId` |

The last three are what make the engine useful rather than merely reactive. `date.reached` powers follow-up reminders and renewal alerts; `schedule.cron` powers "every Monday, email each manager their team's stalled deals"; `inbound.received` is what connects Section 7's lead capture to everything else.

For `date.reached`, a nightly job scans date fields that any active automation references and enqueues delayed jobs. Do not poll every record every minute — only fields actually referenced by an automation are scanned, which the compiled automation set tells you for free.

### Conditions

Conditions reuse the Phase 1 filter DSL with no changes to its grammar, plus three evaluation contexts the list view never needed:

- `record` — the record as it now stands. Same compiler, same operators.
- `changes` — the diff. `{ "changed": "budget", "op": "increased_by_more_than", "value": 100000 }`
- `related` — a condition on a looked-up record. `{ "field": "company_id.city", "op": "eq", "value": "Kolkata" }`, resolved one level deep only

One level of relation depth is a deliberate limit. Unbounded traversal turns a condition evaluation into an unpredictable number of queries, and in an automation that runs on every write, that is how a CRM becomes slow for reasons nobody can find.

### The action graph

Actions form a small graph, not a list, because real sales rules branch. Four node types are enough and no more should be added without a strong case.

```ts
type AutomationNode =
  | { id: string; type: 'action'; handler: string; config: unknown; next: string | null }
  | { id: string; type: 'branch'; conditions: FilterNode; onTrue: string; onFalse: string | null }
  | { id: string; type: 'wait'; mode: 'duration' | 'until_field'; config: WaitConfig; next: string | null }
  | { id: string; type: 'stop'; reason?: string };
```

A `wait` node suspends the run and persists it. The run resumes from a delayed BullMQ job, and on resume it **re-reads the record and re-evaluates the original conditions** before continuing. A three-day wait on a deal that has since been marked lost must not send the follow-up. This re-check is the single most important behaviour in the engine and the one most often left out.

### Action handlers to ship

| Handler | Config | Milestone |
| --- | --- | --- |
| `update_field` | field key, value or template | A |
| `assign_owner` | user, round robin pool, or rule | A |
| `change_stage` | stage id | A |
| `create_record` | target module, field mapping | A |
| `create_task` | title, assignee, due offset | B |
| `send_notification` | in-app or push, recipients | B |
| `send_email` | connector, template, recipient field | C |
| `send_whatsapp` | connector, approved template, phone field | D |
| `send_sms` | connector, DLT template id | D |
| `http_request` | method, URL from allowlist, body template | E |
| `run_report` | report id, delivery | F |

Every handler implements the Phase 1 `ActionHandler` interface. Its `configSchema` renders its own settings form, which means the automation builder UI never learns a handler-specific layout — adding a twelfth handler changes no frontend code.

### Execution

A run is a durable row, not an in-memory sequence. `automation_runs` holds the current node id, the resolved variable bag and a step-by-step log. A crashed worker resumes mid-graph rather than restarting or losing the run. Each node's execution is idempotent by `(runId, nodeId)`, so a retry after a timeout cannot send the same WhatsApp message twice — which is the failure mode customers actually notice.

### Builder UI

A vertical canvas: trigger card at the top, condition card, then action cards with branches splitting into two columns. Built with dnd-kit, same as the kanban. Each card's settings panel is rendered from the handler's `configSchema` by the same renderer that draws record forms. Every field picker, value input and operator list is populated from the compiled module — so the builder gains new fields the moment an admin creates them.

Ship a test runner in the builder from day one: pick a real record, click Test, see each node's outcome without sending anything externally. An automation builder without a dry run is one nobody trusts enough to use.

## Connector framework

A connector is a configured instance of a provider. The provider is declared once in code; the instance is a row an admin creates in the UI. "Dynamic connected apps" means exactly this: adding Gmail for the Kolkata team is an admin task, and adding support for a provider nobody has heard of yet is one manifest file.

```ts
interface ProviderManifest<TConfig, TCreds> {
  key: string;                      // 'whatsapp_cloud', 'smtp', 'razorpay'
  label: string;
  category: 'email' | 'messaging' | 'telephony' | 'calendar' | 'payment' | 'generic';
  icon: string;

  auth: { type: 'api_key' | 'basic' | 'oauth2' | 'none'; scopes?: string[];
          authorizeUrl?: string; tokenUrl?: string };

  configSchema: ZodType<TConfig>;   // renders the setup form — no bespoke UI
  credentialSchema: ZodType<TCreds>;

  capabilities: Capability[];       // 'send_email', 'receive_email', 'send_template_message'
  rateLimit: { perSecond: number; perDay?: number };

  healthCheck(ctx): Promise<{ ok: boolean; detail?: string }>;
  inboundVerify?(req): boolean;     // webhook signature validation
  inboundParse?(req): InboundMessage[];
}
```

The `capabilities` array is what decouples actions from providers. `send_email` asks the registry for any active connector advertising that capability; it never names SMTP or SES. Swapping provider is a dropdown change, and every automation keeps working.

### Credential vault

Credentials are encrypted at rest with AES-256-GCM using a key held in the environment, never in the database. Rules the implementation must follow:

- The API never returns a credential, not even masked beyond the last four characters.
- Decryption happens inside the worker at send time, never in the API process.
- Rotating the master key is a documented maintenance job, written in the same milestone.
- OAuth refresh tokens are stored the same way, refreshed by a scheduled job before expiry rather than on the failing request.

### Operational behaviour

**Health checks** run every 15 minutes per active connector and on save. A failing connector shows a red badge in settings and, critically, surfaces on the automation that depends on it — an admin should learn that WhatsApp is down from the CRM, not from a customer.

**Rate limiting** is per connector, enforced in the worker with a Redis token bucket. When the bucket empties, jobs requeue with backoff rather than failing. WhatsApp and SMS providers throttle hard, and a bulk campaign that trips a provider limit can get an account suspended.

**Circuit breaker.** After 10 consecutive failures the connector opens: queued jobs park, the admin is notified, and a half-open probe retries every five minutes. Without this, one expired token generates thousands of dead-letter rows overnight.

**Inbound routing.** One public endpoint, `POST /api/inbound/:connectorId`, verifies the signature through `inboundVerify`, parses through `inboundParse`, and emits an `inbound.received` event. Every inbound channel — WhatsApp replies, email, form posts, ad-platform leads — enters the system through this one door, which is what lets Section 7 treat them uniformly.

### Providers to ship

| Provider | Category | Milestone |
| --- | --- | --- |
| `webhook_out` | generic | Foundation, already done |
| `smtp` | email | C |
| `ses` | email | C |
| `imap` | email inbound | C |
| `gmail_oauth` | email, two-way | C |
| `whatsapp_cloud` | messaging | D |
| `msg91` or `twilio` | SMS | D |
| `google_calendar` | calendar | E |
| `http_generic` | generic outbound | E |

Ship `smtp` and `webhook_out` first and keep them as the reference implementations. If a new provider needs a change to the framework rather than only a manifest, the framework is wrong — fix it there rather than adding a special case.

## Template engine

One resolver, every channel. A template is text with variables; variables resolve against compiled module metadata, so the variable picker offers exactly the fields that exist today.

```
Hi {{display_name}}, thanks for your interest in {{data.requirement}}.
Your dedicated advisor is {{owner.full_name}} ({{owner.email}}).
{{#if data.budget}}We have options in your range of {{data.budget | currency}}.{{/if}}
Book a call: {{link.booking}}
```

**Namespaces**, fixed and small:

| Namespace | Resolves to |
| --- | --- |
| `display_name`, `stage`, `created_at` | Core record columns |
| `data.<field_key>` | Any dynamic field, formatted by its field type |
| `owner.*` | The record owner's user record |
| `actor.*` | Whoever or whatever triggered the run |
| `related.<field_key>.*` | One lookup hop, same depth limit as conditions |
| `org.*` | Company name, address, support email, signature |
| `link.*` | Generated signed links: record, booking page, unsubscribe, form |

**Formatters** come from the field type's own rendering, not from the template. `{{data.budget}}` prints ₹4,50,000 because `currency` knows Indian digit grouping; `{{data.follow_up_on}}` prints in the org's timezone. Pipes (`| upper`, `| date:'d MMM'`) override only when needed. This matters because the same template is used by email, WhatsApp and SMS, and the value must look right in all three without being written three times.

**Rules the engine enforces**

- Unknown variable is a validation error at save time, not an empty string at send time. Validate against the compiled module when the template is saved and again when an automation referencing it is activated.
- Null-safe at send time: a missing value renders its configured fallback, never the literal `undefined` in a customer's WhatsApp.
- No arbitrary code. Conditionals and loops only, with a nesting depth of 3. A template language that can execute is a template language that can be abused by anyone with admin access.
- Auto-escaping per channel: HTML for email, plain for SMS and WhatsApp.

**Versioning.** Templates are immutable once an automation references them; editing creates a new version and repoints the reference. A message sent three months ago must still be reproducible exactly, which matters in a billing or compliance dispute.

**Preview and test send.** Pick a real record, see the rendered output per channel, send a test to yourself. Build this in the same milestone as the engine, not later — it is how non-technical staff will actually author templates.

**Channel constraints the editor must enforce as you type:** SMS segment count and the 160/70-character boundary; WhatsApp's variable-only template bodies for approved templates; email subject length and a plain-text alternative generated automatically.

## Messaging channels

All three channels write to one `messages` table and one record timeline. A salesperson opening a lead sees email, WhatsApp and SMS in a single thread, in order. That unified view is the product; the channels are plumbing.

```sql
create table messages (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  record_id     uuid references records(id) on delete cascade,
  thread_id     uuid not null,
  channel       text not null,          -- email | whatsapp | sms
  direction     text not null,          -- inbound | outbound
  connector_id  uuid references connectors(id),
  from_address  text not null,
  to_address    text not null,
  subject       text,
  body_text     text,
  body_html     text,
  attachments   jsonb not null default '[]',
  template_id   uuid,
  provider_message_id text,
  status        text not null,          -- queued|sent|delivered|read|failed|bounced
  status_detail text,
  sent_by       uuid,                   -- user, or null when an automation sent it
  automation_run_id bigint,
  created_at    timestamptz not null default now(),
  unique (connector_id, provider_message_id)
);
```

The unique constraint on provider message id is the idempotency guard for webhook replays, which every provider does.

**Matching inbound to a record** is the hard part and needs a fixed ladder, applied in order: exact match on `provider_message_id` thread reference; then the email's `In-Reply-To` header or WhatsApp `context.id`; then an exact match on a phone or email field across modules; then a normalised phone match (E.164, last 10 digits for Indian numbers); then no match — which lands in an Unmatched inbox where a user assigns it in one click, and that assignment is remembered for next time.

### Email

**Outbound** via SMTP or SES. Every send sets `Message-ID`, `References` and a `List-Unsubscribe` header. Track opens with a pixel and clicks with a rewritten link, both switchable off per org — some clients consider tracking intrusive and a B2B CRM should not force it.

**Inbound** via IMAP polling every two minutes, or Gmail OAuth with push notifications where available. Parse with `mailparser`, strip quoted history so the timeline shows the new message rather than the whole chain, store attachments in object storage.

**Deliverability is a project, not a setting.** SPF, DKIM and DMARC on the sending domain; a separate subdomain for bulk so transactional mail is not poisoned by campaigns; bounce and complaint webhooks feeding a suppression list that the send path checks before every message. A hard-bounced address is never retried.

### WhatsApp

The constraint that shapes everything: outside a 24-hour window from the customer's last message, you may only send a pre-approved template. Inside it, free-form is allowed. The engine must model this explicitly.

- Store `last_inbound_at` per contact. The send path computes the window and chooses template or free-form, and refuses rather than silently failing when a free-form send falls outside it.
- Templates are submitted to Meta for approval and carry a status: pending, approved, rejected, paused. Sync status on a schedule and show it in the template editor. An automation referencing a rejected template must warn on activation, not at 2 a.m. when it fires.
- Opt-in is mandatory and must be recorded with source and timestamp — see Section 14.
- Inbound webhook delivers messages and status callbacks on the same endpoint. Handle `sent`, `delivered`, `read`, `failed` and map them onto `messages.status`.
- Support media in both directions, and interactive buttons for quick replies, since a tapped button is far better lead data than parsed free text.

### SMS and DLT

For sending to Indian numbers, TRAI's DLT regime applies: the sender must register an entity, register each header (sender ID), and register every message template, which is then approved and given a template id that must accompany the send. The CRM must treat this as first-class rather than an afterthought.

- The SMS template entity carries `dlt_template_id`, `dlt_header` and an approval status, mirroring the WhatsApp model.
- Validate at save time that the template body matches the registered DLT text apart from its variables — providers reject mismatches, and the failure message is usually unhelpful.
- Distinguish transactional, service-implicit and promotional categories, because consent rules and allowed sending hours differ.
- Respect the national Do Not Disturb registry for promotional sends; the provider enforces it, but the CRM should not queue what will be rejected.

**Provider choice** is deliberately a connector, not a decision this plan makes. Start with whichever has the DLT entity already registered, because registration takes days to weeks and is the long pole in this milestone.

## Inbound lead capture

Every lead source becomes a `source` row with a field mapping, and lands through the same door as everything else. Adding IndiaMART, a new landing page or a partner feed is configuration.

```ts
interface LeadSource {
  id: string;
  orgId: string;
  name: string;
  type: 'web_form' | 'api' | 'email_parse' | 'ad_platform' | 'click_to_whatsapp' | 'csv';
  targetModuleKey: string;
  fieldMapping: Record<string, string>;   // incoming key -> field key
  defaults: Record<string, unknown>;      // e.g. source = 'Website'
  dedupeOn: string[];                     // ['email'] or ['phone']
  onDuplicate: 'merge' | 'create_anyway' | 'update_existing' | 'reject';
  assignTo: AssignmentRule | null;
  isActive: boolean;
  secret: string;                         // signing key for this source
}
```

### Dynamic web forms

Pick a module, pick which of its fields to expose, reorder them, add a heading and a thank-you message. The form renders with the **same field component registry as the record form**, so a new field type works in public forms the day it is added, with no second implementation.

Ship three delivery modes: a hosted page on your own subdomain, a one-line embed script that mounts into any site, and a plain HTML snippet for teams that will not run third-party JavaScript. Conditional field visibility (Section 11) applies here too, so a form can branch on an earlier answer.

Protect every public form with an honeypot field, a per-IP rate limit and optional Cloudflare Turnstile. A public endpoint that writes to your CRM will be found by bots within days of going live.

### Ad platforms and marketplaces

Meta Lead Ads and Google Lead Form extensions both deliver by webhook and both need their field names mapped to yours — which the `fieldMapping` above already handles. Build the generic webhook source first and these become configuration, not code. The same applies to marketplace feeds like IndiaMART or TradeIndia, which arrive as email or API depending on the plan.

### Inbound email parsing

A dedicated address such as `leads@` runs through the same IMAP connector, with rules that extract fields from the body by labelled line or regex. Useful for marketplace notification emails, which are the most common lead source for Indian B2B and almost never offer an API on the basic tier.

### Click to WhatsApp

A `wa.me` link carrying a tracked reference. The first inbound message creates a lead with the source attributed and the phone number already populated. Pair it with an automation that sends an immediate acknowledgement template — inside the 24-hour window, so free-form is allowed.

### Processing pipeline

Every source runs the same five steps, in this order:

1. **Verify** — signature, rate limit, bot checks
2. **Map** — incoming payload to field keys, with type coercion through each field type's `parseImport`
3. **Validate** — against the compiled module schema; a failure parks the payload in a quarantine table with the reason, never discards it
4. **Dedupe** — per `dedupeOn` and `onDuplicate`
5. **Create and assign** — write through `RecordService`, apply the assignment rule, emit `inbound.received`

Step 3's quarantine is not optional. Lead sources change their payloads without warning, and a silently dropped lead is revenue lost with no trace. Surface the quarantine as a screen with a retry button.

**Speed-to-lead.** The whole pipeline, from webhook receipt to the owner's phone buzzing, should complete in under 10 seconds. Measure it and put it on the dashboard — it is the single metric most correlated with conversion in inbound sales.

## Activities, reminders and calendar

Activities are a module, not a special table. Create `activity` as a system module in the foundation's own metadata, with a pipeline of `Open → Done → Cancelled`. It then inherits dynamic fields, views, filters, automations and reports for free, and an admin can add "Site visit confirmed by" as a field without anyone writing code.

The only additions beyond a normal module are a polymorphic link to the record it concerns, and the small set of behaviours below.

| Activity type | Seeded fields |
| --- | --- |
| Task | title, due date, priority, assignee |
| Call | direction, outcome, duration, notes |
| Meeting | start, end, location or link, attendees |
| Note | body, pinned |

**Reminders** are not a new subsystem. A reminder is a `date.reached` automation on the activity's due date — which means a user who wants reminders two days early as well gets that by editing a rule, not by waiting for a release.

### Notifications

Three delivery surfaces, one preference matrix. Each user chooses, per event type, whether they get in-app, push, email or nothing, with a quiet-hours window and an optional daily digest.

| Event | Default |
| --- | --- |
| Lead assigned to me | in-app + push |
| Task due today | push, in the morning digest |
| Mentioned in a note | in-app + push |
| SLA breach on my record | push, immediately |
| Inbound message on my record | in-app |
| Automation failed on my record | in-app, admins also by email |

In-app notifications use the existing realtime channel. Push uses web push for the browser and FCM when the Flutter app lands — register the device token model now even though nothing consumes it yet, because retrofitting device registration into an auth flow is tedious.

The digest matters more than it sounds. Without it, a CRM that notifies on every change trains its users to ignore it within a fortnight.

### Calendar sync

Two-way with Google Calendar, and Outlook later, through the connector framework rather than a bespoke integration.

- Outbound: a meeting activity creates a calendar event with the record link in the description.
- Inbound: events on a watched calendar that carry the CRM's reference land as meeting activities on the right record.
- Conflict rule: the CRM is authoritative for events it created; the calendar is authoritative for everything else. Pick this once and write it down, because two-way sync without a stated winner produces duplicate events, and duplicate events destroy trust in the whole feature.
- Use incremental sync tokens and a channel watch rather than polling. Renew the watch before expiry on a schedule.

**Booking links**, if time allows in Phase 2: a public page showing an owner's free slots, writing the booking back as a meeting activity on the lead. High perceived value, modest effort once calendar sync exists, and it closes the loop from web form to booked call without a human touching it.

## Routing and intelligence rules

Four features that look unrelated and are in fact the same thing: a filter DSL condition attached to an outcome. Build them on one rules table and they cost a fraction of what four separate implementations would.

```sql
create table rules (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  module_id  uuid not null references modules(id) on delete cascade,
  kind       text not null,     -- assignment | sla | scoring | duplicate | validation
  name       text not null,
  conditions jsonb,             -- filter DSL
  config     jsonb not null,    -- kind-specific outcome
  priority   integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
```

### Assignment

Rules evaluate in priority order; the first match wins; an unmatched record goes to the module's default owner. Five strategies, all as config:

| Strategy | Config |
| --- | --- |
| Fixed user | user id |
| Round robin | pool of users, with a Redis counter per pool |
| Load balanced | pool, assign to whoever has fewest open records |
| By field value | map field values to users, e.g. city to regional head |
| Keep existing owner | used to protect records already being worked |

Two rules that experience teaches: respect working hours and availability, so leads do not round-robin to someone on leave; and support reassignment on no-action, where an untouched lead returns to the pool after N hours. Both are config on the same rule.

### SLA and escalation

An SLA is a condition, a target duration and an escalation chain.

```json
{
  "conditions": { "field": "source", "op": "eq", "value": "opt_website" },
  "config": {
    "startOn": "record.created",
    "stopOn": { "field": "stage_id", "op": "neq", "value": "stg_new" },
    "targetMinutes": 30,
    "businessHoursOnly": true,
    "escalations": [
      { "atPercent": 80, "notify": ["owner"] },
      { "atPercent": 100, "notify": ["owner", "manager"], "reassign": "pool_senior" }
    ]
  }
}
```

Business-hours arithmetic needs an org calendar with working days, hours, timezone and holidays. Build that calendar as its own small entity — reports, booking links and digest timing all need it too.

### Lead scoring

Scores are additive rules, recomputed on write and nightly. Keep it transparent: every score shows its contributing rules on the record, because a score nobody can explain is a score nobody acts on.

| Rule example | Points |
| --- | --- |
| Budget above ₹5,00,000 | +20 |
| Source is Referral | +15 |
| Opened an email in the last 7 days | +5 |
| No activity for 14 days | −10 |

Store the score in a system field on the record so it filters, sorts and triggers automations like any other number. Resist machine learning here — rule-based scoring that salespeople understand beats a model they distrust, and you will not have the labelled data for a useful model until the CRM has run for a year.

### Duplicate detection and merge

Run on create and on demand. Match on exact email, normalised phone, and fuzzy name plus company using `pg_trgm` similarity above a configurable threshold. Scoring several signals together beats any single exact match.

The merge operation must be careful, because it is destructive and users will do it wrong at least once:

- Field-by-field selection, with the surviving record's values pre-chosen and conflicts flagged.
- All activities, messages, notes and links move to the survivor.
- The merged record is soft-deleted with a `merged_into` pointer, never hard-deleted, so links from elsewhere still resolve.
- The whole merge is one transaction with one audit entry, and an undo window of 24 hours.

## Dynamic reports and dashboards

A metric is a row. The reporting engine extends the Phase 1 filter compiler with aggregation and grouping and does nothing else — if reporting needs its own query layer, the filter DSL was not built generally enough.

```ts
interface MetricDef {
  id: string;
  moduleKey: string;
  name: string;
  aggregate: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'count_distinct' | 'percentile';
  fieldKey: string | null;            // null for count
  filter: FilterNode | null;          // same DSL as views and conditions
  groupBy: GroupBy[];                 // field, or a date bucket
  timeField: string;                  // which date drives the period
  comparison: 'none' | 'previous_period' | 'previous_year';
  format: { type: 'number' | 'currency' | 'percent' | 'duration'; decimals: number };
}

interface GroupBy {
  fieldKey: string;
  bucket?: 'day' | 'week' | 'month' | 'quarter' | 'year';   // for date fields
  limit?: number;                                           // top N, rest as Other
}
```

The compiler maps this to one SQL statement through the existing `sqlColumns` map — `sum` on a currency field becomes `sum((r.data->>'budget')::numeric)`, grouped by `date_trunc('month', r.created_at)`. Same identifier resolution, same parameter binding, same injection safety as Section 8 of the foundation plan.

### Report types

| Type | What it needs beyond a metric |
| --- | --- |
| KPI tile | A single value with its comparison |
| Time series | One group-by on a bucketed date |
| Breakdown | One group-by on a category field |
| Matrix | Two group-bys, rendered as a pivot table |
| Funnel | Stage counts in pipeline order, plus drop-off between |
| Leaderboard | Group by owner, sorted, with rank movement |
| Record list | Not an aggregate — a saved view rendered as a report |

The funnel and the leaderboard are the two that sales managers open daily. Build those two properly before the matrix.

### Dashboards

A grid of report widgets with drag-to-resize, saved per user or shared with the org. Dashboard-level filters — date range, owner, pipeline — cascade into every widget, so one dashboard serves a manager and each of their reps.

Every widget drills through: clicking a bar opens the underlying records in a list view with the metric's filter applied. A number with no path to the records behind it is the fastest way to lose a sales manager's trust in a report.

### Performance

Aggregates over a growing table are where a CRM gets slow, and the fix must be built now rather than after the first complaint.

- Cache each widget's result in Redis for 60 seconds, keyed by metric id plus resolved filter plus schema version.
- Any field used in a metric's `groupBy` or `filter` gets flagged for the foundation's hot-field index promotion. Surface this in the report builder: if a metric groups on an unindexed field, offer the index with one click.
- Above roughly 200,000 records per module, maintain a nightly rollup table of daily counts and sums per module, owner and stage. Dashboards read the rollup for historical periods and live data only for today. Design the rollup schema in this milestone even if you do not populate it yet.
- Cap a single report at 50,000 scanned rows and tell the user when a result is truncated, rather than timing out.

### Scheduled delivery

A report plus a cron plus recipients plus a format equals a subscription — built as a `schedule.cron` automation with a `run_report` action, not as a separate scheduler. PDF and XLSX generated in the worker, delivered through the email connector. "Every Monday 9am, send each manager their team's pipeline" should be assembled in the automation builder by an admin, with no developer involved.

## Advanced dynamic fields

Five field capabilities the foundation deliberately deferred. Each is a new `FieldTypeDef` or a new rule kind, which is the test that the foundation's registry was built correctly.

### Formula fields

A computed value, stored rather than evaluated on read, so it filters and sorts like any other field.

```
margin = (data.sell_price - data.cost_price) / data.sell_price * 100
days_open = days_between(created_at, now())
full_name = concat(data.first_name, ' ', data.last_name)
```

The expression language is deliberately small: arithmetic, comparison, `if`, string concatenation, date arithmetic, and a fixed function list. **No general-purpose evaluator.** Parse to an AST, walk it with a whitelist of operations, cap depth and execution time. `eval` or a JavaScript sandbox in a path that any admin can write to is a remote-code-execution hole, and admin access is not the same as developer access.

Recompute on write, within the same transaction as the record. Maintain a dependency graph of field to dependent formulas, detect cycles at save time, and cap chain depth at 5. When a formula's definition changes, recompute affected records as a background job with progress shown.

### Rollup fields

An aggregate over related records: total deal value per company, count of open tasks on a lead, most recent activity date.

```json
{ "type": "rollup", "config": {
  "relationField": "company_id", "targetModule": "deal",
  "aggregate": "sum", "targetField": "amount",
  "filter": { "field": "stage.type", "op": "eq", "value": "open" }
}}
```

Update incrementally on child write — adding a deal adjusts the parent's total by the delta rather than re-summing the children. Re-summing on every child write is correct and becomes the slowest query in the system by month six. Add a nightly reconciliation job that recomputes and logs any drift.

### Conditional visibility

Show or hide a field based on other fields. Stored on the field, evaluated by the same filter DSL, applied identically in record forms, public web forms and the detail layout.

```json
{ "showWhen": { "field": "source", "op": "eq", "value": "opt_referral" } }
```

A hidden field is not a secure field. Visibility is a usability feature; Section 12 of the foundation plan is what actually protects data.

### Validation rules

Beyond required and unique: cross-field rules an admin writes, with the error message they want shown.

| Rule | Message |
| --- | --- |
| Close date must be in the future when stage is Proposal | "Set a realistic close date before sending a proposal" |
| Discount above 20% requires an approval note | "Add a note explaining the discount" |
| Phone required when source is Click to WhatsApp | "A phone number is needed for this source" |

Evaluated in `RecordService`, so they hold for the API, imports, automations and the UI alike. The frontend evaluates the same rules for instant feedback, from the same definitions in the schema bundle — written once, enforced twice.

### Layout rules

Per-role, per-stage detail layouts: which sections appear, in what order, which are collapsed. A rep sees six fields on a new lead and twenty on one in Negotiation. This is the cheapest feature in Phase 2 and the one users comment on most, because it is the difference between a form that feels designed and a form that feels like a database table.

## Open platform

The CRM becomes the centre of your stack only if other systems can read and write it without your involvement. Three mechanisms, all built on what already exists.

### Public API

The same endpoints the frontend uses, authenticated with a scoped key instead of a session. No parallel API surface — one implementation, two authentication methods.

```sql
create table api_keys (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  name        text not null,
  key_hash    text not null,          -- store the hash, show the key once
  prefix      text not null,          -- 'crm_live_8f2a', shown in the UI for identification
  scopes      jsonb not null,         -- per module, per action
  rate_limit  integer not null default 120,
  expires_at  timestamptz,
  last_used_at timestamptz,
  created_by  uuid,
  revoked_at  timestamptz
);
```

Scopes reuse the role permission shape from the foundation, so a key cannot be granted more than a role can. Show last-used time and let an admin revoke instantly — a key that cannot be audited or killed is a liability.

Publish an OpenAPI document **generated from compiled metadata**, not hand-written. When an admin adds a module, the API docs gain it automatically. This is the clearest demonstration that the system is genuinely metadata-driven, and it is close to free once the schema compiler exists.

### Outbound webhooks

Subscriptions to the same `DomainEvent` stream the automation engine consumes. Signed with HMAC-SHA256 over the body with a per-subscription secret and a timestamp header, retried with the worker's existing backoff, with a delivery log an admin can inspect and replay.

This is how the CRM reaches systems nobody anticipated — your accounting software, a client's ERP, an internal dashboard. Build it as a thin wrapper over the existing outbox rather than a new pipeline.

### Embedded extensions, later

When a client or a team wants a panel the core does not have, an iframe panel on the record detail, declared as a row with a URL and a signed JWT identifying the record and viewer, is enough. Scope this only if a real need appears; listing it here is to make sure nothing in Phase 2 forecloses it.

### Developer experience

Three things that decide whether anyone actually integrates: a sandbox org with seeded data that can be reset; webhook deliveries visible with their request, response and retry history; and clear, machine-readable errors. An integration partner judges your platform by its first failed call, not its first successful one.

## Safety, quotas and observability

Phase 1 could fail quietly and someone would notice a wrong number. Phase 2 sends messages to customers and spends money, so it must fail loudly and cheaply.

### Loop and runaway protection

The foundation's three guards carry forward and gain two more:

1. Causation chain on every event; an automation already in its own chain is skipped
2. Chain depth capped at 10
3. Per record, 50 automation executions per hour
4. **Global circuit breaker** — if total automation executions exceed 10x the trailing hourly average, pause all automations and alert admins. One badly written rule on a bulk import can otherwise send thousands of messages before anyone wakes up.
5. **Bulk-operation guard** — an import or bulk update produces events flagged `bulk: true`. Automations declare whether they run on bulk events, defaulting to no. Importing 2,000 historical leads must not WhatsApp all of them.

Guard 5 is the one most often missed and the one that causes the worst incident.

### Quotas

Per org, enforced in the worker and visible in settings with current usage:

| Quota | Starting value |
| --- | --- |
| Automation executions per day | 50,000 |
| Emails per day | 10,000 |
| WhatsApp messages per day | 5,000 |
| SMS per day | 5,000 |
| Outbound webhook calls per hour | 10,000 |
| API requests per minute per key | 120 |
| Report rows scanned per query | 50,000 |

At 80% of any quota, notify admins. At 100%, queue rather than drop, and show it clearly — silently dropping a customer message is worse than delaying it.

### Observability

**Automation run log** as a first-class screen, not a database table someone queries. Filter by automation, record, status and date. Each run shows every node, its input, its outcome and its duration, with the provider's actual response on a failed send. When a manager asks why a customer did not get their message, this screen must answer it in under a minute.

**Dead letter queue** with a replay button, grouped by failure reason so one expired token shows as one row with a count, not 4,000 rows.

**Health dashboard** for admins: queue depth, oldest pending job, connector health, delivery rates per channel over 24 hours, speed-to-lead, quota usage. Build it with the Section 10 report engine so it is itself dynamic.

**Alerting** to a Slack or Telegram webhook on: any connector circuit open, queue depth above 1,000, dead letters above 50 in an hour, the global circuit breaker tripping. Four alerts, each actionable. More than that and they get muted.

### Cost control

Messaging is the only variable cost in the system and it is per-message. Record a cost estimate on every outbound message from the connector's configured rate, aggregate it on the health dashboard by channel and by automation, and set a monthly spend ceiling per org that pauses non-critical sends when crossed. Knowing which automation spends your money is the difference between a budget and a surprise.

## Security and compliance

Phase 1 held your own data. Phase 2 holds other people's personal data and contacts them on channels they did not choose. That changes the obligations, and the controls are far cheaper to build now than to retrofit.

### Consent

Consent is a record, not a checkbox. Model it once and every channel uses it.

```sql
create table consents (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  record_id  uuid not null references records(id) on delete cascade,
  channel    text not null,        -- email | whatsapp | sms | call
  purpose    text not null,        -- transactional | marketing
  status     text not null,        -- granted | withdrawn | never_given
  source     text not null,        -- web_form:uuid | imported | manual | inbound_message
  evidence   jsonb,                -- form submission id, IP, timestamp, consent text shown
  granted_at timestamptz,
  withdrawn_at timestamptz
);
```

The send path checks consent before every marketing message and refuses without it. `evidence` must capture the exact wording the person agreed to — "we had consent" is not a defence; showing what they were told is.

Unsubscribe must work on every channel: a `List-Unsubscribe` header and a footer link on email, STOP handling on SMS, and an opt-out button on WhatsApp marketing templates. Honour it within seconds, globally, across every automation. A withdrawn consent that one rule still ignores is the worst kind of bug here.

### India's DPDP Act

The Digital Personal Data Protection Act, 2023 applies to a Kolkata-based company processing Indian customers' data. Rather than a legal reading, these are the product capabilities it implies — confirm the specifics with a lawyer before go-live:

| Obligation | What the CRM needs |
| --- | --- |
| Notice and purpose | Consent text stored with each capture, visible on the record |
| Right to access | Export every record and message for one person, on demand |
| Right to correction | Already covered by normal editing plus the audit trail |
| Right to erasure | A delete-person operation that removes or anonymises across records, messages, logs and backups policy |
| Breach notification | The audit trail must be able to answer what was accessed, by whom, when |
| Retention limits | Data not kept longer than its purpose requires |

Build the erasure operation in Phase 2, not later. It touches messages, activities, automation logs and consent rows, and discovering its full reach a year in, with four services already writing personal data, is a painful project.

### Retention

Policies per entity, run nightly, logged:

| Entity | Suggested default |
| --- | --- |
| Message bodies | 24 months, then headers and metadata only |
| Automation run logs | 90 days |
| Dead letters | 30 days after resolution |
| Webhook delivery logs | 30 days |
| Audit trail | 7 years |
| Lost leads | Configurable, with a review prompt rather than silent deletion |

### Practical controls

- **PII in logs:** redact email, phone and message bodies from application logs. A log aggregator is usually the least protected store you have.
- **Attachments:** signed URLs with short expiry, never public bucket paths. A lead's uploaded PAN card must not be guessable.
- **Credentials:** the vault from Section 4; never in environment-variable dumps, error reports or the automation run log.
- **Admin actions:** creating a connector, exporting records in bulk or changing a role is logged to `admin_audit` with the actor and the before state.
- **Bulk export:** rate-limited, logged and notified to org owners. Exfiltration by a departing salesperson is the most common data loss event a CRM actually suffers, and far more likely than an external breach.

## Build order

Eight milestones. A, B and C are the critical path and must be built in that order — everything after them is a manifest plus rows, and everything before them is unusable without the engine.

&#91;embedded content: Phase 2 build order · 8 milestones, 8 gates\]

### Acceptance criteria

| # | Milestone | Done when |
| --- | --- | --- |
| A | Automation engine | An admin builds a rule with a branch and a wait, tests it on a real record with the dry run, activates it, and the run log shows each node's outcome |
| B | Connector framework + templates | An admin adds an SMTP connector in the UI, writes a template with three variables, previews it against a real lead and receives a test mail |
| C | Email, two-way | An outbound mail from an automation threads correctly, the customer's reply lands on that lead's timeline within two minutes, and a hard bounce suppresses the address |
| D | WhatsApp and SMS | A rule chases a stalled lead on WhatsApp inside the session window, the reply logs against the record, a send without consent is refused with a readable reason |
| E | Capture and activities | A web form built from the Lead module creates an assigned lead, deduped, with the owner notified on their phone in under 10 seconds; a bad payload lands in quarantine and replays |
| F | Routing and reports | Round robin respects working hours, an SLA escalates at 100%, and a funnel widget drills through to the underlying records |
| G | Advanced fields | A formula field computes on write, filters and sorts like a normal field; a rollup updates incrementally and reconciles overnight with zero drift |
| H | Platform and governance | An API key creates a record with correct scope enforcement, a webhook delivers and replays, and a person-erasure request removes their data across records, messages and logs |

### Sequencing notes

**Start the slow external work on day one of Phase 2,** in parallel with milestone A. Three things have lead times you do not control: DLT entity and header registration for SMS, WhatsApp Business verification and template approval, and email domain warming. Each takes one to three weeks of waiting. If they start when milestone C begins, the team sits idle.

**Milestone A ships value on its own.** Round-robin assignment, stage automation and task creation are useful before a single message is sent. That is the argument for this order over starting with email.

**Effort, as an estimate not a commitment.** With two developers who know the Phase 1 codebase: A is roughly three weeks, B two, C three, D three, E three, F three, G two, H two — about five months to H. The spine, A through C, is about two months, and it is the part worth doing carefully.

## Guardrails and open decisions

### Guardrails

The Phase 1 guardrails all still apply. These twelve are specific to Phase 2, and each exists because the shortcut is tempting and the cost arrives later.

**Keep it dynamic**

1. No channel-specific code outside its provider manifest and action handler. If `whatsapp` appears in the automation engine, the routing rules or the UI shell, the design has been abandoned.
2. No second filter language. Conditions, SLA rules, scoring, report filters, visibility rules and form logic all compile through the Phase 1 DSL.
3. No second template resolver. Email, WhatsApp, SMS, notifications and web form confirmations share one.
4. Every settings form in Phase 2 is rendered from a `configSchema` by the existing form renderer. Hand-built settings screens are how a dynamic system quietly becomes static.

**Keep it safe**

5. No general-purpose expression evaluator anywhere — formulas, templates and conditions all parse to an AST walked against a whitelist.
6. Every outbound send is idempotent by `(runId, nodeId)` or by `(connectorId, providerMessageId)`.
7. Credentials are decrypted in the worker only, and never appear in a log, an error or a run record.
8. Automations do not run on bulk-flagged events unless explicitly opted in.
9. A `wait` node re-evaluates its conditions on resume, always.

**Keep it honest**

10. A message is never silently dropped. Queue it, fail it visibly, or refuse it with a reason the user can read.
11. Every number in a report drills through to its records.
12. Consent is checked in the send path, not in the UI that composes the message.

### Open decisions

| # | Question | Default taken here | Why it matters now |
| --- | --- | --- | --- |
| 1 | WhatsApp: Meta Cloud API direct, or an aggregator such as Gupshup or Interakt? | Cloud API direct | Aggregators approve faster and handle DLT-style paperwork, but cost more per message and add a dependency |
| 2 | SMS provider | Open — pick whoever holds the DLT entity | DLT header and template registration takes days to weeks; start it before milestone D |
| 3 | Email sending domain | A subdomain separate from your main mail | Warming a domain takes two to three weeks; start before milestone C |
| 4 | Does email need two-way sync in Phase 2, or is outbound enough? | Two-way | IMAP or Gmail OAuth roughly doubles the email milestone |
| 5 | Is this still internal only, or will Webingo sell it? | Internal | Changes how hard quotas, per-org isolation and billing hooks need to be |
| 6 | Build booking links in Phase 2 or Phase 3? | Phase 3 | Cheap after calendar sync, but it is scope |
| 7 | Who owns the automation run log day to day? | Unassigned | A log nobody is responsible for reading is a log that catches nothing |

**One recommendation.** Do not build all twelve areas before anyone uses any of them. Ship milestone A and B, put the sales team on automations for three weeks, and let what they ask for reorder C through H. The automation engine's real requirements are discovered by watching someone try to build a rule, not by specifying it further.
