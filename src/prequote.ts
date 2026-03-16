import type { SolverContext } from './context.ts';
import { getDependencyClosure, getStepRevertPolicies, getStepSpends } from './analysis.ts';
import type { ResolvedOrder } from './types.ts';

export function prequote(ctx: SolverContext, order: ResolvedOrder): void {
  // TODO: validate well-formedness:
  // - every referenced step and variable index fails with a clear validation error
  // - output bounds are uint256-compatible
  checkValidRevertPolicies(order);

  for (const assumption of order.assumptions) {
    if (!ctx.isWhitelisted(assumption.trusted, assumption.kind)) {
      throw new Error(`Untrusted account ${assumption.trusted.address} kind '${assumption.kind}'`);
    }
  }

  for (const variable of order.variables) {
    if (variable.type === 'Witness' && !ctx.getWitnessResolver(variable.kind)) {
      throw new Error(`Unsupported witness kind '${variable.kind}'`);
    }
  }
}

function checkValidRevertPolicies(order: ResolvedOrder): void {
  const dependencyClosure = getDependencyClosure(order);

  const abortStepIds = new Set(
    order.steps.flatMap((_, stepId) => isAbortStep(order, stepId) ? [stepId] : [])
  );

  const isAbortGated = (stepId: number) =>
    dependencyClosure.get(stepId)!.isSupersetOf(abortStepIds);

  if (order.steps.some((_, stepId) => isFillStep(order, stepId) && !isAbortGated(stepId))) {
    throw new Error('Invalid RevertPolicy order');
  }
}

function isFillStep(order: ResolvedOrder, stepIdx: number): boolean {
  return getStepSpends(order, stepIdx).erc20.length > 0;
}

function isAbortStep(order: ResolvedOrder, stepIdx: number): boolean {
  return getStepRevertPolicies(order, stepIdx, 'abort').length > 0;
}
