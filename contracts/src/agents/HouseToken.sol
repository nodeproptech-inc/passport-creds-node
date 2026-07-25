// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title HouseToken
 * @notice ERC-20 house scrip. The concierge's routine budget is its balance.
 *         An allowance voucher, not money: only the house treasury mints, and the
 *         treasury can claw back (reclaim) at any time.
 */
contract HouseToken is ERC20 {
    error NotTreasury();

    address public immutable TREASURY;

    modifier onlyTreasury() {
        if (msg.sender != TREASURY) revert NotTreasury();
        _;
    }

    constructor(string memory name_, string memory symbol_, address treasury) ERC20(name_, symbol_) {
        TREASURY = treasury;
    }

    function mint(address to, uint256 amount) external onlyTreasury {
        _mint(to, amount);
    }

    function reclaim(address from, uint256 amount) external onlyTreasury {
        _burn(from, amount);
    }
}
