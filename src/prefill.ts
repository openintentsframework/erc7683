import type { SolverContext } from './context.ts';
import { getDependencies, getStepOutputs, type DependencyNode } from './analysis.ts';
import { envEval, type VariableEnv } from './env.ts';
import type { AssetFlow } from './quote.ts';
import type { Formula, ResolvedOrder } from './types.ts';
import { memoize } from './utils.ts';

export async function prefill(
  ctx: SolverContext,
  order: ResolvedOrder,
  env: VariableEnv,
  flows: Required<AssetFlow<bigint>>[],
): Promise<void> {
  // TODO: check inventory, limits, and ERC-20 allowance here.
  await validateWorstCaseCompletion(ctx, order, env, flows);
}

async function validateWorstCaseCompletion(
  ctx: SolverContext,
  order: ResolvedOrder,
  env: VariableEnv,
  flows: Required<AssetFlow<bigint>>[],
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const dependencies = getDependencies(order);

  const stepBounds = await Promise.all(order.steps.map(async (step, stepIdx) => {
    const outputs = getStepOutputs(order, stepIdx);

    const evalBound = async (bound?: Formula) =>
      bound && Number(await envEval(env, bound));

    const [
      timestampLower = -Infinity,
      timestampUpper = +Infinity,
      blockNumberLower,
      blockNumberUpper,
    ] = await Promise.all([
      evalBound(outputs['block.timestamp']?.lowerBound),
      evalBound(outputs['block.timestamp']?.upperBound),
      evalBound(outputs['block.number']?.lowerBound),
      evalBound(outputs['block.number']?.upperBound),
    ]);

    const etaBlock = async (blockNumber: number) =>
      now + await ctx.getTimeToBlock(step.target.chainId, blockNumber, flows);

    const [etaBlockLower, etaBlockUpper] = await Promise.all([
      blockNumberLower ? etaBlock(blockNumberLower - 1) : Promise.resolve(-Infinity),
      blockNumberUpper ? etaBlock(blockNumberUpper) : Promise.resolve(+Infinity),
    ]);

    return [
      Math.max(timestampLower, etaBlockLower),
      Math.min(timestampUpper, etaBlockUpper),
    ] as const;
  }));

  const getDepsReadyTime = (deps: DependencyNode) =>
    Math.max(
      now,
      ...deps.neededSteps.map(visitStep),
      ...deps.inputVariables.map(visitVariable),
    );

  const visitStep = memoize((stepIdx: number): number => {
    const step = order.steps[stepIdx]!;
    const depsReadyTime = getDepsReadyTime(dependencies.steps[stepIdx]!);
    const confirmationThreshold = ctx.getConfirmationThreshold(step.target.chainId, flows);

    const [lowerBound, upperBound] = stepBounds[stepIdx]!;
    const executionTime = Math.max(lowerBound, depsReadyTime);
    const completionTime = executionTime + confirmationThreshold.etaFromBroadcast;

    if (completionTime > upperBound)
      throw new Error(`Step ${stepIdx} worst-case completion misses deadline`);

    return completionTime;
  });

  const visitVariable = memoize((varIdx: number): number => {
    const variable = order.variables[varIdx]!;
    const depsReadyTime = getDepsReadyTime(dependencies.variables[varIdx]!);

    if (variable.type === 'Witness')
      return depsReadyTime + ctx.getWitnessDelay(variable.kind, variable.data);

    return depsReadyTime;
  });

  for (const stepIdx of order.steps.keys()) {
    visitStep(stepIdx);
  }
}
