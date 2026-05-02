import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { formatName } from '@wonderland/interop-addresses';
import { createPublicClient, createWalletClient, decodeFunctionData, defineChain, http, getAddress, type Address, type PublicClient } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';

import { type SolverContext, type WalletClient } from './context.ts';
import { process as processOrder, type ProcessResult } from './process.ts';

import basicTargetArtifact from '../out/common.sol/BasicTarget.json' with { type: 'json' };
import demoErc20Artifact from '../out/common.sol/DemoERC20.json' with { type: 'json' };

const SOLVER_MNEMONIC = 'zoo pony sorry praise pudding bean witness miracle list knee early rotate';
const USER_MNEMONIC = 'false brass security hockey slight shrimp cupboard distance involve used rose song';

const BLOCK_TIME_MS = 10;
const CHAIN_COUNT = 2;
const ANVIL_PORT = 8545;

const solverAccount = mnemonicToAccount(SOLVER_MNEMONIC).address;
const userAccount = mnemonicToAccount(USER_MNEMONIC).address;

interface DemoChain {
  publicClient: PublicClient;
  walletClient: WalletClient;
  anvil: ChildProcess;
}

interface DemoContext {
  chains: DemoChain[];
  tokens: Address[];
  names: Map<string, string>;
  context: SolverContext;
}

async function createDemoContext(): Promise<DemoContext> {
  const chains = await Promise.all(Array.from({ length: CHAIN_COUNT }, (_, i) => startAnvil(BigInt(i + 1))));
  const tokens = await Promise.all(chains.map(deployDemoToken));
  const names = new Map<string, string>();
  for (const chainIdx of chains.keys()) {
    const chainId = BigInt(chainIdx + 1);
    names.set(addressKey(chainId, solverAccount), 'solver');
    names.set(addressKey(chainId, userAccount), 'user');
  }
  for (const [chainIdx, token] of tokens.entries()) {
    const chainId = BigInt(chainIdx + 1);
    names.set(addressKey(chainId, token), `DEMO token on chain ${chainId}`);
  }
  const context: SolverContext = {
    getPublicClient: chainId => chains[Number(chainId - 1n)]!.publicClient,
    getWalletClient: chainId => chains[Number(chainId - 1n)]!.walletClient,
    paymentChain: 1n,
    paymentRecipient: solverAccount,
    fillerAddress: solverAccount,
    isAssumptionAccepted: () => false,
    getWitnessResolver: () => undefined,
    getTokenPriceUsd: async () => 0n,
    getGasPriceUsd: async () => 0n,
    getConfirmationThreshold: () => ({ etaFromBroadcast: 0, confirmations: 1 }),
    getTimeToBlock: async (chainId, targetBlockNumber) =>
      Math.max(0, Number(targetBlockNumber) - Number(await chains[Number(chainId - 1n)]!.publicClient.getBlockNumber())) * BLOCK_TIME_MS,
    getWitnessDelay: () => 0,
  };

  return { chains, tokens, names, context };
}

function stopDemoContext({ chains }: DemoContext): void {
  for (const { anvil } of chains) {
    anvil.kill();
  }
}

async function startAnvil(chainId: bigint): Promise<DemoChain> {
  const host = '127.0.0.1';
  const port = ANVIL_PORT + Number(chainId - 1n);
  const url = `http://${host}:${port}`;
  const transport = http(url);
  const solverAccount = mnemonicToAccount(SOLVER_MNEMONIC);
  const anvil = spawn(
    'anvil',
    [
      '--host', host,
      '--port', String(port),
      '--quiet',
      '--block-time', String(BLOCK_TIME_MS / 1000),
      '--mnemonic', SOLVER_MNEMONIC,
      '--chain-id', String(chainId),
    ],
    { stdio: 'inherit' }
  );

  const chain = defineChain({
    id: Number(chainId),
    name: 'anvil',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [url] } },
  });

  const publicClient = createPublicClient({ chain, transport, pollingInterval: 1 });
  const walletClient = createWalletClient({ account: solverAccount, chain, transport, pollingInterval: 1 });

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await publicClient.getChainId();
      return { publicClient, walletClient, anvil };
    } catch {
      await setTimeout(100);
    }
  }

  throw new Error('Anvil did not start in time');
}

