// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {InteroperableAddress} from "@openzeppelin/contracts/utils/draft-InteroperableAddress.sol";
import {IResolver, Step, Attribute, VariableRole, Formula, Argument} from "../ERC7683.sol";
import {BasicTarget} from "../common.sol";

// Two-step resolver that demonstrates variables and execution outputs. Step 0 calls
// BasicTarget.run("hello", 42) and captures block.timestamp as a variable. Step 1
// calls the same function but passes the captured timestamp as the second argument.
contract Resolver is IResolver {
    address immutable target;

    constructor() {
        target = address(new BasicTarget());
    }

    function resolve(bytes calldata payload) external view returns (ResolvedOrder memory order) {
        require(payload.length == 0);

        uint256 varCount = 0;
        uint256 step0_timestamp = varCount++;

        bytes[] memory variables = new bytes[](varCount);
        variables[step0_timestamp] = VariableRole.ExecutionOutput("block.timestamp", 0);

        bytes[] memory step0_arguments = new bytes[](2);
        step0_arguments[0] = Argument.String("hello");
        step0_arguments[1] = Argument.Uint256(42);

        order.steps = new bytes[](2);
        order.steps[0] = Step.Call(
            InteroperableAddress.formatEvmV1(block.chainid, target),
            BasicTarget.run.selector,
            step0_arguments,
            new bytes[](0)
        );

        bytes[] memory step1_arguments = new bytes[](2);
        step1_arguments[0] = Argument.String("hello");
        step1_arguments[1] = Argument.Variable(step0_timestamp);

        bytes[] memory step1_attributes = new bytes[](1);
        step1_attributes[0] = Attribute.SpendsGas(Formula.Constant(100_000));

        order.steps[1] = Step.Call(
            InteroperableAddress.formatEvmV1(block.chainid, target),
            BasicTarget.run.selector,
            step1_arguments,
            step1_attributes
        );
        order.variables = variables;
        order.assumptions = new Assumption[](0);
        order.payments = new bytes[](0);
    }
}
