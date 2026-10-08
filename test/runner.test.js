import test from "node:test";
import assert from "node:assert/strict";
import {
  BaseCommand,
  EmptyCommand,
  PureCommand,
  ParCommand,
  SeqCommand,
  createLeafCommand,
  createRunner,
} from "../src/index.js";

const TestCommand = createLeafCommand("TestCommand", "test");
const OtherCommand = createLeafCommand("OtherCommand", "other");

class GetOperation {}
class NextOperation {}

const deferred = () => {
  let resolve;
  let reject;

  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

test("runner resolves pure and empty commands without services", async () => {
  const exec = createRunner();

  assert.equal(await exec(PureCommand.of(5)), 5);
  assert.equal(await exec(new EmptyCommand()), undefined);
  assert.deepEqual(await exec(new ParCommand()), []);
});

test("runner dispatches commands unchanged to the correct service", async () => {
  const command = TestCommand.of(GetOperation, { id: 1 });
  const calls = [];

  const exec = createRunner({
    test: {
      init() {
        calls.push("init");
      },
      send(received) {
        calls.push("send");
        assert.equal(received, command);
        return { id: 1 };
      },
    },
    other: {
      init() {
        assert.fail("wrong service initialized");
      },
      send() {
        assert.fail("wrong service called");
      },
    },
  });

  assert.deepEqual(await exec(command), { id: 1 });
  assert.deepEqual(calls, ["init", "send"]);
});

test("runner awaits asynchronous initialization before sending", async () => {
  const started = deferred();
  const initialized = deferred();
  let sent = false;

  const exec = createRunner({
    test: {
      init() {
        started.resolve();
        return initialized.promise;
      },
      send() {
        sent = true;
        return "done";
      },
    },
  });

  const result = exec(TestCommand.of(GetOperation));

  await started.promise;
  assert.equal(sent, false);

  initialized.resolve();

  assert.equal(await result, "done");
  assert.equal(sent, true);
});

test("runner calls init for each leaf execution", async () => {
  let initializations = 0;

  const exec = createRunner({
    test: {
      init() {
        initializations++;
      },
      send() {
        return "done";
      },
    },
  });

  await exec(TestCommand.of(GetOperation));
  await exec(TestCommand.of(GetOperation));

  assert.equal(initializations, 2);
});

test("runner recursively executes a leaf returned by service.send", async () => {
  const next = OtherCommand.of(NextOperation, { id: 2 });
  const calls = [];

  const exec = createRunner({
    test: {
      init() {
        calls.push("test:init");
      },
      send() {
        calls.push("test:send");
        return next;
      },
    },
    other: {
      init() {
        calls.push("other:init");
      },
      send(command) {
        calls.push("other:send");
        assert.equal(command, next);
        return "done";
      },
    },
  });

  assert.equal(await exec(TestCommand.of(GetOperation)), "done");
  assert.deepEqual(calls, [
    "test:init",
    "test:send",
    "other:init",
    "other:send",
  ]);
});

test("runner returns non-leaf service results without interpreting them", async () => {
  const result = PureCommand.of(5);

  const exec = createRunner({
    test: {
      init() {},
      send() {
        return result;
      },
    },
  });

  assert.equal(await exec(TestCommand.of(GetOperation)), result);
});

test("sequence passes results into subsequent commands", async () => {
  const calls = [];

  const exec = createRunner({
    test: {
      init() {},
      send(command) {
        const { type, command: params } = command.extract();
        calls.push({ type, params });

        return type === GetOperation ? 4 : params.value * 2;
      },
    },
  });

  const command = TestCommand.of(GetOperation, { id: 1 })
    .chain((value) => TestCommand.of(NextOperation, { value: value + 3 }))
    .chain((value) => PureCommand.of(value + 1));

  assert.equal(await exec(command), 15);
  assert.deepEqual(calls, [
    { type: GetOperation, params: { id: 1 } },
    { type: NextOperation, params: { value: 7 } },
  ]);
});

test("sequence accepts raw continuation values", async () => {
  const exec = createRunner();

  const sequence = new SeqCommand(PureCommand.of(4), (value) => value + 2);

  assert.equal(await exec(sequence), 6);

  const parallelSequence = new ParCommand([
    PureCommand.of(2),
    PureCommand.of(3),
  ]).chain(([a, b]) => a + b);

  assert.equal(await exec(parallelSequence), 5);
});

test("parallel commands start concurrently and preserve result order", async () => {
  const bothStarted = deferred();
  const gates = [deferred(), deferred()];
  const started = [];

  const exec = createRunner({
    test: {
      init() {},
      send(command) {
        const { id } = command.extract().command;
        started.push(id);

        if (started.length === 2) {
          bothStarted.resolve();
        }

        return gates[id].promise;
      },
    },
  });

  const result = exec(
    new ParCommand([
      TestCommand.of(GetOperation, { id: 0 }),
      TestCommand.of(GetOperation, { id: 1 }),
    ]),
  );

  await bothStarted.promise;
  assert.deepEqual(started, [0, 1]);

  gates[1].resolve("second");
  gates[0].resolve("first");

  assert.deepEqual(await result, ["first", "second"]);
});

test("initialization failure prevents sending", async () => {
  const failure = new Error("init failed");

  const exec = createRunner({
    test: {
      async init() {
        throw failure;
      },
      send() {
        assert.fail("send must not run");
      },
    },
  });

  await assert.rejects(
    exec(TestCommand.of(GetOperation)),
    (error) => error === failure,
  );
});

test("send failures reject and skip sequence continuations", async () => {
  for (const asynchronous of [false, true]) {
    const failure = new Error("send failed");
    let continued = false;

    const exec = createRunner({
      test: {
        init() {},
        send() {
          if (asynchronous) {
            return Promise.reject(failure);
          }

          throw failure;
        },
      },
    });

    const command = TestCommand.of(GetOperation).chain(() => {
      continued = true;
      return PureCommand.of("unexpected");
    });

    await assert.rejects(exec(command), (error) => error === failure);

    assert.equal(continued, false);
  }
});

test("sequence continuation errors reject", async () => {
  const failure = new Error("continuation failed");
  const exec = createRunner();

  const command = new ParCommand([PureCommand.of(1)]).chain(() => {
    throw failure;
  });

  await assert.rejects(exec(command), (error) => error === failure);
});

test("parallel failure rejects without waiting for other commands", async () => {
  const bothStarted = deferred();
  const failing = deferred();
  const pending = deferred();
  const finished = deferred();
  const failure = new Error("parallel failure");

  let starts = 0;
  let pendingFinished = false;

  const exec = createRunner({
    test: {
      init() {},
      send(command) {
        if (++starts === 2) {
          bothStarted.resolve();
        }

        if (command.extract().command.id === 0) {
          return failing.promise;
        }

        return pending.promise.then((value) => {
          pendingFinished = true;
          finished.resolve();
          return value;
        });
      },
    },
  });

  const result = exec(
    new ParCommand([
      TestCommand.of(GetOperation, { id: 0 }),
      TestCommand.of(GetOperation, { id: 1 }),
    ]),
  );

  const rejection = assert.rejects(result, (error) => error === failure);

  await bothStarted.promise;
  failing.reject(failure);

  await rejection;
  assert.equal(pendingFinished, false);

  pending.resolve("done");
  await finished.promise;

  assert.equal(pendingFinished, true);
});

test("unregistered services reject", async () => {
  await assert.rejects(createRunner()(TestCommand.of(GetOperation)), TypeError);
});

test("unsupported command types reject", async () => {
  await assert.rejects(
    createRunner()(new BaseCommand()),
    /Unknown command tag/,
  );
});
