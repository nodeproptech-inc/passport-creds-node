# ENSIP-25 — Verifiable Agent Identity (implementation spec)

**Owner: Luiz Henrique.** Adds ENSIP-25 (Verifiable AI Agent Identity with ENS) to PassportKit, on top of
the Model-A agent link we already have on-chain (`IdentityFactory.linkAgent`).

> Prize angle (ENS): this is the "more clever than showing names" play. Our ENS name isn't a label — it
> (a) serves **live compliance status** (`PassportResolver.text`), and now (b) **verifiably links a human to
> the AI agents acting for them** via a real ENS standard. Thesis: _eligibility infrastructure for humans AND agents._

---

## 1. What ENSIP-25 standardizes (verbatim essentials)

- **Text record key:** `agent-registration[<registry>][<agentId>]`
  - `<registry>` = the **ERC-7930 interoperable address** of the agent registry contract (hex string, `0x`-prefixed).
  - `<agentId>` = the registry-defined agent identifier (string), **MUST NOT contain `[` or `]`**.
- **Value:** MUST be a non-empty string; SHOULD be `"1"`. The specific value has no meaning — **presence = attestation** by the ENS name owner.
- **Verification (client side):**
  1. Get (claimed ENS name, agentId, registry address) from the agent registry entry.
  2. Build the key `agent-registration[<registry>][<agentId>]`.
  3. Resolve that text record on the claimed ENS name.
  4. Non-empty value → verified for that registry entry.
- **Companions:** `<registry>` points at an **ERC-8004** ("on-chain AI agent identity registry") entry; addresses are encoded with **ERC-7930**.
- Spec: https://docs.ens.domains/ensip/25 · blog: https://ens.domains/blog/post/ensip-25

---

## 2. How it maps onto PassportKit

We already have the on-chain link (Model A):
- `IdentityFactory.linkAgent(agentWallet, personIdentity)` → `identityOfWallet[agentWallet] = personIdentity`.
- The **person** owns an ENS name (e.g. `alice.passportkit.eth`), `identityOf[node] = personIdentity`.

Mapping decision:
- **Registry** = our `IdentityFactory` (it IS the agent registry — `identityOfWallet` + `isAgent`). Its address, ERC-7930-encoded, is `<registry>`. (Optional stretch: also expose a thin ERC-8004-compatible view for full-standard cred — see §6.)
- **agentId** = the agent **wallet address** as a hex string (contains no `[`/`]` — compliant).
- **Claimed ENS name** = the **person's** name. The record `agent-registration[<7930(factory)>][<agentWallet>]` lives on the person's name and attests "this agent is mine."

---

## 3. The clever part — compute the attestation LIVE (recommended, Path A)

Instead of the owner calling `setText`, `PassportResolver.text()` **derives** the ENSIP-25 record from the
on-chain link. The attestation is true **iff** `linkAgent` was called and still holds:

```
text(node, key):
    if key starts with "agent-registration[":
        (registryField, agentIdField) = parseBrackets(key)         // the two [...] segments
        if registryField != expectedRegistry7930(): return ""       // must be OUR registry
        address agent = parseHexAddress(agentIdField)
        address personId = identityOf[node]
        if personId != address(0) && factory.identityOfWallet(agent) == personId:
            return "1"                                              // attested, live
        return ""                                                   // not linked / unlinked / revoked
    ... existing compliance.status / compliance.identity handling ...
```

Why this wins:
- **No manual `setText`, no keeper** — same magic as `compliance.status`.
- **`unlinkAgent(agent)` → the record flips to empty → ENSIP-25 verification fails** automatically. Ties agent identity to our revoke/unlink model.
- Combined with `compliance.status`, one ENS name proves: _"this agent belongs to a verified human AND that human is currently eligible."_

Implementation notes:
- Add an `IIdentityFactory` reference to the resolver — global immutable, or per-tenant in the `Tenant` struct (prefer per-tenant to stay white-label). Minimal interface: `identityOfWallet(address) view returns (address)`.
- `expectedRegistry7930()` = the ERC-7930 encoding of the factory address on this chain (see §5). Compare the bracket segment against it (bytes compare). To keep Solidity string parsing bounded: compute the fixed prefix `agent-registration[<7930>][` on-chain, require `key` starts with it, then parse the trailing hex address up to `]`.
- String parsing (`parseBrackets`, `parseHexAddress`, `startsWith`) is the bulk of the work — pure `bytes` slicing, no external calls.

