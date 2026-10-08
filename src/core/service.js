export const createService = ({ init, send, cleanup }) => {
  let resource;
  let initialization;

  return Object.freeze({
    init() {
      initialization ??= Promise.resolve()
        .then(() => init())
        .then((value) => {
          resource = value;
          return value;
        })
        .catch((error) => {
          initialization = undefined;
          throw error;
        });

      return initialization;
    },

    send(command) {
      return send(resource, command);
    },

    async cleanup() {
      if (!initialization) {
        return;
      }

      try {
        await initialization;
      } catch {
        // Failed initialization left no resource to cleanup.
        return;
      }

      try {
        await cleanup?.(resource);
      } finally {
        resource = undefined;
        initialization = undefined;
      }
    },
  });
};
