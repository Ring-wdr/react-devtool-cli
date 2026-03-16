export class CliError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "CliError";
    this.code = options.code ?? "cli-error";
    this.exitCode = options.exitCode ?? 1;
    this.details = options.details;
  }
}

export function ensure(condition, message, options) {
  if (!condition) {
    throw new CliError(message, options);
  }
}

export function normalizeError(error, fallbackCode = "unexpected-error") {
  if (error instanceof CliError) {
    return error;
  }

  return new CliError(error?.message ?? String(error), {
    code: error?.code ?? fallbackCode,
    exitCode: error?.exitCode ?? 1,
  });
}
