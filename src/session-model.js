import { CliError } from "./errors.js";

export const SUPPORTED_TRANSPORTS = new Set(["open", "connect", "attach"]);
export const SUPPORTED_BROWSERS = new Set(["chromium", "firefox", "webkit"]);
export const SUPPORTED_ENGINES = new Set(["auto", "custom", "devtools"]);

export function normalizeTransport(value) {
  const transport = value ? String(value) : "open";
  if (!SUPPORTED_TRANSPORTS.has(transport)) {
    throw new CliError(`Unsupported transport: ${transport}`, {
      code: "unsupported-transport",
    });
  }

  return transport;
}

export function normalizeBrowserName(value, transport = "open") {
  const browserName = value ? String(value) : "chromium";
  if (!SUPPORTED_BROWSERS.has(browserName)) {
    throw new CliError(`Unsupported browser: ${browserName}`, {
      code: "unsupported-browser",
    });
  }

  if (transport === "attach" && browserName !== "chromium") {
    throw new CliError("CDP attach mode only supports Chromium.", {
      code: "unsupported-browser-for-cdp",
    });
  }

  return browserName;
}

export function normalizeEngine(value) {
  const engine = value ? String(value) : "auto";
  if (!SUPPORTED_ENGINES.has(engine)) {
    throw new CliError(`Unsupported engine: ${engine}`, {
      code: "unsupported-engine",
    });
  }

  return engine;
}

export function resolveTimeoutMs(options = {}) {
  if (typeof options.timeout === "number") {
    return options.timeout;
  }

  if (typeof options.timeoutMs === "number") {
    return options.timeoutMs;
  }

  return undefined;
}

export function buildSessionCapabilities({ transport, persistent }) {
  return {
    supportsReconnect: transport === "connect" || transport === "attach",
    supportsPersistentContext: transport === "open",
    supportsHighFidelityProtocol: transport !== "attach",
    isChromiumOnly: transport === "attach",
    ownsBrowserLifecycle: transport === "open",
    requiresReloadForHookInjection: transport !== "open",
    persistent: Boolean(persistent),
  };
}

export function getSessionEndpoint(transport, options = {}) {
  if (transport === "connect") {
    return options.wsEndpoint ?? null;
  }

  if (transport === "attach") {
    return options.cdpUrl ?? null;
  }

  return null;
}
