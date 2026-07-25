// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title ScoreRegistry
 * @notice Minimal per-agent reputation store — a stand-in for an ERC-8004 reputation registry.
 *
 * DEMO: scores are set manually here by an account with SCORER_ROLE. A real deployment feeds this
 * from off-chain behavior — the subgraph risk-signal — or an ERC-8004 reputation registry, and this
 * contract (or an adapter) becomes the on-chain source.
 *
 * Surfaced via ENS: `PassportResolver` reads `scoreOf(agent)` to serve the live text record
 * `agent.reputation[<agent>]`, so any client can read an agent's score with one standard ENS lookup.
 */
contract ScoreRegistry is AccessControl {
    bytes32 public constant SCORER_ROLE = keccak256("SCORER_ROLE");

    mapping(address => uint256) public scoreOf; // agent wallet => reputation score

    event ScoreSet(address indexed agent, uint256 score);

    error ZeroAdmin();

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAdmin();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(SCORER_ROLE, admin);
    }

    /// @notice Set (or update) an agent's reputation score. DEMO: called manually; production: fed
    ///         by the off-chain reputation pipeline (subgraph / ERC-8004).
    function setScore(address agent, uint256 score) external onlyRole(SCORER_ROLE) {
        scoreOf[agent] = score;
        emit ScoreSet(agent, score);
    }
}
