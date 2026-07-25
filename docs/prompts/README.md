# prompts/ — vibe-coding prompts (spec-driven)

> The prompts we feed the AI **in-event** to generate each piece from the specs. These ship in the repo (ETHGlobal requires specs + prompts to be included — "judges need to see how you directed the AI").
>
> **How to use:** open the relevant `specs/*.md` alongside the prompt, run the prompt, then **commit incrementally** and review. Never bulk-drop. Attribute AI use per file in `AI-USAGE.md`.

Order: `01-contracts` → `02-backend` → `03-frontend`.

- `01-contracts.md` — the 9 Solidity contracts + `ComplianceHook.t.sol`.
- `02-backend.md` — issuer signing service + adapt the reused NestJS modules.
- `03-frontend.md` — adapt the reused dashboard + gated app to the gate + ENS.
