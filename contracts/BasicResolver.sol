// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {InteroperableAddress} from "@openzeppelin/contracts/utils/draft-InteroperableAddress.sol";
import {IResolver, Steps} from "./common.sol";

contract BasicResolver is IResolver {
    uint256 immutable chainId;
    address immutable target;

    constructor() {
        chainId = block.chainid;
        target = address(new BasicTarget());
    }

    function resolve(bytes calldata payload) external view returns (ResolvedOrder memory order) {
        require(payload.length == 0);

        bytes[] memory arguments = new bytes[](2);
        arguments[0] = abi.encode("", "hello");
        arguments[1] = abi.encode("", 42);

        order.steps = new bytes[](1);
        order.steps[0] = Steps.Call(
            InteroperableAddress.formatEvmV1(chainId, target),
            BasicTarget.run.selector,
            arguments,
            new bytes[](0),
            new bytes[](0)
        );
        order.variables = new bytes[](0);
        order.assumptions = new Assumption[](0);
        order.payments = new bytes[](0);
    }
}

contract BasicTarget {
    function run(string calldata, uint256) external pure {}
}
