# ReliefConnect — Architecture & Design Decisions
*Living document. Update as decisions are made.*

---

## Current stack
- Frontend: Vanilla HTML/CSS/JS (single page app)
- Hosting: Netlify (auto-deploy from GitHub on push to main)
- Domain: volunteerdisasterrelief.com
- Repo: github.com/StarkSoftwareDevelopment/reliefconnect
- AI: Anthropic Claude (claude-sonnet-4-6) via API
- Maps: Google Maps JavaScript API + Geocoding API
- Email alerts: SendGrid (backend Netlify function)
- Database: Supabase (Postgres) — migrating from localStorage

---

## Branch strategy
- `main` — production, always deployable
- `supabase-pm` — current work: Supabase migration + full PM overhaul
- `credentials` — future: credential/identity microservices (branch from main once PM is merged)

---

## Phase 1: Project Management overhaul (branch: supabase-pm)

### Project states (human-facing)
| State | Meaning |
|---|---|
| `pending_approval` | AI has generated scope; awaiting PM review |
| `to_do` | Approved & published; no work started |
| `doing` | Work started; not all tasks complete |
| `done` | All tasks complete; awaiting inspection |
| `passed_inspection` | All acceptance tests passed. Mission complete. |

Unapproved projects (`pending_approval`) are hidden from public map and mission board.

### Task states (database)
```
task_setup_not_assigned
task_setup_assigned_but_not_started
acceptance_test_written
acceptance_test_approved
task_requirements_written
task_requirements_approved
task_prioritized
task_not_assigned
task_assigned_but_not_started
task_assigned_and_in_progress
task_completed_review_not_assigned
task_completed_review_assigned
task_completed_review_in_progress
task_completed_review_satisfactory
task_completed_review_not_satisfactory_reassigned_but_not_started
```

### AI rewrite loop
1. Ask submitted → AI generates project + tasks + acceptance tests
2. Project lands in `pending_approval`, alert fires to coordinator
3. Coordinator reviews in Approval Queue tab — can edit any field inline
4. **Approve** → status → `to_do`, published publicly
5. **Deny** → coordinator must enter denial reason (required)
   - Denial reason + original ask + first AI attempt → AI rewrites
   - Rewritten project replaces previous attempt, back in queue
   - After 2 auto-rewrites without approval → flagged for manual attention, no more auto-rewrites
6. At any point coordinator can manually edit any field before approving

### Field locking
- Any field can have a lock icon
- Clicking lock opens a credential-type selector (which credential is required to edit this field)
- Locked fields show a badge visible to all; editable only by holders of that credential type
- *Note: credential types will be stubbed as simple permission strings in Phase 1,
  replaced by full verifiable credentials in Phase 2*

### People & assignment
- Anyone in the system can be a PM on a project
- Typing in any person field offers autocomplete from all known people
- Typing an unrecognized name + Enter → creates that person in the system
- People are project-scoped until they create an account

### Project chain of custody
- Projects have an ordered list of PMs (primary + backups)
- If primary PM is removed/unavailable, ownership transfers to next in chain
- Chain is rank-ordered and editable by any PM on the chain or a coordinator

### Roles
- Roles are project-specific (e.g. "Roofer on Project X")
- A role can require a credential type (e.g. "must hold Roofer credential")
- Tasks can be delegated to a role during setup
- When a person is approved for a role on a project, they auto-inherit all tasks for that role
- If a person holds a matching credential, role approval is automatic (unless PM overrides)
- PM can create roles, assign tasks to roles, and assign people to roles at any time
- Tasks rejected by assignee → return to PM's queue for reassignment

### Task assignment
- Click any "assigned to" field → inline text input with autocomplete
- Autocomplete searches all people associated with the project
- Unrecognized name + Enter → creates person record
- Role assignment auto-propagates tasks to all people holding that role

---

## Supabase schema

### tables

**people**
```sql
id          uuid primary key default gen_random_uuid()
slug        text unique  -- human readable, used in URLs
name        text not null
email       text
phone       text
created_at  timestamptz default now()
wallet_id   uuid  -- FK to wallets (Phase 2)
```

**projects**
```sql
id               uuid primary key default gen_random_uuid()
ask_id           uuid references asks(id)
title            text
summary          text
address          text
category         text
urgency          text  -- critical | high | medium | low
status           text  -- pending_approval | to_do | doing | done | passed_inspection
pm_chain         uuid[]  -- ordered array of person IDs
acceptance_tests jsonb  -- array of strings
pm_briefing      text
agent_briefing   text
coords           jsonb  -- {lat, lng} cached from geocoding
ai_attempt_count int default 1
denial_reason    text
created_at       timestamptz default now()
approved_at      timestamptz
approved_by      uuid references people(id)
```

**project_roles**
```sql
id                  uuid primary key default gen_random_uuid()
project_id          uuid references projects(id)
name                text  -- e.g. "Roofer", "Chainsaw operator"
required_credential text  -- stub in Phase 1, FK to credential types in Phase 2
created_by          uuid references people(id)
```

