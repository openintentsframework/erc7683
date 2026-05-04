import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { formatName } from '@wonderland/interop-addresses';
import { createERC5267Client } from 'eip712domains/viem';
import { createPublicClient, createWalletClient, decodeFunctionData, defineChain, encodeAbiParameters, encodeFunctionData, hexToBytes, http, getAddress, parseSignature, type Address, type Hex, type PublicClient } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';

import { type SolverContext, type WalletClient } from './context.ts';
import { process as processOrder, type ProcessResult } from './process.ts';

import basicTargetArtifact from '../out/common.sol/BasicTarget.json' with { type: 'json' };
import demoErc20Artifact from '../out/common.sol/DemoERC20.json' with { type: 'json' };
import demoSpokePoolArtifact from '../out/across.sol/DemoSpokePool.json' with { type: 'json' };
import erc1967ProxyArtifact from '../out/ERC1967Proxy.sol/ERC1967Proxy.json' with { type: 'json' };

const SOLVER_MNEMONIC = 'zoo pony sorry praise pudding bean witness miracle list knee early rotate';
const USER_MNEMONIC = 'false brass security hockey slight shrimp cupboard distance involve used rose song';

const BLOCK_TIME_MS = 10;
const CHAIN_COUNT = 2;
const ANVIL_PORT = 8545;

const solverAccount = mnemonicToAccount(SOLVER_MNEMONIC).address;
const user = mnemonicToAccount(USER_MNEMONIC);
const userAccount = user.address;

interface DemoChain {
  publicClient: PublicClient;
  walletClient: WalletClient;
  anvil: ChildProcess;
}

interface DemoContext {
  chains: DemoChain[];
  tokens: Address[];
  names: Map<string, string>;
  tokenPricesUsd: Map<string, bigint>;
  context: SolverContext;
}

async function createDemoContext(): Promise<DemoContext> {
  const chains = await Promise.all(Array.from({ length: CHAIN_COUNT }, (_, i) => startAnvil(BigInt(i + 1))));
  const tokens = await Promise.all(chains.map(deployDemoToken));
  const names = new Map<string, string>();
  const tokenPricesUsd = new Map<string, bigint>();
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
    getTokenPriceUsd: async token => tokenPricesUsd.get(addressKey(token.chainId, token.address)) ?? 0n,
    getGasPriceUsd: async () => 0n,
    getConfirmationThreshold: () => ({ etaFromBroadcast: 0, confirmations: 1 }),
    getTimeToBlock: async (chainId, targetBlockNumber) =>
      Math.max(0, Number(targetBlockNumber) - Number(await chains[Number(chainId - 1n)]!.publicClient.getBlockNumber())) * BLOCK_TIME_MS,
    getWitnessDelay: () => 0,
  };

  return { chains, tokens, names, tokenPricesUsd, context };
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
    bytecode: demoErc20Artifact.bytecode.object as Hex,
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
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'string' && value.startsWith('0x')) return value;
  return JSON.stringify(value, (_, nested) => typeof nested === 'bigint' ? `${nested}n` : nested);
}

function indent(text: string, spaces = 2): string {
  return text.replace(/^/gm, ' '.repeat(spaces));
}

interface DemoRunOptions {
  resolver: string;
  setup: (demoContext: DemoContext) => Promise<DemoSetupResult>;
}

interface DemoSetupResult {
  payload: Uint8Array;
  constructorArgs?: readonly unknown[];
}

