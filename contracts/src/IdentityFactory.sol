// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Identity} from "./Identity.sol";

/**
 * @title IdentityFactory
 * @notice Creates one Identity per wallet and resolves wallet → identity.
 *         `identityOfWallet` is what the token + hook use to find a wallet's identity.
 *
 * For the MVP the backend (AGENT_ROLE) creates the identity after Privy login + proof of wallet
 * ownership off-chain. The wallet becomes the MANAGEMENT key of its own identity.
 */
contract IdentityFactory is AccessControl {
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");

    address public immutable issuerRegistry;
    mapping(address => address) public identityOfWallet; // wallet => identity (person OR agent)
    mapping(address => bool) public isIdentity;          // identity we minted (guards linkAgent)
    mapping(address => bool) public isAgent;             // wallet linked AS an agent (guards unlinkAgent)

    event IdentityCreated(address indexed wallet, address indexed identity);
    event AgentLinked(address indexed agentWallet, address indexed personIdentity);
    event AgentUnlinked(address indexed agentWallet, address indexed personIdentity);

    error ZeroAdmin();
    error ZeroIssuerRegistry();
    error ZeroWallet();
    error IdentityExists();
    error ZeroAgent();
    error NotAnIdentity();
    error WalletInUse();
    error NotLinked();

    constructor(address admin, address issuerRegistry_) {
        if (admin == address(0)) revert ZeroAdmin();
        if (issuerRegistry_ == address(0)) revert ZeroIssuerRegistry();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(AGENT_ROLE, admin);
        issuerRegistry = issuerRegistry_;
    }

    function createIdentity(address wallet) external onlyRole(AGENT_ROLE) returns (address identity) {
        if (wallet == address(0)) revert ZeroWallet();
        if (identityOfWallet[wallet] != address(0)) revert IdentityExists();
        identity = address(new Identity(wallet, issuerRegistry));
        identityOfWallet[wallet] = identity;
        isIdentity[identity] = true;
        emit IdentityCreated(wallet, identity);
    }

    /// @notice Model A (agent delegation): point an agent wallet at an EXISTING person's identity,
    ///         WITHOUT minting a new one. The agent holds no claims of its own — every enforcement
    ///         surface resolves `agentWallet → personIdentity → isEligible`, so the agent inherits
    ///         100% of the person's compliance. Revoke the person → all their agents flip at once.
    /// @dev    MVP: backend (AGENT_ROLE) calls this after the person authorizes the spawn off-chain
    ///         (Privy-authenticated). Roadmap: gate behind the person's management-key EIP-712 sig.
    function linkAgent(address agentWallet, address personIdentity) external onlyRole(AGENT_ROLE) {
        if (agentWallet == address(0)) revert ZeroAgent();
        if (!isIdentity[personIdentity]) revert NotAnIdentity();        // no pointing at garbage
        if (identityOfWallet[agentWallet] != address(0)) revert WalletInUse(); // not a person nor agent
        identityOfWallet[agentWallet] = personIdentity;
        isAgent[agentWallet] = true;
        emit AgentLinked(agentWallet, personIdentity);
    }

    /// @notice Surgical lever: disown ONE agent without touching the person or their other agents.
    ///         The wallet resolves to address(0) again → every surface refuses it.
    /// @dev    Guarded by `isAgent`, so it can ONLY unlink wallets linked as agents — never a person's
    ///         own wallet (which would erase their wallet→identity resolution and brick every surface).
    function unlinkAgent(address agentWallet) external onlyRole(AGENT_ROLE) {
        if (!isAgent[agentWallet]) revert NotLinked();     // person wallets / unknown wallets rejected
        address id = identityOfWallet[agentWallet];
        identityOfWallet[agentWallet] = address(0);
        isAgent[agentWallet] = false;
        emit AgentUnlinked(agentWallet, id);
    }
}
