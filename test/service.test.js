import test from "node:test";
import assert from "node:assert/strict";
import { createService } from "../src/index.js";

const deferred = () => {
  let resolve;
  let reject;

  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

test("service creation is lazy and freezes the interface", () => {
  const service = createService({
    init() {
      assert.fail("must not initialize during creation");
    },
    send() {},
  });

  assert.ok(Object.isFrozen(service));
});

test("service caches synchronous initialization results", async () => {
  const resource = {};
  let calls = 0;

  const service = createService({
    init() {
      calls++;
      return resource;
    },
    send() {},
  });

  assert.equal(await service.init(), resource);
  assert.equal(await service.init(), resource);
  assert.equal(calls, 1);
});

test("concurrent init calls share the same promise", async () => {
  const started = deferred();
  const gate = deferred();
  const resource = {};
  let calls = 0;

  const service = createService({
    init() {
      calls++;
      started.resolve();
      return gate.promise;
    },
    send() {},
  });

  const first = service.init();
  const second = service.init();

  assert.equal(first, second);

  await started.promise;
  assert.equal(calls, 1);

  gate.resolve(resource);

  assert.equal(await first, resource);
  assert.equal(await second, resource);
  assert.equal(service.init(), first);
});

test("undefined initialization results are still cached", async () => {
  let calls = 0;

  const service = createService({
    init() {
      calls++;
    },
    send() {},
  });

  assert.equal(await service.init(), undefined);
  assert.equal(await service.init(), undefined);
  assert.equal(calls, 1);
});

test("send forwards the resource and command unchanged", async () => {
  const resource = {};
  const command = {};
  const result = {};
  let calls = 0;

  const service = createService({
    init: () => resource,
    send(receivedResource, receivedCommand) {
      calls++;
      assert.equal(receivedResource, resource);
      assert.equal(receivedCommand, command);
      return result;
    },
  });

  await service.init();

  assert.equal(service.send(command), result);
  assert.equal(calls, 1);
});

test("send preserves asynchronous results and thrown errors", async () => {
  const result = Promise.resolve("done");
  const failure = new Error("send failed");
  let shouldFail = false;

  const service = createService({
    init() {},
    send() {
      if (shouldFail) {
        throw failure;
      }
      return result;
    },
  });

  await service.init();

  assert.equal(service.send({}), result);
  assert.equal(await result, "done");

  shouldFail = true;

  assert.throws(
    () => service.send({}),
    (error) => error === failure,
  );
});

test("synchronous initialization failures allow retry", async () => {
  const failure = new Error("init failed");
  const resource = {};
  let attempts = 0;

  const service = createService({
    init() {
      if (++attempts === 1) {
        throw failure;
      }
      return resource;
    },
    send() {},
  });

  await assert.rejects(service.init(), (error) => error === failure);

  assert.equal(await service.init(), resource);
  assert.equal(attempts, 2);
});

test("concurrent callers share initialization failure, then can retry", async () => {
  const gate = deferred();
  const failure = new Error("async init failed");
  const resource = {};
  let attempts = 0;

  const service = createService({
    init() {
      attempts++;
      return attempts === 1 ? gate.promise : resource;
    },
    send() {},
  });

  const first = service.init();
  const second = service.init();

  assert.equal(first, second);

  const rejected = assert.rejects(first, (error) => error === failure);

  gate.reject(failure);
  await rejected;

  assert.equal(await service.init(), resource);
  assert.equal(attempts, 2);
});

test("cleanup of an unused service does nothing", async () => {
  const service = createService({
    init() {
      assert.fail("cleanup must not initialize the service");
    },
    send() {},
    cleanup() {
      assert.fail("unused service must not invoke cleanup");
    },
  });

  await service.cleanup();
});

test("cleanup receives the resource and resets initialization", async () => {
  const resources = [{}, {}];
  const cleaned = [];
  let initializations = 0;

  const service = createService({
    init: () => resources[initializations++],
    send() {},
    cleanup(resource) {
      cleaned.push(resource);
    },
  });

  assert.equal(await service.init(), resources[0]);

  await service.cleanup();
  await service.cleanup();

  assert.deepEqual(cleaned, [resources[0]]);
  assert.equal(await service.init(), resources[1]);
  assert.equal(initializations, 2);
});

test("cleanup waits for pending initialization", async () => {
  const started = deferred();
  const gate = deferred();
  const resource = {};
  const cleaned = [];

  const service = createService({
    init() {
      started.resolve();
      return gate.promise;
    },
    send() {},
    cleanup(value) {
      cleaned.push(value);
    },
  });

  const initializing = service.init();
  await started.promise;

  const cleaning = service.cleanup();
  assert.deepEqual(cleaned, []);

  gate.resolve(resource);

  await initializing;
  await cleaning;

  assert.deepEqual(cleaned, [resource]);
});

test("cleanup awaits asynchronous resource cleanup", async () => {
  const started = deferred();
  const gate = deferred();
  let completed = false;

  const service = createService({
    init: () => ({}),
    send() {},
    async cleanup() {
      started.resolve();
      await gate.promise;
    },
  });

  await service.init();

  const cleaning = service.cleanup().then(() => {
    completed = true;
  });

  await started.promise;
  assert.equal(completed, false);

  gate.resolve();
  await cleaning;

  assert.equal(completed, true);
});

test("missing cleanup callback still resets initialization", async () => {
  let initializations = 0;

  const service = createService({
    init: () => ++initializations,
    send() {},
  });

  assert.equal(await service.init(), 1);
  await service.cleanup();
  assert.equal(await service.init(), 2);
});

test("cleanup failures propagate but still reset initialization", async () => {
  for (const asynchronous of [false, true]) {
    const failure = new Error("cleanup failed");
    let initializations = 0;

    const service = createService({
      init: () => ++initializations,
      send() {},
      cleanup() {
        if (asynchronous) {
          return Promise.reject(failure);
        }
        throw failure;
      },
    });

    await service.init();

    await assert.rejects(service.cleanup(), (error) => error === failure);

    assert.equal(await service.init(), 2);
  }
});

test("cleanup skips resources when pending initialization fails", async () => {
  const gate = deferred();
  const failure = new Error("init failed");
  let attempts = 0;

  const service = createService({
    init() {
      return ++attempts === 1 ? gate.promise : "recovered";
    },
    send() {},
    cleanup() {
      assert.fail("failed initialization has no resource to clean");
    },
  });

  const initializing = service.init();
  const rejection = assert.rejects(initializing, (error) => error === failure);
  const cleaning = service.cleanup();

  gate.reject(failure);

  await rejection;
  await cleaning;

  assert.equal(await service.init(), "recovered");
});
