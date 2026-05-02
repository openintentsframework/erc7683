import type { SolverContext } from './context.ts';
import type { Account, ResolvedOrder } from './types.ts';
import type { TransactionReceipt } from 'viem';
import { resolve } from './resolve.ts';
import { prequote } from './prequote.ts';
import { prefill } from './prefill.ts';
import { quote, type AssetFlow } from './quote.ts';
import { fill } from './fill.ts';
import { VariableEnv } from './env.ts';

export interface ProcessResult {
  order: ResolvedOrder;
  env: VariableEnv;
  flows: Required<AssetFlow<bigint>>[];
  receipts: Partial<TransactionReceipt[]> | undefined;
}

export async function process(
  ctx: SolverContext,
  resolver: Account,
  payload: Uint8Array,
): Promise<ProcessResult> {
  const order = await resolve(
    ctx.getPublicClient(resolver.chainId),
    resolver.address,
    payload,
  );

  prequote(ctx, order);

  const env = new VariableEnv(ctx, order.variables);
  const { flows } = await quote(ctx, env, order);

  await prefill(ctx, order, env, flows);

  const receipts = await fill(ctx, order, env);

  return { order, env, flows, receipts };
}
