// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {InteroperableAddress} from "@openzeppelin/contracts/utils/draft-InteroperableAddress.sol";
import {IResolver, Step, Argument} from "../../ERC7683.sol";
import {BasicTarget} from "../common.sol";

// A minimal resolver with a single step: calls BasicTarget.run("hello", 42) with no
// variables or attributes.
contract Resolver is IResolver {
    address immutable target;

    constructor() {
        target = address(new BasicTarget());
    }

    function resolve(bytes calldata payload) external view returns (ResolvedOrder memory order) {
        require(payload.length == 0);

        order.variables = new bytes[](0);
        order.assumptions = new Assumption[](0);
        order.payments = new bytes[](0);

        order.steps = new bytes[](1);

        bytes[] memory step0_arguments = new bytes[](2);
        step0_arguments[0] = Argument.ConstString("hello");
        step0_arguments[1] = Argument.ConstUint256(42);

        order.steps[0] = Step.Call(
            InteroperableAddress.formatEvmV1(block.chainid, target),
            BasicTarget.run.selector,
            step0_arguments,
            new bytes[](0)
        );
    }
}
