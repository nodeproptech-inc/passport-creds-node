// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ICompliancePassport {
    // Mirrors the backend passport status model exactly.
    // IN_PROGRESS exists for consistency but the chain mostly uses NONE/LIMITED/GREEN/RED.
    enum PassportStatus {
        NONE,
        IN_PROGRESS,
        LIMITED,
        GREEN,
        RED,
        REVOKED,
        EXPIRED
    }

    event PassportMinted(address indexed user, uint256 indexed tokenId, PassportStatus status);

    event PassportStatusUpdated(address indexed user, uint256 indexed tokenId, PassportStatus status);

    event PassportRevoked(address indexed user, uint256 indexed tokenId);

    // Called by CRE after writing claims to ClaimRegistry.
    // Mints a new passport if the user doesn't have one, otherwise updates status.
    function syncPassport(address user) external returns (uint256 tokenId, PassportStatus status);

    // Derives passport status from current claims in ClaimRegistry — does not write.
    function computeStatus(address user) external view returns (PassportStatus);

    function statusOf(address user) external view returns (PassportStatus);

    function tokenIdOf(address user) external view returns (uint256);

    function hasPassport(address user) external view returns (bool);

    // ERC5192 — always returns true for soulbound tokens.
    function locked(uint256 tokenId) external view returns (bool);
}
