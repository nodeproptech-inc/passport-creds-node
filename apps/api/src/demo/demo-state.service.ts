import { Injectable } from '@nestjs/common';
import { getAddress, keccak256, toHex, type Address } from 'viem';

export type DemoPersonhoodStatus = 'UNVERIFIED' | 'VERIFIED';

/**
 * Local-only state used when contracts and credentials have not been deployed.
 * It is intentionally in-memory: nothing here is an on-chain attestation.
 */
@Injectable()
export class DemoStateService {
  private readonly identities = new Map<string, Address>();
  private readonly personhood = new Map<string, DemoPersonhoodStatus>();

  get enabled(): boolean {
    return process.env.DEMO_MODE === 'true';
  }

  identityFor(wallet: Address): Address | null {
    return this.identities.get(wallet.toLowerCase()) ?? null;
  }

  createIdentity(wallet: Address): Address {
    const key = wallet.toLowerCase();
    const existing = this.identities.get(key);
    if (existing) return existing;

    // A deterministic display-only address; it is never deployed or submitted to a chain.
    const hash = keccak256(toHex(`passportkit-demo:${key}`));
    const identity = getAddress(`0x${hash.slice(-40)}`) as Address;
    this.identities.set(key, identity);
    return identity;
  }

  personhoodFor(wallet: Address): DemoPersonhoodStatus {
    return this.personhood.get(wallet.toLowerCase()) ?? 'UNVERIFIED';
  }

  markPersonhoodVerified(wallet: Address): void {
    this.personhood.set(wallet.toLowerCase(), 'VERIFIED');
  }
}
