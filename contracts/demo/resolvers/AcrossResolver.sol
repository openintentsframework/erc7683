// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {V3SpokePoolInterface} from "across/contracts/interfaces/V3SpokePoolInterface.sol";
import {InteroperableAddress} from "@openzeppelin/contracts/utils/draft-InteroperableAddress.sol";
import {IResolver, Step, Attribute, Formula, Payment, VariableRole, Argument} from "../../ERC7683.sol";

contract Resolver is IResolver {
    uint256 internal constant REPAYMENT_DELAY_SECONDS = 2 hours;

    mapping(uint256 chainId => address spokePool) public spokePools;

    struct Payload {
        uint256 originChainId;
        uint256 destinationChainId;
        address depositor;
        address recipient;
        address exclusiveRelayer;
        address inputToken;
        address outputToken;
        uint256 inputAmount;
        uint256 outputAmount;
        uint32 depositId;
        uint32 fillDeadline;
        uint32 exclusivityDeadline;
        bytes message;
    }

    constructor(uint256[] memory chainIds, address[] memory spokePools_) {
        require(chainIds.length == spokePools_.length);
        for (uint256 i = 0; i < chainIds.length; i++) {
            spokePools[chainIds[i]] = spokePools_[i];
        }
    }

    function resolve(bytes calldata payload) external view returns (ResolvedOrder memory order) {
        Payload memory p = abi.decode(payload, (Payload));
        address destinationSpokePool = spokePools[p.destinationChainId];
        address originSpokePool = spokePools[p.originChainId];
        require(destinationSpokePool != address(0));
        require(originSpokePool != address(0));

        bytes memory inputToken = InteroperableAddress.formatEvmV1(p.originChainId, p.inputToken);
        bytes memory outputToken = InteroperableAddress.formatEvmV1(p.destinationChainId, p.outputToken);

        uint256 varCount = 0;
        uint256 paymentRecipient = varCount++;

        order.variables = new bytes[](varCount);
        order.variables[paymentRecipient] = VariableRole.PaymentRecipient();

        order.payments = new bytes[](1);
        order.payments[0] = Payment.ERC20(
            inputToken,
            InteroperableAddress.formatEvmV1(p.originChainId, originSpokePool),
            Formula.Constant(p.inputAmount),
            paymentRecipient,
            0,
            REPAYMENT_DELAY_SECONDS
        );

        order.assumptions = new Assumption[](0);

        order.steps = new bytes[](1);

        bytes[] memory step0Arguments = new bytes[](3);
        step0Arguments[0] = abi.encode("", _relayData(p));
        step0Arguments[1] = Argument.Uint256(p.originChainId);
        step0Arguments[2] = Argument.Variable(paymentRecipient);

        bytes[] memory step0Attributes = new bytes[](4);
        step0Attributes[0] = Attribute.SpendsERC20(
            outputToken,
            Formula.Constant(p.outputAmount),
            InteroperableAddress.formatEvmV1(p.destinationChainId, p.exclusiveRelayer),
            InteroperableAddress.formatEvmV1(p.destinationChainId, p.recipient)
        );
        step0Attributes[1] = Attribute.RevertPolicy(
            "abort",
            bytes.concat(V3SpokePoolInterface.NotExclusiveRelayer.selector)
        );
        step0Attributes[2] = Attribute.RevertPolicy(
            "abort",
            bytes.concat(V3SpokePoolInterface.RelayFilled.selector)
        );
        step0Attributes[3] = Attribute.TimingBounds(
            "block.timestamp",
            "",
            Formula.Constant(p.fillDeadline)
        );

        order.steps[0] = Step.Call(
            InteroperableAddress.formatEvmV1(p.destinationChainId, destinationSpokePool),
            V3SpokePoolInterface.fillRelay.selector,
            step0Arguments,
            step0Attributes
        );
    }

    function _relayData(Payload memory p) private pure returns (V3SpokePoolInterface.V3RelayData memory) {
        return V3SpokePoolInterface.V3RelayData({
            depositor: bytes32(uint256(uint160(p.depositor))),
            recipient: bytes32(uint256(uint160(p.recipient))),
            exclusiveRelayer: bytes32(uint256(uint160(p.exclusiveRelayer))),
            inputToken: bytes32(uint256(uint160(p.inputToken))),
            outputToken: bytes32(uint256(uint160(p.outputToken))),
            inputAmount: p.inputAmount,
            outputAmount: p.outputAmount,
            originChainId: p.originChainId,
            depositId: p.depositId,
            fillDeadline: p.fillDeadline,
            exclusivityDeadline: p.exclusivityDeadline,
            message: p.message
        });
    }
}
