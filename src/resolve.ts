import type { Hex, Address, PublicClient } from 'viem';
import { decodeFunctionData, getAddress, toHex, hexToBigInt, hexToNumber, size, slice } from 'viem';
import type { Attribute, ResolvedOrder, Account, Argument, Formula, Payment, Step, VariableRole } from './types.ts';
import { resolverAbi, attributeAbi, formulaAbi, paymentAbi, stepAbi, variableRoleAbi } from './abis.ts';
import { decodeAbiWrappedValue } from './abi-wrap.ts';

const UINT256_MAX = (1n << 256n) - 1n;

export async function resolve(client: PublicClient, resolver: Address, payload: Uint8Array): Promise<ResolvedOrder> {
  const result = await client.readContract({
    address: resolver,
    abi: resolverAbi,
    functionName: 'resolve',
    args: [toHex(payload)],
  });

  return {
    steps: result.steps.map(decodeStep),
    variables: result.variables.map(decodeVariableRole),
    assumptions: result.assumptions.map(decodeAssumption),
    payments: result.payments.map(decodePayment),
  };
}

function decodeAssumption(encoded: { trusted: Hex; kind: string }) {
  return {
    trusted: decodeERC7930Address(encoded.trusted),
    kind: encoded.kind,
  };
}

function decodeStep(data: Hex): Step {
  const decoded = decodeFunctionData({ abi: stepAbi, data });

  switch (decoded.functionName) {
    case 'Call': {
      const [target, selector, arguments_, attributes] =
        decoded.args;
      return {
        type: 'Call',
        target: decodeERC7930Address(target),
        selector,
        arguments: arguments_.map(decodeArgument),
        attributes: attributes.map(decodeAttribute),
      };
    }
  }
}

function decodeArgument(encoded: Hex): Argument {
  if (size(encoded) === 32) {
    return { type: 'Variable', varIdx: hexToNumber(encoded) };
  } else {
    return { type: 'AbiEncodedValue', value: decodeAbiWrappedValue(encoded) };
  }
}

function decodeAttribute(encoded: Hex): Attribute {
  const decoded = decodeFunctionData({ abi: attributeAbi, data: encoded });

  switch (decoded.functionName) {
    case 'SpendsERC20': {
      const [token, amountFormula, spender, recipient] = decoded.args;
      return {
        type: 'SpendsERC20',
        token: decodeERC7930Address(token),
        amount: decodeFormula(amountFormula),
        spender: decodeERC7930Address(spender),
        recipient: decodeERC7930Address(recipient),
      };
    }
    case 'SpendsGas': {
      const [amountFormula] = decoded.args;
      return {
        type: 'SpendsGas',
        amount: decodeFormula(amountFormula),
      };
    }
    case 'TimingBounds': {
      const [field, lowerBound, upperBound] = decoded.args;
      return {
        type: 'TimingBounds',
        field,
        lowerBound: decodeOptionalFormula(lowerBound),
        upperBound: decodeOptionalFormula(upperBound),
      };
    }
    case 'NeedsStep': {
      const [stepIdx] = decoded.args;
      return {
        type: 'NeedsStep',
        stepIdx: toSafeNumber(stepIdx),
      };
    }
    case 'RevertPolicy': {
      const [policy, expectedReason] = decoded.args;
      switch (policy) {
        case 'abort':
        case 'ignore':
          return { type: 'RevertPolicy', policy, expectedReason };
        default:
          throw new Error(`Unsupported revert policy: ${policy}`);
      }
    }
  }
}

function decodeFormula(encoded: Hex): Formula {
  const decoded = decodeFunctionData({ abi: formulaAbi, data: encoded });

  switch (decoded.functionName) {
    case 'Constant': {
      const [value] = decoded.args;
      return { type: 'Constant', value };
    }
    case 'Variable': {
      const [varIdx] = decoded.args;
      return { type: 'Variable', varIdx: toSafeNumber(varIdx) };
    }
  }
}

