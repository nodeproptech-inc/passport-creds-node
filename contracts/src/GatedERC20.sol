// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

interface IEligibilityGate {
    function isEligible(address identity, uint256 policyId) external view returns (bool, bytes32);
}

interface IIdentityResolver {
    function identityOfWallet(address wallet) external view returns (address);
}

/**
 * @title GatedERC20  (transfer-gate surface)
 * @notice A permissioned ERC-20 whose _update consults the EligibilityGate. The 4th
 *         enforcement surface: the "transfer fails" of the money moment.
 *
 * Free-exit principle (unifies with the Uniswap hook):
 *   - mint (from == 0):   recipient `to` must be eligible
 *   - transfer:           BOTH `from` AND `to` must be eligible  (revoke -> your transfer fails)
 *   - burn (to == 0):     NO gate -- you can always exit/redeem, we never trap funds
 *
 * "Compliance blocks movement to a counterparty (transfer/swap), never your own exit (burn)."
 */
contract GatedERC20 is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    IEligibilityGate public immutable gate;
    IIdentityResolver public immutable resolver; // wallet -> identity
    uint256 public immutable policyId; // e.g. requires KYC_VERIFIED

    error NotEligible(address wallet, bytes32 reason);
    error ZeroGate();
    error ZeroResolver();
    error ZeroAdmin();

    constructor(
        string memory name_,
        string memory symbol_,
        address gate_,
        address resolver_,
        uint256 policyId_,
        address admin
    ) ERC20(name_, symbol_) {
        if (gate_ == address(0)) revert ZeroGate();
        if (resolver_ == address(0)) revert ZeroResolver();
        if (admin == address(0)) revert ZeroAdmin();

        gate = IEligibilityGate(gate_);
        resolver = IIdentityResolver(resolver_);
        policyId = policyId_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
    }

    /// @notice Mint gated to MINTER_ROLE (issuer/agent role).
    function mint(address to, uint256 amt) public onlyRole(MINTER_ROLE) {
        _mint(to, amt);
    }

    /// @notice Public burn — free exit. Holders can always redeem their own tokens.
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        bool isMint = from == address(0);
        bool isBurn = to == address(0);

        // real transfer (not mint, not burn): sender must be eligible -> "transfer fails" on revocation
        if (!isMint && !isBurn) _requireEligible(from);
        // mint or transfer: recipient must be eligible (parity with isVerified(to))
        if (!isBurn) _requireEligible(to);
        // burn (to == 0): NO check -> exit/redeem always free

        super._update(from, to, value);
    }

    function _requireEligible(address wallet) internal view {
        address identity = resolver.identityOfWallet(wallet);
        (bool ok, bytes32 reason) = gate.isEligible(identity, policyId);
        if (!ok) revert NotEligible(wallet, reason);
    }
}
