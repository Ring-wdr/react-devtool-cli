import util from "node:util";

function escapeYamlString(value) {
  return JSON.stringify(value);
}

function formatYamlScalar(value) {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return escapeYamlString(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return escapeYamlString(String(value));
}

function toYaml(value, indent = 0) {
  const prefix = " ".repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${prefix}[]`;
    }

    return value
      .map((item) => {
        if (item !== null && typeof item === "object") {
          return `${prefix}-\n${toYaml(item, indent + 2)}`;
        }

        return `${prefix}- ${formatYamlScalar(item)}`;
      })
      .join("\n");
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return `${prefix}{}`;
    }

    return entries
      .map(([key, item]) => {
        if (item !== null && typeof item === "object") {
          return `${prefix}${key}:\n${toYaml(item, indent + 2)}`;
        }

        return `${prefix}${key}: ${formatYamlScalar(item)}`;
      })
      .join("\n");
  }

  return `${prefix}${formatYamlScalar(value)}`;
}

export function formatOutput(value, format = "json") {
  switch (format) {
    case "json":
      return `${JSON.stringify(value, null, 2)}\n`;
    case "pretty":
      return `${util.inspect(value, {
        colors: false,
        depth: 8,
        compact: false,
        sorted: true,
      })}\n`;
    case "yaml":
      return `${toYaml(value)}\n`;
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}
