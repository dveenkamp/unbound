import { createRunner } from "./runner.js";
import { Do } from "./do.js";
import { isGenerator } from "./isGenerator.js";

export const createRuntime = (services = {}) => {
  const exec = createRunner(services);

  const run = async (fn, ...args) => {
    const out = fn(...args);

    if (isGenerator(out)) {
      return await exec(Do(out));
    }

    return await out;
  };

  const cleanup = async () => {
    await Promise.all(
      Object.values(services).map((service) => service.cleanup?.()),
    );
  };

  return { exec, run, cleanup };
};
