function coerceValue(raw) {
  if (raw === "true") {
    return true;
  }

  if (raw === "false") {
    return false;
  }

  if (/^-?\d+$/.test(raw)) {
    return Number(raw);
  }

  return raw;
}

export function parseArgv(argv) {
  const positionals = [];
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const [, rawKey, inlineValue] = token.match(/^--([^=]+)(?:=(.*))?$/) ?? [];
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());

    if (inlineValue !== undefined) {
      options[key] = coerceValue(inlineValue);
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }

    options[key] = coerceValue(next);
    index += 1;
  }

  return { positionals, options };
}
