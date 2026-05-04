// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {InteroperableAddress} from "@openzeppelin/contracts/utils/draft-InteroperableAddress.sol";
import {IResolver, Step, Attribute, Formula, Payment, VariableRole, Argument} from "../../ERC7683.sol";

// Payload-driven resolver for a simple two-chain token swap:
// 1. Submit an ERC-2612 permit for the user's source-chain tokens.
// 2. Transfer destination-chain tokens from the solver to the user.
// 3. Claim source-chain tokens from the user with transferFrom.
// This is not a secure protocol as there is no escrow!
contract Resolver is IResolver {
    struct Payload {
        uint256 sourceChain;
        address sourceToken;
        uint256 destinationChain;
        address destinationToken;
        address user;
        address solver;
        uint256 amount;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    function resolve(bytes calldata payload) external pure returns (ResolvedOrder memory order) {
        Payload memory p = abi.decode(payload, (Payload));

        bytes memory sourceToken = InteroperableAddress.formatEvmV1(p.sourceChain, p.sourceToken);
        bytes memory destinationToken = InteroperableAddress.formatEvmV1(p.destinationChain, p.destinationToken);

        uint256 varCount = 0;
        uint256 paymentRecipient = varCount++;

        order.variables = new bytes[](varCount);
        order.variables[paymentRecipient] = VariableRole.PaymentRecipient();
        order.steps = new bytes[](3);
        order.payments = new bytes[](1);
        order.payments[0] = Payment.ERC20(
            sourceToken,
            InteroperableAddress.formatEvmV1(p.sourceChain, p.user),
            Formula.Constant(p.amount),
            paymentRecipient,
            2,
            0
        );
        order.assumptions = new Assumption[](0);

        bytes[] memory step0Arguments = new bytes[](7);
        step0Arguments[0] = Argument.ConstAddress(p.user);
        step0Arguments[1] = Argument.ConstAddress(p.solver);
        step0Arguments[2] = Argument.ConstUint256(p.amount);
        step0Arguments[3] = Argument.ConstUint256(p.deadline);
        step0Arguments[4] = Argument.ConstUint8(p.v);
        step0Arguments[5] = Argument.ConstBytes32(p.r);
        step0Arguments[6] = Argument.ConstBytes32(p.s);

        bytes[] memory step0Attributes = new bytes[](1);
        step0Attributes[0] = Attribute.RevertPolicy("abort", "");

        order.steps[0] = Step.Call(
            sourceToken,
            IERC20Permit.permit.selector,
            step0Arguments,
            step0Attributes
        );

        bytes[] memory step1Arguments = new bytes[](2);
        step1Arguments[0] = Argument.ConstAddress(p.user);
        step1Arguments[1] = Argument.ConstUint256(p.amount);

        bytes[] memory step1Attributes = new bytes[](2);
        step1Attributes[0] = Attribute.NeedsStep(0);
        step1Attributes[1] = Attribute.SpendsERC20(
            destinationToken,
            Formula.Constant(p.amount),
            InteroperableAddress.formatEvmV1(p.destinationChain, p.solver),
            InteroperableAddress.formatEvmV1(p.destinationChain, p.user)
        );

        order.steps[1] = Step.Call(
            destinationToken,
            IERC20.transfer.selector,
            step1Arguments,
            step1Attributes
        );

        bytes[] memory step2Arguments = new bytes[](3);
        step2Arguments[0] = Argument.ConstAddress(p.user);
        step2Arguments[1] = Argument.Variable(paymentRecipient);
        step2Arguments[2] = Argument.ConstUint256(p.amount);

        bytes[] memory step2Attributes = new bytes[](2);
        step2Attributes[0] = Attribute.NeedsStep(0);
        step2Attributes[1] = Attribute.SpendsGas(Formula.Constant(100_000));

        order.steps[2] = Step.Call(
            sourceToken,
            IERC20.transferFrom.selector,
            step2Arguments,
            step2Attributes
        );
    }
}
