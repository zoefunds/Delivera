# Remediation verification record

Date: 2026-10-18 (Africa/Lagos)

## Deployed evidence source and addresses

- Funded live-run source commit: `d9d94c0b5b16edcc4982875f89dd53542b658e92`
- Latest remediated source commit: `6cffd60` (adds the post-arbitration re-dispute guard and automated recovery/funding-claim regressions)
- GenLayer StudioNet contract: `0xB19331f411618Abb253a01Fa5b457D910c92D8F6`
- GenLayer deployment transaction: `0x79b954dd00da88b3f42028ed23e5f96bdf58d1c6ffeeb188a46df411f054dfc7`
- Base Sepolia escrow v2: `0xC7A0AC77AE3058D0a1A8E3874C8e394D0E4a7875`
- Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Client and decision authority: `0x7401c129EDfc26E68FE19309fE461eb3Db1058Eb`
- Configured relayer (restored after the run): `0xd07E3D1bAF59F1c09e2F8842786D89B716915f3E`

The funded evidence deployment receipt reached `FINALIZED` (`status: 7`) with
`MAJORITY_AGREE` and unanimous revealed votes. The Base deployment was compiled
from the funded live-run source commit above. Commit `6cffd60` changes only the
GenLayer dispute-entry guard, backend testability/comments, frontend dispute
button eligibility, CI, and documentation; it does not change the deployed Base
escrow bytecode. A replacement StudioNet deployment requires the encrypted
`anchor-deploy` keystore password, which is intentionally not stored in this
repository.

## Reproducible checks

```bash
cd contracts/base && npm test
cd ../../backend && npm test && npm run typecheck
cd ../frontend && npm run build
cd .. && python3 -m py_compile contracts/delivera.py
python3 -m unittest contracts/test_dispute_guards.py
genvm-lint check contracts/delivera.py
git diff --check
```

Observed results:

- Solidity: 6 passing tests.
- Backend: 3 tests passed (false funding claims and interrupted-relay recovery); TypeScript passed.
- Frontend production build: passed; all 11 routes generated.
- Python syntax compilation and the settled-milestone dispute-guard regression: passed.
- GenVM static lint: 3 checks passed. Full SDK validation could not run because
  the linter's pinned SDK archive was unavailable (`filename ...tar not found`).
- Patch whitespace validation: passed.

## Funded StudioNet to Base Sepolia demonstration

The completed agreement was `delivera-2`, with Base allocations of 500,000,
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

The original configured relayer was restored in Base transaction
`0x17fb8223550c149e42aebdb5b86484c731707c1a03ab2cf05d2d6008f33a2b42`.
A fresh read confirmed the restored relayer, zero escrow balance, and all three
settlement flags still true.

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
