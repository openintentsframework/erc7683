import type { Hex, PublicClient, TransactionReceipt } from 'viem';
import type { SolverContext } from './context.ts';
import { getDependencies, getStepOutputs, getStepRevertPolicies, type DependencyNode } from './analysis.ts';
import { buildCallData, envEval } from './env.ts';
import { abiEncode } from './abi-wrap.ts';
import type { VariableEnv } from './env.ts';
import type { ResolvedOrder } from './types.ts';
import { memoize } from './utils.ts';

class ResolverError extends Error {
  constructor() { super("resolver error") }
}

class AbortOrderError extends Error {
  constructor() { super("abort order") }
}

export async function fill(
  ctx: SolverContext,
  order: ResolvedOrder,
  env: VariableEnv,
): Promise<boolean> {
  const dependencies = getDependencies(order);

  const waitForDependencies = (deps: DependencyNode): Promise<unknown> =>
    Promise.all([
      ...deps.neededSteps.map(visitStep),
      ...deps.inputVariables.map(visitVariable),
    ]);

  const visitStep = memoize(async (stepId: number) => {
    await waitForDependencies(dependencies.steps[stepId]!);
    await waitForStepLowerBound(ctx, env, order, stepId);
    await executeStep(ctx, env, order, stepId);
  });

  const visitVariable = memoize(async (varIdx: number) => {
    await waitForDependencies(dependencies.variables[varIdx]!);
    const role = order.variables[varIdx];
    if (role?.type === 'Witness') {
      const values = await Promise.all(role.variables.map(depIdx => env.get(depIdx)));
      const resolved = await ctx.getWitnessResolver(role.kind)!.resolve(role.data, values);
      env.set(varIdx, resolved);
    }
  });

  try {
    await Promise.all(order.steps.map((_, stepId) => visitStep(stepId)));
    return true;
  } catch (error) {
    if (error instanceof AbortOrderError)
      return false;
    throw error;
  }
}

async function executeStep(
  ctx: SolverContext,
  env: VariableEnv,
  order: ResolvedOrder,
  stepId: number,
): Promise<void> {
  const step = order.steps[stepId]!;
  const walletClient = ctx.getWalletClient(step.target.chainId);
  const publicClient = ctx.getPublicClient(step.target.chainId);
  const { confirmations } = ctx.getConfirmationThreshold(step.target.chainId, null);

  const callData = await buildCallData(env, step);
  let revertData = await simulateRevert(
    publicClient,
    ctx.fillerAddress,
    step.target.address,
    callData,
  );

  if (!revertData) {
    const txhash = await walletClient.sendTransaction({
      account: ctx.fillerAddress,
      to: step.target.address,
      data: callData,
    });

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txhash,
      confirmations,
    });

    if (receipt.status === 'success') {
      await applyExecutionOutputs(env, publicClient, receipt, order, stepId);
    } else {
      revertData = await simulateRevert(
        publicClient,
        ctx.fillerAddress,
        step.target.address,
        callData,
        receipt.blockNumber,
      );

      if (!revertData)
        throw new ResolverError();
    }
  }

  if (revertData) {
    const revertDataLower = revertData.toLowerCase();
    const revertPolicy = getStepRevertPolicies(order, stepId).find(policy =>
      revertDataLower.startsWith(policy.expectedReason.toLowerCase())
    )?.policy;

    switch (revertPolicy) {
      case 'abort':
        throw new AbortOrderError();
      case 'ignore':
        return;
      default:
        throw new ResolverError();
    }
  }
}

async function sleepUntilTimestamp(timestampSeconds: bigint): Promise<void> {
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  if (nowSeconds >= timestampSeconds) return;
  const sleepMs = Number((timestampSeconds - nowSeconds) * 1000n);
  await new Promise(resolve => setTimeout(resolve, sleepMs));
}

async function waitForStepLowerBound(
  ctx: SolverContext,
  env: VariableEnv,
  order: ResolvedOrder,
  stepId: number,
): Promise<void> {
  const step = order.steps[stepId]!;
  const outputs = getStepOutputs(order, stepId);
  const [targetSeconds, targetBlockNumber] = await Promise.all(
    [
      outputs['block.timestamp'],
      outputs['block.number'],
    ].map(
      output => output?.lowerBound && envEval(env, output.lowerBound)
    )
  );
  await Promise.all([
    targetSeconds && sleepUntilTimestamp(targetSeconds),
    targetBlockNumber && new Promise<void>((resolve, reject) => {
      const publicClient = ctx.getPublicClient(step.target.chainId);
      const unwatch = publicClient.watchBlockNumber({
        emitOnBegin: true,
        onBlockNumber: blockNumber =>
          (blockNumber + 1n >= targetBlockNumber) && (unwatch(), resolve()),
        onError: error => (unwatch(), reject(error)),
      });
    }),
  ]);
}

async function simulateRevert(
  publicClient: PublicClient,
  account: `0x${string}`,
  to: `0x${string}`,
  data: Hex,
  blockNumber?: bigint,
): Promise<Hex | undefined> {
  const { results: [result] } = await publicClient.simulateCalls({
    account,
    blockNumber,
    calls: [{ to, data }],
  });
  return result?.status === 'failure' ? result.data : undefined;
}

async function applyExecutionOutputs(
  env: VariableEnv,
  publicClient: PublicClient,
  receipt: TransactionReceipt,
  order: ResolvedOrder,
  stepId: number,
): Promise<void> {
  const outputs = getStepOutputs(order, stepId);
  let blockPromise: ReturnType<PublicClient['getBlock']> | undefined;
  const getBlock = () => blockPromise ??= publicClient.getBlock({ blockNumber: receipt.blockNumber });

  for (const output of Object.values(outputs)) {
    if (!output) continue;

    switch (output.field) {
      case 'block.number': {
        env.set(output.varIdx, abiEncode(receipt.blockNumber, 'uint256'));
        break;
      }

      case 'block.timestamp': {
        const block = await getBlock();
        env.set(output.varIdx, abiEncode(block.timestamp, 'uint256'));
        break;
      }

      case 'receipt.effectiveGasPrice': {
        env.set(output.varIdx, abiEncode(receipt.effectiveGasPrice, 'uint256'));
        break;
      }

      default:
        throw new Error(`Unsupported Outputs field '${output.field}'`);
    }
  }
}
