# Verification Report — Foundation Plan vs Codebase

Oct 9, 2026 · verified against the running system, not just by reading code
**Updated Oct 10, 2026 — remediation status added. See "Where this stands now".**

## Where this stands now

Every finding below has been addressed in code unless this section lists it as
outstanding. The plan itself has been amended where the plan was the thing that
needed changing; `CRM Foundation Plan — Metadata-Driven Architecture.md` carries
a revision note explaining each amendment in place.

**Closed, and re-verified against a running build**

| | Finding | How it was closed |
| --- | --- | --- |
| C1 | Authorisation unenforced | `auth/permissions.ts` interprets the role document; `auth/record-scope.ts` compiles `own`/`team` into the predicate; `PermissionsGuard` gates 22 admin endpoints; field-level read/write applied in the bundle and on every record response. A Read Only role now gets 403 on create, delete, module and field writes. |
| C2 | Compiled validation dead | `RecordService.validateData` runs `normalize()` then `valueSchema`, on create, update, bulk and import. Unknown keys, wrong-typed `data`, and read-only fields are 400s. |
| C3 | One bad value 500s a module | Bulk update routed through the validated path, plus non-throwing `crm_try_*` casts (migration 0004) so legacy bad data degrades to NULL instead of failing the query. |
| C4 | jsonb writes correct only by accident | Every jsonb parameter now binds through `::text::jsonb`, the one form correct with and without Drizzle's serialiser patch. Seed reverified: `source.config` holds a real options array. |
| C5 | Migration 0002 never applied | Ordered, tracked runner with `schema_migrations`; 0003 adds the missing indexes, `citext`, `admin_audit`, `idempotency_keys`, `field_sequences`, `teams`. |
| C6 | Hot field promotion absent | `IndexPromotionService` with the plan's whitelisted DDL; `module_id` as a leading column so the index is actually chosen; reconcile endpoint. |
| H1 | Idempotency a no-op | Real replay store, keyed on the **resolved** path so one key against two record ids no longer collides. |
| H2–H8 | Unshaped 500s | Catch-all RFC 7807 filter; boundary coercion in `common/input.ts`. All 21 hostile-input probes now return 400/409 with zero logged 500s. |
| H9 | No filter components | Operators resolved from each field's declared `operators` in the bundle; multi-value editors for `has_any`/`in`. |
| H10 | Seed view filters unusable | Seed rewritten: DSL-shaped filters, all field flags and sections, `opt_*` ids, idempotent. |
| H11 | Mass assignment | Explicit allowlists in fields, modules, views, pipelines and users services. |
| H12 | Schema version bumped outside the transaction | Atomic `schema_version + 1` inside the caller's transaction, for fields, pipelines and stages. |
| H13 | `record_links` stale | `syncRecordLinks` on create, update, bulk and import. |
| H14 | Global search scanned `data::text` | Searches `display_name` + `search_tsv`, with per-module scope branches. |
| H15 | `javascript:` URLs stored | Scheme allowlist in `url.normalize`. |
| H16 | Stage IDOR | Every pipeline and stage read/write proved against the caller's org. |
| H17 | Two pollers, non-atomic claim | Single-statement claim with `FOR UPDATE SKIP LOCKED`; in-API poller off by default; stalled events reclaimed. |
| H18 | `conditions` ignored | `automations/conditions.ts` evaluates the filter grammar in memory; `trigger.fieldKeys` honoured. |
| H19 | No error boundary | Route-level and per-cell boundaries. |
| H20 | `citext` missing | Added, with existing case-variants collapsed first. |
| H21 | `auto_number` a no-op | Allocated from `field_sequences` inside the write transaction; `is_system`. |
| H22 | Select stored labels | `normalize` maps a label to its id or rejects. |
| — | Keyset dropped NULL-sorted rows *(found Oct 10)* | NULL-aware predicate; all rows now page exactly once in both directions. |
| — | Session secret fallback, no revocation, shared default password | Secret required in production; `user_sessions` index makes revocation real; random per-user password returned once. |
| — | Anyone could rewrite any saved view | Ownership enforced; shared views need `manageViews`. |
| — | Caddy unreachable API + no compression | `/api/*` in its own `handle` block ahead of the SPA rewrite; `encode zstd gzip`; asset caching. Validated with `caddy validate`. |
| — | Bundle 334 KB over a 250 KB ceiling | 216 KB: lazy admin routes, split vendors, and a bounded icon map instead of lucide's full set. |
| — | `pg_stat_statements` collected nothing | `shared_preload_libraries` set in compose. |
| — | `docker compose up` started only Postgres and Redis | Profiles removed, migrations as a pre-start job, plan's 4 GB tuning, loopback binds, restart policies, log rotation. |

