// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IJobEscrow {
    function releasePayment() external;
    function claimAutoRelease() external;
}

contract MaliciousReentrancyAttacker {
    address public targetJob;
    bool public reentered;

    constructor(address _targetJob) {
        targetJob = _targetJob;
    }

    receive() external payable {
        if (!reentered) {
            reentered = true;
            // Attempt reentrancy attack back into releasePayment or claimAutoRelease
            try IJobEscrow(targetJob).releasePayment() {} catch {}
        }
    }

    function setTarget(address _targetJob) external {
        targetJob = _targetJob;
    }
}
