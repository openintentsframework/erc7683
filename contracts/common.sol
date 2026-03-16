// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IResolver {
    struct ResolvedOrder {
        bytes[] steps;
        bytes[] variables;
        Assumption[] assumptions;
        bytes[] payments;
    }

    struct Assumption {
        bytes trusted;
        string kind;
    }

    function resolve(bytes calldata payload) external view returns (ResolvedOrder memory);
}

interface ISteps {
    function Call(
        bytes calldata target,
        bytes4 selector,
        bytes[] calldata arguments,
        bytes[] calldata attributes,
        bytes[] calldata payments
    ) external;
}

library Steps {
    function Call(
        bytes memory target,
        bytes4 selector,
        bytes[] memory arguments,
        bytes[] memory attributes,
        bytes[] memory payments
    ) internal pure returns (bytes memory) {
        return abi.encodeCall(ISteps.Call, (target, selector, arguments, attributes, payments));
    }
}
