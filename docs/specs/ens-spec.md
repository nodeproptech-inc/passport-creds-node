# Spec — ENS-resolvable status (PassportKit Node)

> 4th enforcement surface + the ENS prize ($5k). A `.eth` subname per identity, with compliance status in **text records** — but **read-through** (computed live from the `EligibilityGate`), not static.
> It's "never cut" in the cut order → **must be scoped before Friday.**

---

## 0. Locked decisions

- **Read-through resolver (primary)** — the compliance record is **computed on read** from the `EligibilityGate`, not written with `setText`. So revocation **flips automatically** (no push tx).
- **Chain: Ethereum Sepolia (L1)** — the ENS core (registry/NameWrapper/resolvers) lives on **Ethereum L1**; the testnet is **Ethereum Sepolia**. **NOT Base Sepolia** (Base is L2; ENS core isn't there).
- ⚠️ **Co-locate the whole MVP on Ethereum Sepolia** (identity + EligibilityGate + resolver + hook + token). A Solidity resolver **can't make cross-chain calls**, so read-through only works if the `EligibilityGate` is **on the same chain** as the resolver. Forking fresh, we pick the chain — not bound to the old PassportCreds Base Sepolia. (Uniswap v4 is also on Ethereum Sepolia — confirm the `PoolManager`.)
- **If we stay on Base Sepolia:** cross-chain read-through needs **CCIP-Read** (EIP-3668 gateway = rabbit hole). The viable path becomes the **push-mirror** (fallback §8): backend listens to `RevocationSet` on Base → `setText` on L1 Sepolia.
- **Kit model (white-label):** the parent name = the **tenant's brand** (each white-label owns their own `.eth`; the kit does NOT register top-level names). **Subname issuance + resolver = the kit, done BY CODE** (see §0.1). Demo tenant = `passportkit.eth`, registered on **Ethereum Sepolia** before Friday (infra setup).
- **Subname per identity:** `<label>.<tenant>.eth`, resolver = our tenant-aware `PassportResolver`, issued by the `PassportSubnameRegistrar`.

---

## 0.1 White-label / kit model (this is the SDK)

PassportKit is a **kit → future SDK**. The ENS piece is **reusable code**, not a hardcoded name. Two things, only one is the kit:

1. **Parent name = the tenant's brand.** Each white-label (e.g. `brandx.eth`, `acme.eth`) **owns their own** `.eth`, registered once (top-level registration costs money — the kit does not do it).
2. **The KIT = subname issuance + read-through resolver, by code.** Given a name the tenant owns, the kit issues **compliant subnames** under it (`user.tenant.eth`) and resolves live status — reading **that tenant's** EligibilityGate.

Two generic, tenant-parametrized contracts:
- **`PassportSubnameRegistrar`** — `issueSubname(parentNode, label, userWallet, identity)` → creates the subname pointing at the resolver + registers `node→identity`. Called by the tenant's backend/factory on onboarding. **Subnames created by code, zero UI.**
- **`PassportResolver` (tenant-aware)** — `mapping(parentNode → (gate, policyId))` so **one resolver serves N tenants**, each reading their own gate. `text()` stays read-through.

**Hackathon proof:** register 1 demo name (`passportkit.eth`) = the demo tenant, and show a subname **issued by a contract call** resolving live compliance. Contracts are generic → that IS the white-label proof, even with one tenant.

**SDK roadmap:** gasless subnames at scale (wildcard ENSIP-10 / CCIP-Read / ENS v2 Namechain L2) so a tenant onboards millions with no per-user tx; an npm SDK wrapping registrar + resolver + issuer signing.

**v2-ready by design:** our tenant-aware architecture maps **1:1 to ENS v2's per-tenant registries** (each white-label = its own registry in v2). We ship v1 today and migrate cleanly as v2/Namechain matures. ⚠️ Honesty rule: say *"designed for v2"* / *"maps to v2"*, **never** *"running on v2"* unless we actually deploy on it. (Confirm exact v2/Namechain status at the ENS booth.)

**Pitch upgrade:** not "we added ENS to a product" but *"a reusable subname-compliance rail any white-label plugs into — the tenant brings the name, the kit issues compliant, resolvable identities, by code."* Exactly the *"meaningful new capability, not cosmetic"* (Continuity) + *"scalable subname ecosystems"* ENS asks for.

---

## 1. The push-based problem (and why the read-through resolver kills it)

The other 3 surfaces (transfer/swap/gated) **read** the `EligibilityGate` live. A standard ENS text record (`setText`) is **static**: on revocation it **doesn't flip by itself** — someone would have to send a `setText` (listener + keeper + gas).

**Solution:** a **custom ENS resolver** whose `text(node, key)` **reads the `EligibilityGate` on the fly**. Then:
```
resolve("compliance.status" of alice.passportkit.eth)
  → PassportResolver.text(node, "compliance.status")
  → gate.isEligible(identityOf[node], policyId)
  → returns "GREEN" or "REVOKED" LIVE
```
Revocation now reflects in ENS **automatically**. No push, no keeper. And it's the strongest **"Most Creative Use"** story: *text records backed by live on-chain state, not static strings.*

---

## 2. Text record schema

| Key | Value (read-through) |
|---|---|
| `compliance.status` | `GREEN` / `REVOKED` (or NONE/LIMITED/RED if we want granular) |
| `compliance.identity` | OnchainID address |
| `compliance.kyc` | `verified` / `none` |
| `compliance.personhood` | `verified` / `none` (World ID) |
| `compliance.policy` | policyId label |
| `url` | dashboard link (optional) |
| `avatar` | passport image (optional, WOW) |

---

## 3. PassportResolver — tenant-aware read-through (sketch)

One resolver serves **N white-label tenants**; each `parentNode` carries its own gate + policy.

```solidity
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

interface IEligibilityGate {
    function isEligible(address identity, uint256 policyId) external view returns (bool, bytes32);
}

contract PassportResolver {
    struct Tenant { IEligibilityGate gate; uint256 policyId; address controller; }
    mapping(bytes32 => Tenant)  public tenantOf;    // parentNode -> tenant config
    mapping(bytes32 => address) public identityOf;  // node -> OnchainID
    mapping(bytes32 => bytes32) public parentOf;    // node -> parentNode

    /// A tenant registers their gate/policy (auth: parent owner — omitted).
    function setTenant(bytes32 parentNode, IEligibilityGate gate, uint256 policyId, address controller) external {
        tenantOf[parentNode] = Tenant(gate, policyId, controller);
    }

    /// Set once when the subname is issued (by the tenant's controller/registrar).
    function setIdentity(bytes32 node, bytes32 parentNode, address identity) external {
        require(msg.sender == tenantOf[parentNode].controller, "not controller");
        identityOf[node] = identity;
        parentOf[node]   = parentNode;
    }

    function text(bytes32 node, string calldata key) external view returns (string memory) {
        address id = identityOf[node];
        Tenant memory t = tenantOf[parentOf[node]];
        if (keccak256(bytes(key)) == keccak256("compliance.status")) {
            if (id == address(0) || address(t.gate) == address(0)) return "NONE";
            (bool ok,) = t.gate.isEligible(id, t.policyId);
            return ok ? "GREEN" : "REVOKED";        // ← LIVE per tenant, flips on revocation
        }
        // compliance.identity / .kyc / .personhood / .policy ...
        return "";
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x59d1d43c   // ITextResolver.text(bytes32,string)
            || id == 0x01ffc9a7;  // ERC-165
    }
}
```

Notes:
- `text()` interface id = `0x59d1d43c`; add `IAddrResolver` (`0x3b3b57de`) if we also resolve `addr`.
- **SDK-scale path:** **wildcard ENSIP-10** (`resolve(bytes name, bytes data)`, id `0x9061b923`) → answer for `*.tenant.eth` **without minting each subname** (gasless at scale). Roadmap; for a few demo users, minting is simpler.

---

## 4. Issue the subname BY CODE (`PassportSubnameRegistrar`)

The kit issues subnames programmatically — no manual UI. One reusable function per tenant:
```solidity
function issueSubname(bytes32 parentNode, string calldata label, address userWallet, address identity)
    external returns (bytes32 node)
{
    // parent must be wrapped + this registrar approved by the tenant owner (setApprovalForAll on NameWrapper)
    nameWrapper.setSubnodeRecord(parentNode, label, userWallet, address(resolver), 0, fuses, expiry);
    node = keccak256(abi.encodePacked(parentNode, keccak256(bytes(label))));
    resolver.setIdentity(node, parentNode, identity);
}
```
Called by the tenant's backend/factory when a user onboards. The tenant grants the registrar `setApprovalForAll` on the NameWrapper (or the owner wallet calls it). `node = keccak256(parentNode, keccak256(label))`.

---

## 5. Reading in the frontend / gated app

```ts
// viem, client on Eth Sepolia
const status = await client.getEnsText({ name: "alice.passportkit.eth", key: "compliance.status" });
// → "GREEN" | "REVOKED"  (live)
```
**Subname as access token:** the gated app resolves the name → `compliance.status == "GREEN"` → allow. This is the "subname as access token" the track asks for.

---

## 6. Money moment (auto-flip)
```
1) alice.passportkit.eth → compliance.status = GREEN   (resolved live)
2) revokeClaim(KYC)                                       (1 tx on OnchainID/issuer)
3) SAME ENS query → compliance.status = REVOKED          (without touching ENS!)
   + gated app closes + transfer fails + swap reverts
```

---

## 7. ENS prizes — $5k pool, 3 tracks (1 build hits 2)
| Track | $ | Fit |
|---|---|---|
| **Best ENS Continuity Integration** (continuity-only) | 2,000 | ✅ plan-to-win: new ENS capability on top of PassportCreds |
| **Most Creative Use** | 1,500 | ✅ their prompt literally: "verifiable credentials in text records" + "subnames as access tokens" + read-through = "surprise us". **No from-scratch restriction** → continuity projects eligible |
| **Best ENS for AI Agents** | 1,500 | 🟡 **stretch**: only if we add the human-backed agent |

**AI Agents stretch (double-dips with World AgentKit $8k, completes the "humans AND agents" thesis):** give the agent an ENS subname + agent metadata in text records (**ENSIP-26**) + agent name verification (**ENSIP-25**); the agent only acts if the human's passport is GREEN. Do only if the team has capacity.

⚠️ **All 3 tracks require:** functional demo with **no hard-coded values** · video or live demo · **in-person ENS booth Sunday morning** (mandatory). The read-through resolver satisfies "no hard-coded" by construction.

---

## 8. Gotchas / pre-event decisions
- **Register the demo tenant name (`passportkit.eth`) on Eth Sepolia BEFORE Friday** (commit-reveal, ~2 tx + test ETH). Setup, not feature code. (In the kit, each tenant brings/owns their own name.)
- Frontend/gated app read on **Ethereum Sepolia** (right client).
- **Fallback (if the custom resolver stalls):** subname + static `setText` + a `RevocationSet` listener in the backend calling `setText("REVOKED")`. Works, but it's push-based and costs gas. **Only if needed.**
- If time really gets tight: 1 demo subname + read-through resolver already proves everything (no need for N users).

---

## 9. New vs. reused / IP
- **New (Lisbon):** `PassportResolver` (tenant-aware) + `PassportSubnameRegistrar` + the subname wiring, from scratch, Apache-2.0.
- **Reused:** nothing from production (our production stack does no ENS).
- On-chain: status/hash only. No PII.
