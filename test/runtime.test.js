import test from "node:test";
import assert from "node:assert/strict";
import { PureCommand, createLeafCommand, createRuntime } from "../src/index.js";

const TestCommand = createLeafCommand("TestCommand", "test");

class GetOperation {}

const deferred = () => {
  let resolve;

  const promise = new Promise((res) => {
    resolve = res;
  });

  return { promise, resolve };
};

test("runtime forwards arguments and returns ordinary values", async () => {
  const runtime = createRuntime();
  const input = { id: 1 };

  const result = await runtime.run(
    (received, multiplier) => {
      assert.equal(received, input);
      return received.id * multiplier;
    },
    input,
    3,
  );

  assert.equal(result, 3);
});

test("runtime awaits asynchronous function results", async () => {
  const runtime = createRuntime();
  const gate = deferred();

  const result = runtime.run(() => gate.promise);

  gate.resolve("done");

  assert.equal(await result, "done");
});

test("runtime executes generators and passes results between yields", async () => {
  const calls = [];

  const runtime = createRuntime({
    test: {
      init() {},
      send(command) {
        const { type, command: params } = command.extract();

        assert.equal(type, GetOperation);
        calls.push(params);

        return params.value * 2;
      },
    },
  });

  const result = await runtime.run(function* (start) {
    const first = yield TestCommand.of(GetOperation, {
      value: start,
    });

    const second = yield TestCommand.of(GetOperation, {
      value: first + 1,
    });

    return second + 3;
  }, 2);

  assert.equal(result, 13);
  assert.deepEqual(calls, [{ value: 2 }, { value: 5 }]);
});

test("runtime handles generators with no yields", async () => {
  const runtime = createRuntime();

  assert.equal(
    await runtime.run(function* () {
      return 7;
    }),
    7,
  );
});

test("runtime handles an existing generator returned by a function", async () => {
  const runtime = createRuntime();

  function* computation() {
    return yield PureCommand.of(8);
  }

  const iterator = computation();

  assert.equal(await runtime.run(() => iterator), 8);
});

test("runtime exposes exec for explicitly executing commands", async () => {
  const runtime = createRuntime({
    test: {
      init() {},
      send(command) {
        return command.extract().command.id;
      },
    },
  });

  const result = await runtime.run(
    async ({ exec, id }) => await exec(TestCommand.of(GetOperation, { id })),
    { exec: runtime.exec, id: 42 },
  );

  assert.equal(result, 42);
});

test("runtime returns ordinary command results without executing them", async () => {
  const runtime = createRuntime();
  const command = PureCommand.of(9);

  assert.equal(await runtime.run(() => command), command);
});

test("runtime propagates synchronous and asynchronous function errors", async () => {
  const runtime = createRuntime();
  const failure = new Error("function failed");

  await assert.rejects(
    runtime.run(() => {
      throw failure;
    }),
    (error) => error === failure,
  );

  await assert.rejects(
    runtime.run(async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
});

test("runtime propagates generator errors before and after a yield", async () => {
  const runtime = createRuntime();
  const failure = new Error("generator failed");

  await assert.rejects(
    runtime.run(function* () {
      throw failure;
    }),
    (error) => error === failure,
  );

  await assert.rejects(
    runtime.run(function* () {
      yield PureCommand.of(1);
      throw failure;
    }),
    (error) => error === failure,
  );
});

test("runtime rejects non-command yields", async () => {
  const runtime = createRuntime();

  await assert.rejects(
    runtime.run(function* () {
      yield 42;
    }),
    /you must yield a Command/,
  );
});

test("runtime propagates service failures from generator execution", async () => {
  const failure = new Error("service failed");
  let continued = false;

  const runtime = createRuntime({
    test: {
      init() {},
      send() {
        throw failure;
      },
    },
  });

  await assert.rejects(
    runtime.run(function* () {
      yield TestCommand.of(GetOperation);
      continued = true;
    }),
    (error) => error === failure,
  );

  assert.equal(continued, false);
});

test("runtime cleanup supports missing and synchronous cleanup methods", async () => {
  let cleanups = 0;

  const runtime = createRuntime({
    withoutCleanup: {},
    withCleanup: {
      cleanup() {
        cleanups++;
      },
    },
  });

  await runtime.cleanup();

  assert.equal(cleanups, 1);
  await createRuntime().cleanup();
});

test("runtime cleanup waits for all successful asynchronous cleanups", async () => {
  const allStarted = deferred();
  const gates = [deferred(), deferred()];
  let starts = 0;
  const finished = [];

  const makeService = (id) => ({
    async cleanup() {
      if (++starts === 2) {
        allStarted.resolve();
      }

      await gates[id].promise;
      finished.push(id);
    },
  });

  const runtime = createRuntime({
    first: makeService(0),
    second: makeService(1),
  });

  let settled = false;
  const cleaning = runtime.cleanup().then(() => {
    settled = true;
  });

  await allStarted.promise;
  assert.equal(settled, false);

  gates[0].resolve();
  // Explicitly observe the first cleanup finishing.
  await gates[0].promise;
  assert.equal(settled, false);

  gates[1].resolve();
  await cleaning;

  assert.deepEqual(finished, [0, 1]);
  assert.equal(settled, true);
});

test("runtime cleanup propagates asynchronous cleanup failures", async () => {
  const failure = new Error("cleanup failed");

  const runtime = createRuntime({
    test: {
      async cleanup() {
        throw failure;
      },
    },
  });

  await assert.rejects(runtime.cleanup(), (error) => error === failure);
});

test("runtime does not automatically clean up after run", async () => {
  let cleanups = 0;

  const runtime = createRuntime({
    test: {
      cleanup() {
        cleanups++;
      },
    },
  });

  await runtime.run(() => "done");
  assert.equal(cleanups, 0);

  await assert.rejects(
    runtime.run(() => {
      throw new Error("failed");
    }),
  );
  assert.equal(cleanups, 0);

  await runtime.cleanup();
  assert.equal(cleanups, 1);
});
