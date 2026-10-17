# Remediation verification record

Date: 2026-10-18 (Africa/Lagos)

## Source state

- Baseline reviewed: `bcc7411`
- Remediation source: working tree based on `bcc7411` (record the final commit
  here before deployment)
- Base escrow v2 live address: **not deployed yet**
- GenLayer remediation live address: **not deployed yet**

The prior Base escrow address belongs to v1 and must not be represented as the
remediated deployment. A deployment attempt from this workspace was blocked by
the execution approval boundary because creating a live fund-moving contract
requires explicit user authorization.

## Reproducible local checks

```bash
cd contracts/base && npm test
cd ../../backend && npm run typecheck
cd ../frontend && npm run build
cd .. && python3 -m py_compile contracts/delivera.py
genvm-lint check contracts/delivera.py
git diff --check
```

Observed results:

- Solidity: 6 passing tests.
- Backend TypeScript: passed.
- Frontend production build: passed; all 11 routes generated.
- Python syntax compilation: passed.
- GenVM static lint: 3 checks passed. Full SDK validation could not run because
  the linter's pinned SDK archive was unavailable (`filename ...tar not found`).
- Patch whitespace validation: passed.

## Scenarios covered by the Solidity suite

The v2 suite uses a three-milestone escrow with allocations 400,000, 350,000,
and 250,000 USDC base units and asserts actual token balances and authoritative
escrow readbacks.

1. Funding binds contract id, client, provider, total, and the ordered allocation array.
2. A different wallet cannot pre-fund/reserve the public id with the client's authorization.
3. Altering the provider or allocation array invalidates the funding signature.
4. Resolving milestone 1 at 60/40 distributes only 350,000 and leaves 650,000 untouched.
5. A relayer cannot alter a signed amount, and a non-relayer cannot submit the instruction.
6. Reusing the same settlement id is rejected on-chain.
7. Re-signing a second id for an already settled milestone is also rejected by allocation state.
8. A release, partial dispute split, and cancellation refund across three milestones finish with
   exact provider/client token changes and zero remaining escrow.

## Interrupted relay recovery

Settlement ids are deterministic (`chainContractId:kind:index`) and consumed
by `processedSettlements` in Solidity. Before submitting a database row whose
tx hash is null, the relay checks that mapping. If Base already executed the
instruction, the relay records a recovered marker and applies the accounting
delta without sending a second transaction. Row claiming and accounting occur
in one database transaction. Duplicate settlement attempts remain impossible
even if PostgreSQL is unavailable immediately after a successful Base receipt.

Wallet-signed GenLayer writes carry their transaction hash into the confirmation
endpoint. The backend waits for `FINALIZED` before mirroring payout-eligible
state; an `ACCEPTED` but appealable result cannot authorize Base movement.

## Live end-to-end checklist (required before acceptance)

After explicit deployment authorization and funded test wallets are available:

1. Commit the source and record its SHA.
2. Deploy the new GenLayer contract; record its address and finalized receipt.
3. Deploy Base escrow v2 with distinct relayer and authority addresses; verify source and record address.
4. Create a three-milestone agreement and capture the GenLayer creation result.
5. Fund exact allocations from the registered client; capture `EscrowFunded`, USDC balances, and `getEscrow`.
6. Approve one milestone, reject/resubmit another, and resolve a third by partial split.
7. Stop the relay after one Base receipt but before its DB write, restart it, and capture recovery without a second transfer.
8. Submit duplicate-id and second-id/same-milestone attempts and capture both reverts.
9. Exercise cancellation/completion refund for remaining allocations.
10. Attach GenVM finalized results, Base receipts, authoritative readbacks, before/after client/provider balances, addresses, and source SHA to this file.

Local simulation is evidence for correctness, but it is not mislabeled here as a funded StudioNet-to-Base Sepolia demonstration.
