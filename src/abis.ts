import { parseAbi } from 'viem';

export const resolverAbi = parseAbi([
  'function resolve(bytes payload) view returns (ResolvedOrder)',
  'struct ResolvedOrder { bytes[] steps; bytes[] variables; Assumption[] assumptions; bytes[] payments; }',
  'struct Assumption { bytes trusted; string kind; }',
]);

export const stepAbi = parseAbi([
  'function Call(bytes target, bytes4 selector, bytes[] arguments, bytes[] attributes, bytes[] payments) external',
]);

export const attributeAbi = parseAbi([
  'function SpendsERC20(bytes token, bytes amountFormula, bytes spender, bytes receiver) external',
  'function SpendsGas(bytes amountFormula) external',
  'function Outputs(string field, uint256 varIdx, bytes lowerBound, bytes upperBound) external',
  'function NeedsStep(uint256 stepIdx) external',
  'function RevertPolicy(string policy, bytes expectedReason) external',
]);

export const formulaAbi = parseAbi([
  'function Constant(uint256 val) external',
  'function Variable(uint256 varIdx) external',
]);

export const paymentAbi = parseAbi([
  'function ERC20(bytes token, bytes sender, bytes amountFormula, uint256 recipientVarIdx, uint256 estimatedDelaySeconds) external',
]);

export const variableRoleAbi = parseAbi([
  'function PaymentRecipient(uint256 chainId) external',
  'function PaymentChain() external',
  'function Pricing() external', // rename Decision?
  'function ExecutionOutput() external',
  'function Witness(string kind, bytes data, uint256[] variables) external',
  'function Query(bytes target, bytes4 selector, bytes[] arguments, uint256 blockNumber) external',
  'function QueryEvents(bytes emitter, bytes1 topicMatch, bytes32 topic0, bytes32 topic1, bytes32 topic2, bytes32 topic3, uint256 blockNumber) external',
]);

export const ethLogAbi = parseAbi([
  'function _(EthLog[] memory) external',
  'struct EthLog { address emitter; bytes32[] topics; bytes data; uint256 blockNumber; bytes32 transactionHash; uint256 transactionIndex; bytes32 blockHash; uint256 logIndex; }',
])[0].inputs;
