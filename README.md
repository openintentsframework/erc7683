# ERC-7683 Redux Demo

[ERC-7683 Redux: Programmable Fillers](https://ethereum-magicians.org/t/erc-7683-redux-programmable-fillers/27674)

## Order

An order consists of lists of steps, variables, payments, and assumptions.

Steps and variables determine a set of requirements. A solver that fulfills these requirements will receive the order payments, unless one of the steps aborts the order. This is subject to trust in the order resolver and any included assumptions.

### Requirements

The central requirement for an order to be fulfilled is the execution of all steps. These may use variables as inputs, which in turn may be the outputs of prior steps. These dependencies determine the order in which steps can be executed.

#### Step: Call

A `Call` step is fulfilled by an onchain call to a target contract, specified by a function selector, list of arguments, and list of attributes.

Attributes provide additional constraints and instructions:

- `SpendsERC20`: The call consumes up to some amount of an ERC-20 token.
- `SpendsGas`: The call consumes gas up to some amount. If omitted, gas may be estimated by simulation prior to execution.
- `NeedsStep`: The call requires another step to have been executed before it.
- `Outputs`: The call produces certain outputs (eg., inclusion timestamp) that must fall within lower and/or upper bounds, if specified.
- `RevertPolicy`: The call may revert with a matching revert reason, when this is observed it must be handled according to a policy:
    - `ignore`: The reverting step can be ignored and execution proceed to other steps.
    - `abort`: The entire order must be aborted.

In addition to explicit `NeedsStep` dependencies, the step implicitly depends on all variables used in arguments and attributes.

Requirements are not automatically enforced by target contracts. If a call is executed with unmet requirements, behavior is unspecified.

#### Variable: Payment Recipient

A `PaymentRecipient` variable is assigned to the solver's payment recipient on the specified chain.

#### Variable: Payment Chain

A `PaymentChain` variable is assigned to the solver's preferred payment chain.

#### Variable: Pricing

A `Pricing` variable is a solver-chosen decision variable used to set the prices at which assets are bought or sold. The effect will be observed in spends and payments formulas that depend on this the variable.

#### Variable: Execution Output

An `ExecutionOutput` variable must be assigned from an observed execution outcome of the step that binds it via an `Outputs` attribute.

#### Variable: Witness

A `Witness` variable is some offchain computation, a function of order data and variables, identified by the witness kind. It may depend on a service external to the solver.

#### Variable: Query

A `Query` variable is computed by an offchain call to a target contract, specified by a function selector, list of arguments, and block number. A block number of `uint256(-1)` indicates the latest block.

#### Variable: Query Events

A `QueryEvents` variable is computed by querying logs from a specified emitter and block number, optionally filtered by topics. A block number of `uint256(-1)` indicates the latest block.