**Still outstanding — deliberately, and in priority order**

1. **Kanban loads one shared 50-row page.** Plan Section 9 wants a
   keyset-paginated query and count per column. Cards and column totals are now
   metadata-driven and terminal-stage aging is fixed, but the per-column fetch
   is not built. Stages past the first 50 records appear empty.
2. **No automated test suite.** `backend/test/*.ts` are still hand-run scripts
   with no runner, no `npm test` and no CI. The hostile-input cases the plan
   mandates do exist and do pass. Guardrail 18 is not met until they fail a
   build.
3. **CSV import is synchronous.** Per-row validation and the error report are in
   place; the job-id path above 2,000 rows is not.
4. **No Redis layer or `schema.invalidated` pub/sub** for the compiled schema.
   Safe on one API process, because the version is in the cache key; required
   before scaling out.
5. **Inline grid editing and the command palette** (Plan Section 11) — the grid
   is read-plus-drawer only.
6. **Fractional `data.position`** for intra-column kanban ordering.
7. **TOTP two-factor** — now explicitly deferred in the plan, with the data model
   it would need.
8. **Files are on local disk**, not R2. Hardened (size cap, mime allowlist,
   attachment disposition) but not the plan's storage.

---


## How this was verified

Three passes, in increasing order of evidence strength:

1. **Static read** of all 7,318 backend and 8,538 frontend lines against the 1,070-line plan.
2. **Multi-agent audit**, one agent per plan section, each required to cite `file:line`.
3. **Live execution** — a throwaway Postgres 16 + Redis 7, the real migration, the real `npm run seed`, the compiled API booted on port 9100, and ~45 HTTP probes. Findings marked **[PROVEN]** were reproduced against that running system; nothing marked **[PROVEN]** is inference.

Both `tsc` builds pass clean. The architecture is right. What follows is almost entirely *missing enforcement*, not wrong design.

## Verdict

The **shape** of the foundation is faithful to the plan: one `records` table with a `data jsonb` column, no EAV, no table-per-module, a real field-type registry, a real schema compiler, a filter compiler that resolves identifiers through compiled metadata and binds every value, a transactional outbox, and a frontend that renders forms and tables from a metadata bundle. Guardrails 1, 2, 9 and 10 hold.

But the foundation is **not yet production grade**, for three reasons that each cut across the whole system:

| | |
| --- | --- |
| **Authorisation does not exist** | The `roles` table, the permissions JSON and the roles UI are all present. Nothing reads them. A "Read Only" user can create records, delete records, create modules and add fields to a system module. |
| **Validation does not exist** | `valueSchema`, `createSchema`, `updateSchema`, `uniqueKeys` and `toSearchText` are all compiled and then never called. The only write-time check is `normalize()`, which coerces rather than rejects. |
| **Bad values become 500s, permanently** | Because validation is absent, a non-date string can reach a `date` field. Every later query that sorts or filters that field then fails on the `::timestamptz` cast — for every record in the module, for every user, until someone edits the database. |

Milestones M0–M8 are structurally present. M2 (validation), M5 (import/export semantics) and the permission half of M8 are not met.

## Critical — fix before any real data enters

### C1. Authorisation is entirely unenforced **[PROVEN]**

