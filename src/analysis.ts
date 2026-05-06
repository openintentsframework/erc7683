import type {
  Attribute_RevertPolicy,
  Attribute_SpendsERC20,
  Attribute_TimingBounds,
  Formula,
  ResolvedOrder,
  VariableRole_ExecutionOutput,
} from './types.ts';
import { memoize } from './utils.ts';

export interface Spends {
  erc20: Attribute_SpendsERC20[];
  gas?: Formula;
}

export interface DependencyNode {
  neededSteps: number[];
  inputVariables: number[];
}

export interface Dependencies {
  steps: DependencyNode[];
  variables: DependencyNode[];
}

export interface SoftExecutionOutput {
  varIdx: number;
  stepIdx: number;
  field: string;
  sourceStepIdx: number;
}

export function getStepSpends(order: ResolvedOrder, stepIdx: number): Spends {
  const spends: Spends = { erc20: [] };
  const step = order.steps[stepIdx]!;

  for (const attribute of step.attributes) {
    if (attribute.type === 'SpendsERC20')
      spends.erc20.push(attribute);

    if (attribute.type === 'SpendsGas') {
      if (spends.gas !== undefined)
        throw new Error(`Multiple ${attribute.type} attributes`);
      spends.gas = attribute.amount;
    }
  }

  return spends;
}

export function getStepInputs(order: ResolvedOrder, stepIdx: number): number[] {
  const step = order.steps[stepIdx]!;
  const spends = getStepSpends(order, stepIdx);
  const inputs = new Set<number>();

  for (const arg of step.arguments) {
    if (arg.type === 'Variable')
      inputs.add(arg.varIdx);
  }

  if (spends.gas?.type === 'Variable')
    inputs.add(spends.gas.varIdx);

  for (const attribute of step.attributes) {
    switch (attribute.type) {
      case 'TimingBounds': {
        if (attribute.lowerBound?.type === 'Variable')
          inputs.add(attribute.lowerBound.varIdx);
        if (attribute.upperBound?.type === 'Variable')
          inputs.add(attribute.upperBound.varIdx);
        break;
      }
      case 'NeedsVariable': {
        inputs.add(attribute.varIdx);
        break;
      }
    }
  }

  return [...inputs];
}

export function getStepSoftInputs(order: ResolvedOrder, stepIdx: number): number[] {
  const spends = getStepSpends(order, stepIdx);
  const inputs = new Set<number>();

  for (const { amount } of spends.erc20) {
    if (amount.type === 'Variable')
      inputs.add(amount.varIdx);
  }

  return [...inputs];
}

export function getSoftExecutionOutputs(order: ResolvedOrder): SoftExecutionOutput[] {
  const outputs = new Map<number, SoftExecutionOutput>();

  for (const [sourceStepIdx] of order.steps.entries()) {
    for (const varIdx of getStepSoftInputs(order, sourceStepIdx)) {
      for (const outputVarIdx of getVariableExecutionOutputs(order, varIdx, new Set())) {
        const role = order.variables[outputVarIdx]!;
        if (role.type !== 'ExecutionOutput') continue;

        const previous = outputs.get(outputVarIdx);
        if (previous === undefined) {
          outputs.set(outputVarIdx, {
            varIdx: outputVarIdx,
            stepIdx: role.stepIdx,
            field: role.field,
            sourceStepIdx,
          });
        }
      }
    }
  }

  return [...outputs.values()];
}

export function getStepRevertPolicies(
  order: ResolvedOrder,
  stepIdx: number,
  policy?: Attribute_RevertPolicy['policy'],
): Attribute_RevertPolicy[] {
  return order.steps[stepIdx]!.attributes
    .filter(attr => attr.type === 'RevertPolicy')
    .filter(attr => policy === undefined || attr.policy === policy);
}

export function getStepTimingBounds(order: ResolvedOrder, stepIdx: number, field: string): Attribute_TimingBounds | undefined {
  const step = order.steps[stepIdx]!;
  const matching = step.attributes
    .filter(attribute => attribute.type === 'TimingBounds')
    .filter(attribute => attribute.field === field);
  // TODO: support multiple TimingBounds attributes for the same field.
  if (matching.length > 1) {
    throw new Error(`Multiple TimingBounds attributes for '${field}'`);
  }
  return matching[0];
}

export function getStepExecutionOutputs(order: ResolvedOrder, stepIdx: number): [number, string][] {
  return order.variables
    .flatMap((role, varIdx) =>
      role.type === 'ExecutionOutput' && role.stepIdx === stepIdx
      ? [[varIdx, role.field] satisfies [number, string]]
      : []
    )
}

export function getStepNeeds(order: ResolvedOrder, stepIdx: number): number[] {
  return order.steps[stepIdx]!.attributes
    .filter(attribute => attribute.type === 'NeedsStep')
    .map(attribute => attribute.stepIdx);
}

export function getDependencies(
  order: ResolvedOrder,
): Dependencies {
  return {
    steps: order.steps.map((_, stepIdx) => ({
      neededSteps: getStepNeeds(order, stepIdx),
      inputVariables: getStepInputs(order, stepIdx),
    })),
    variables: order.variables.map((_, varIdx) => ({
      neededSteps: getVariableNeeds(order, varIdx),
      inputVariables: getVariableInputs(order, varIdx),
    })),
  };
}

function getVariableNeeds(order: ResolvedOrder, varIdx: number): number[] {
  const role = order.variables[varIdx]!;
  return role.type === 'ExecutionOutput' ? [role.stepIdx] : [];
}

function getVariableInputs(order: ResolvedOrder, varIdx: number): number[] {
  const role = order.variables[varIdx]!;
  switch (role.type) {
    case 'Witness':
      return role.variables;
    case 'Query':
      return role.arguments
        .filter(arg => arg.type === 'Variable')
        .map(arg => arg.varIdx);
    case 'PaymentRecipient':
    case 'PaymentChain':
    case 'StepCaller':
    case 'ExecutionOutput':
    case 'QueryEvents':
      return [];
    default:
      throw new Error(`Unsupported variable type`);
  }
}

function* getVariableExecutionOutputs(
  order: ResolvedOrder,
  varIdx: number,
  visited: Set<number>,
): Iterable<number> {
  if (visited.has(varIdx)) return;
  visited.add(varIdx);

  const role = order.variables[varIdx]!;
  switch (role.type) {
    case 'ExecutionOutput': {
      yield varIdx;
      break;
    }

    case 'Query': {
      for (const arg of role.arguments) {
        if (arg.type === 'Variable') {
          yield* getVariableExecutionOutputs(order, arg.varIdx, visited);
        }
      }
      break;
    }

    case 'Witness': {
      for (const depIdx of role.variables) {
        yield* getVariableExecutionOutputs(order, depIdx, visited);
      }
      break;
    }
  }
}

// Returns, for each step, the step itself plus all steps that must execute before it.
export function getDependencyClosure(order: ResolvedOrder): Map<number, Set<number>> {
  const deps = getDependencies(order);

  const visitDeps = (deps: DependencyNode) =>
    new Set([
      ...deps.neededSteps.values().flatMap(visitStep),
      ...deps.inputVariables.values().flatMap(visitVariable),
    ]);

  const visitStep = memoize((stepIdx: number): Set<number> =>
    visitDeps(deps.steps[stepIdx]!).add(stepIdx));

  const visitVariable = memoize((varIdx: number): Set<number> =>
    visitDeps(deps.variables[varIdx]!));

  order.steps.forEach((_, stepIdx) => visitStep(stepIdx));

  return visitStep.results;
}
