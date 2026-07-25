# World ID personhood MVP

The `/passport` page uses the new `apps/api` endpoints only:

1. Connect a wallet and read `GET /eligibility/:wallet`.
2. When necessary, call `POST /identity/create`.
3. `POST /world-id/request` signs a short-lived RP context on the server.
4. IDKit opens in `staging`; the Simulator returns a proof.
5. `POST /world-id/verify` forwards the untouched result to World, then signs `PROOF_OF_PERSONHOOD` when issuer contracts are configured.
6. With a real claim, the holder's MetaMask wallet calls `Identity.submitClaim`. In `DEMO_MODE`, the response is explicitly local/mock and no transaction is claimed.

## Run

```powershell
cd C:\Users\Domingos\Documents\Hackathon\passportkit
npm run start --workspace=apps/api
NEXT_IGNORE_INCORRECT_LOCKFILE=1 npm run dev --workspace=apps/web -- --port 3003
```

The supplied local files use API port 3005 to avoid the existing process on 3001. Set `WORLD_APP_ID`, `WORLD_RP_ID`, and `WORLD_RP_SIGNING_KEY` in `apps/api/.env` with staging values from the World Developer Portal; do not put the signing key in the web environment.

## Simulator

Create a staging World app/action matching `WORLD_ACTION`, start both apps, connect MetaMask, open `/passport`, and select **Verify with World ID**. Scan/open the staging request in the World ID Simulator, complete the Proof of Human flow, and return to the page. With deployed issuer/factory/gate and keys, approve the MetaMask `submitClaim` transaction; otherwise the result is visibly labelled MOCK.
