# Remediation verification record

Date: 2026-10-18 (Africa/Lagos)

Two additional sequential production application passes, each covering every
current UI/API section with a distinct real StudioNet agreement, are recorded
in [`TWO_PASS_PRODUCTION_E2E.md`](TWO_PASS_PRODUCTION_E2E.md).

## Deployed evidence source and addresses

- Funded live-run source commit: `d9d94c0b5b16edcc4982875f89dd53542b658e92`
- Current deployed remediation source: `e112763a7a59d1d346df32043425380e3ad29631`
- Current GenLayer deployment source: `aadff224afe33477df0facdfe164504d393994d2`
- Current GenLayer StudioNet contract: `0xDa4B86C86010329dbf484a1ccD1BD64396B25cBa`
- Current GenLayer deployment transaction: `0x1690d4f69ee49e842b6f4eeab5fc04a5a8cebfce48401f3cc29354f5615a8190`
- Historical funded-run GenLayer contract: `0xB19331f411618Abb253a01Fa5b457D910c92D8F6`
- Historical deployment transaction: `0x79b954dd00da88b3f42028ed23e5f96bdf58d1c6ffeeb188a46df411f054dfc7`
- Current Base Sepolia escrow: `0x2bA36CD29993cf4250adfb48F367E1893dcd43B5`
- Current Base deployment transaction: `0x8af24446291a0efc4fe9641cafdde37cd54e65660e53c0ee4a053c13d9f8b212` (block 48,259,013)
- Historical funded-run escrow: `0xC7A0AC77AE3058D0a1A8E3874C8e394D0E4a7875`
- Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Client and decision authority: `0x7401c129EDfc26E68FE19309fE461eb3Db1058Eb`
- Current relayer: `0x0EaD3C2e53Bf4c47B8875DcC1669E69Deee19d2D`
- Relayer rotation transaction: `0xe859c848aa50d86d779004c956e3bde20bd92315027576ff78567770834ceddd` (Base Sepolia block 48,257,187)

The current deployment reached `FINALIZED` (`status: 7`) with `MAJORITY_AGREE`;
three validators agreed and two became idle after quorum. Its authoritative
`get_platform_stats` read returned owner `0x7401…58Eb`, threshold 70, maximum
attempts 3, and zero initial agreements. Current escrow bytecode adds
deployment-aware agreement keys, post-finality activation, and a seven-day
recovery path limited to untouched deposits that never activated. The prior
addresses remain below only as historical funded-run evidence.

## Reproducible checks

```bash
cd contracts/base && npm test
cd ../../backend && npm test && npm run typecheck
cd ../frontend && npm run build
cd .. && python3 -m py_compile contracts/delivera.py
python3 -m unittest contracts/test_dispute_guards.py
genvm-lint check contracts/delivera.py
git diff --check
# Requires the explicitly authorized throwaway client key:
cd backend && E2E_CLIENT_PRIVATE_KEY=... npm run e2e:current
```

Observed results:

- Solidity: 10 passing tests, including same-local-ID cross-deployment funding, permissionless transport with mandatory authority authentication, and both sides of the unconfirmed-deposit recovery gate.
- Backend: 4 tests passed (deployment namespaces, false funding claims, and interrupted-relay recovery); TypeScript passed.
- Frontend production build: passed; all 11 routes generated.
- Python syntax compilation and the settled-milestone dispute-guard regression: passed.
- GenVM static lint: 3 checks passed. Full SDK validation could not run because
  the installed linter could not access its cached pinned SDK archive
  (`Operation not permitted` under `~/.cache/genvm-linter/extracted/...`).
- Patch whitespace validation: passed.

## Cross-deployment identifier regression

The Base key is:

```text
keccak256(abi.encode(
  "DELIVERA_AGREEMENT_V1",
  61999,
  genLayerIntelligentContract,
  localAgreementId
))
```