async function deployDemoToken({ publicClient, walletClient }: DemoChain) {
  const hash = await walletClient.deployContract({
    abi: demoErc20Artifact.abi,
    bytecode: demoErc20Artifact.bytecode.object as `0x${string}`,
    account: solverAccount,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert(receipt.contractAddress, 'DemoERC20 deployment failed');
  return getAddress(receipt.contractAddress);
}

function addressKey(chainId: bigint, address: Address): string {
  return formatName({
    version: 1,
    chainType: 'eip155',
    chainReference: chainId.toString(),
    address: getAddress(address),
  }, { includeChecksum: false });
}

function formatAddress(demoContext: DemoContext, chainId: bigint, address: Address): string {
  return demoContext.names.get(addressKey(chainId, address)) ?? addressKey(chainId, address);
}

function formatValue(value: unknown): string {
  return typeof value === 'bigint' ? `${value}n` : JSON.stringify(value);
}

function indent(text: string, spaces = 2): string {
  return text.replace(/^/gm, ' '.repeat(spaces));
}

interface DemoRunOptions {
  resolver: string;
  payload: Uint8Array;
}

async function run(demoContext: DemoContext, { resolver, payload }: DemoRunOptions): Promise<ProcessResult> {
  const { publicClient, walletClient } = demoContext.chains[0]!;
  const artifact = await import(`../out/${resolver}.sol/Resolver.json`, { with: { type: 'json' } });
  const hash = await walletClient.deployContract({
    abi: artifact.default.abi,
    bytecode: artifact.default.bytecode.object as `0x${string}`,
    account: solverAccount,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert(receipt.contractAddress, `${resolver} deployment failed`);
  const resolverAddress = getAddress(receipt.contractAddress);

  return processOrder(demoContext.context, { chainId: 1n, address: resolverAddress }, payload);
}

async function formatDemoRunDebug(
  demoContext: DemoContext,
  { resolver }: DemoRunOptions,
  processResult: ProcessResult,
): Promise<string> {
  const lines = [
    ``,
    `\x1b[1m• ${resolver}\x1b[0m`,
  ];
  const processDebug = await formatProcessResultDebug(demoContext, processResult);
  if (processDebug.length > 0) lines.push(indent(processDebug));
  return lines.join('\n');
}

async function formatProcessResultDebug(
  demoContext: DemoContext,
  { order, flows, receipts }: ProcessResult,
): Promise<string> {
  const lines: string[] = [];

  if (flows.length > 0) {
    lines.push('', 'Flows:');
    for (const flow of flows) {
      const sign = flow.sign > 0n ? '+' : '-';
      const token = flow.token === 'gas' ? 'gas' : formatAddress(demoContext, flow.chainId, flow.token);
      lines.push(`  • ${sign}${flow.amount} ${token} on chain ${flow.chainId}`);
    }
  }

  if (receipts?.some(Boolean)) {
    lines.push('', 'Executed Steps:');
  }

  for (const [stepId, receipt] of receipts?.entries() ?? []) {
    if (!receipt) continue;

    const step = order.steps[stepId]!;
    const publicClient = demoContext.context.getPublicClient(step.target.chainId);
    const tx = await publicClient.getTransaction({ hash: receipt.transactionHash });
    assert(tx.blockNumber !== null, `Missing block number for step ${stepId}`);
    const block = await publicClient.getBlock({ blockNumber: tx.blockNumber });
    const decoded = decodeFunctionData({ abi: basicTargetArtifact.abi, data: tx.input });

    lines.push(
      `  • Step ${stepId}`,
      `      To:        ${formatAddress(demoContext, step.target.chainId, step.target.address)}`,
      `      Data:      ${decoded.functionName}(${decoded.args?.map(formatValue).join(', ')})`,
      `      Block:     ${tx.blockNumber}`,
      `      Timestamp: ${block.timestamp}`,
    );
  }

  return lines.join('\n');
}


// BEGIN TESTS

const demos: DemoRunOptions[] = [
  { resolver: 'SingleStep', payload: new Uint8Array() },
  { resolver: 'ExecutionOutput', payload: new Uint8Array() },
  { resolver: 'Query', payload: new Uint8Array() },
  { resolver: 'TimestampLowerBound', payload: new Uint8Array() },
];

const selectedResolver = process.argv[2];

for (const demo of demos) {
  if (selectedResolver !== undefined && demo.resolver !== selectedResolver) continue;

  const demoContext = await createDemoContext();
  try {
    const result = await run(demoContext, demo);
    const debug = await formatDemoRunDebug(demoContext, demo, result);
    console.log(debug);
  } finally {
    stopDemoContext(demoContext);
  }
}
