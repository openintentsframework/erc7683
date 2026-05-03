// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MockSpokePool} from "across/contracts/test/MockSpokePool.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts-v4/proxy/ERC1967/ERC1967Proxy.sol";

contract RevertingWrappedNative {
    fallback() external payable {
        revert("unused");
    }
}

contract DemoSpokePool is MockSpokePool {
    constructor() MockSpokePool(address(new RevertingWrappedNative())) {}
}
