import { BaseCommand, PureCommand } from "./commands.js";
import { isGenerator } from "./isGenerator.js";

export const Do = (genFn) => {
  const it = isGenerator(genFn) ? genFn : genFn();

  const step = (lastValue) => {
    const { value, done } = it.next(lastValue);

    if (done) {
      return PureCommand.of(value);
    }

    const cmd = value;
    if (!(cmd instanceof BaseCommand)) {
      throw new Error("Do(): you must yield a Command");
    }

    return cmd.chain(step);
  };

  return step(undefined);
};