Plan Section 13 and Guardrail 11: *"Permissions are applied in the query, never by filtering fetched rows in JavaScript."* Neither happens — there is no permission check anywhere in the request path.

`backend/src/auth/auth.guard.ts:24` authenticates and attaches `request.user`, and that is the end of it. No `@RequirePermission`, no record-scope `WHERE` clause, no field stripping. `records.service.list()` receives `currentUser` and never uses it for scoping.

Measured against the running API, logged in as a seeded **Read Only** user:

```
POST   /api/modules/lead/records        -> 201   (created a record)
DELETE /api/modules/lead/records/:id    -> 200   (deleted a record)
POST   /api/modules                     -> 201   (created a module)
POST   /api/modules/lead/fields         -> 201   (added a field to a system module)
GET    /api/roles                       -> 200
```

The plan's own role matrix for that role is `read: all, create: false, update: false, delete: none`.

Also missing: the record-scope compiler (`all`/`team`/`own`/`none`), field-level read/write enforcement, the `team` membership table, and the `admin_audit` table Section 13 requires.

**Fix:** a `PermissionsGuard` reading `role.permissions`, plus a `scopeCondition(user, moduleKey)` fragment appended by the same builder that appends filters, plus response field-stripping. This is the single largest piece of missing work.

### C2. The compiled validation layer is dead code **[PROVEN]**

Plan Section 6, "One compiler, four consumers", lists API validation as consumer #1. `schema-compiler.ts:140-150` builds `createSchema` and `updateSchema`; `grep` finds no reader. `records.service.create()` hand-rolls a `normalize()` loop instead (`records.service.ts:63-78`).

Consequences proven against the running API:

```
POST {"display_name":"x","data":"oops"}                 -> 201  (data must be an object)
POST {"display_name":"x","data":[1,2]}                  -> 201
POST {"display_name":"x","data":{"no_such_field":"v"}}  -> 201  (silently discarded, no error)
```

`uniqueKeys` is likewise compiled and never read, so the seeded `email` field marked unique in the plan accepts duplicates.

**Fix:** parse the normalised object through `createSchema` / `updateSchema` before opening the write transaction, return RFC 7807 with the `fields` array on failure, and check `uniqueKeys` inside the transaction.

### C3. One bad value permanently 500s an entire module's list view **[PROVEN]**

This is the most damaging consequence of C2 and the direct answer to "code that does not crash on any input".

`bulkAction('update')` merges raw client JSON straight into the column — `data = data || $1::jsonb` (`records.service.ts:897`) — with no `normalize()` and no validation. Reproduced end to end:

```
POST /records/bulk {"action":"update","record_ids":[id],
                    "data":{"data":{"follow_up_on":"next tuesday"}}}   -> 201
stored: {"follow_up_on": "next tuesday"}

GET /records?sort=follow_up_on:desc                                    -> 500
GET /records?filter={follow_up_on within overdue}                      -> 500
```

The compiled expression is `(r.data->>'follow_up_on')::timestamptz`; Postgres raises `22007` for the whole result set, so the failure is not scoped to the offending row. Any saved view sorting or filtering that field is dead for every user. The same applies to `::numeric`, `::boolean` and `::uuid` casts — and `user`/`lookup` `normalize()` never validates UUID shape, so `::uuid` is reachable the same way.

**Fix:** three layers, all needed. (a) Route bulk updates through the same normalise+validate path as `update()`. (b) Validate values with `valueSchema` (C2). (c) Make the compiled SQL defensive so legacy bad data degrades to `NULL` instead of a 500 — use a safe-cast expression for the lossy casts, e.g. `NULLIF(r.data->>'k','')::timestamptz` guarded by a regex predicate, or a small immutable `try_cast` helper.

### C4. jsonb writes are correct only by accident, and the seed is already corrupt **[PROVEN]**

Every jsonb write in raw SQL uses `${JSON.stringify(x)}::jsonb`. With plain `postgres.js` that stores a **JSON string scalar**, not an object — so `data->>'key'` returns `NULL` for every key.

