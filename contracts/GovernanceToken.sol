// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title GovernanceToken
 * @notice Simple ERC20 used for DAO participation. 1 token is a membership ticket, not vote weight.
 */
contract GovernanceToken is ERC20, Ownable {
    constructor() ERC20("Aid Governance Token", "AGOV") {}

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
