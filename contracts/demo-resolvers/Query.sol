// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {InteroperableAddress} from "@openzeppelin/contracts/utils/draft-InteroperableAddress.sol";
import {IResolver, Step, VariableRole, Argument} from "../ERC7683.sol";
import {BasicTarget} from "../common.sol";

// Demonstrates the Query variable role. BasicTarget has a magic value fixed at deployment
// and a checkMagic function that reverts if the wrong value is passed. The resolver has a
// wrappedMagic() getter that queries the target's magic and returns it in abi-wrapped format.
// The resolved order queries wrappedMagic() to populate a variable, then passes it to checkMagic.
contract Resolver is IResolver {
    BasicTarget immutable target;

    constructor() {
        target = new BasicTarget();
    }

    function wrappedMagic() external view returns (string memory, uint256 result) {
        result = target.magic();
    }

    function resolve(bytes calldata payload) external view returns (ResolvedOrder memory order) {
        require(payload.length == 0);

        bytes memory resolverAddr = InteroperableAddress.formatEvmV1(block.chainid, address(this));
        bytes memory targetAddr = InteroperableAddress.formatEvmV1(block.chainid, address(target));

        uint256 varCount = 0;
        uint256 magic = varCount++;

        bytes[] memory variables = new bytes[](varCount);
        variables[magic] = VariableRole.Query(
            resolverAddr,
            this.wrappedMagic.selector,
            new bytes[](0),
            type(uint256).max
        );

        bytes[] memory step0_arguments = new bytes[](1);
        step0_arguments[0] = Argument.Variable(magic);

        order.steps = new bytes[](1);
        order.steps[0] = Step.Call(
            targetAddr,
            BasicTarget.checkMagic.selector,
            step0_arguments,
            new bytes[](0)
        );
        order.variables = variables;
        order.assumptions = new Assumption[](0);
        order.payments = new bytes[](0);
    }
}