async function run(demoContext: DemoContext, { resolver, setup }: DemoRunOptions): Promise<ProcessResult> {
  const { publicClient, walletClient } = demoContext.chains[0]!;
  const { payload, constructorArgs = [] } = await setup(demoContext);
  const artifact = await import(`../out/${resolver}.sol/Resolver.json`, { with: { type: 'json' } });
  const hash = await walletClient.deployContract({
    abi: artifact.default.abi,
    bytecode: artifact.default.bytecode.object as Hex,
    args: constructorArgs,
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
  { order, flows, pnlUsd, receipts }: ProcessResult,
): Promise<string> {
  const lines: string[] = [];

  if (flows.length > 0) {
    lines.push('', 'Flows:');
    for (const flow of flows) {
      const sign = flow.sign > 0n ? '+' : '-';
      const asset = flow.token === 'gas' ? `gas on chain ${flow.chainId}` : formatAddress(demoContext, flow.chainId, flow.token);
      lines.push(`  • ${sign}${flow.amount} ${asset}`);
    }
  }

  lines.push('', `PnL: ${pnlUsd} USD`);

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
    const decoded = decodeFunctionData({ abi: [...basicTargetArtifact.abi, ...demoErc20Artifact.abi, ...demoSpokePoolArtifact.abi], data: tx.input });

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
  { resolver: 'SingleStep', setup: async () => ({ payload: new Uint8Array() }) },
  { resolver: 'ExecutionOutput', setup: async () => ({ payload: new Uint8Array() }) },
  { resolver: 'Query', setup: async () => ({ payload: new Uint8Array() }) },
  { resolver: 'TimestampLowerBound', setup: async () => ({ payload: new Uint8Array() }) },

  {
    resolver: 'PermitSwap',
    setup: async ({ chains, tokens, tokenPricesUsd }) => {
      const amount = 100n;
      const deadline = 2n ** 256n - 1n;
      const [sourceToken, destinationToken] = tokens;
      assert(sourceToken !== undefined);
      assert(destinationToken !== undefined);
      tokenPricesUsd.set(addressKey(1n, sourceToken), 2n);
      tokenPricesUsd.set(addressKey(2n, destinationToken), 1n);

      const sourceMint = await chains[0]!.walletClient.writeContract({
        abi: demoErc20Artifact.abi,
        address: sourceToken,
        functionName: 'mint',
        args: [userAccount, amount],
        account: solverAccount,
      });
      await chains[0]!.publicClient.waitForTransactionReceipt({ hash: sourceMint });

      const destinationMint = await chains[1]!.walletClient.writeContract({
        abi: demoErc20Artifact.abi,
        address: destinationToken,
        functionName: 'mint',
        args: [solverAccount, amount],
        account: solverAccount,
      });
      await chains[1]!.publicClient.waitForTransactionReceipt({ hash: destinationMint });

      const { getEIP712Domain } = createERC5267Client(chains[0]!.publicClient);
      const domain = await getEIP712Domain(sourceToken);
      assert(domain !== undefined, 'DemoERC20 EIP-712 domain unavailable');

      const signature = await user.signTypedData({
        domain,
        types: {
          Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'Permit',
        message: {
          owner: userAccount,
          spender: solverAccount,
          value: amount,
          nonce: 0n,
          deadline,
        },
      });
      const { v, r, s } = parseSignature(signature);
      assert(v !== undefined);

      return {
        payload: hexToBytes(encodeAbiParameters([{
          type: 'tuple',
          components: [
            { name: 'sourceChain', type: 'uint256' },
            { name: 'sourceToken', type: 'address' },
            { name: 'destinationChain', type: 'uint256' },
            { name: 'destinationToken', type: 'address' },
            { name: 'user', type: 'address' },
            { name: 'solver', type: 'address' },
            { name: 'amount', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
            { name: 'v', type: 'uint8' },
            { name: 'r', type: 'bytes32' },
            { name: 's', type: 'bytes32' },
          ],
        }], [{
          sourceChain: 1n,
          sourceToken,
          destinationChain: 2n,
          destinationToken,
          user: userAccount,
          solver: solverAccount,
          amount,
          deadline,
          v: Number(v),
          r,
          s,
        }])),
      };
    },
  },

  {
    resolver: 'AcrossResolver',
    setup: async ({ chains, tokens, names, tokenPricesUsd }) => {
      // Helper to deploy an initialized DemoSpokePool proxy.
      const deployDemoSpokePool = async ({ publicClient, walletClient }: DemoChain) => {
        const implementationHash = await walletClient.deployContract({
          abi: demoSpokePoolArtifact.abi,
          bytecode: demoSpokePoolArtifact.bytecode.object as Hex,
          account: solverAccount,
        });
        const implementationReceipt = await publicClient.waitForTransactionReceipt({ hash: implementationHash });
        assert(implementationReceipt.contractAddress, 'DemoSpokePool implementation deployment failed');

        // MockSpokePool disables initializers in the implementation constructor,
        // so initialize through the proxy constructor instead.
        const proxyHash = await walletClient.deployContract({
          abi: erc1967ProxyArtifact.abi,
          bytecode: erc1967ProxyArtifact.bytecode.object as Hex,
          args: [implementationReceipt.contractAddress, encodeFunctionData({
            abi: demoSpokePoolArtifact.abi,
            functionName: 'initialize',
            args: [0, solverAccount, solverAccount],
          })],
          account: solverAccount,
        });
        const proxyReceipt = await publicClient.waitForTransactionReceipt({ hash: proxyHash });
        assert(proxyReceipt.contractAddress, 'DemoSpokePool deployment failed');
        return getAddress(proxyReceipt.contractAddress);
      };

      // Deploy an origin SpokePool where the user deposits, and a destination
      // SpokePool where the solver fills the relay.
      const originSpokePool = await deployDemoSpokePool(chains[0]!);
      const destinationSpokePool = await deployDemoSpokePool(chains[1]!);
      names.set(addressKey(1n, originSpokePool), 'SpokePool chain 1');
      names.set(addressKey(2n, destinationSpokePool), 'SpokePool chain 2');

      const amount = 100n;
      const fillDeadlineOffset = 60 * 60;
      const [inputToken, outputToken] = tokens;
      assert(inputToken !== undefined);
      assert(outputToken !== undefined);
      tokenPricesUsd.set(addressKey(1n, inputToken), 2n);
      tokenPricesUsd.set(addressKey(2n, outputToken), 1n);

      // The user account is separate from Anvil's funded mnemonic, so fund it
      // for the origin-chain approval and deposit transactions.
      const userFunding = await chains[0]!.walletClient.sendTransaction({
        account: solverAccount,
        to: userAccount,
        value: 10n ** 18n,
      });
      await chains[0]!.publicClient.waitForTransactionReceipt({ hash: userFunding });

      // Seed the bridge: the user needs input tokens on the origin chain, and
      // the solver needs output-token inventory on the destination chain.
      const inputMint = await chains[0]!.walletClient.writeContract({
        abi: demoErc20Artifact.abi,
        address: inputToken,
        functionName: 'mint',
        args: [userAccount, amount],
        account: solverAccount,
      });
      await chains[0]!.publicClient.waitForTransactionReceipt({ hash: inputMint });

      const outputMint = await chains[1]!.walletClient.writeContract({
        abi: demoErc20Artifact.abi,
        address: outputToken,
        functionName: 'mint',
        args: [solverAccount, amount],
        account: solverAccount,
      });
      await chains[1]!.publicClient.waitForTransactionReceipt({ hash: outputMint });

      const inputApproval = await chains[0]!.walletClient.writeContract({
        abi: demoErc20Artifact.abi,
        address: inputToken,
        functionName: 'approve',
        args: [originSpokePool, amount],
        account: user,
      });
      await chains[0]!.publicClient.waitForTransactionReceipt({ hash: inputApproval });

      // The solver needs destination-chain allowance because fillV3Relay
      // transfers output tokens from msg.sender to the recipient.
      const outputApproval = await chains[1]!.walletClient.writeContract({
        abi: demoErc20Artifact.abi,
        address: outputToken,
        functionName: 'approve',
        args: [destinationSpokePool, amount],
        account: solverAccount,
      });
      await chains[1]!.publicClient.waitForTransactionReceipt({ hash: outputApproval });

      // This is the user's Across deposit. The resolver will later describe
      // only the solver's fill of this deposit, not the deposit itself.
      const currentTime = await chains[0]!.publicClient.readContract({
        abi: demoSpokePoolArtifact.abi,
        address: originSpokePool,
        functionName: 'getCurrentTime',
      });

      const deposit = await chains[0]!.walletClient.writeContract({
        abi: demoSpokePoolArtifact.abi,
        address: originSpokePool,
        functionName: 'depositV3Now',
        args: [
          userAccount,
          userAccount,
          inputToken,
          outputToken,
          amount,
          amount,
          2n,
          solverAccount,
          fillDeadlineOffset,
          0,
          '0x',
        ],
        account: user,
      });
      const depositReceipt = await chains[0]!.publicClient.waitForTransactionReceipt({ hash: deposit });

      return {
        // Payload is order-specific relay data. The SpokePool addresses are
        // constructor configuration on the resolver, keyed by chain id.
        payload: hexToBytes(encodeAbiParameters([{
          type: 'tuple',
          components: [
            { name: 'originChainId', type: 'uint256' },
            { name: 'destinationChainId', type: 'uint256' },
            { name: 'depositor', type: 'address' },
            { name: 'recipient', type: 'address' },
            { name: 'exclusiveRelayer', type: 'address' },
            { name: 'inputToken', type: 'address' },
            { name: 'outputToken', type: 'address' },
            { name: 'inputAmount', type: 'uint256' },
            { name: 'outputAmount', type: 'uint256' },
            { name: 'depositId', type: 'uint32' },
            { name: 'quoteTimestamp', type: 'uint32' },
            { name: 'fillDeadline', type: 'uint32' },
            { name: 'exclusivityDeadline', type: 'uint32' },
            { name: 'depositBlockNumber', type: 'uint256' },
            { name: 'message', type: 'bytes' },
          ],
        }], [{
          originChainId: 1n,
          destinationChainId: 2n,
          depositor: userAccount,
          recipient: userAccount,
          exclusiveRelayer: solverAccount,
          inputToken,
          outputToken,
          inputAmount: amount,
          outputAmount: amount,
          depositId: 0,
          quoteTimestamp: Number(currentTime),
          fillDeadline: Number(currentTime) + fillDeadlineOffset,
          exclusivityDeadline: 0,
          depositBlockNumber: depositReceipt.blockNumber,
          message: '0x',
        }])),
        constructorArgs: [[1n, 2n], [originSpokePool, destinationSpokePool]],
      };
    },
  },
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
