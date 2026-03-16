import assert from "node:assert/strict";

import { parseArgv } from "../src/args.js";
import { formatOutput } from "../src/format.js";
import {
  buildSessionCapabilities,
  getSessionEndpoint,
  normalizeBrowserName,
  normalizeTransport,
  resolveTimeoutMs,
} from "../src/session-model.js";

function run(name, fn) {
  try {
    fn();
    process.stdout.write(`ok - ${name}\n`);
  } catch (error) {
    process.stderr.write(`not ok - ${name}\n${error.stack}\n`);
    process.exitCode = 1;
  }
}

run("parseArgv supports booleans, numbers, and positionals", () => {
  const parsed = parseArgv([
    "session",
    "connect",
    "--ws-endpoint",
    "ws://127.0.0.1:3000/",
    "--browser",
    "firefox",
    "--headless=false",
    "--timeout",
    "5000",
  ]);

  assert.deepEqual(parsed.positionals, ["session", "connect"]);
  assert.equal(parsed.options.wsEndpoint, "ws://127.0.0.1:3000/");
  assert.equal(parsed.options.browser, "firefox");
  assert.equal(parsed.options.headless, false);
  assert.equal(parsed.options.timeout, 5000);
});

run("parseArgv preserves snapshot options for node commands", () => {
  const parsed = parseArgv([
    "node",
    "inspect",
    "n12",
    "--session",
    "app",
    "--snapshot",
    "snapshot-3",
  ]);

  assert.deepEqual(parsed.positionals, ["node", "inspect", "n12"]);
  assert.equal(parsed.options.session, "app");
  assert.equal(parsed.options.snapshot, "snapshot-3");
});

run("formatOutput renders JSON", () => {
  const output = formatOutput({ ok: true }, "json");
  assert.match(output, /"ok": true/);
});

run("formatOutput renders YAML for compact objects", () => {
  const output = formatOutput({ ok: true, items: ["a", "b"] }, "yaml");
  assert.match(output, /ok: true/);
  assert.match(output, /- "a"/);
});

run("formatOutput renders pretty output", () => {
  const output = formatOutput({ ok: true }, "pretty");
  assert.match(output, /ok: true/);
});

run("session-model normalizes transports and browser names", () => {
  assert.equal(normalizeTransport("connect"), "connect");
  assert.equal(normalizeBrowserName("webkit", "open"), "webkit");
  assert.throws(() => normalizeBrowserName("firefox", "attach"), /CDP attach mode only supports Chromium/);
});

run("session-model resolves timeout and endpoint", () => {
  assert.equal(resolveTimeoutMs({ timeout: 4000 }), 4000);
  assert.equal(resolveTimeoutMs({ timeoutMs: 2500 }), 2500);
  assert.equal(getSessionEndpoint("connect", { wsEndpoint: "ws://127.0.0.1:3000/" }), "ws://127.0.0.1:3000/");
  assert.equal(getSessionEndpoint("attach", { cdpUrl: "http://127.0.0.1:9222/" }), "http://127.0.0.1:9222/");
});

run("session-model exposes transport capabilities", () => {
  assert.deepEqual(buildSessionCapabilities({ transport: "open", persistent: true }), {
    supportsReconnect: false,
    supportsPersistentContext: true,
    supportsHighFidelityProtocol: true,
    isChromiumOnly: false,
    ownsBrowserLifecycle: true,
    requiresReloadForHookInjection: false,
    persistent: true,
  });
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
