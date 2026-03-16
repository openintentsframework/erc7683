import type { Address, Hex } from 'viem';

import type { AbiEncodedValue } from './abi-wrap.ts';

export interface ResolvedOrder {
  steps: Step[];
  variables: VariableRole[];
  assumptions: Assumption[];
  payments: Payment[];
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
  payments: Payment[];
}

export type Attribute =
  | Attribute_SpendsERC20
  | Attribute_SpendsEstimatedGas
  | Attribute_Outputs
  | Attribute_NeedsStep
  | Attribute_RevertPolicy;

export interface OutputBinding {
  field: string;
  varIdx: number;
  lowerBound?: Formula;
  upperBound?: Formula;
}

export interface Attribute_SpendsERC20 {
  type: 'SpendsERC20';
  token: Account;
  amount: Formula;
  spender: Account;
  receiver: Account;
}

export interface Attribute_SpendsEstimatedGas {
  type: 'SpendsEstimatedGas';
  amount: Formula;
}

export interface Attribute_Outputs {
  type: 'Outputs';
  output: OutputBinding;
}

export interface Attribute_NeedsStep {
  type: 'NeedsStep';
  stepIdx: number;
}

export interface Attribute_RevertPolicy {
  type: 'RevertPolicy';
  policy: 'drop' | 'ignore'; // TODO: 'retry';
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
  estimatedDelaySeconds: bigint;
}

export type VariableRole =
  | VariableRole_PaymentRecipient
  | VariableRole_PaymentChain
  | VariableRole_Pricing
  | VariableRole_ExecutionOutput
  | VariableRole_Witness
  | VariableRole_Query
  | VariableRole_QueryEvents;

export interface VariableRole_PaymentRecipient {
  type: 'PaymentRecipient';
  chainId: bigint;
}

export interface VariableRole_PaymentChain {
  type: 'PaymentChain';
}

export interface VariableRole_Pricing {
  type: 'Pricing';
}

export interface VariableRole_ExecutionOutput {
  type: 'ExecutionOutput';
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
  blockNumber: bigint;
}

export interface VariableRole_QueryEvents {
  type: 'QueryEvents';
  emitter: Account;
  topic0?: Hex;
  topic1?: Hex;
  topic2?: Hex;
  topic3?: Hex;
  blockNumber: bigint;
}

export interface Assumption {
  trusted: Account;
  kind: string;
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
