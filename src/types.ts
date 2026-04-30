import type { Address, Hex } from 'viem';

import type { AbiEncodedValue } from './abi-wrap.ts';

export interface ResolvedOrder {
  steps: Step[];
  variables: VariableRole[];
  payments: Payment[];
  assumptions: Assumption[];
}

export interface Account {
  address: Address;
  chainId: bigint;
}

export type Step = Step_Call;

export interface Step_Call {
  type: 'Call';
  target: Account;
  selector: Hex; // bytes4
  arguments: Argument[];
  attributes: Attribute[];
}

export type Attribute =
  | Attribute_SpendsERC20
  | Attribute_SpendsGas
  | Attribute_TimingBounds
  | Attribute_NeedsStep
  | Attribute_RevertPolicy;

export interface Attribute_SpendsERC20 {
  type: 'SpendsERC20';
  token: Account;
  amount: Formula;
  spender: Account;
  recipient: Account;
}

export interface Attribute_SpendsGas {
  type: 'SpendsGas';
  amount: Formula;
}

export interface Attribute_TimingBounds {
  type: 'TimingBounds';
  field: string;
  lowerBound?: Formula;
  upperBound?: Formula;
}

export interface Attribute_NeedsStep {
  type: 'NeedsStep';
  stepIdx: number;
}

export interface Attribute_RevertPolicy {
  type: 'RevertPolicy';
  policy: 'abort' | 'ignore'; // TODO: 'retry';
  expectedReason: Hex;
}

export type Formula = Formula_Constant | Formula_Variable;

export interface Formula_Constant {
  type: 'Constant';
  value: bigint;
}

export interface Formula_Variable {
  type: 'Variable';
  varIdx: number;
}

export type Payment = Payment_ERC20;

export interface Payment_ERC20 {
  type: 'ERC20';
  token: Account;
  sender: Account;
  amount: Formula;
  recipientVarIdx: number;
  onStepIdx: number;
  estimatedDelaySeconds: bigint;
}

export type VariableRole =
  | VariableRole_PaymentRecipient
  | VariableRole_PaymentChain
  | VariableRole_ExecutionOutput
  | VariableRole_Witness
  | VariableRole_Query
  | VariableRole_QueryEvents;

export interface VariableRole_PaymentRecipient {
  type: 'PaymentRecipient';
}

export interface VariableRole_PaymentChain {
  type: 'PaymentChain';
}

export interface VariableRole_ExecutionOutput {
  type: 'ExecutionOutput';
  field: string;
  stepIdx: number;
}

export interface VariableRole_Witness {
  type: 'Witness';
  kind: string;
  data: Hex;
  variables: number[];
}

export interface VariableRole_Query {
  type: 'Query';
  target: Account;
  selector: Hex; // bytes4
  arguments: Argument[];
  blockNumber?: bigint;
}

export interface VariableRole_QueryEvents {
  type: 'QueryEvents';
  emitter: Account;
  topic0?: Hex;
  topic1?: Hex;
  topic2?: Hex;
  topic3?: Hex;
  blockNumber?: bigint;
}

export interface Assumption {
  name: string;
  data: Hex;
}

export type Argument = Argument_Variable | Argument_AbiEncodedValue;

export interface Argument_Variable {
  type: 'Variable';
  varIdx: number;
}

export interface Argument_AbiEncodedValue {
  type: 'AbiEncodedValue';
  value: AbiEncodedValue;
}
