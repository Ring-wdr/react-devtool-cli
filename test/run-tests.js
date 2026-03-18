import assert from "node:assert/strict";
import http from "node:http";

import { parseArgv } from "../src/args.js";
import { closeSessionWithFallback, forceKillProcessTree } from "../src/cli.js";
import { formatOutput } from "../src/format.js";
import { requestSession } from "../src/http-client.js";
import {
  buildSessionCapabilities,
  getSessionEndpoint,
  normalizeBrowserName,
  normalizeEngine,
  normalizeTransport,
  resolveTimeoutMs,
} from "../src/session-model.js";

const pending = [];

function run(name, fn) {
  const task = Promise.resolve()
    .then(fn)
    .then(() => {
      process.stdout.write(`ok - ${name}\n`);
    })
    .catch((error) => {
      process.stderr.write(`not ok - ${name}\n${error.stack}\n`);
      process.exitCode = 1;
    });

  pending.push(task);
}

async function main() {
  await Promise.all(pending);
  if (process.exitCode) {
    process.exit(process.exitCode);
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

run("parseArgv preserves session doctor options", () => {
  const parsed = parseArgv([
    "session",
    "doctor",
    "--session",
    "app",
    "--format",
    "pretty",
  ]);

  assert.deepEqual(parsed.positionals, ["session", "doctor"]);
  assert.equal(parsed.options.session, "app");
  assert.equal(parsed.options.format, "pretty");
});

run("parseArgv preserves session engine preference", () => {
  const parsed = parseArgv([
    "session",
    "open",
    "--url",
    "http://localhost:3000",
    "--engine",
    "devtools",
  ]);

  assert.deepEqual(parsed.positionals, ["session", "open"]);
  assert.equal(parsed.options.engine, "devtools");
});

run("parseArgv preserves profiler commit positionals and limits", () => {
  const parsed = parseArgv([
    "profiler",
    "ranked",
    "commit-2",
    "--session",
    "app",
    "--limit",
    "15",
  ]);

  assert.deepEqual(parsed.positionals, ["profiler", "ranked", "commit-2"]);
  assert.equal(parsed.options.session, "app");
  assert.equal(parsed.options.limit, 15);
});

run("parseArgv preserves interact click options", () => {
  const parsed = parseArgv([
    "interact",
    "click",
    "--session",
    "app",
    "--selector",
    ".result-row",
    "--timeout-ms",
    "1200",
  ]);

  assert.deepEqual(parsed.positionals, ["interact", "click"]);
  assert.equal(parsed.options.session, "app");
  assert.equal(parsed.options.selector, ".result-row");
  assert.equal(parsed.options.timeoutMs, 1200);
});

run("parseArgv preserves interact type options", () => {
  const parsed = parseArgv([
    "interact",
    "type",
    "--session",
    "app",
    "--selector",
    "input",
    "--text",
    "abc",
  ]);

  assert.deepEqual(parsed.positionals, ["interact", "type"]);
  assert.equal(parsed.options.text, "abc");
});

run("parseArgv preserves profiler compare options", () => {
  const parsed = parseArgv([
    "profiler",
    "compare",
    "--session",
    "app",
    "--left",
    "profile-a",
    "--right",
    "profile-b",
  ]);

  assert.deepEqual(parsed.positionals, ["profiler", "compare"]);
  assert.equal(parsed.options.left, "profile-a");
  assert.equal(parsed.options.right, "profile-b");
});

run("parseArgv preserves node inspect commit option", () => {
  const parsed = parseArgv([
    "node",
    "inspect",
    "n12",
    "--session",
    "app",
    "--commit",
    "commit-3",
  ]);

  assert.deepEqual(parsed.positionals, ["node", "inspect", "n12"]);
  assert.equal(parsed.options.commit, "commit-3");
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
  assert.equal(normalizeEngine("auto"), "auto");
  assert.equal(normalizeEngine("devtools"), "devtools");
  assert.throws(() => normalizeBrowserName("firefox", "attach"), /CDP attach mode only supports Chromium/);
  assert.throws(() => normalizeEngine("unknown"), /Unsupported engine/);
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

run("forceKillProcessTree uses taskkill on Windows", () => {
  const calls = [];
  const result = forceKillProcessTree(123, {
    platform: "win32",
    spawnSyncImpl(command, args) {
      calls.push({ command, args });
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  assert.deepEqual(calls, [{
    command: "taskkill",
    args: ["/PID", "123", "/T", "/F"],
  }]);
  assert.equal(result.ok, true);
  assert.equal(result.strategy, "taskkill");
});

run("closeSessionWithFallback returns graceful close result when session responds", async () => {
  const result = await closeSessionWithFallback("demo", {
    async requestSessionImpl() {
      return { result: { closed: true, sessionName: "demo" } };
    },
  });

  assert.deepEqual(result, {
    closed: true,
    sessionName: "demo",
    forced: false,
  });
});

run("closeSessionWithFallback force closes unresponsive sessions", async () => {
  const calls = [];
  const result = await closeSessionWithFallback("demo", {
    async requestSessionImpl() {
      throw Object.assign(new Error("timeout"), { code: "session-request-timeout" });
    },
    async readMetadataImpl() {
      return { pid: 321 };
    },
    forceKillProcessTreeImpl(pid) {
      calls.push({ type: "kill", pid });
      return { ok: true };
    },
    async removeSessionFilesImpl(sessionName) {
      calls.push({ type: "remove", sessionName });
    },
  });

  assert.deepEqual(calls, [
    { type: "kill", pid: 321 },
    { type: "remove", sessionName: "demo" },
  ]);
  assert.deepEqual(result, {
    closed: true,
    sessionName: "demo",
    forced: true,
    recoveredFrom: "session-request-timeout",
  });
});

run("requestSession times out when the session server does not respond", async () => {
  const server = http.createServer(() => {});
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    await assert.rejects(
      requestSession("timeout-test", "session.status", {}, {
        timeoutMs: 50,
        metadata: { port, secret: "secret" },
      }),
      (error) => error.code === "session-request-timeout",
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

await main();
