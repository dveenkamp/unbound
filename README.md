# Unbound

Composable deferred commands with pluggable interpreters.

Unbound lets application code describe service operations without directly accessing configured clients. Instead of importing a DynamoDB client to write an item, you could build a command such as `putItem(...)` and execute it with `exec`. The runner routes that command to the registered service.

Configure each service once when creating a runtime. Application code can then compose operations across databases, storage, authentication, and other integrations through the same execution interface. Different runtimes can execute those commands using different service configurations.

Commands remain deferred until executed, so they can be composed sequentially, run in parallel, or yielded from generators.

This core package has no runtime dependencies. Integrations provide their own command builders, service implementations, and dependencies outside this package.

## Installation

```bash
pnpm add @dveenkamp/unbound
```

Unbound uses ES modules.

## Quick start

```js
import {
  createLeafCommand,
  createService,
  createRuntime,
} from "@dveenkamp/unbound";

const MathCommand = createLeafCommand("MathCommand", "math");

class Multiply {
  send({ a, b }) {
    return a * b;
  }
}

const mathService = createService({
  init: () => ({}),

  send(_resource, cmd) {
    const { type: Operation, command: params } = cmd.extract();
    return new Operation().send(params);
  },
});

const runtime = createRuntime({
  math: mathService,
});

try {
  const result = await runtime.exec(MathCommand.of(Multiply, { a: 3, b: 4 }));

  console.log(result); // 12
} finally {
  await runtime.cleanup();
}
```

The runner uses the command's `commandType` to select a service. The service receives the command unchanged and decides how to execute its operation.

## Sequential composition

Use `chain` to build a command that depends on an earlier result:

```js
const command = MathCommand.of(Multiply, { a: 3, b: 4 }).chain((result) =>
  MathCommand.of(Multiply, { a: result, b: 2 }),
);

const result = await runtime.exec(command); // 24
```

Leaf and parallel commands create a deferred sequence when chained. A sequence continuation can return a command or an ordinary value.

`PureCommand.chain` calls its continuation immediately and returns its result directly.

## Parallel composition

```js
import { ParCommand } from "@dveenkamp/unbound";

const command = new ParCommand([
  MathCommand.of(Multiply, { a: 2, b: 3 }),
  MathCommand.of(Multiply, { a: 4, b: 5 }),
]);

const results = await runtime.exec(command); // [6, 20]
```

Results preserve input order. `concat` also combines commands into parallel groups.

Parallel execution uses `Promise.all`. If one command fails, execution rejects without canceling or waiting for the remaining commands. Parallel groups are not transactions.

## Generator notation

Use `runtime.run` to invoke a function. If it returns a generator, Unbound executes its yielded commands and passes their results back into the generator.

```js
const result = await runtime.run(function* (start) {
  const first = yield MathCommand.of(Multiply, {
    a: start,
    b: 3,
  });

  const second = yield MathCommand.of(Multiply, {
    a: first,
    b: 2,
  });

  return second;
}, 4);

// result === 24
```

Generators must yield commands.

Ordinary values and promises are also supported:

```js
await runtime.run((a, b) => a + b, 2, 3); // 5
await runtime.run(async () => "done"); // "done"
```

A command returned directly by an ordinary function is returned unchanged. Use `runtime.exec` to execute it.

You can also interpret a generator explicitly:

```js
import { Do } from "@dveenkamp/unbound";

const result = await runtime.exec(
  Do(function* () {
    return yield MathCommand.of(Multiply, { a: 2, b: 3 });
  }),
);
```

## Command types

| Type           | Purpose                                           |
| -------------- | ------------------------------------------------- |
| `PureCommand`  | Holds a value                                     |
| `EmptyCommand` | Represents no work; executes to `undefined`       |
| `LeafCommand`  | Base class for service-specific commands          |
| `SeqCommand`   | Executes a command, then invokes its continuation |
| `ParCommand`   | Executes child commands concurrently              |

### Mapping

`map` transforms command descriptions rather than execution results.

```js
const command = MathCommand.of(Multiply, { a: 2, b: 3 });

const updated = command.map((descriptor) => ({
  ...descriptor,
  command: { ...descriptor.command, b: 5 },
}));
```

`PureCommand.map` transforms its stored value. Parallel and sequence commands map their children, including commands produced by sequence continuations.

Use `chain` when subsequent work should depend on an execution result.

## Services

A service implements:

- `init()`: prepares resources; may return a value or promise.
- `send(command)`: executes a leaf command.
- `cleanup()`: optionally releases resources.

The runner awaits `init()` before each leaf execution. Services must tolerate repeated and concurrent initialization calls.

The optional `createService` factory handles that lifecycle:

```js
const service = createService({
  init: () => createResource(),

  send: (resource, command) => executeOperation(resource, command),

  cleanup: (resource) => resource.close(),
});
```

The factory:

- Initializes lazily.
- Shares one initialization promise across concurrent callers.
- Caches the initialized resource.
- Allows retry after initialization failure.
- Awaits cleanup and resets initialization state afterward.

Service callbacks supply integration-specific behavior. Unbound does not require a particular client, SDK, or operation implementation.

## Runtime

```js
const { exec, run, cleanup } = createRuntime(services);
```

| Method             | Purpose                                                |
| ------------------ | ------------------------------------------------------ |
| `exec(command)`    | Executes a command                                     |
| `run(fn, ...args)` | Invokes a function and interprets a returned generator |
| `cleanup()`        | Invokes registered service cleanup methods             |

Cleanup is explicit; `run` and `exec` do not call it automatically.

Call cleanup after outstanding work has settled, and avoid concurrent cleanup or new work during cleanup. A rejected parallel execution may still have commands running.

For command execution without runtime helpers:

```js
import { createRunner } from "@dveenkamp/unbound";

const exec = createRunner(services);
```

If a service returns a leaf command, the runner executes that command recursively. Other service results are returned unchanged.

## Errors

Initialization, service execution, and sequence continuation failures reject execution. Subsequent sequence steps are skipped.

Execution failures are not automatically injected into generators through `iterator.throw()`. Handle them around `runtime.run` or `runtime.exec`.

Unbound executes trusted application code. Authorization and validation of external inputs belong to the application and its integrations.

## Development

```bash
pnpm test
pnpm test:watch
```

## License

MIT
