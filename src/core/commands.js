export class BaseCommand {
  constructor(value) {
    this.value = value;
  }
  extract() {
    return this.value;
  }
  map() {
    throw new Error("Unimplemented: map");
  }
  chain() {
    throw new Error("Unimplemented: chain");
  }
  concat() {
    throw new Error("Unimplemented: concat");
  }
  ap(other) {
    return this.chain((f) => other.map(f));
  }
  fold() {
    throw new Error("Unimplemented: fold");
  }
}

export class EmptyCommand extends BaseCommand {
  constructor() {
    super(null);
  }

  map() {
    return this;
  }
  chain() {
    return this;
  }
  concat(other) {
    return other;
  }
  ap() {
    return this;
  }
  fold(reducer, initial) {
    return initial;
  }
}

export class PureCommand extends BaseCommand {
  static of(value) {
    return new PureCommand(value);
  }

  map(f) {
    return new PureCommand(f(this.extract()));
  }
  chain(f) {
    return f(this.extract());
  }
  concat(other) {
    if (other instanceof EmptyCommand) {
      return this;
    }

    if (other instanceof ParCommand) {
      return new ParCommand([this, ...other.extract()]);
    }

    return new ParCommand([this, other]);
  }

  fold(reducer, initial) {
    return initial;
  }
}

export class SeqCommand extends BaseCommand {
  constructor(first, next) {
    super({ first, next });
  }

  map(f) {
    return new SeqCommand(this.value.first.map(f), (x) =>
      this.value.next(x).map(f),
    );
  }

  chain(f) {
    return new SeqCommand(this, f);
  }

  concat(other) {
    if (other instanceof EmptyCommand) {
      return this;
    }

    if (other instanceof ParCommand) {
      return new ParCommand([this, ...other.extract()]);
    }

    return new ParCommand([this, other]);
  }
  fold() {
    throw new Error("fold is not supported for seq commands");
  }
}

export class ParCommand extends BaseCommand {
  constructor(commands = []) {
    super(commands);
  }

  map(f) {
    return new ParCommand(this.value.map((cmd) => cmd.map(f)));
  }

  concat(other) {
    if (other instanceof EmptyCommand) {
      return this;
    }

    if (other instanceof ParCommand) {
      return new ParCommand([...this.value, ...other.extract()]);
    }

    return new ParCommand([...this.value, other]);
  }

  chain(f) {
    return new SeqCommand(this, f);
  }

  fold(reducer, initial) {
    return this.value.reduce(
      (acc, cmd) => reducer(acc, cmd.extract()),
      initial,
    );
  }
}

export class LeafCommand extends BaseCommand {
  chain(f) {
    return new SeqCommand(this, f);
  }

  concat(other) {
    if (other instanceof EmptyCommand) {
      return this;
    }

    if (other instanceof ParCommand) {
      return new ParCommand([this, ...other.extract()]);
    }

    return new ParCommand([this, other]);
  }

  fold(reducer, initial) {
    return reducer(initial, this.extract());
  }
}

export const createLeafCommand = (name, commandType) => {
  const Command = class extends LeafCommand {
    static of(type, command = {}) {
      return new Command({ type, command });
    }

    static empty() {
      return new EmptyCommand();
    }

    get commandType() {
      return commandType;
    }

    map(f) {
      return new Command(f(this.value));
    }
  };

  Object.defineProperty(Command, "name", { value: name });

  return Command;
};
