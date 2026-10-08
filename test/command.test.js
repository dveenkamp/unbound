import test from "node:test";
import assert from "node:assert/strict";
import {
  BaseCommand,
  EmptyCommand,
  PureCommand,
  ParCommand,
  SeqCommand,
  LeafCommand,
  createLeafCommand,
} from "../src/index.js";

const TestCommand = createLeafCommand("TestCommand", "test");

class GetOperation {}
class OtherOperation {}

test("leaf factory preserves command identity and descriptors", () => {
  const command = TestCommand.of(GetOperation, { id: 1 });

  assert.ok(command instanceof TestCommand);
  assert.ok(command instanceof LeafCommand);
  assert.ok(command instanceof BaseCommand);
  assert.equal(command.commandType, "test");
  assert.deepEqual(command.extract(), {
    type: GetOperation,
    command: { id: 1 },
  });

  const mapped = command.map((value) => ({
    ...value,
    command: { id: 2 },
  }));

  assert.ok(mapped instanceof TestCommand);
  assert.equal(mapped.extract().type, GetOperation);
  assert.deepEqual(mapped.extract().command, { id: 2 });
  assert.deepEqual(command.extract().command, { id: 1 });
});

test("pure commands map values and chain directly", () => {
  const command = PureCommand.of(2);

  assert.equal(command.map((x) => x + 3).extract(), 5);
  assert.equal(command.chain((x) => PureCommand.of(x * 4)).extract(), 8);
});

test("empty commands preserve their existing behavior", () => {
  const empty = new EmptyCommand();
  const other = PureCommand.of(1);

  assert.equal(
    empty.map(() => assert.fail()),
    empty,
  );
  assert.equal(
    empty.chain(() => assert.fail()),
    empty,
  );
  assert.equal(empty.ap(other), empty);
  assert.equal(empty.concat(other), other);
  assert.equal(other.concat(empty), other);
  assert.equal(
    empty.fold(() => assert.fail(), 10),
    10,
  );
});

test("concat preserves order and flattens parallel commands", () => {
  const a = PureCommand.of("a");
  const b = TestCommand.of(GetOperation);
  const c = PureCommand.of("c");

  const combined = a.concat(b).concat(new ParCommand([c]));

  assert.ok(combined instanceof ParCommand);
  assert.deepEqual(combined.extract(), [a, b, c]);
});

test("parallel map transforms each child's description", () => {
  const commands = new ParCommand([
    TestCommand.of(GetOperation),
    TestCommand.of(OtherOperation),
  ]);

  const mapped = commands.map((value) => ({
    ...value,
    command: { enabled: true },
  }));

  assert.deepEqual(
    mapped.extract().map((command) => command.extract()),
    [
      { type: GetOperation, command: { enabled: true } },
      { type: OtherOperation, command: { enabled: true } },
    ],
  );
});

test("sequence map transforms first and subsequent descriptions", () => {
  const sequence = new SeqCommand(TestCommand.of(GetOperation), (result) =>
    TestCommand.of(OtherOperation, { result }),
  );

  const mapped = sequence.map((value) => ({
    ...value,
    mapped: true,
  }));

  assert.deepEqual(mapped.extract().first.extract(), {
    type: GetOperation,
    command: {},
    mapped: true,
  });

  assert.deepEqual(mapped.extract().next(42).extract(), {
    type: OtherOperation,
    command: { result: 42 },
    mapped: true,
  });
});

test("fold retains leaf, parallel, and pure behavior", () => {
  const leaf = TestCommand.of(GetOperation, { id: 1 });
  const pure = PureCommand.of(4);
  const collect = (acc, value) => [...acc, value];

  assert.deepEqual(leaf.fold(collect, []), [leaf.extract()]);
  assert.deepEqual(new ParCommand([leaf, pure]).fold(collect, []), [
    leaf.extract(),
    4,
  ]);
  assert.deepEqual(pure.fold(collect, []), []);

  assert.throws(
    () => leaf.chain(PureCommand.of).fold(collect, []),
    /fold is not supported/,
  );
});

test("ap applies a pure function to a pure value", () => {
  assert.equal(
    PureCommand.of((x) => x * 2)
      .ap(PureCommand.of(3))
      .extract(),
    6,
  );
});
