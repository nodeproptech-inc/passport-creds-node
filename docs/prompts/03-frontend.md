# Prompts — Frontend (`apps/web`, Next.js)

> Reference: `FORK-BOOTSTRAP.md` (frontend keep/change), `specs/reuse-inventory.md`, `specs/ens-spec.md §5`.
> Reuse Privy + dashboard + Deal Room; the delta is repointing to the gate + ENS + World + the revoke demo.

## Onboarding (keep)
```
Prompt: "Keep PrivyAppProvider + PrivyLoginButton + WalletSetupCard as-is. After login,
call the backend to create the OnchainID + issue the ENS subname; store the wallet + identity
+ ENS name in app state."
```

## World flow + claim submission (Model B)
```
Prompt: "Add the World ID flow (Identity Attestations + Selfie Check). On success, the frontend
calls the backend for the issuer-signed claim, then THE USER'S WALLET submits it on-chain
(Identity.submitClaim) — the holder submits, not the backend. Show progress → claim lands."
```

## Dashboard (adapt `app/passport` + `components/passport/*`)
```
Prompt: "Adapt the passport dashboard to the new model: show status GREEN/RED from
EligibilityGate, the KYC + personhood claim badges, the OnchainID address, and the ENS name
(read compliance.status via viem getEnsText on Eth Sepolia). Reuse existing components."
```

## Gated app (adapt `app/deal-room/*`)
```
Prompt: "Adapt the Deal Room (our GATED APP surface) to gate on the ENS name / EligibilityGate:
resolve the user's <label>.passportkit.eth compliance.status → GREEN opens, REVOKED closes.
Reuse DealRoom{Locked,Unlocked,Blocked}. This must flip LIVE on revocation."
```

## Revoke demo control (new)
```
Prompt: "Add a clearly-labeled demo 'Revoke KYC' button that calls the backend revoke endpoint,
then re-polls: dashboard → RED, gated app → closed, ENS status → REVOKED. This is the money moment."
```

## Services (adapt `modules/passport`, `modules/access`)
```
Prompt: "Repoint passport.service + access.service to the new API (isEligible + ENS reads).
Remove TransferLimitForm/TransferPolicyBanner (old policy model)."
```

## Branding
```
Prompt: "Rebrand shell (layout, landing) from PassportCreds to PassportKit Node. No hard-coded
compliance values anywhere — everything reads on-chain / ENS live."
```
