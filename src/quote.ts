import type { Address } from 'viem';
import { getStepSpends, getStepTimingBounds } from './analysis.ts';
import type { SolverContext } from './context.ts';
import { envSimulateCall, envEval, type VariableEnv } from './env.ts';
import type { Formula, ResolvedOrder, Step } from './types.ts';

interface QuoteResult {
  flows: Required<AssetFlow<bigint>>[];
  pnlUsd: bigint;
}

export async function quote(
  ctx: SolverContext,
  env: VariableEnv,
  order: ResolvedOrder,
): Promise<QuoteResult> {
  const flowFormulas = collectFlowFormulas(order);

  // TODO: use black box optimization to estimate flow amounts whose formulas
  // depend on execution outputs that are not known at quote time, and return
  // those timing and fee decisions.
  // NOTE: formulas that depend on realized execution outputs such as inclusion
  // timing must remain compatible with hard step deadlines and execution slack.
  const flowAmounts = await computeFlowAmounts(ctx, env, flowFormulas);
  const pnlUsd = await computePnLUsd(ctx, flowAmounts);

  if (pnlUsd < 0n) {
    throw new Error('Negative PnL');
  }

  return { flows: flowAmounts, pnlUsd };
}

async function computePnLUsd(
  ctx: SolverContext,
  flows: Required<AssetFlow<bigint>>[],
): Promise<bigint> {
  let pnl = 0n;

  for (const flow of flows) {
    const price = flow.token === 'gas'
      ? await ctx.getGasPriceUsd(flow.chainId)
      : await ctx.getTokenPriceUsd({ address: flow.token, chainId: flow.chainId });

    pnl += flow.amount * flow.sign * price;
  }

  return pnl;
}

export type AssetFlow<TAmount> = TokenFlow<TAmount> | GasFlow<TAmount>;

export interface TokenFlow<TAmount> {
  chainId: bigint;
  token: Address;
  amount: TAmount;
  sign: 1n | -1n;
}

export interface GasFlow<TAmount> {
  chainId: bigint;
  token: 'gas';
  amount?: TAmount;
  timestampLowerBound: Formula | undefined;
  sign: -1n;
  step: Step;
}

function collectFlowFormulas(order: ResolvedOrder): AssetFlow<Formula>[] {
  const flows: AssetFlow<Formula>[] = [];

  for (const [stepIdx, step] of order.steps.entries()) {
    const spends = getStepSpends(order, stepIdx);

    flows.push({
      chainId: step.target.chainId,
      token: 'gas',
      amount: spends.gas,
      timestampLowerBound: getStepTimingBounds(order, stepIdx, 'block.timestamp')?.lowerBound,
      step,
      sign: -1n,
    });

    for (const attribute of spends.erc20) {
      flows.push({
        chainId: attribute.token.chainId,
        token: attribute.token.address,
        amount: attribute.amount,
        sign: -1n,
      });
    }

  }

  for (const payment of order.payments) {
    if (payment.type === 'ERC20') {
      flows.push({
        chainId: payment.token.chainId,
        token: payment.token.address,
        amount: payment.amount,
        sign: 1n,
      });
    }
  }

  return flows;
}

async function computeFlowAmounts(
  ctx: SolverContext,
  env: VariableEnv,
  flows: AssetFlow<Formula>[],
): Promise<Required<AssetFlow<bigint>>[]> {
  const evaluated: Required<AssetFlow<bigint>>[] = [];

  for (const flow of flows) {
    if (flow.token === 'gas') {
      let amount = flow.amount && await envEval(env, flow.amount);

      if (amount === undefined) {
        const blockTimestamp = flow.timestampLowerBound && await envEval(env, flow.timestampLowerBound);
        const { data, gasUsed, status } = await envSimulateCall(ctx, env, flow.step, blockTimestamp);
        if (status !== 'success') {
          throw new Error(`Gas simulation failed: ${data}`);
        }
        amount = gasUsed;
      }
      evaluated.push({ ...flow, amount: amount });
    } else {
      const amount = await envEval(env, flow.amount);
      evaluated.push({ ...flow, amount: amount });
    }
  }

  return evaluated;
}

 
