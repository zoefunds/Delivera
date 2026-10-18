# Two-pass production application E2E

Date: 2026-10-18 (Africa/Lagos)

Target frontend: `https://delivera-frontend.vercel.app`  
Target API: `https://delivera-api-gideon.fly.dev`  
StudioNet contract: `0xDa4B86C86010329dbf484a1ccD1BD64396B25cBa`

Current production frontend deployment: `dpl_DeaASceUsx7XiWRF6pJ6Y4PDeBci`

The passes below were executed sequentially. Pass 2 was not started until Pass
1 had reached StudioNet `FINALIZED`, had been confirmed into PostgreSQL, and
all application-section reads had completed. Test wallets signed real nonce
messages, and both agreements are live StudioNet records rather than fixtures.

The New Agreement page now exposes **Autofill detailed test contract**. It
fills a unique timestamped version of the Pass 1 cold-chain agreement, uses the
registered provider `0x1A321F1615D5Ff2F236620647aF1E30a4fAcCB7d`, and supplies
three detailed criteria/evidence milestones totaling 0.36 ledger units. Users
must still review the data and sign the StudioNet transaction themselves.

## Sections covered in each pass

- Homepage and architectural-trust copy: rendered successfully in the
  production browser.
- Sign in: wallet-only login page rendered; nonce, signature verification, and
  authenticated identity calls each returned HTTP 200 for client and provider.
- Dashboard/contracts: returned HTTP 200 and showed the expected cumulative
  agreement count.
- New agreement: submitted a real wallet-signed StudioNet transaction, waited
  for `FINALIZED`, then confirmed the exact record into the production API.
- Agreement detail: database and authoritative chain title, party addresses,
  status, milestone count, allocations, descriptions, and acceptance criteria
  agreed.
- Evaluations: returned HTTP 200 with an empty list, correct for new DRAFT
  agreements that have no submitted evidence.
- Projects: returned HTTP 200 with zero projects; the current application has
  no project-creation surface and agreements are standalone.
- Wallet: returned HTTP 200 with the authenticated address. The client held
  121,740,000 Base Sepolia USDC base units at the final read; the two new
  provider wallets held zero because these DRAFT agreements were not funded.
- Notifications: each provider received exactly one `contract.invited`
  notification and could see its own agreement.
- Authorization boundary: each provider received `403 FORBIDDEN` when trying
  to read the other pass's agreement.

## Pass 1 — Lagos medical cold-chain operations

- Title: `Lagos Cold-Chain Operations Control Tower — Production E2E Pass 1`
- Client: `0x7401c129EDfc26E68FE19309fE461eb3Db1058Eb`
- Provider: `0x1A321F1615D5Ff2F236620647aF1E30a4fAcCB7d`
- StudioNet transaction: `0xd9ea2f469dcad9aba85e7b04cec143a8d315a27d6f8560f5066e9ea14323ce90`
- Final transaction status: `FINALIZED`
- Chain agreement: `delivera-2`
- Database agreement: `bdb80363-384a-4252-b2cc-7046415aa8a0`
- Confirmation response: HTTP 201
- Total: `360000000000000000` ledger atto-units

Milestones:

1. `Accessible shipment control dashboard` — 0.11 ledger units. Requires a
   responsive public dashboard, keyboard navigation, labelled Normal/Warning/
   Critical states, twelve anonymized shipments, Africa/Lagos timestamps, and
   no console-blocking errors.
2. `Documented shipment-status API` — 0.12 ledger units. Requires the concrete
   shipment/custody/temperature/timestamp/SLA/ETA schema, success and failure
   examples, documented 4xx handling, and no patient data.
3. `Cold-chain incident response runbook` — 0.13 ledger units. Requires
   severity levels, response roles, a 15-minute critical escalation target,
   containment steps, communication templates, retained evidence, and a
   retrospective checklist.

Observed section results: dashboard 200 with one agreement, projects 200 with
zero, wallet 200, notifications 200, detail 200 with database `DRAFT` and chain
`DRAFT`, evaluations 200 with zero. Provider view showed one agreement and one
invitation; cross-provider detail returned 403.

## Pass 2 — West Africa renewable-microgrid reliability

- Title: `West Africa Renewable Microgrid Reliability Portal — Production E2E Pass 2`
- Client: `0x7401c129EDfc26E68FE19309fE461eb3Db1058Eb`
- Provider: `0x7D23369AD3F3E53c3B8E231A561cb6d802De6662`
- StudioNet transaction: `0xcc790f8ecf6a5773fbecf6b4a0e6c1081f5345d3be83c9290ab88701b26d1b21`
- Final transaction status: `FINALIZED`
- Chain agreement: `delivera-3`
- Database agreement: `ddf5b25f-19a3-477d-b80b-648725edf712`
- Confirmation response: HTTP 201
- Total: `450000000000000000` ledger atto-units

Milestones:

1. `Regional microgrid reliability dashboard` — 0.14 ledger units. Requires
   six sites across Lagos, Accra, and Abidjan; 24-hour and 30-day availability;
   maintenance/outage separation; keyboard filters; freshness timestamps; and
   explicit kW, kWh, and percentage units.
2. `Auditable telemetry and uptime API` — 0.15 ledger units. Requires the
   site/time/generation/demand/battery/grid/incident schema, reproducible uptime
   formula and exclusions, documented 404 behavior, and anonymized examples.
3. `Black-start and communications playbook` — 0.16 ledger units. Requires
   safety preconditions, ordered recovery, rollback triggers, operating roles,
   customer templates, and voltage/frequency validation after restoration.

Observed section results: dashboard 200 with both agreements, projects 200
with zero, wallet 200, notifications 200, detail 200 with database `DRAFT` and
chain `DRAFT`, evaluations 200 with zero. Provider view showed one agreement
and one invitation; cross-provider detail returned 403.

## Important scope statement

These two passes exercise every current application section and the complete
wallet-authenticated agreement-creation path. They intentionally stop at
`DRAFT`; they do not claim to be additional funded payment-lifecycle runs. The
separate funded multi-milestone approval, dispute, cancellation, replay, and
USDC-balance evidence remains in `docs/VERIFICATION.md`.
