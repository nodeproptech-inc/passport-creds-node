# ComplianceHook demo

Local demo of the Uniswap v4 **ComplianceHook** — two pools gated by the same
EligibilityGate that guards every other PassportKit surface:

| Pool | Policy | Who can swap / add liquidity |
|---|---|---|
| Deal Room pool | `#1` | identity with a valid `KYC_VERIFIED` claim |
| Investor pool | `#2` | identity with `KYC_VERIFIED` + `ACCREDITED_INVESTOR` |

Removing liquidity is never gated — funds are never trapped.

## Run

```bash
cd apps/hook-demo
npm install       # first time only
npm start         # → http://localhost:4180
```

The server is self-healing: it starts anvil if none is running and deploys the demo
world (`contracts/script/DeployHookDemo.s.sol`) if the hooks aren't on-chain.
**↺ Reset world** resets the chain (`anvil_reset`, clock included) and redeploys.

## Actors (anvil dev accounts)

| actor | role | starts with |
|---|---|---|
| operator | admin + issuer signer + LP | identity with both claims (seeded both pools) |
| ana | investor, accreditation pending | identity + `KYC_VERIFIED` |
| rui | stranger | identity, zero claims |

Every card shows the identity, both claims (with expiry), pool access with the
hook's reason code, the actor's **LP position per pool**, and token balances.
Swap/liquidity log lines carry the exact token deltas.

## Transactions

- **Built-in inspector** — click any tx hash in the log: status, gas, and fully
  decoded events (`IdentityCreated`, `ClaimAdded`, `RevocationSet`, `Swap`,
  `ModifyLiquidity`, …).
- **Otterscan** (optional, local explorer UI): `make hook-demo-explorer`
  (Docker; anvil exposes the `ots_*` API natively) → http://localhost:5100.
- **Testnet explorer** — set `EXPLORER_URL` in `.env` and hashes also link out
  (e.g. Etherscan on Sepolia).

## Ethereum Sepolia

Copy `env.example` to `.env` and fill in: `RPC_URL`, `EXPLORER_URL`, funded
`OPERATOR_PK`/`ANA_PK`/`RUI_PK`, and `POOL_MANAGER`
(canonical v4 on Sepolia: `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`). Then:

```bash
cd contracts && set -a && source ../apps/hook-demo/.env && set +a && \
  forge script script/DeployHookDemo.s.sol --rpc-url $RPC_URL --broadcast
cd ../apps/hook-demo && npm start
```

Timewarp and reset are local-only; claim-expiry demos need real time on testnets.

## Demo script (~2 min)

1. **Rui swaps** → `NotCompliant(MISSING_KYC)`.
2. **⚡ Verify Rui's KYC** (the issuer signs EIP-712, Rui submits it to his own
   Identity) → Deal Room pool trades.
3. **Ana on the Investor pool** → `MISSING_ACCREDITED`; verify accreditation →
   unlocked.
4. **Ana adds liquidity** (watch position + deltas), **Revoke KYC ⚠**
   (`ClaimIssuer.setRevoked`) → pools refuse her — **Exit still works**.
   **Restore KYC** re-opens the latch and she is back in.
5. **⏩ Fast-forward 1 year** → claims expire; even the operator gets `MISSING_KYC`.
6. Click a **tx hash** — decoded events, straight from the chain.

## API

```
GET  /api/state
GET  /api/tx/<hash>        receipt + decoded events
POST /api/swap             {"actor":"ana","pool":"deal|investor","zeroForOne":true}
POST /api/liquidity        {"actor":"ana","pool":"deal","direction":"add|remove"}
POST /api/verify           {"actor":"ana","claim":"kyc|accredited","approved":true}
                           (issuer signs EIP-712 → holder submits; approved:false revokes)
POST /api/revoke-claim     {"actor":"ana","claim":"kyc"}   issuer latch on
POST /api/restore-claim    {"actor":"ana","claim":"kyc"}   issuer latch off
POST /api/revoke-passport  {"actor":"ana"}                 every topic at once
POST /api/timewarp         {"days":366}             (local only)
POST /api/reset            {}                       (local only)
```

Refusals come back decoded from v4's `WrappedError`, e.g.
`{"ok":false,"reason":"MISSING_ACCREDITED","message":"NotCompliant(0x7099…79C8, MISSING_ACCREDITED)"}`.

`npm test` covers the revert decoder, env parsing, and position aggregation.