For the same local ID `delivera-1`, the historical deployment derives
`0xeeae4c9399087a9e4ac6716c04bb42c2dc7d749f8ca22b08ca086f659e6d0a0e`,
while the current deployment derives
`0x3b8cab0227cbc1fb819bf6cc95eb2c601717ce76bf1f72baa5096f1c6014eb27`.
The Solidity regression funds both keys independently in one escrow, then
asserts separate 1,000,000-unit balances. Backend tests independently assert
that changing either the chain ID or Intelligent Contract address changes the
key. Funding signatures, events, receipt verification, settlement signatures,
replay identifiers, relay reconciliation, and browser funding all use the
scoped key.

## Unconfirmed funding recovery

New deposits cannot settle until `activateEscrow` receives an expiring
decision-authority signature after GenLayer funding reaches `FINALIZED`.
Before activation, settlement calls revert. If confirmation never completes,
only the funding client may recover the entirely untouched deposit after
604,800 seconds. Activation permanently disables recovery, as does any state
with a consumed entitlement. The browser surfaces this recovery only for an
on-chain deposit that is unactivated and past its recovery timestamp.

### Hosted CI status

The latest GitHub Actions run observed before this documentation refresh,
[`39088023008`](https://github.com/zoefunds/Delivera/actions/runs/39088023008),
was triggered for commit `c708d28489d4de16360251a33fa396be9147af51`,
but GitHub did not start the job: `The job was not started because your
account is locked due to a billing issue.` This is an account-level runner
block, not a test failure; GitHub produced no job log. The commands and
observed local results above are the current reproducible evidence until the
repository owner's Actions billing lock is cleared and the workflow is rerun.

## Sequential production application E2E — 2026-10-18

Each section was exercised separately against
`https://delivera-frontend.vercel.app` and the production API, without parallel
mutation or placeholder agreement content.

1. **Homepage:** loaded with HTTP/visual success, all navigation targets and
   architecture sections present. The test found and removed two overstatements
   (server-independent settlement and instant payout); production now describes
   the authority bridge and normal 30-second relay explicitly.
2. **Authentication:** the real deployment wallet requested a one-time nonce,
   signed the exact SIWE-style message, verified it, and fetched `/auth/me`.
   Nonce, verify, and authenticated identity reads each returned HTTP 200.
3. **Dashboard:** authenticated `/contracts` and `/projects` returned HTTP 200;
   six existing agreements and zero projects were rendered from production data.
4. **New agreement:** current StudioNet transaction
   `0x71ecbbed9384bcdf0e40507457fb075bbd3ed759d9946d6c76443937edab45d9`
   finalized successfully and created `delivera-1`: “Delivera Production
   Verification: Accessible Analytics Portal.” It contains three substantive
   milestones for an accessible 12-week Lagos operations dashboard, a documented
   anonymized shipment-status API, and a deployment/incident-response runbook,
   allocated 0.5/0.6/0.7 ledger units. The authoritative readback exactly matched
   the supplied titles, descriptions, acceptance criteria, evidence types,
   parties, and 1.8 total.
5. **Contract detail/evaluations:** both endpoints returned HTTP 200 for real
   production agreement `39368b31-98c1-46cb-954a-50fabfe048af`. This test exposed
   stale backend state: PostgreSQL reported `FUNDED`, while the old configured
   GenLayer contract returned `DRAFT`/zero funded, and the API advertised retired
   escrow `0x6049…4383`. This observation applied to the retired backend and led
   to its replacement; the canonical backend now advertises the current
   GenLayer and v2 Base escrow addresses.
6. **Wallet:** the page's actual direct Base RPC path returned chain id `84532`
   and 121,740,000 base units (121.740000 USDC) for `0x7401…58Eb`.
7. **Notifications:** authenticated production retrieval returned HTTP 200 and
   seven real records, including escrow-funded and contract-invited events with
   persisted unread state and timestamps.

The frontend production environment was repaired during this historical run:
`NEXT_PUBLIC_API_URL` had been empty and is now
`https://delivera-api-gideon.fly.dev`; `NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS` is the
current address above. The Vercel production deployment used by that run,
`dpl_DeaASceUsx7XiWRF6pJ6Y4PDeBci` completed `READY` and was aliased to the
public domain. It was later superseded by current deployment
`dpl_G3uwJ844wgzGoEuovn2BFQf15gGt` when the canonical replacement backend was connected.

### Canonical production backend replacement

The inaccessible `delivera-api` and `delivera-api-v2` deployments are retired.
The canonical API is `https://delivera-api-gideon.fly.dev`, backed by the new
Fly Postgres app `delivera-db-gideon` and Upstash Redis database
`delivera-redis-gideon` in the authenticated `personal` organization. Its
public `/health` read returned `healthy` with server/database/Redis `ok` and
both chain integrations `configured`. A real wallet nonce, signature verify,
and authenticated identity read each returned HTTP 200 against the fresh
database. Current Vercel production deployment `dpl_G3uwJ844wgzGoEuovn2BFQf15gGt`
is `READY` and embeds the new API URL. Fly is intentionally scaled to one
always-on API machine so there is a single in-process relay scheduler.

## Funded StudioNet to Base Sepolia demonstration

### Current deployment funded lifecycle — `delivera-4`

This run used the current public pair: GenLayer
`0xDa4B86C86010329dbf484a1ccD1BD64396B25cBa` and Base escrow
`0x2bA36CD29993cf4250adfb48F367E1893dcd43B5`. Client
`0x7401c129EDfc26E68FE19309fE461eb3Db1058Eb` and provider
`0x5C00df44891d87e1223F040C158568360cc35A52` signed their own lifecycle
transactions. Its deployment-scoped Base key was
`0xe916b54ef77d1b1a19b964ace4b09f091d0345c53dbf84480e4fc5cebb33a308`.

- Base funding: `0x8f3a73cedd08f18052af7f5f2be9706d01f0fa3bd7849a7286ad68633d3d298f`, block 48,259,616; exact allocations `[110000, 120000, 130000]`.
- Post-finality activation: `0xb9cb06c3c69f1331d05703babc6803b5b4265ab88cae78c175af254e3117fc8f`, block 48,259,635.
- Provider acceptance: `0x5e7f61aaf61bbd5141283a974d13d5ab3d9e43a5dba0fe449655cf89687a7a04`.
- Milestone 0 submission: `0x560067f6194ba8985c6667c373a0edce736ef389933fa2d01a98f6e19d52d55c`; client approval: `0x7661d8c6f9fe3d03ecfa59e97030679721e370503e798a762139f2a9edbfd055`; Base 110,000-unit release: `0x399f87ba4f3ef03be02c65e567c35b05c04116fa59f4c9bc287a2a3bfb6c51c0`, block 48,259,700.
- Milestone 1 submission: `0xbc05bfa17c6d9067b8f0d51dcf027a665439271641594f67e6d57a5005421546`; validator evaluation: `0xe41d79d4cdf6b256aa9ee128bddbd35ad9961e085ca7fe3792d94d0ecb9bed19`. Independent retrieval returned `reachable_count = 0`, verdict `rejected`, score 0.
- Dispute creation: `0x16ef75f5d175429b709d6ded0bc02fd310050d43ec8e6453a440e75b3cf6f9e2`; provider statement: `0x3225d6b42bda08fd485031f07e91b7f862e0eac6ddff95790be319c4c2f1e2a5`; consensus resolution: `0x820d3c7ba380051a6befd239cfe2764675c497c6806fe81477e7e832fba43774` at exact provider/client split 0/10,000 bps.
- Base milestone-1 arbitration: `0x815f90ea76af965ec9130c94f38b0712f8f7bd2d649206834db06ad5650777f3`, block 48,259,820; exactly 120,000 units returned to the client without consuming milestone 2.
- Milestone 2 submission: `0x691e54a10124cc4a73dd60a7c33c10c3baef31a892a31bb53a1b2e46a6a0f433`; validator evaluation: `0xc996719cebc144657920ea634e1cb640e9fdcd06fc114f88d576469094d4f610`. Validators retrieved the real page (`reachable_count = 1`) and conservatively rejected it at score 25 because the fetched representation did not contain the exact required phrase. The client then explicitly approved it in `0xecb46be804a15b487c3ca44f06b032efbbb27920de05f202bad005bd03f63c62`.
- Final Base release and settlement: `0xae47076ea4118ab7cd43da8acf03ec5f667b75a6d70ae04eea14261864d5008e`, block 48,259,895.

Final GenLayer state is `COMPLETED`: funded 0.36, released 0.24, refunded
0.12 ledger units. Final Base state is activated and `SETTLED`: funded 360,000,
released 240,000, refunded 120,000, per-milestone consumption
`[110000, 120000, 130000]`, remaining 0. Wallet balances changed from client
121,740,000 / provider 0 / escrow 0 to client 121,500,000 / provider 240,000 /
escrow 0 USDC base units. This is the required funded lifecycle on the current
public contract pair, not the historical adjudicator.

### Historical funded lifecycle

This funded agreement was `delivera-2` on the historical GenLayer deployment
`0xB19331f411618Abb253a01Fa5b457D910c92D8F6`; identifiers are scoped to a
GenLayer deployment, so it is distinct from the current deployment's newer
`delivera-2`. Its Base allocations were 500,000,
600,000, and 700,000 USDC base units (0.5, 0.6, and 0.7 USDC). Its provider was
`0xCB6000A59ea2653CaCc2eC5c62f9ac9a341222fb`.

### Funding and authenticated binding

- StudioNet creation: `0x67de1f9413fbe02172d891a58b47dfece3a2bd27cc4d3754158bc3cd2918054d`, finalized with majority agreement.
- Base funding: `0x54692058973271c5ecf578bf31184b1f1814cf0cfca32a08bd4111424c4919cd`, block 48,255,609.
- Base `EscrowFunded` bound `delivera-2`, the registered client, provider, ordered allocation hash, and exactly 1,800,000 units.
- The owner-only StudioNet funding confirmation recorded the exact Base transaction hash, escrow address, and matching id; its authoritative readback showed `FUNDED` with `funded_atto = 1800000000000000000`.
- Provider acceptance: `0x9a0f8b9d82bf964f882a7b6250a9db00c4b41eb2ba5037232cb936cc4dbd1232`.

### Milestone 0: manual approval and payment

- Provider submitted `https://example.com/`; the client manually approved it in StudioNet transaction `0x4b0646cae67d0b566e683c22403ebf16a256dc96383d9307bfe20d0f210c59bb`, which reached `FINALIZED`.
- Base release: `0x0fb001c48852896c3673dbccb1a5779ffafad779f6d5102d076bd906c31834e8`, block 48,255,711.
- Exactly 500,000 units moved to the provider; Base remaining escrow became 1,300,000.

### Milestone 1: rejection, arbitration, and isolation

- Validators independently attempted to retrieve `https://delivera-evidence.invalid/missing-artifact`.
- Verification transaction `0xb69a77e52abc8fd70c1a33ffadb253ef5757708ad3a0b4bfeb0c84d70882b38b` reached majority agreement on `rejected`, score 0, and `reachable_count = 0`.
- The finalized arbitration used the exact 500-bps bucket rule and resolved at provider 0 / client 10,000 bps. The agreement recorded provider 0 and client 600,000,000,000,000,000 atto units for milestone 1.
- Base dispute settlement: `0xdcec01a034b971b37ccdf3ae1b51a99b4254cd2a801cce8a838e6808c6f1f793`, block 48,255,813.
- The authoritative Base readback immediately afterward was: funded 1,800,000; released 500,000; refunded 600,000; milestone settlements `[500000, 600000, 0]`; remaining 700,000. This proves milestone 2's allocation was untouched.

### Milestone 2 and completion

- The provider submitted the final milestone only after the isolation readback; the client manually approved it.
- The finalized StudioNet agreement readback was `COMPLETED`, released 1.2 ledger units and refunded 0.6, with milestones 0 and 2 approved and milestone 1 exhausted/resolved.
- Base release: `0x635419ae5f4b13fe3edaf9d607445c36c3a9d86ea920ec2835da2b620348acbb`, block 48,255,881.
- Final Base state: funded 1,800,000; released 1,200,000; refunded 600,000; milestone settlements `[500000, 600000, 700000]`; remaining 0; status `SETTLED`.
- USDC balances for this agreement changed from client 124,440,000 / provider 0 / escrow 0 to client 123,240,000 / provider 1,200,000 / escrow 0. Thus the provider actually received 1.2 USDC and the client actually recovered 0.6 USDC from the disputed allocation.

## Cancellation and refund evidence

`delivera-1` was funded and then cancelled before provider acceptance, exercising
the safe cancellation path:

- Base funding: `0x70f89206813658d63d898e3a3c48ee74dd15143e41ec34afdaf027ea147f29e9`.
- Finalized StudioNet cancellation: `0xbbdb0dba94bdf10113e5896247d060e10084d76d4fbd341676cbf848708b0ac2`.
- Base refund and settlement: `0x65ca3b8bcaa887802694a7110cde4604e5b730d8568ee40625a3a96c080c9e3a`, block 48,255,580.
- All three unsettled allocations were marked settled, the entire 1.8 USDC returned to the client, and remaining escrow became zero.

## Replay and interrupted-relay recovery

The live Base readback returned `processedSettlements = true` for milestone 0
release, milestone 1 dispute, and milestone 2 release. This is the recovery
signal used when a Base receipt succeeds before PostgreSQL records its hash: a
restarted relay observes the deterministic settlement id on-chain, records the
recovered settlement, and does not broadcast again.

The backend regression suite also failure-injects that exact uncertain state:
an approved database row has no saved hash while its deterministic Base
settlement id is already processed. The sweep records
`RECOVERED:<settlementId>`, updates the accounting mirror once, and asserts that
`releaseMilestone` is not called. This makes the recovery procedure reproducible
without spending funds.

Two live adversarial retries were made after milestone 1 settled:

1. Reusing the exact deterministic id reverted with `DeliveraEscrow: settlement already processed`.
2. Signing a different id and altered 500-bps split for the same milestone reverted with `DeliveraEscrow: milestone already settled`.

During the historical run, its original configured relayer was restored in Base transaction
`0x17fb8223550c149e42aebdb5b86484c731707c1a03ab2cf05d2d6008f33a2b42`.
A read then confirmed zero escrow balance and all three settlement flags still
true. After that demonstration, the canonical relayer was rotated to
`0x0EaD3C2e53Bf4c47B8875DcC1669E69Deee19d2D` in transaction
`0xe859c848aa50d86d779004c956e3bde20bd92315027576ff78567770834ceddd`.

## Solidity adversarial suite

The local suite additionally proves unauthorized pre-funding, altered provider
or allocation signatures, altered settlement amounts, non-relayer submission,
60/40 partial dispute arithmetic, exact unrelated-fund isolation, replay
protection, second-id/same-milestone rejection, and mixed
release/dispute/cancellation accounting.

## GenLayer dispute lifecycle regression

Post-payment disputes are unsupported. `raise_dispute` now checks both the
visible milestone status and `settled_atto == 0` before creating or appending a
dispute. This closes the case where an arbitrated `EXHAUSTED` milestone could be
opened again and leave the agreement frozen in `DISPUTED`. CI parses the
contract and verifies that this guard occurs before the first dispute-state
mutation; the UI independently suppresses the action for resolved milestones.
