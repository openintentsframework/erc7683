// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {InteroperableAddress} from "@openzeppelin/contracts/utils/draft-InteroperableAddress.sol";
import {IResolver, Step, Attribute, VariableRole, Formula, Argument} from "../ERC7683.sol";
import {BasicTarget} from "../common.sol";

// Single-step resolver that calls checkTimestamp with a timestamp 2 seconds in the future.
// checkTimestamp requires block.timestamp >= argument, so the transaction must wait
// before it can succeed. An Outputs attribute with a lowerBound tells the filler to wait.
contract Resolver is IResolver {
    address immutable target;

    constructor() {
        target = address(new BasicTarget());
    }

    function resolve(bytes calldata payload) external view returns (ResolvedOrder memory order) {
        require(payload.length == 0);

        uint256 targetTimestamp = block.timestamp + 2;

        uint256 varCount = 0;
        uint256 step0_timestamp = varCount++;

        bytes[] memory variables = new bytes[](varCount);
        variables[step0_timestamp] = VariableRole.ExecutionOutput();

        bytes[] memory step0_arguments = new bytes[](1);
        step0_arguments[0] = Argument.Uint256(targetTimestamp);

        bytes[] memory step0_attributes = new bytes[](2);
        step0_attributes[0] = Attribute.Outputs({
            field: "block.timestamp",
            varIdx: step0_timestamp,
            lowerBound: Formula.Constant(targetTimestamp),
            upperBound: ""
        });
        step0_attributes[1] = Attribute.SpendsGas(Formula.Constant(100_000));

        order.steps = new bytes[](1);
        order.steps[0] = Step.Call(
            InteroperableAddress.formatEvmV1(block.chainid, target),
            BasicTarget.checkTimestamp.selector,
            step0_arguments,
            step0_attributes
        );
        order.variables = variables;
        order.assumptions = new Assumption[](0);
        order.payments = new bytes[](0);
    }
}
