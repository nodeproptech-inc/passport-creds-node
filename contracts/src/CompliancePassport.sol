// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IClaimRegistry} from "./interfaces/IClaimRegistry.sol";
import {ICompliancePassport} from "./interfaces/ICompliancePassport.sol";

/**
 * @title CompliancePassport
 * @notice ERC721 + ERC5192 soulbound Compliance Passport for PassportCreds by Node.
 *
 * Each wallet gets at most one passport token. The token is non-transferable (soulbound).
 * Passport status is derived from claims stored in ClaimRegistry — it does not duplicate claim data.
 *
 * Status rules:
 *   REVOKED  — admin revoked this wallet's passport
 *   RED      — KYC_AML_VERIFIED = FAILED or REVOKED
 *   GREEN    — KYC_AML_VERIFIED = valid AND ACCREDITED_INVESTOR = valid
 *   LIMITED  — KYC_AML_VERIFIED = valid, ACCREDITED_INVESTOR missing or failed
 *   NONE     — no valid claims
 *
 * CRE calls syncPassport after every successful ClaimRegistry.submitClaim.
 */
contract CompliancePassport is ICompliancePassport, ERC721, AccessControl {
    bytes32 public constant CRE_UPDATER_ROLE = keccak256("CRE_UPDATER_ROLE");
    bytes32 public constant ISSUER_ADMIN_ROLE = keccak256("ISSUER_ADMIN_ROLE");

    // ERC5192 event — emitted once on mint to signal the token is locked.
    event Locked(uint256 tokenId);

    IClaimRegistry public immutable CLAIM_REGISTRY;

    uint256 private _nextTokenId;

    // user => tokenId (0 means no passport)
    mapping(address => uint256) private _tokenOf;

    // tokenId => status
    mapping(uint256 => PassportStatus) private _statusOf;

    // wallets with a manually revoked passport
    mapping(address => bool) public revokedWallet;

    constructor(address admin, address claimRegistryAddress) ERC721("PassportCreds by Node", "PCP") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ISSUER_ADMIN_ROLE, admin);
        CLAIM_REGISTRY = IClaimRegistry(claimRegistryAddress);
        _nextTokenId = 1;
    }

    /**
     * @notice Syncs passport status from ClaimRegistry. Mints a new token if needed.
     * @dev Called by CRE after writing a claim. Only CRE_UPDATER_ROLE.
     * @param user Wallet whose passport should be synced.
     * @return tokenId The passport token ID (new or existing).
     * @return status  The updated passport status.
     */
    function syncPassport(address user)
        external
        override
        onlyRole(CRE_UPDATER_ROLE)
        returns (uint256 tokenId, PassportStatus status)
    {
        status = computeStatus(user);

        if (_tokenOf[user] == 0) {
            // First sync — mint the passport
            tokenId = _nextTokenId++;
            _tokenOf[user] = tokenId;
            _statusOf[tokenId] = status;
            _mint(user, tokenId);
            emit Locked(tokenId);
            emit PassportMinted(user, tokenId, status);
        } else {
            tokenId = _tokenOf[user];
            _statusOf[tokenId] = status;
            emit PassportStatusUpdated(user, tokenId, status);
        }
    }

    /**
     * @notice Derives passport status from current ClaimRegistry state. Pure read — no writes.
     * @dev Revocation check takes precedence over everything else.
     */
    function computeStatus(address user) public view override returns (PassportStatus) {
        if (revokedWallet[user]) return PassportStatus.REVOKED;

        IClaimRegistry.ClaimStatus kyc =
            CLAIM_REGISTRY.getClaimStatus(user, keccak256("KYC_AML_VERIFIED"));
        IClaimRegistry.ClaimStatus accredited =
            CLAIM_REGISTRY.getClaimStatus(user, keccak256("ACCREDITED_INVESTOR"));

        // A failed or revoked KYC/AML claim is a hard block
        if (
            kyc == IClaimRegistry.ClaimStatus.FAILED
                || kyc == IClaimRegistry.ClaimStatus.REVOKED
        ) {
            return PassportStatus.RED;
        }

        bool kycValid = CLAIM_REGISTRY.hasValidClaim(user, keccak256("KYC_AML_VERIFIED"));
        bool accreditedValid = CLAIM_REGISTRY.hasValidClaim(user, keccak256("ACCREDITED_INVESTOR"));

        if (kycValid && accreditedValid) return PassportStatus.GREEN;
        if (kycValid) return PassportStatus.LIMITED;

        // Accreditation failure alone does not produce RED — only LIMITED or NONE
        if (
            accredited == IClaimRegistry.ClaimStatus.FAILED
                || accredited == IClaimRegistry.ClaimStatus.REVOKED
        ) {
            return PassportStatus.NONE;
        }

        return PassportStatus.NONE;
    }

    /**
     * @notice Returns the current passport status for a wallet.
     * @dev Reads from stored status — reflects the last syncPassport call, not live claims.
     *      For live status, use computeStatus.
     */
    function statusOf(address user) external view override returns (PassportStatus) {
        uint256 tokenId = _tokenOf[user];
        if (tokenId == 0) return PassportStatus.NONE;
        return _statusOf[tokenId];
    }

    /**
     * @notice Returns the token ID for a wallet. Returns 0 if no passport exists.
     */
    function tokenIdOf(address user) external view override returns (uint256) {
        return _tokenOf[user];
    }

    /**
     * @notice Returns true if the wallet has a minted passport token.
     */
    function hasPassport(address user) external view override returns (bool) {
        return _tokenOf[user] != 0;
    }

    /**
     * @notice ERC5192 — all passport tokens are permanently locked (soulbound).
     */
    function locked(uint256 tokenId) external view override returns (bool) {
        require(_ownerOf(tokenId) != address(0), "CompliancePassport: token does not exist");
        return true;
    }

    /**
     * @notice Revokes a wallet's passport. Only ISSUER_ADMIN_ROLE.
     * @dev Sets revokedWallet flag. Next syncPassport call will write REVOKED status onchain.
     */
    function revokePassport(address user) external onlyRole(ISSUER_ADMIN_ROLE) {
        require(_tokenOf[user] != 0, "CompliancePassport: no passport to revoke");
        revokedWallet[user] = true;
        uint256 tokenId = _tokenOf[user];
        _statusOf[tokenId] = PassportStatus.REVOKED;
        emit PassportRevoked(user, tokenId);
    }

    // --- ERC721 transfer block (soulbound) ---

    /**
     * @dev Reverts any transfer between two non-zero addresses.
     *      Mint (from == 0) is allowed. Burn (to == 0) is allowed if implemented later.
     */
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        require(from == address(0) || to == address(0), "CompliancePassport: soulbound, transfers disabled");
        return super._update(to, tokenId, auth);
    }

    // --- ERC165 supportsInterface ---

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, AccessControl)
        returns (bool)
    {
        // ERC5192 interface ID: 0xb45a3c0e
        return interfaceId == 0xb45a3c0e || super.supportsInterface(interfaceId);
    }
}