function decodeOptionalFormula(encoded: Hex): Formula | undefined {
  return size(encoded) === 0 ? undefined : decodeFormula(encoded);
}

function decodeVariableRole(encoded: Hex): VariableRole {
  const decoded = decodeFunctionData({ abi: variableRoleAbi, data: encoded });

  switch (decoded.functionName) {
    case 'ExecutionOutput': {
      const [field, stepIdx] = decoded.args;
      return { type: 'ExecutionOutput', field, stepIdx: toSafeNumber(stepIdx) };
    }
    case 'Witness': {
      const [kind, data, variables] = decoded.args;
      return { type: 'Witness', kind, data, variables: variables.map(toSafeNumber) };
    }
    case 'Query': {
      const [target, selector, arguments_, blockNumber] = decoded.args;
      return {
        type: 'Query',
        target: decodeERC7930Address(target),
        selector,
        arguments: arguments_.map(decodeArgument),
        blockNumber: decodeBlockNumber(blockNumber),
      };
    }
    case 'QueryEvents': {
      const [emitter, topicMatch, topic0, topic1, topic2, topic3, blockNumber] = decoded.args;
      const queryEvents: VariableRole = {
        type: 'QueryEvents',
        emitter: decodeERC7930Address(emitter),
        topic0,
        topic1,
        topic2,
        topic3,
        blockNumber: decodeBlockNumber(blockNumber),
      };

      const mask = hexToNumber(topicMatch);
      if (!(mask & (1 << 0))) delete queryEvents.topic0;
      if (!(mask & (1 << 1))) delete queryEvents.topic1;
      if (!(mask & (1 << 2))) delete queryEvents.topic2;
      if (!(mask & (1 << 3))) delete queryEvents.topic3;

      return queryEvents;
    }
    default: {
      decoded.args satisfies readonly [];
      return { type: decoded.functionName };
    }
  }
}

function decodeBlockNumber(blockNumber: bigint): bigint | undefined {
  return blockNumber === UINT256_MAX ? undefined : blockNumber;
}

function decodePayment(encoded: Hex): Payment {
  const decoded = decodeFunctionData({ abi: paymentAbi, data: encoded });

  switch (decoded.functionName) {
    case 'ERC20': {
      const [token, sender, amountFormula, recipientVarIdx, onStepIdx, estimatedDelaySeconds] =
        decoded.args;
      return {
        type: 'ERC20',
        token: decodeERC7930Address(token),
        sender: decodeERC7930Address(sender),
        amount: decodeFormula(amountFormula),
        recipientVarIdx: toSafeNumber(recipientVarIdx),
        onStepIdx: toSafeNumber(onStepIdx),
        estimatedDelaySeconds,
      };
    }
  }
}

// ERC-7930 binary format:
// - version: 2 bytes
// - chainType: 2 bytes
// - chainRefLen: 1 byte
// - chainRef: N bytes
// - addrLen: 1 byte
// - address: M bytes
function decodeERC7930Address(binary: Hex): Account {
  const version = slice(binary, 0, 2);
  if (version !== '0x0001') {
    throw new Error(`Unsupported ERC-7930 version: ${version}`);
  }
  const chainType = slice(binary, 2, 4);
  if (chainType !== '0x0000') {
    throw new Error(`Unsupported chain type: ${chainType}`);
  }
  const chainRefLen = hexToNumber(slice(binary, 4, 5));
  const chainRef = slice(binary, 5, 5 + chainRefLen);
  const addrLen = hexToNumber(slice(binary, 5 + chainRefLen, 6 + chainRefLen));
  const address = getAddress(slice(binary, 6 + chainRefLen, 6 + chainRefLen + addrLen));
  const chainId = hexToBigInt(chainRef);
  return { address, chainId };
}

function toSafeNumber(value: bigint): number {
  const num = Number(value);
  if (!Number.isSafeInteger(num)) {
    throw new Error(`Number out of safe integer range: ${value.toString()}`);
  }
  return num;
}
