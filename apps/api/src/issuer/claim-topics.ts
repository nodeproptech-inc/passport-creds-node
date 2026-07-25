import { keccak256, toHex } from 'viem';

/**
 * Claim topics = uint256(keccak256(name)).
 * MUST stay in sync with contracts/src/libraries/Types.sol (library ClaimTopics).
 */
export type ClaimTopicName = 'KYC_VERIFIED' | 'PROOF_OF_PERSONHOOD' | 'ACCREDITED_INVESTOR';

export function topicId(name: ClaimTopicName): bigint {
  return BigInt(keccak256(toHex(name)));
}

export const CLAIM_TOPICS: Record<ClaimTopicName, bigint> = {
  KYC_VERIFIED: topicId('KYC_VERIFIED'),
  PROOF_OF_PERSONHOOD: topicId('PROOF_OF_PERSONHOOD'),
  ACCREDITED_INVESTOR: topicId('ACCREDITED_INVESTOR'),
};
