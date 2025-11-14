// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockSGD is ERC20 {
    constructor() ERC20("Mock SGD", "mSGD") {
        _mint(msg.sender, 1_000_000 ether); // Give deployer test supply
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
