// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IResolver {
    struct ResolvedOrder {
        bytes[] steps;
        bytes[] variables;
        bytes[] payments;
        Assumption[] assumptions;
    }

    struct Assumption {
        string name;
        bytes data;
    }

    function resolve(bytes calldata payload) external view returns (ResolvedOrder memory);
}

interface IStep {
    function Call(
        bytes calldata target,
        bytes4 selector,
        bytes[] calldata arguments,
        bytes[] calldata attributes
    ) external;
}

library Step {
    function Call(
        bytes memory target,
        bytes4 selector,
        bytes[] memory arguments,
        bytes[] memory attributes
    ) internal pure returns (bytes memory) {
        return abi.encodeCall(IStep.Call, (target, selector, arguments, attributes));
    }
}

interface IAttribute {
    function SpendsERC20(bytes memory token, bytes memory amountFormula, bytes memory spender, bytes memory recipient) external;
    function SpendsGas(bytes memory amountFormula) external;
    function TimingBounds(string memory field, bytes memory lowerBound, bytes memory upperBound) external;
    function NeedsStep(uint256 stepIdx) external;
    function NeedsVariable(uint256 varIdx) external;
    function RevertPolicy(string memory policy, bytes memory expectedReason) external;
}

library Attribute {
    function SpendsERC20(bytes memory token, bytes memory amountFormula, bytes memory spender, bytes memory recipient) internal pure returns (bytes memory) {
        return abi.encodeCall(IAttribute.SpendsERC20, (token, amountFormula, spender, recipient));
    }

    function SpendsGas(bytes memory amountFormula) internal pure returns (bytes memory) {
        return abi.encodeCall(IAttribute.SpendsGas, (amountFormula));
    }

    function NeedsStep(uint256 stepIdx) internal pure returns (bytes memory) {
        return abi.encodeCall(IAttribute.NeedsStep, (stepIdx));
    }

    function NeedsVariable(uint256 varIdx) internal pure returns (bytes memory) {
        return abi.encodeCall(IAttribute.NeedsVariable, (varIdx));
    }

    function TimingBounds(string memory field, bytes memory lowerBound, bytes memory upperBound) internal pure returns (bytes memory) {
        return abi.encodeCall(IAttribute.TimingBounds, (field, lowerBound, upperBound));
    }

    function RevertPolicy(string memory policy, bytes memory expectedReason) internal pure returns (bytes memory) {
        return abi.encodeCall(IAttribute.RevertPolicy, (policy, expectedReason));
    }
}

interface IFormula {
    function Constant(uint256 val) external;
    function Variable(uint256 varIdx) external;
}

library Formula {
    function Constant(uint256 val) internal pure returns (bytes memory) {
        return abi.encodeCall(IFormula.Constant, (val));
    }

    function Variable(uint256 varIdx) internal pure returns (bytes memory) {
        return abi.encodeCall(IFormula.Variable, (varIdx));
    }
}

interface IPayment {
    function ERC20(
        bytes memory token,
        bytes memory sender,
        bytes memory amountFormula,
        uint256 recipientVarIdx,
        uint256 onStepIdx,
        uint256 estimatedDelaySeconds
    ) external;
}

library Payment {
    function ERC20(
        bytes memory token,
        bytes memory sender,
        bytes memory amountFormula,
        uint256 recipientVarIdx,
        uint256 onStepIdx,
        uint256 estimatedDelaySeconds
    ) internal pure returns (bytes memory) {
        return abi.encodeCall(
            IPayment.ERC20,
            (token, sender, amountFormula, recipientVarIdx, onStepIdx, estimatedDelaySeconds)
        );
    }
}

interface IVariableRole {
    function PaymentRecipient() external;
    function PaymentChain() external;
    function StepCaller(uint256 stepIdx) external;
    function ExecutionOutput(string memory field, uint256 stepIdx) external;
    function Witness(string memory kind, bytes memory data, uint256[] memory variables) external;
    function Query(bytes memory target, bytes4 selector, bytes[] memory arguments, uint256 blockNumber) external;
    function QueryEvents(
        bytes memory emitter,
        bytes1 topicMatch,
        bytes32 topic0,
        bytes32 topic1,
        bytes32 topic2,
        bytes32 topic3,
        uint256 blockNumber
    ) external;
}

library VariableRole {
    function PaymentRecipient() internal pure returns (bytes memory) {
        return abi.encodeCall(IVariableRole.PaymentRecipient, ());
    }

    function PaymentChain() internal pure returns (bytes memory) {
        return abi.encodeCall(IVariableRole.PaymentChain, ());
    }

    function StepCaller(uint256 stepIdx) internal pure returns (bytes memory) {
        return abi.encodeCall(IVariableRole.StepCaller, (stepIdx));
    }

    function ExecutionOutput(string memory field, uint256 stepIdx) internal pure returns (bytes memory) {
        return abi.encodeCall(IVariableRole.ExecutionOutput, (field, stepIdx));
    }

    function Witness(string memory kind, bytes memory data, uint256[] memory variables) internal pure returns (bytes memory) {
        return abi.encodeCall(IVariableRole.Witness, (kind, data, variables));
    }

    function Query(bytes memory target, bytes4 selector, bytes[] memory arguments, uint256 blockNumber) internal pure returns (bytes memory) {
        return abi.encodeCall(IVariableRole.Query, (target, selector, arguments, blockNumber));
    }

    function QueryEvents(
        bytes memory emitter,
        bytes1 topicMatch,
        bytes32 topic0,
        bytes32 topic1,
        bytes32 topic2,
        bytes32 topic3,
        uint256 blockNumber
    ) internal pure returns (bytes memory) {
        return abi.encodeCall(IVariableRole.QueryEvents, (emitter, topicMatch, topic0, topic1, topic2, topic3, blockNumber));
    }
}

interface IEthLog {
    function _(EthLog[] memory) external;
}

struct EthLog {
    address emitter;
    bytes32[] topics;
    bytes data;
    uint256 blockNumber;
    bytes32 transactionHash;
    uint256 transactionIndex;
    bytes32 blockHash;
    uint256 logIndex;
}

library Argument {
    function Variable(uint256 varIdx) internal pure returns (bytes memory) {
        return abi.encode(varIdx);
    }

    function ConstAddress(address value) internal pure returns (bytes memory) {
        return abi.encode("", value);
    }

    function ConstBytes32(bytes32 value) internal pure returns (bytes memory) {
        return abi.encode("", value);
    }

    function ConstBytes(bytes memory value) internal pure returns (bytes memory) {
        return abi.encode("", value);
    }

    function ConstUint8(uint8 value) internal pure returns (bytes memory) {
        return abi.encode("", value);
    }

    function ConstUint256(uint256 value) internal pure returns (bytes memory) {
        return abi.encode("", value);
    }

    function ConstString(string memory value) internal pure returns (bytes memory) {
        return abi.encode("", value);
    }
}