It currently works in the API only because `db/connection.ts:15` constructs a Drizzle instance over the same client, and `drizzle-orm/postgres-js` patches the client's JSON serialiser as a side effect. Isolated proof:

```
raw client only                     : jsonb_typeof = string   <- broken
same client, after a Drizzle query  : jsonb_typeof = object
Drizzle constructed but unused      : jsonb_typeof = object
```

`seed.ts`, `migrate.ts` and `worker.ts` each create a bare `postgres(url)` with **no Drizzle**, so they get the broken behaviour. Confirmed on the real seeded database:

```
fields.key   jsonb_typeof(config)
source       string      <- the Source dropdown has no options
budget       string      <- the currency code INR is lost
email        object      (only because its config is the SQL literal '{}')
```

So the default Lead module — which the plan requires to be usable on first login — ships with a broken Source select. The standalone worker writes double-encoded `automation_runs.log` for the same reason, while the in-API worker writes correct JSON: two workers, two data shapes.

**Fix:** replace every `${JSON.stringify(x)}::jsonb` with `${sql.json(x)}`, which is correct with or without Drizzle. ~20 sites in `records.service.ts`, plus `seed.ts` and `outbox-worker.service.ts`.

### C5. Migration 0002 is never applied; there is no migration tracking **[PROVEN]**

`db/migrate.ts:10` hardcodes `0001_foundation.sql`. `0002_automations_indexes.sql` has never run in any database. Verified index list after a real migrate:

```
idx_records_data, idx_records_list, idx_records_owner, idx_records_search, idx_records_stage
```