### Path B — static `setText` (simpler fallback)
If live-compute runs long: after `linkAgent`, have the registrar/backend (or the name owner) write the
ENSIP-25 record with a standard `setText(node, "agent-registration[...]", "1")`. Fully spec-compliant, less
clever, and it does NOT auto-flip on unlink (you'd have to clear it). Use only if time-boxed.

---

## 4. Verification flow (what a client / our frontend does)

```
given: personName = "alice.passportkit.eth", agentWallet, registry = IdentityFactory
key   = "agent-registration[" + erc7930(registry) + "][" + toHexString(agentWallet) + "]"
value = ensPublicResolver.text(namehash(personName), key)   // standard ENS text lookup
verified = value != ""
```

Any wallet/explorer can do this with **one standard ENS call** — no PassportKit integration needed. That's the composability pitch.

---

## 5. ERC-7930 encoding of the registry (verify before hardcoding)

From the spec's mainnet example, registry `0x8004…432` on chainId 1 encodes as
`0x000100000101148004a169fb4a3325136eb29fa0ceb6d2e539a432`, which decomposes as:

| bytes | meaning | mainnet value |
|---|---|---|
| `0001` | ERC-7930 version | `0001` |
| `0000` | chain type (eip155) | `0000` |
| `01` | chain-ref length | `01` |
| `01` | chain reference (chainId) | `01` (mainnet) |
| `14` | address length (20) | `14` |
| `8004…432` | the 20-byte address | registry |

**Sepolia (chainId 11155111 = 0xAA36A7, 3 bytes)** → inferred:
`0x00010000` + `03` + `aa36a7` + `14` + `<factory 20 bytes>`
= `0x0001000003aa36a714<factoryAddressNo0x>`

⚠️ This byte layout is inferred from ONE example — **validate against the ERC-7930 spec** before shipping. Best:
have the resolver **build the expected 7930 string on-chain** from `block.chainid` + the factory address so it's
never hardcoded and can't drift.

---

## 6. Registry choice (one decision)

- **Path 1 (fast, recommended):** `IdentityFactory` IS the registry. `<registry>` = its 7930 address; `<agentId>` = agent wallet. No new contract.
- **Path 2 (bonus cred):** add a minimal **ERC-8004**-shaped registry (or an adapter view over IdentityFactory) so the `<registry>` is a "real" agent registry entry with an incrementing `agentId`. More standard-faithful; more work. Do only if Path 1 lands with time to spare.

---

## 7. Build checklist

- [ ] Decide registry: Path 1 (IdentityFactory) vs Path 2 (ERC-8004). Default: Path 1.
- [ ] Add `IIdentityFactory` ref to `PassportResolver` (per-tenant `Tenant` field or immutable).
- [ ] Implement `expectedRegistry7930()` on-chain (from `block.chainid` + factory addr).
- [ ] Extend `PassportResolver.text()` to serve `agent-registration[...]` live (Path A pseudocode §3).
- [ ] String helpers: `startsWith`, extract bracket segment, `parseHexAddress`, `toHexString`.
- [ ] Tests: linked agent → `"1"`; wrong registry → `""`; unlinked agent → `""`; person revoked → still `"1"` for the LINK (revocation hits `compliance.status`, not the link) OR decide it should also gate — **design call, see §8**.
- [ ] Frontend "My Agents": show the ENSIP-25 verification (green check) + the one-line `text()` proof; unlink → flips.
- [ ] Update `HANDOFF.md` + `contracts-reference.md` with the new resolver behavior.

---

## 8. Open design call (Luiz)

**Does `agent-registration` reflect only the LINK, or also the person's live eligibility?**
- ENSIP-25 semantics = "is this agent linked to this name" (identity, not compliance). Purest: return `"1"` whenever linked, regardless of the person's compliance. `compliance.status` carries the eligibility separately.
- Alternative (stronger money-moment): return `""` when the person is NOT eligible, so revoking the person **also** breaks the ENSIP-25 attestation → one revoke kills both the compliance record and the agent-identity record.
- **Recommendation:** keep ENSIP-25 = link only (spec-pure), and let `compliance.status` carry eligibility. The demo still shows both flipping. Revisit if we want the single-revoke-kills-everything drama on the agent record too.

---

_Fits the ENS + x402/agent prize narrative. See `HANDOFF.md` §6 (Noé owns the ENS parent; this agent-identity
resolver work is Luiz's) and `contracts-reference.md` (PassportResolver)._