**role_assignments**
```sql
id         uuid primary key default gen_random_uuid()
role_id    uuid references project_roles(id)
person_id  uuid references people(id)
approved   boolean default false
approved_by uuid references people(id)
created_at timestamptz default now()
```

**tasks**
```sql
id               uuid primary key default gen_random_uuid()
project_id       uuid references projects(id)
role_id          uuid references project_roles(id)  -- nullable
assigned_to      uuid references people(id)  -- nullable
title            text
description      text
tools            text
acceptance_tests jsonb  -- array of strings
status           text  -- one of the 15 task statuses
sequence         int   -- sort order within project
locked_fields    jsonb  -- {fieldName: required_credential}
created_at       timestamptz default now()
updated_at       timestamptz default now()
```

**task_history**
```sql
id          uuid primary key default gen_random_uuid()
task_id     uuid references tasks(id)
changed_by  uuid references people(id)
from_status text
to_status   text
note        text
created_at  timestamptz default now()
```

**asks**
```sql
id           uuid primary key default gen_random_uuid()
name         text
phone        text
email        text
address      text
description  text
category     text
urgency      text
people_count text
access_notes text
file_urls    jsonb
created_at   timestamptz default now()
project_id   uuid references projects(id)  -- set after AI generates project
```

**submissions**
```sql
id          uuid primary key default gen_random_uuid()
task_id     uuid references tasks(id)
person_id   uuid references people(id)
notes       text
file_urls   jsonb
created_at  timestamptz default now()
```

**reviews**
```sql
id          uuid primary key default gen_random_uuid()
task_id     uuid references tasks(id)
reviewer_id uuid references people(id)
outcome     text  -- pass | fail
notes       text  -- required on fail
created_at  timestamptz default now()
```

**bottlenecks**
```sql
id          uuid primary key default gen_random_uuid()
task_id     uuid references tasks(id)
project_id  uuid references projects(id)
reporter_id uuid references people(id)
description text
resolved    boolean default false
resolved_by uuid references people(id)
created_at  timestamptz default now()
```

---

## Phase 2: Credential microservices (branch: credentials)

### The four systems
1. **Credential Lab** — CRUD credential *types*
2. **Credential Factory** — issue & manage credential *instances*
3. **Wallet Lab** — CRUD wallet *types*
4. **Wallet Factory** — create & issue wallet *instances*
5. **Vault Lab** — CRUD vault types *(roadmap — construction TBD)*
6. **Vault Factory** — create & issue vault instances *(roadmap — construction TBD)*

### On account creation, auto-provisioned:
1. `people` record with UUID + human-readable slug
2. ReliefConnect identity credential issued to person (self-issued by org)
3. Wallet instance created, identity credential stored in it
4. Endpoint: `volunteerdisasterrelief.com/people/{slug}/wallet`

### URL strategy
- Slug is a human-readable alias for the UUID
- Routes resolve slug → UUID internally
- Public-facing URLs always show slug: `/people/benjamin_linville/wallet`
- Internal DB always uses UUID as primary key

### Credential instance fields
```
id              uuid  -- unique credential instance ID
type_id         uuid  -- FK to credential type
issuer_id       uuid  -- person or org that issued it
recipient_id    uuid  -- person or wallet it was issued to
issued_at       timestamptz
expires_at      timestamptz (nullable)
revoked         boolean
revoked_at      timestamptz (nullable)
revoked_by      uuid (nullable)
transfer_history jsonb  -- array of {from, to, transaction_id, timestamp}
public          boolean  -- from credential type
```

### License House staff
- **Uncle Ben** — Claude-powered conversational agent answering "how does this work?"
  - Avatar of BJ Linville
  - Friendly, plain-language explanations of the credential system
- **Cotton Eye Joe** — verification & provenance agent
  - Input: credential instance ID
  - Output: validity status, issuer chain, transfer history, revocation status
  - Answers: "where did it come from?" and "where did it go?"
  - Requires appropriate credential to query private credentials (per type definition)

### Self-issued org identity
- First credential type: `ReliefConnect Organization Identity`
- First credential instance: issued by `stark_software_development` to `relief_connect`
- This becomes the root of trust for all credentials issued by the platform

### Future integrations
- Public registries (blockchain anchoring, DID methods)
- Proof of humanity (for voting, high-trust roles)
- W3C Verifiable Credentials spec compliance
- Cross-org credential recognition

---

## To-do list (from conversation)
- [ ] Rotate GitHub token (ghp_WMO...) at github.com/settings/tokens
- [ ] Rotate Netlify token at app.netlify.com/user/applications
- [ ] Finish SendGrid setup (API key + sender verification)
- [ ] Enable Geocoding API in Google Cloud console
- [ ] Verify ANTHROPIC_API_KEY env var name in Netlify matches code
- [ ] Move stats bar to Coordinator tab
