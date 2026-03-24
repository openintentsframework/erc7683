import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout } from 'node:timers/promises';
import { onExit } from 'signal-exit';
import { createPublicClient, createWalletClient, decodeFunctionData, defineChain, http } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import type { SolverContext } from './context.ts';
import { process } from './process.ts';

import basicTargetArtifact from '../out/common.sol/BasicTarget.json' with { type: 'json' };

const MNEMONIC = 'zoo pony sorry praise pudding bean witness miracle list knee early rotate';
const BLOCK_TIME_MS = 10;

const account = mnemonicToAccount(MNEMONIC).address;
const chains = await Promise.all(Array.from({ length: 2 }, (_, i) => startAnvil(BigInt(i + 1))));

const context: SolverContext = {
  getPublicClient: chainId => chains[Number(chainId) - 1]!.publicClient,
  getWalletClient: chainId => chains[Number(chainId) - 1]!.walletClient,
  paymentChain: 1n,
  paymentRecipient: () => account,
  fillerAddress: account,
  isWhitelisted: () => false,
  getWitnessResolver: () => undefined,
  getTokenPriceUsd: () => 0n,
  getGasPriceUsd: () => 0n,
  getConfirmationThreshold: () => ({ etaFromBroadcast: 0, confirmations: 1 }),
  getTimeToBlock: async (chainId, targetBlockNumber) =>
    Math.max(0, Number(targetBlockNumber) - Number(await chains[Number(chainId) - 1]!.publicClient.getBlockNumber())) * BLOCK_TIME_MS,
  getWitnessDelay: () => 0,
};

async function startAnvil(chainId: bigint) {
  const host = '127.0.0.1';
  const port = await getFreePort(host);
  const url = `http://${host}:${port}`;
  const transport = http(url);
  const account = mnemonicToAccount(MNEMONIC);
  const anvil = spawn(
    'anvil',
    [
      '--host', host,
      '--port', String(port),
      '--quiet',
      '--block-time', String(BLOCK_TIME_MS / 1000),
      '--mnemonic', MNEMONIC,
      '--chain-id', String(chainId),
    ],
    { stdio: 'inherit' }
  );
  anvil.unref();
  onExit(() => { anvil.kill('SIGTERM'); });

  const chain = defineChain({
    id: Number(chainId),
    name: 'anvil',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [url] } },
  });

  const publicClient = createPublicClient({ chain, transport, pollingInterval: 1 });
  const walletClient = createWalletClient({ account, chain, transport, pollingInterval: 1 });

  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await publicClient.getChainId();
      return { publicClient, walletClient };
    } catch {
      await setTimeout(100);
    }
  }

  throw new Error('Anvil did not start in time');
}

function getFreePort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, host, () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function formatValue(value: unknown): string {
  return typeof value === 'bigint' ? `${value}n` : JSON.stringify(value);
}

async function run(sourceFile: string, payload: Uint8Array) {
  const { publicClient, walletClient } = chains[0]!;
  const artifact = await import(`../out/${sourceFile}.sol/Resolver.json`, { with: { type: 'json' } });
  const hash = await walletClient.deployContract({
    abi: artifact.default.abi,
    bytecode: artifact.default.bytecode.object as `0x${string}`,
    account,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert(receipt.contractAddress, `${sourceFile} deployment failed`);

  console.log(``);
  console.log(`--- ${sourceFile} ---`);
  console.log(`Resolver: ${receipt.contractAddress}`);

  const receipts = await process(context, { chainId: 1n, address: receipt.contractAddress }, payload);

  for (const [stepId, receipt] of receipts?.entries() ?? []) {
    if (!receipt) continue;

    const tx = await publicClient.getTransaction({ hash: receipt.transactionHash });
    assert(tx.blockNumber !== null, `Missing block number for step ${stepId}`);
    const block = await publicClient.getBlock({ blockNumber: tx.blockNumber });
    const decoded = decodeFunctionData({ abi: basicTargetArtifact.abi, data: tx.input });

    console.log(``);
    console.log(`Step ${stepId}:`);
    console.log(`  To:        ${tx.to}`);
    console.log(`  Data:      ${decoded.functionName}(${decoded.args?.map(formatValue).join(', ')})`);
    console.log(`  Block:     ${tx.blockNumber}`);
    console.log(`  Timestamp: ${block.timestamp}`);
  }
}


// BEGIN TESTS

await run('SingleStep', new Uint8Array());

await run('TimestampOutput', new Uint8Array());

