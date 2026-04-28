import type {
  Attribute_Outputs,
  Attribute_RevertPolicy,
  Attribute_SpendsERC20,
  Formula,
  ResolvedOrder,
} from './types.ts';
import { memoize } from './utils.ts';

export interface Spends {
  erc20: Attribute_SpendsERC20[];
  gas?: Formula;
}

export type Outputs = Record<string, Attribute_Outputs>;

export interface DependencyNode {
  neededSteps: number[];
  inputVariables: number[];
}

export interface Dependencies {
  steps: DependencyNode[];
  variables: DependencyNode[];
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
  const outputs = getStepOutputs(order, stepIdx);
  const inputs = new Set<number>();

  for (const arg of step.arguments) {
    if (arg.type === 'Variable')
      inputs.add(arg.varIdx);
  }

  for (const { amount } of spends.erc20) {
    if (amount.type === 'Variable')
      inputs.add(amount.varIdx);
  }

  if (spends.gas?.type === 'Variable')
    inputs.add(spends.gas.varIdx);

  for (const { lowerBound, upperBound } of Object.values(outputs)) {
    if (lowerBound?.type === 'Variable')
      inputs.add(lowerBound.varIdx);
    if (upperBound?.type === 'Variable')
      inputs.add(upperBound.varIdx);
  }

  return [...inputs];
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

export function getStepOutputs(order: ResolvedOrder, stepIdx: number): Outputs {
  const outputs: Outputs = {};
  const step = order.steps[stepIdx]!;

  for (const attribute of step.attributes) {
    if (attribute.type !== 'Outputs')
      continue;

    switch (attribute.field) {
      case 'block.timestamp':
      case 'block.number':
      case 'receipt.effectiveGasPrice':
        if (attribute.field in outputs)
          throw new Error(`Invalid Outputs: each field may be assigned at most once per step`);
        outputs[attribute.field] = attribute;
        break;

      default:
        throw new Error(`Unsupported Outputs field '${attribute.field}'`);
    }
  }

  if (Object.keys(outputs).length > 0 && getStepRevertPolicies(order, stepIdx, 'ignore').length > 0) {
    throw new Error(`Invalid Outputs: steps with outputs may not use ignore revert policy`);
  }

  return outputs;
}

export function getStepNeeds(order: ResolvedOrder, stepIdx: number): number[] {
  return order.steps[stepIdx]!.attributes
    .filter(attribute => attribute.type === 'NeedsStep')
    .map(attribute => attribute.stepIdx);
}

export function getVariableProducers(order: ResolvedOrder): Map<number, number> {
  const producers = new Map<number, number>();

  for (const stepIdx of order.steps.keys()) {
    for (const output of Object.values(getStepOutputs(order, stepIdx))) {
      if (order.variables[output.varIdx]?.type !== 'ExecutionOutput')
        throw new Error(`Invalid Outputs: targets must be ExecutionOutput variables`);
      if (producers.has(output.varIdx))
        throw new Error(`Invalid Outputs: variables must be assigned by at most one output`);
      producers.set(output.varIdx, stepIdx);
    }
  }

  return producers;
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
  if (order.variables[varIdx]!.type !== 'ExecutionOutput')
    return [];

  const producer = getVariableProducers(order).get(varIdx);
  if (producer === undefined)
    throw new Error(`Invalid Outputs: ExecutionOutput variable ${varIdx} is never produced`);

  return [producer];
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
    case 'Pricing':
    case 'ExecutionOutput':
    case 'QueryEvents':
      return [];
    default:
      throw new Error(`Unsupported variable type`);
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
