// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {InteroperableAddress} from "@openzeppelin/contracts/utils/draft-InteroperableAddress.sol";
import {IResolver, Step, Attribute, VariableRole, Formula} from "./common.sol";

contract BasicResolver is IResolver {
    uint256 immutable chainId;
    address immutable target;

    constructor() {
        chainId = block.chainid;
        target = address(new BasicTarget());
    }

    function resolve(bytes calldata payload) external view returns (ResolvedOrder memory order) {
        require(payload.length == 0);

        uint256 freeVar = 0;
        uint256 step0_timestamp = freeVar++;

        bytes[] memory variables = new bytes[](freeVar);
        variables[step0_timestamp] = VariableRole.ExecutionOutput();

        bytes[] memory step0_arguments = new bytes[](2);
        step0_arguments[0] = abi.encode("", "hello");
        step0_arguments[1] = abi.encode("", 42);

        bytes[] memory step0_attributes = new bytes[](1);
        step0_attributes[0] = Attribute.Outputs("block.timestamp", step0_timestamp, "", "");

        order.steps = new bytes[](2);
        order.steps[0] = Step.Call(
            InteroperableAddress.formatEvmV1(chainId, target),
            BasicTarget.run.selector,
            step0_arguments,
            step0_attributes,
            new bytes[](0)
        );

        bytes[] memory step1_arguments = new bytes[](2);
        step1_arguments[0] = abi.encode("", "hello");
        step1_arguments[1] = abi.encode(step0_timestamp);

        bytes[] memory step1_attributes = new bytes[](1);
        step1_attributes[0] = Attribute.SpendsGas(Formula.Constant(100_000));

        order.steps[1] = Step.Call(
            InteroperableAddress.formatEvmV1(chainId, target),
            BasicTarget.run.selector,
            step1_arguments,
            step1_attributes,
            new bytes[](0)
        );
        order.variables = variables;
        order.assumptions = new Assumption[](0);
        order.payments = new bytes[](0);
    }
}

contract BasicTarget {
    function run(string calldata, uint256) external pure {}
}
