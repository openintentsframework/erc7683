# ERC-7683 Redux Specification

For an introduction see [ERC-7683 Redux: Programmable Fillers](https://ethereum-magicians.org/t/erc-7683-redux-programmable-fillers/27674).

## Key Terms

- **Order**: An offer of payment in exchange for the fulfillment of a set of requirements.
- **Solver**: An actor that fulfills order requirements.
- **Payload**: An encoding of an order as a bytestring.
- **Resolver**: A payload decoder and order validator and guarantor.

## Orders

An order's requirements are expressed as a list of **steps** and a list of **variables**.

To fulfill the requirements of an order, each step MUST be executed as specified, and variable values MUST be decided as specified and used consistently.

A step or variable can have *hard dependencies* on other steps and variables as documented below. Not every mention of a variable is a hard dependency. Hard dependencies MUST be acyclic. Fulfillment MUST proceed in hard-dependency order, i.e., a step MUST NOT execute before its hard dependencies have successfully executed.

A step MAY abort the order. When aborted, requirements are not fulfilled and no payment is offered.

### Step: `Call`

Parameters:

- `target`: An interoperable address.
- `selector`: A 4-byte function selector.
- `arguments`: A list of function arguments, each a constant or a variable.
- `attributes`: A list of attributes.

To execute the step a solver MUST evaluate each element of `arguments` to a constant, encode them into call data together with `selector` (see Values and Encoding), and submit a transaction that makes a call to `target` with said data.

The step has a hard dependency on all variables mentioned in `arguments`.

Each element of `attributes` determines additional requirements or options.

#### Attribute: `NeedsStep`

Parameters:

- `stepIdx`: The index of a step in the order.

The call has a hard dependency on the step numbered `stepIdx`.

The attribute MAY be omitted if the dependency is implied by a hard dependency on a variable.

#### Attribute: `NeedsVariable`

Parameters:

- `varIdx`: The index of a variable in the order.

The call has a hard dependency on the variable numbered `varIdx`.

The attribute MAY be omitted if the dependency is implied by the call arguments, formulas, or another variable dependency.

#### Attribute: `SpendsERC20`

Parameters:

- `token`: An interoperable address of an ERC-20 token on the chain where the call is made.
- `amountFormula`: An amount of the token, as a constant or a variable.
- `spender`, `recipient`: Interoperable addresses on the chain.

The call MAY transfer tokens from the caller, up to the amount given by `amountFormula`, using `transferFrom` on `token` called from `spender`. The tokens SHOULD be transferred to `recipient`.

The solver MUST ensure the caller account has balance of `token` and allowance for `spender` of at least said amount.

The call does not have a hard dependency on the variables in `amountFormula`. In particular, the formula MAY depend on step outputs such as inclusion timing (e.g., block timestamp). If the formula depends on timing, the amount SHOULD decrease with time so that a tight upper bound can be estimated by the solver.

#### Attribute: `SpendsGas`

Parameters:

- `amountFormula`: An amount of gas, as a constant or a variable.

The call MAY consume up to the amount given by `amountFormula`.

The solver MUST ensure the call executes with a gas limit of at least said amount of gas.

If this attribute is omitted, the solver MAY estimate gas cost by simulation prior to execution of any other step in the order. If simulation fails due to missing prerequisites, the order SHOULD include this attribute.

The call has a hard dependency on the variables in `amountFormula`.

#### Attribute: `RevertPolicy`

Parameters:

- `policy`: An identifier for a policy; `"ignore"` or `"abort"`.
- `expectedReason`: A bytestring prefix.

The call MAY revert.

If the call would revert with data that begins with `expectedReason`, the solver MUST proceed according to `policy`:

- `ignore`: The step MUST be considered executed. The solver MAY safely skip this action and proceed with fulfillment. An included reverted transaction MUST NOT be required.
- `abort`: The entire order MUST be aborted.

A call MUST NOT revert without a matching `RevertPolicy` attribute.

#### Attribute: `TimingBounds`

Parameters:

- `field`: A timing field; `"block.number"` or `"block.timestamp"`.
- `lowerBound`: An optional number.
- `upperBound`: An optional number.

The call MUST be included onchain such that the value of `field` observed when executed is at least `lowerBound` and at most `upperBound`.

### Variables

An order includes variables as placeholders for values that the solver decides.

Each variable MUST be decided as specified by its variable role. Once a value is decided it MUST be used consistently wherever the variable is referenced.

#### Role: `PaymentRecipient`

No parameters.

The variable MUST be assigned to the account where the solver prefers to receive payment.

#### Role: `PaymentChain`

No parameters.

The variable MUST be assigned to the ID of the chain where the solver prefers to receive payment.

#### Role: `StepCaller`

Parameters:

- `stepIdx`: The index of a step in the order.

The variable MUST be assigned to the account used as the caller when executing the step numbered `stepIdx`.

#### Role: `ExecutionOutput`

Parameters:

- `field`: A field identifier that can be captured from execution; `"block.number"`, `"block.timestamp"`, or `"receipt.effectiveGasPrice"`.
- `stepIdx`: The index of a step in the order.

The variable MUST be assigned to the value observed in execution. For example, the `"block.number"` field must be the block number where the call in a step was included onchain.

The variable has a hard dependency on the step numbered `stepIdx`.

#### Role: `Witness`

Parameters:

- `kind`: An identifier for a kind of witness.
- `data`: A bytestring as expected by the witness kind.
- `variables`: A list of indices of variables in the order.

`kind` MUST identify some offchain procedure by which the solver can obtain a value, as a function of `data` and the values of `variables`.

The variable MUST be assigned to the result of invoking this procedure.

The variable has a hard dependency on all variables mentioned in `variables`.

#### Role: `Query`

Parameters:

- `target`: An interoperable address.
- `selector`: A 4-byte function selector.
- `arguments`: A list of function arguments, each a constant or a variable.
- `blockNumber`: An optional block number.

The solver MUST evaluate each element of `arguments` to a constant, encode them into call data together with `selector` (see Values and Encoding), and invoke `eth_call` to `target` with said data.

If `blockNumber` is omitted, the latest block is used.

The call MUST NOT revert, and the variable MUST be assigned to the value produced by interpreting the value returned by `eth_call` as a framed ABI encoding (see Values and Encoding).

#### Role: `QueryEvents`

Parameters:

- `emitter`: An interoperable address.
- `topic0`, `topic1`, `topic2`, `topic3`: Optional 32-byte values.
- `blockNumber`: An optional block number.

The solver MUST invoke `eth_getLogs` for `emitter` at `blockNumber` filtered by the provided topics.

If `blockNumber` is omitted, the latest block is used.

The variable MUST be assigned to the results of `eth_getLogs` as the framed ABI encoding (see Values and Encoding) of an array of the following struct.

```solidity
struct EthLog {
    address emitter;
    bytes32[] topics;
    bytes data;
    uint256 blockNumber;
    bytes32 transactionHash;
    uint256 transactionIndex;
    bytes32 blockHash;
    uint256 logIndex;
}
```

### Payments

An order includes a list of payments that will be made.

#### Payment: `ERC20`

Parameters:

- `token`: An interoperable address of an ERC-20 token.
- `sender`: An interoperable address.
- `amountFormula`: An amount of the token, as a constant or a variable.
- `recipientVarIdx`: The index of a `PaymentRecipient` variable.
- `onStepIdx`: The index of a step in the order.
- `estimatedDelaySeconds`: A duration in seconds.

When the step numbered `onStepIdx` is executed, a payment MUST be made of at least the amount given by `amountFormula` of `token` sourced from `sender`. The payment MUST be transferred to the address value of the variable numbered `recipientVarIdx`, on the chain indicated by `token`. The payment SHOULD be delayed by `estimatedDelaySeconds` with high confidence.

## Values and Encoding

Values assigned to variables are untyped and represented only by their ABI encoding and whether they are statically or dynamically sized.

Some contexts that consume values may interpret them as a particular type. For example, the amount formula of `SpendsGas` is interpreted as `uint256`.

### Framed ABI Encoding

In the EVM, values are represented by their *framed ABI encoding*.

The framed ABI encoding of a value is the canonical ABI encoding of the two-element tuple `("", value)`, whose first element is the empty string and whose second element is the value. In Solidity, it is the bytes produced by `abi.encode("", value)`.

A framed ABI encoding corresponds to a dynamically sized value exactly when it starts with the 96-byte prefix
```
0000000000000000000000000000000000000000000000000000000000000040
0000000000000000000000000000000000000000000000000000000000000060
0000000000000000000000000000000000000000000000000000000000000000
```
The remaining bytes after the prefix are the ABI encoding of the value on its own.

A framed ABI encoding for a statically sized value begins with a 32-byte prefix and ends with a 32-byte suffix. The remaining bytes in between prefix and suffix are the ABI encoding of the value. The numeric value of the prefix will be exactly 32 plus the length of the value encoding, and the suffix will be the zero word.

### Call Data Encoding

To encode call data, concatenate the 4-byte function selector with the ABI encoding of the function arguments.

The ABI encoding of the function arguments is like [standard ABI encoding](https://docs.soliditylang.org/en/v0.8.34/abi-spec.html#formal-specification-of-the-encoding). For statically sized values, the head is its ABI encoding, and the tail is empty. For dynamically sized values, the head is the offset to the tail, and the tail is the ABI encoding.

## Resolvers

An order can be transmitted in the form of a **payload** encoded for a specific **resolver**.

A resolver provides a way to decode the payload as an order (i.e., steps, variables, and payments), validating and guaranteeing that the order is well formed and safe for solvers, except for additional named **assumptions** that the resolver cannot check for itself.

A resolver MUST guarantee that an order may only abort as explicitly specified in revert policies. If no abort policy is triggered, a solver that begins to execute the steps of an order MUST be able to fulfill all requirements and receive all payments.

Liveness and censorship resistance of the underlying chains MAY be implicitly assumed. A particular resolver MAY make and document additional implicit assumptions (e.g., the security of a particular protocol). A solver MUST review all such implicit assumptions before a trusting a resolver.

Liveness and censorship resistance of any tokens used in `SpendsERC20` attributes MAY be implicitly assumed.

### Named Assumptions

Additional assumptions for a given order must be identified by a name and may be parameterized by data.

A solver MUST validate the assumption (e.g., checking against a whitelist) before fulfilling the order.

```solidity
struct Assumption {
    string name;
    bytes data;
}
```

### EVM Resolvers

A resolver can be implemented and deployed as a contract for the EVM with the `IResolver` interface.

```solidity
interface IResolver {
    struct ResolvedOrder {
        /// Array of `IStep` ABI calldata.
        bytes[] steps;
        /// Array of `IVariableRole` ABI calldata.
        bytes[] variables;
        /// Array of `IPayment` ABI calldata.
        bytes[] payments;
        Assumption[] assumptions;
    }

    struct Assumption {
        string name;
        bytes data;
    }

    function resolve(bytes calldata payload) external view returns (ResolvedOrder memory);
}

interface IStep {
    /// @param arguments Each element is either an ABI-encoded variable index, or a framed ABI encoding of a value.
    /// @param attributes Each element is `IAttribute` ABI calldata.
    function Call(
        bytes calldata target,
        bytes4 selector,
        bytes[] calldata arguments,
        bytes[] calldata attributes
    ) external;
}

interface IVariableRole {
    function PaymentRecipient() external;
    function PaymentChain() external;
    function StepCaller(uint256 stepIdx) external;
    function ExecutionOutput(string calldata field, uint256 stepIdx) external;
    function Witness(string calldata kind, bytes calldata data, uint256[] calldata variables) external;
    /// @param arguments Each element is a variable index or a framed ABI encoding.
    /// @param blockNumber `uint256(-1)` means none.
    function Query(bytes calldata target, bytes4 selector, bytes[] calldata arguments, uint256 blockNumber) external;
    /// @param topicMatch Bitmask of topics to filter by; e.g., `0x01` filters by `topic0` only.
    /// @param blockNumber `uint256(-1)` means none.
    function QueryEvents(bytes calldata emitter, bytes1 topicMatch, bytes32 topic0, bytes32 topic1, bytes32 topic2, bytes32 topic3, uint256 blockNumber) external;
}

interface IPayment {
    /// @param amountFormula `IFormula` ABI calldata.
    function ERC20(bytes calldata token, bytes calldata sender, bytes calldata amountFormula, uint256 recipientVarIdx, uint256 onStepIdx, uint256 estimatedDelaySeconds) external;
}

interface IAttribute {
    /// @param amountFormula `IFormula` ABI calldata.
    function SpendsERC20(bytes calldata token, bytes calldata amountFormula, bytes calldata spender, bytes calldata recipient) external;
    /// @param amountFormula `IFormula` ABI calldata.
    function SpendsGas(bytes calldata amountFormula) external;
    /// @param lowerBound Empty, or `IFormula` ABI calldata.
    /// @param upperBound Empty, or `IFormula` ABI calldata.
    function TimingBounds(string calldata field, bytes calldata lowerBound, bytes calldata upperBound) external;
    function NeedsStep(uint256 stepIdx) external;
    function NeedsVariable(uint256 varIdx) external;
    function RevertPolicy(string calldata policy, bytes calldata expectedReason) external;
}

interface IFormula {
    function Constant(uint256 val) external;
    function Variable(uint256 varIdx) external;
}
```
