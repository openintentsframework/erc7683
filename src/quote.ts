import type { Address } from 'viem';
import { getSoftExecutionOutputs, getStepSpends, getStepTimingBounds } from './analysis.ts';
import type { SolverContext } from './context.ts';
import { envSimulateCall, envEval, type VariableEnv } from './env.ts';
import { abiEncode } from './abi-encoding.ts';
import type { Formula, ResolvedOrder, Step } from './types.ts';

const DUTCH_AUCTION_MAX_WAIT_SECONDS = 300n;

export interface QuoteResult {
  flows: Required<AssetFlow<bigint>>[];
  pnlUsd: bigint;
  decisions: QuoteDecision[];
}

export type QuoteDecision = QuoteTimingTarget;

export interface QuoteTimingTarget {
  type: 'TimingTarget';
  varIdx: number;
  stepIdx: number;
  field: 'block.timestamp';
  value: bigint;
}

export async function quote(
  ctx: SolverContext,
  env: VariableEnv,
  order: ResolvedOrder,
): Promise<QuoteResult> {
  const flowFormulas = collectFlowFormulas(order);
  const softOutputs = getSoftExecutionOutputs(order);

  // TODO: use black box optimization to estimate flow amounts whose formulas
  // depend on execution outputs that are not known at quote time, and return
  // those timing and fee decisions.
  // NOTE: formulas that depend on realized execution outputs such as inclusion
  // timing must remain compatible with hard step deadlines and execution slack.
  if (softOutputs.length > 1) {
    throw new Error('Multiple soft execution outputs are not supported');
  }

  if (softOutputs.length === 1) {
    return chooseSoftExecutionOutputTarget(ctx, env, order, flowFormulas, softOutputs[0]!);
  }

  const result = await quoteAt(ctx, env, order, flowFormulas, []);
  if (result.pnlUsd < 0n) {
    throw new Error('Negative PnL');
  }
  return result;
}

async function chooseSoftExecutionOutputTarget(
  ctx: SolverContext,
  env: VariableEnv,
  order: ResolvedOrder,
  flowFormulas: AssetFlow<Formula>[],
  output: ReturnType<typeof getSoftExecutionOutputs>[number],
): Promise<QuoteResult> {
  if (output.field !== 'block.timestamp') {
    throw new Error(`Unsupported soft execution output '${output.field}'`);
  }

  const timestampBounds = getStepTimingBounds(order, output.stepIdx, 'block.timestamp');
  const lowerBound = timestampBounds?.lowerBound && await envEval(env, timestampBounds.lowerBound);
  const upperBound = timestampBounds?.upperBound && await envEval(env, timestampBounds.upperBound);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const lower = maxBigint(now, lowerBound ?? 0n);
  const upper = minBigint(upperBound ?? lower + DUTCH_AUCTION_MAX_WAIT_SECONDS, lower + DUTCH_AUCTION_MAX_WAIT_SECONDS);

  const quoteAtTimestamp = (value: bigint) => quoteAt(ctx, env, order, flowFormulas, [{
    type: 'TimingTarget',
    varIdx: output.varIdx,
    stepIdx: output.stepIdx,
    field: 'block.timestamp',
    value,
  }]);

  const lowerQuote = await quoteAtTimestamp(lower);
  if (lowerQuote.pnlUsd >= 0n) {
    return lowerQuote;
  }

  const upperQuote = await quoteAtTimestamp(upper);
  if (upperQuote.pnlUsd < 0n) {
    throw new Error('No profitable Dutch auction target');
  }

  let lo = lower;
  let hi = upper;
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    const midQuote = await quoteAtTimestamp(mid);
    if (midQuote.pnlUsd >= 0n) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  return quoteAtTimestamp(hi);
}

function maxBigint(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

function minBigint(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

async function quoteAt(
  ctx: SolverContext,
  env: VariableEnv,
  order: ResolvedOrder,
  flowFormulas: AssetFlow<Formula>[],
  decisions: QuoteDecision[],
): Promise<QuoteResult> {
  for (const decision of decisions) {
    env.set(decision.varIdx, abiEncode(decision.value, 'uint256'));
  }

  const flows = await computeFlowAmounts(ctx, env, order, flowFormulas, decisions);
  const pnlUsd = await computePnLUsd(ctx, flows);
  return { flows, pnlUsd, decisions };
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
  order: ResolvedOrder,
  flows: AssetFlow<Formula>[],
  decisions: QuoteDecision[],
): Promise<Required<AssetFlow<bigint>>[]> {
  const evaluated: Required<AssetFlow<bigint>>[] = [];

  for (const flow of flows) {
    if (flow.token === 'gas') {
      let amount = flow.amount && await envEval(env, flow.amount);

      if (amount === undefined) {
        let blockTimestamp = flow.timestampLowerBound && await envEval(env, flow.timestampLowerBound);
        const stepIdx = order.steps.indexOf(flow.step);
        const quoteTimestamp = getQuoteTimestampLowerBound(decisions, stepIdx);
        if (quoteTimestamp !== undefined && (blockTimestamp === undefined || quoteTimestamp > blockTimestamp)) {
          blockTimestamp = quoteTimestamp;
        }
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

function getQuoteTimestampLowerBound(decisions: QuoteDecision[], stepIdx: number): bigint | undefined {
  return decisions
    .filter(decision => decision.type === 'TimingTarget')
    .filter(decision => decision.stepIdx === stepIdx)
    .reduce<bigint | undefined>(
      (max, decision) => max === undefined || decision.value > max ? decision.value : max,
      undefined
    );
}

 
