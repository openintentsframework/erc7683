// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {InteroperableAddress} from "@openzeppelin/contracts/utils/draft-InteroperableAddress.sol";
import {IResolver, Step, Attribute, Formula, Payment, VariableRole, Argument} from "../../ERC7683.sol";

function computeDutchAmount(
    uint256 startTimestamp,
    uint256 startAmount,
    uint256 minAmount,
    uint256 decreasePerSecond,
    uint256 timestamp
) pure returns (uint256) {
    if (timestamp <= startTimestamp) {
        return startAmount;
    }

    uint256 discount = (timestamp - startTimestamp) * decreasePerSecond;
    return discount >= startAmount - minAmount ? minAmount : startAmount - discount;
}

contract DutchAuctionTarget {
    // At execution time the token amount is determined by the actual block
    // timestamp, so a solver cannot know the exact spend before inclusion.
    function fill(
        address token,
        address recipient,
        uint256 startTimestamp,
        uint256 startAmount,
        uint256 minAmount,
        uint256 decreasePerSecond
    ) external {
        IERC20(token).transferFrom(
            msg.sender,
            recipient,
            computeDutchAmount(startTimestamp, startAmount, minAmount, decreasePerSecond, block.timestamp)
        );
    }
}

contract Resolver is IResolver {
    struct Payload {
        uint256 chainId;
        address token;
        address user;
        uint256 startTimestamp;
        uint256 startAmount;
        uint256 minAmount;
        uint256 decreasePerSecond;
        uint256 paymentAmount;
    }

    address immutable target;

    constructor(address target_) {
        target = target_;
    }

    function queryDutchAmount(
        uint256 timestamp,
        uint256 startTimestamp,
        uint256 startAmount,
        uint256 minAmount,
        uint256 decreasePerSecond
    ) external pure returns (string memory empty, uint256 amount) {
        // Query variable used by SpendsERC20 to describe the same amount that
        // DutchAuctionTarget will compute from the realized execution timestamp.
        empty = "";
        amount = computeDutchAmount(startTimestamp, startAmount, minAmount, decreasePerSecond, timestamp);
    }

    function resolve(bytes calldata payload) external view returns (ResolvedOrder memory order) {
        Payload memory p = abi.decode(payload, (Payload));

        bytes memory resolverAddr = InteroperableAddress.formatEvmV1(block.chainid, address(this));
        bytes memory targetAddr = InteroperableAddress.formatEvmV1(p.chainId, target);
        bytes memory token = InteroperableAddress.formatEvmV1(p.chainId, p.token);

        uint256 varCount = 0;
        uint256 paymentRecipient = varCount++;
        uint256 step0Timestamp = varCount++;
        uint256 dutchAmount = varCount++;

        order.variables = new bytes[](varCount);
        order.variables[paymentRecipient] = VariableRole.PaymentRecipient();

        // This output is only known after step 0 executes. The spend formula
        // below depends on it, but that dependency is soft: it should affect
        // quote-time bidding, not create a hard pre-execution dependency.
        order.variables[step0Timestamp] = VariableRole.ExecutionOutput("block.timestamp", 0);

        bytes[] memory dutchAmountArguments = new bytes[](5);
        dutchAmountArguments[0] = Argument.Variable(step0Timestamp);
        dutchAmountArguments[1] = Argument.ConstUint256(p.startTimestamp);
        dutchAmountArguments[2] = Argument.ConstUint256(p.startAmount);
        dutchAmountArguments[3] = Argument.ConstUint256(p.minAmount);
        dutchAmountArguments[4] = Argument.ConstUint256(p.decreasePerSecond);
        order.variables[dutchAmount] = VariableRole.Query(
            resolverAddr,
            this.queryDutchAmount.selector,
            dutchAmountArguments,
            type(uint256).max
        );

        order.payments = new bytes[](1);
        order.payments[0] = Payment.ERC20(
            token,
            InteroperableAddress.formatEvmV1(p.chainId, p.user),
            Formula.Constant(p.paymentAmount),
            paymentRecipient,
            0,
            0
        );

        bytes[] memory step0Arguments = new bytes[](6);
        step0Arguments[0] = Argument.ConstAddress(p.token);
        step0Arguments[1] = Argument.ConstAddress(p.user);
        step0Arguments[2] = Argument.ConstUint256(p.startTimestamp);
        step0Arguments[3] = Argument.ConstUint256(p.startAmount);
        step0Arguments[4] = Argument.ConstUint256(p.minAmount);
        step0Arguments[5] = Argument.ConstUint256(p.decreasePerSecond);

        bytes[] memory step0Attributes = new bytes[](1);
        // The amount is f(step0Timestamp). A Dutch auction-aware solver should
        // choose a target timestamp during quote, evaluate this amount at that
        // target, and then avoid executing before that target.
        step0Attributes[0] = Attribute.SpendsERC20(
            token,
            Formula.Variable(dutchAmount),
            targetAddr,
            InteroperableAddress.formatEvmV1(p.chainId, p.user)
        );

        order.steps = new bytes[](1);
        order.steps[0] = Step.Call(
            targetAddr,
            DutchAuctionTarget.fill.selector,
            step0Arguments,
            step0Attributes
        );

        order.assumptions = new Assumption[](0);
    }
}
