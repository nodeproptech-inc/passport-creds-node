// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title IssuerRegistry
 * @notice Which issuers are trusted for which claim topics. A small set WE control.
 *
 * Why it matters for security: the EligibilityGate loops over `issuersForTopic(topic)` — a set
 * bounded by us — NOT over whatever claims land on a user's identity. So an attacker cannot make
 * the eligibility read expensive (they can't add trusted issuers). Griefing stays closed.
 */
contract IssuerRegistry is AccessControl {
    mapping(address => mapping(uint256 => bool)) private _trusted; // issuer => topic => trusted
    mapping(uint256 => address[]) private _issuers;                // topic => issuer list (enumerable)
    mapping(uint256 => mapping(address => uint256)) private _idx1; // topic => issuer => index+1

    event TrustedSet(address indexed issuer, uint256 indexed topic, bool ok);

    error ZeroAdmin();
    error ZeroIssuer();

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAdmin();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function isTrusted(address issuer, uint256 topic) external view returns (bool) {
        return _trusted[issuer][topic];
    }

    function issuersForTopic(uint256 topic) external view returns (address[] memory) {
        return _issuers[topic];
    }

    function setTrusted(address issuer, uint256 topic, bool ok) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (issuer == address(0)) revert ZeroIssuer();
        if (ok == _trusted[issuer][topic]) return; // no-op: don't emit a phantom state transition
        if (ok) {
            _trusted[issuer][topic] = true;
            _issuers[topic].push(issuer);
            _idx1[topic][issuer] = _issuers[topic].length; // index + 1
        } else {
            _trusted[issuer][topic] = false;
            _removeFromTopic(topic, issuer);
        }
        emit TrustedSet(issuer, topic, ok);
    }

    /// @dev swap-and-pop removal keeping the index map consistent.
    function _removeFromTopic(uint256 topic, address issuer) internal {
        uint256 i = _idx1[topic][issuer];
        if (i == 0) return;
        address[] storage arr = _issuers[topic];
        uint256 last = arr.length - 1;
        if (i - 1 != last) {
            address moved = arr[last];
            arr[i - 1] = moved;
            _idx1[topic][moved] = i;
        }
        arr.pop();
        _idx1[topic][issuer] = 0;
    }
}
