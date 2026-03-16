import type { SolverContext } from './context.ts';
import type { Account } from './types.ts';
import { resolve } from './resolve.ts';
import { prequote } from './prequote.ts';
import { prefill } from './prefill.ts';
import { quote } from './quote.ts';
import { fill } from './fill.ts';

export async function process(ctx: SolverContext, resolver: Account, payload: Uint8Array): Promise<void> {
  const order = await resolve(
    ctx.getPublicClient(resolver.chainId),
    resolver.address,
    payload,
  );

  prequote(ctx, order);

  const { env, flows } = await quote(ctx, order);

  await prefill(ctx, order, env, flows);

  await fill(ctx, order, env);
}
