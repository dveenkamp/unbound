import {
  BaseCommand,
  ParCommand,
  SeqCommand,
  LeafCommand,
  EmptyCommand,
  PureCommand,
} from "./commands.js";

export const createRunner = (services = {}) => {
  const run = async (cmd) => {
    if (cmd instanceof PureCommand) {
      return cmd.extract();
    }

    if (cmd instanceof LeafCommand) {
      const service = services[cmd.commandType];
      await service.init();

      const res = await service.send(cmd);
      if (res instanceof LeafCommand) {
        return run(res);
      }
      return res;
    }

    if (cmd instanceof ParCommand) {
      return Promise.all(cmd.value.map(run));
    }

    if (cmd instanceof SeqCommand) {
      const res = await run(cmd.value.first);

      const nextRes = cmd.value.next(res);

      return run(
        nextRes instanceof BaseCommand ? nextRes : PureCommand.of(nextRes),
      );
    }

    if (cmd instanceof EmptyCommand) {
      return;
    }

    throw new Error(`Unknown command tag: ${cmd.tag}`);
  };

  return run;
};
