// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {V3SpokePoolInterface} from "across/contracts/interfaces/V3SpokePoolInterface.sol";
import {SpokePoolInterface} from "across/contracts/interfaces/SpokePoolInterface.sol";
import {InteroperableAddress} from "@openzeppelin/contracts/utils/draft-InteroperableAddress.sol";
import {IResolver, Step, Attribute, Formula, Payment, VariableRole, Argument, EthLog} from "../../ERC7683.sol";

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
        uint32 quoteTimestamp;
        uint32 fillDeadline;
        uint32 exclusivityDeadline;
        uint256 depositBlockNumber;
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
        uint256 originDeposit = varCount++;
        uint256 originDepositValid = varCount++;

        order.variables = new bytes[](varCount);
        order.variables[paymentRecipient] = VariableRole.PaymentRecipient();
        order.variables[originDeposit] = VariableRole.QueryEvents(
            InteroperableAddress.formatEvmV1(p.originChainId, originSpokePool),
            bytes1(0x05), // Match topic0 and topic2: event selector and deposit id.
            V3SpokePoolInterface.FundsDeposited.selector,
            bytes32(0),
            bytes32(uint256(p.depositId)),
            bytes32(0),
            p.depositBlockNumber
        );
        bytes[] memory originDepositValidArguments = new bytes[](2);
        originDepositValidArguments[0] = Argument.Variable(originDeposit);
        originDepositValidArguments[1] = Argument.ConstBytes(payload);
        order.variables[originDepositValid] = VariableRole.Query(
            InteroperableAddress.formatEvmV1(block.chainid, address(this)),
            this.validateOriginDeposit.selector,
            originDepositValidArguments,
            type(uint256).max
        );

        // Origin-chain repayment has zero Across LP fee, so the relayer refund
        // is exactly the input amount.
        order.payments = new bytes[](1);
        order.payments[0] = Payment.ERC20(
            inputToken,
            InteroperableAddress.formatEvmV1(p.originChainId, originSpokePool),
            Formula.Constant(p.inputAmount),
            paymentRecipient,
            0,
            REPAYMENT_DELAY_SECONDS
        );

        if (p.message.length == 0) {
            order.assumptions = new Assumption[](0);
        } else {
            order.assumptions = new Assumption[](1);
            order.assumptions[0] = Assumption({
                name: "non-reverting",
                data: InteroperableAddress.formatEvmV1(p.destinationChainId, p.recipient)
            });
        }

        order.steps = new bytes[](1);

        bytes[] memory step0Arguments = new bytes[](3);
        step0Arguments[0] = abi.encode("", _relayData(p));
        step0Arguments[1] = Argument.ConstUint256(p.originChainId);
        step0Arguments[2] = Argument.Variable(paymentRecipient);

        bytes[] memory step0Attributes = new bytes[](6);
        step0Attributes[0] = Attribute.SpendsERC20(
            outputToken,
            Formula.Constant(p.outputAmount),
            InteroperableAddress.formatEvmV1(p.destinationChainId, destinationSpokePool),
            InteroperableAddress.formatEvmV1(p.destinationChainId, p.recipient)
        );
        step0Attributes[1] = Attribute.NeedsVariable(originDepositValid);
        step0Attributes[2] = Attribute.RevertPolicy(
            "abort",
            bytes.concat(V3SpokePoolInterface.NotExclusiveRelayer.selector)
        );
        step0Attributes[3] = Attribute.RevertPolicy(
            "abort",
            bytes.concat(V3SpokePoolInterface.RelayFilled.selector)
        );
        step0Attributes[4] = Attribute.RevertPolicy(
            "abort",
            bytes.concat(SpokePoolInterface.FillsArePaused.selector)
        );
        step0Attributes[5] = Attribute.TimingBounds(
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

    function validateOriginDeposit(
        EthLog[] calldata logs,
        bytes calldata payload
    ) external pure returns (string memory empty, bool valid) {
        Payload memory p = abi.decode(payload, (Payload));
        bytes32 depositor = bytes32(uint256(uint160(p.depositor)));
        bytes memory expectedData = abi.encode(
            bytes32(uint256(uint160(p.inputToken))),
            bytes32(uint256(uint160(p.outputToken))),
            p.inputAmount,
            p.outputAmount,
            p.quoteTimestamp,
            p.fillDeadline,
            p.exclusivityDeadline,
            bytes32(uint256(uint160(p.recipient))),
            bytes32(uint256(uint160(p.exclusiveRelayer))),
            p.message
        );

        if (logs.length == 1) {
            EthLog calldata log = logs[0];
            if (
                log.topics.length == 4
                && log.topics[0] == V3SpokePoolInterface.FundsDeposited.selector
                && log.topics[1] == bytes32(uint256(p.destinationChainId))
                && log.topics[2] == bytes32(uint256(p.depositId))
                && log.topics[3] == depositor
                && keccak256(log.data) == keccak256(expectedData)
            ) return ("", true);
        }

        revert("invalid origin deposit");
    }
}
