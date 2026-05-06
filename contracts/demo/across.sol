// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SpokePool} from "across/contracts/spoke-pools/SpokePool.sol";

contract RevertingWrappedNative {
    fallback() external payable {
        revert("unused");
    }
}

contract DemoSpokePool is SpokePool {
    event BridgedToHubPool(uint256 amount, address token);

    constructor() SpokePool(address(new RevertingWrappedNative()), 1 hours, 9 hours, 0, 0) {}

    function initialize(uint32 initialDepositId, address crossDomainAdmin, address withdrawalRecipient) public initializer {
        __SpokePool_init(initialDepositId, crossDomainAdmin, withdrawalRecipient);
    }

    function _bridgeTokensToHubPool(uint256 amountToReturn, address l2TokenAddress) internal override {
        emit BridgedToHubPool(amountToReturn, l2TokenAddress);
    }

    function _requireAdminSender() internal view override {
        require(msg.sender == crossDomainAdmin);
    }
}
