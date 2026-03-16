import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

import { onExit } from 'signal-exit';
import { createPublicClient, createWalletClient, decodeFunctionData, http, parseAbi, type Account, type Address, type PublicClient, type Transport, type WalletClient } from 'viem';
import { foundry } from 'viem/chains';

import basicResolverArtifact from '../out/BasicResolver.sol/BasicResolver.json' with { type: 'json' };

import type { SolverContext } from './context.ts';
import { process } from './process.ts';

const basicTargetAbi = parseAbi([
  'function run(string,uint256)',
]);
const blockTimeMs = 10;

const { account, publicClient, walletClient } = await startAnvil();

const chainId = await publicClient.getChainId();
const hash = await walletClient.deployContract({
  abi: basicResolverArtifact.abi,
  bytecode: basicResolverArtifact.bytecode.object as `0x${string}`,
  account,
});
const receipt = await publicClient.waitForTransactionReceipt({ hash });

assert(receipt.contractAddress, 'BasicResolver deployment failed');

const ctx: SolverContext = {
  getPublicClient: requestedChainId => {
    assert.equal(requestedChainId, BigInt(chainId), `Unsupported chain ${requestedChainId}`);
    return publicClient;
  },
  getWalletClient: requestedChainId => {
    assert.equal(requestedChainId, BigInt(chainId), `Unsupported chain ${requestedChainId}`);
    return walletClient;
  },
  paymentChain: BigInt(chainId),
  paymentRecipient: () => account,
  fillerAddress: account,
  isWhitelisted: () => true,
  getWitnessResolver: () => undefined,
  getTokenPriceUsd: () => 0n,
  getGasPriceUsd: () => 0n,
  getConfirmationThreshold: () => ({ etaFromBroadcast: 0, confirmations: 1 }),
  getTimeToBlock: async (_requestedChainId, targetBlockNumber) =>
    Math.max(0, Number(targetBlockNumber) - Number(await publicClient.getBlockNumber())) * blockTimeMs,
  getWitnessDelay: () => 0,
};

const receipts = await process(
  ctx,
  {
    address: receipt.contractAddress,
    chainId: BigInt(chainId),
  },
  new Uint8Array()
);

console.log('Setup');
console.log(`  BasicResolver deployed at ${receipt.contractAddress}`);

for (const [stepId, receipt] of receipts?.entries() ?? []) {
  if (!receipt) continue;

  const tx = await publicClient.getTransaction({ hash: receipt.transactionHash });
  assert(tx.blockNumber !== null, `Missing block number for step ${stepId}`);
  const block = await publicClient.getBlock({ blockNumber: tx.blockNumber });
  const decoded = decodeFunctionData({ abi: basicTargetAbi, data: tx.input });

  console.log(`Step ${stepId}`);
  console.log(`  To: ${tx.to}`);
  console.log(`  Data: ${decoded.functionName}(${decoded.args.map(formatValue).join(', ')})`);
  console.log(`  Block: ${tx.blockNumber}`);
  console.log(`  Timestamp: ${block.timestamp}`);
}

async function startAnvil(): Promise<{
  account: Address;
  publicClient: PublicClient<Transport, typeof foundry>;
  walletClient: WalletClient<Transport, typeof foundry, Account>;
}> {
  const rpcUrl = 'http://127.0.0.1:8545';
  const chain = foundry;
  const transport = http(rpcUrl);
  const anvil = spawn(
    'anvil',
    ['--host', '127.0.0.1', '--port', '8545', '--quiet', '--block-time', String(blockTimeMs / 1000)],
    { stdio: 'inherit' }
  );
  anvil.unref();
  onExit(() => { anvil.kill('SIGTERM'); });

  const publicClient = createPublicClient({ chain, transport, pollingInterval: 1 });

  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await publicClient.getChainId();
      const [account] = await createWalletClient({ chain, transport, pollingInterval: 1 }).getAddresses();
      assert(account, 'No JSON-RPC account available');
      const walletClient = createWalletClient({ account, chain, transport, pollingInterval: 1 });
      return { account, publicClient, walletClient };
    } catch {
      await setTimeout(100);
    }
  }

  throw new Error('Anvil did not start in time');
}

function formatValue(value: unknown): string {
  return typeof value === 'bigint'
    ? `${value}n`
    : JSON.stringify(value);
}