Missing: `idx_outbox_pending` (so the worker's poll scans the whole outbox table), `idx_events_record` (the timeline query, never defined in either file), `idx_links_target`, and `idx_records_name`.

**Fix:** a `schema_migrations(version text primary key, applied_at timestamptz)` table and a runner that applies `migrations/*.sql` in lexical order, each file in its own transaction.

### C6. Hot field promotion does not exist

Plan Section 4 makes `is_indexed` the mechanism that keeps dynamic-field filters fast, and Section 14 calls it out again. No code creates expression indexes. Every filter on a dynamic field is a sequential scan, so the plan's 120 ms p95 list budget cannot be met past a few tens of thousands of records. `idx_records_data` (GIN `jsonb_ops`) cannot help, because the filter compiler emits scalar `->>` expressions, never `@>`.

**Fix:** the whitelisted `CREATE INDEX CONCURRENTLY` job the plan already sanctions, triggered when `is_indexed` flips.

## High

| # | Finding | Evidence |
| --- | --- | --- |
| H1 | **Idempotency-Key is a no-op.** `common/interceptors.ts` — both interceptors are empty `return next.handle()` stubs. Guardrail 12. **[PROVEN]** two POSTs with the same key created two records. | `interceptors.ts:6,13` |
| H2 | **Unhandled errors are not RFC 7807 and leak as bare 500s.** `AppErrorFilter` only catches `AppError`, so ZodError, Postgres errors and TypeErrors return `{"statusCode":500,"message":"Internal server error"}`. **[PROVEN]** | `common/errors.ts:36` |
| H3 | **Repeated query params 500.** Express turns `?q=a&q=b` into an array; `.trim()` then throws. **[PROVEN]** `?q=a&q=b` → 500, `?sort=a&sort=b` → 500. | `records.service.ts:1152,1186` |
| H4 | **Forged or stale cursors 500.** A cursor whose `id` is not a UUID → 500. A cursor minted while sorting by `display_name` and reused with `sort=budget:desc` → 500 — which happens whenever a user changes sort mid-pagination. **[PROVEN]** | `keyset-pagination.ts:11`, `records.service.ts:1196` |
| H5 | **Bulk actions 500 on a non-UUID id.** `id = ANY($1)` with `["oops"]` → 500. **[PROVEN]** | `records.service.ts:866` |
| H6 | **Generic PATCH does not validate `stage_id`/`pipeline_id`.** Only `changeStage()` validates. A bogus `stage_id` through `PATCH /records/:id` → 500 (FK violation). A valid stage from *another module* is accepted, orphaning the record. Plan Section 9. **[PROVEN]** | `records.service.ts:300` |
| H7 | **Zod and unknown-type errors 500.** A malformed field config → 500; `type:"does_not_exist"` → 500 via `getFieldType`'s plain `throw new Error`. **[PROVEN]** | `fields.service.ts:30`, `registry.ts:47` |
| H8 | **`PATCH /automations/:id` with a partial body 500s.** Omitted fields bind `undefined`, which postgres.js rejects with `UNDEFINED_VALUE`. **[PROVEN]** on a real automation id. | `automations.service.ts:118-131` |
| H9 | **No filter components exist, so no view can be filtered from the UI.** `FieldComponentSet` declares only `{Input, Cell}` — the plan requires `{Input, Cell, Filter}`. There is no filter builder, which means the plan's whole-foundation acceptance test ("a saved view filtered on two of those fields") cannot be completed in the browser. | `components/fields/types.ts:17` |
| H10 | **Seeded view filters are unusable** — stored double-encoded *and* in a non-DSL shape: `"{\"filter\":{\"owner_id\":\"{me}\",\"stage_type\":\"open\"}}"`. The filter compiler would reject it; `stage_type` is not a field. "My open leads" and "Follow-ups due" do not work. **[PROVEN]** | `seed.ts:101-106` |
| H11 | **Mass assignment in every metadata service.** `values({ orgId, moduleId, ...data })` puts client data *after* the trusted fields, so a caller can set `orgId`, `moduleId`, `isSystem` or `id`. `views.service.update` passes `data` straight through. | `fields.service.ts:38`, `modules.service.ts:33,70`, `views.service.ts:18,22` |
| H12 | **`schema_version` is bumped outside the field transaction.** `bumpSchemaVersion` uses `this.db`, not `tx`, and is read-modify-write. If it fails or races, the compiler keeps serving a cached schema and the new field never appears. It also risks pool starvation by taking a second connection while a transaction holds one. | `fields.service.ts:41`, `modules.service.ts:79` |
| H13 | **`record_links` goes stale immediately.** Written on create only — never on update, delete, bulk or import. Plan Section 4: *"written in the same transaction as the record."* | `records.service.ts:118` |
| H14 | **Global search is a full scan and leaks hidden fields.** `searchGlobal` does `r.data::text ILIKE '%q%'`, matching inside every field including ones a user may not read, with no index and no permission check. | `records.service.ts:674` |
| H15 | **`url.normalize` accepts any scheme and the cell renders a live `href`** — `javascript:` is stored and clickable. | `definitions/url.ts`, `fields/link-field.tsx` |
| H16 | **Cross-tenant IDOR on pipeline stages** — stage reads, creates and reorders are not org-scoped. | `pipelines.service.ts` |
| H17 | **Two pollers dispatch the same outbox events.** `OutboxWorkerService` is an `OnModuleInit` provider of `AutomationsModule`, which `AppModule` imports — so it runs inside the API *and* in `worker.ts`. The claim is also not atomic: `SELECT ... FOR UPDATE SKIP LOCKED` runs outside a transaction, so the locks drop before the separate `UPDATE ... SET status='processing'`. Two processes can deliver the same webhook twice. Plan: *"The worker is a separate process from the API."* | `automations.module.ts:11`, `outbox-worker.service.ts:113-130` |
| H18 | **Automation `conditions` are never evaluated.** `getMatchingAutomations` filters on `trigger.eventType` and `moduleKey` only, so an automation with conditions fires on every event. `trigger.fieldKeys` ("when Budget changes") is also ignored. | `automations.service.ts:170` |
| H19 | **No error boundary anywhere in the frontend.** A single render throw white-screens the whole app. Confirmed by grep: no `componentDidCatch` / `getDerivedStateFromError`. | `main.tsx`, `App.tsx` |
| H20 | **`citext` is missing**, so email uniqueness is case-sensitive. **[PROVEN]** `Admin@X.com` and `admin@x.com` both inserted into one org. | `0001_foundation.sql:1,14` |
| H21 | **`auto_number` allocates no sequence and is client-writable.** No counter storage, no allocation, `is_system` not set in the seed — so `lead_no` renders as an editable input. | `definitions/auto-number.ts` |
| H22 | **`select` / `multi_select` store whatever string arrives, including labels.** `normalize` does not check the value against `config.options`. Direct Guardrail 5 violation. | `definitions/select.ts:27` |

## Medium

- `?fields=` is accepted and never used — the list always does `SELECT r.*`. **[PROVEN]**: `?fields=display_name` returned the full row. Plan Section 14.
- `count()` always runs an exact `COUNT(*)` and **ignores `q`**. **[PROVEN]**: count was 9 both with and without a non-matching `q`, so kanban headers disagree with the list. Plan wants a planner estimate above 10,000 rows.
- The **table ignores the view's column config** — columns come from all non-system fields, so a saved view's column selection does nothing, and the Owner column the plan's "All leads" view specifies is never rendered.
- **No inline editing in the grid** (plan: *"Salespeople live in the grid, not in forms"*), and no command palette.
- **Blocking "Loading schema…" spinner** on every cold load; the schema is not persisted to `localStorage` and `refetchOnWindowFocus` is disabled, so the plan's instant-render-from-cache path and ETag-on-focus revalidation do not happen. Guardrail 17.
- **`this_quarter` is missing** from the `within` tokens; all tokens are computed in server-local time rather than the org timezone, so "today" is wrong for an IST team on a UTC box.
- **A filter group carrying both `and` and `or` silently drops the `or` branch** — returns too many rows rather than erroring.
- **`date` compiles to `::timestamptz`**, not the plan's `::date`.
- **`search_tsv` ignores `is_searchable` and `toSearchText`** in `create`/`update` (it concatenates every string and number, including raw option ids) while `importCsv` does it correctly — two different behaviours.
- **CSV import is synchronous**, not the job id the plan specifies; its `errors` array is declared and never populated, so `failedCount` is always 0. **Export is buffered in memory**, capped at 10,000 rows, not streamed.
- **`expandLookups` does not filter by `org_id`** when resolving users and lookup targets.
- **Two concurrent PATCHes lose data** — both read the whole `data` object and write it back, so the later write reverts the earlier one. Needs a row lock or a SQL-side jsonb merge.
- **CSV export does not neutralise formula injection** (`=`, `+`, `-`, `@` leading cells).
- **File uploads have no size cap and no mime allowlist**, are written with `fs.writeFileSync`, and are served from the app origin — an uploaded `.html` or `.svg` is stored XSS. Files are also not org-scoped. (Path traversal *is* handled via `path.basename`.)
- **No rate limiting** anywhere (plan: 300 rpm per user and per org).
- **Outbox status vocabulary drift** — the worker writes `'completed'`, the schema comments say `done`. Events stuck in `'processing'` after a crash are never reclaimed. Backoff is `1s, 2s, 10s, 60s, 5m` against the plan's `1s, 10s, 60s, 5m, 30m`.
- **No Redis schema cache and no `schema.invalidated` pub/sub** — two of the plan's three cache layers. `compile()` also queries the `modules` row on every call, and the in-process cache is never evicted.
- **The schema bundle is recomputed and MD5-hashed on every request**, carries no permission map, and omits nothing for field-level permissions.
- **Seed omits every field flag the plan specifies** (unique / searchable / indexed) and every section (`Contact`, `Qualification`, `System`) — so all fields land in one "General" section, nothing is searchable, nothing is indexed. Seeded role permissions use a different JSON shape than the plan. The seed is **not idempotent** for roles: re-running duplicates all five.
- **`backend/test/*.ts` are manual scripts, not tests** — no runner, no `npm test`, nothing fails a build. The hostile-input cases the plan mandates *are* written and *do* pass, which is why the filter compiler is the strongest part of the backend.
- **Infra:** `api`, `worker` and `caddy` are all behind `profiles: [production]`, so a bare `docker compose up` starts only Postgres and Redis — M0's "one command" does not hold. `PORT` is 3000 in `.env` and 9000 in `backend/.env` while compose maps `3000:9000` and Caddy proxies `api:9000`. The Caddyfile puts `try_files {path} /index.html` and `handle /api/*` in one block, and `try_files` rewrites first — `/api/*` is likely rewritten to the SPA and never reaches the proxy. Postgres tuning is set for a 1 GB box, not the plan's 4 GB values. No `pg_stat_statements`, no restart policies, no backups, no CI.

## Where the plan itself should change

These are places where the plan is the thing that needs editing, not the code.

1. **`search_tsv`** — the plan says `tsvector`; the code chose `text` + trigram, which is genuinely better for the substring search a CRM search box actually does, but it silently lost ranked word search. Decide explicitly and write both down.
2. **`idx_records_data` with `jsonb_path_ops`** — the filter compiler never emits `@>`, so this index can never be used. Either drop it or state the containment queries that justify it.
3. **Hot field promotion** needs a real contract: the exact two permitted statements, the identifier format and its 63-byte truncation rule, where the job runs, and that `CREATE INDEX CONCURRENTLY` cannot run inside a transaction.
4. **`admin_audit`** is required in one prose sentence in Section 13 and has no DDL anywhere — which is exactly why it was never built. Move it into Section 4 with full DDL.
5. **Idempotency-Key** is mandated by Guardrail 12 with no storage, no key scope and no replay semantics defined. Add an `idempotency_keys` table and state the semantics.
6. **Migrations** are never described — no versions table, no runner contract. Add them.
7. **Who runs `valueSchema` / `createSchema`** is never stated, which is why both became dead code. Make it an explicit rule: `normalize()` coerces, `valueSchema` decides, `RecordService` runs both before opening the transaction.
8. **The `opt_` option-id regex contradicts the plan's own seed section**, which names options `Website`, `Referral`, … Relax the regex and state the real invariant: ids are immutable once referenced.
9. **`phone` E.164 normalisation is unimplementable as written** — it needs a default country in config.
10. **The operators table omits `file` and `auto_number`**, both shipped in v1.
11. **`canBeUnique` / `canBeIndexed`** have no named enforcement point.
12. **`auto_number`** asserts "sequence per module, read-only" with no storage or allocation mechanism.
13. **The SQL expression table omits `pipeline_id` and `updated_at`**, both real columns the filter DSL needs.
14. **"A cache hit costs nothing" is unachievable as specified**, because the cache key needs the `schema_version` from the database.
15. **The ETag as a *sum* of schema versions is collision-prone** and ignores that the bundle is per-user once field permissions apply.
16. **`within` token timezone** is undefined; it must resolve against the org timezone.
17. **"stage.type eq open"**, which the plan's own default view requires, is not expressible in the filter DSL — `field` resolves to field keys only. Either add a virtual `stage.type` resolver or change the seeded view.
18. **Route map drift** — the plan lists `/m/:moduleKey/views/:viewId`, `/settings/modules/:key/fields`, `/settings/modules/:key/pipelines` and `/search`; the implementation merged the two settings screens and made search a dialog. Both are reasonable; the plan should match.

## Suggested order of work

1. **C4** (jsonb writes + reseed) — smallest change, unblocks correct seed data.
2. **C5** (migration runner) + the four missing indexes.
3. **C2 + C3** (validation layer, bulk through the write path, defensive casts) — this is what stops the 500s.
4. **H2, H3, H4, H5, H6, H7, H8** (global exception filter + boundary coercion) — the "never crash on input" pass.
5. **C1** (permissions) — the largest piece; do it once the write path is trustworthy.
6. **H1** (idempotency store), **H17** (single worker + atomic claim), **H13** (`record_links`).
7. **H9** (filter components + filter builder) — required for the plan's acceptance test.
8. **C6** (hot field promotion) and the performance rules.
9. Plan amendments 1–18.
