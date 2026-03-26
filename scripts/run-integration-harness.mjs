import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const testAppDir = path.join(rootDir, "test-app");
const viteBinPath = path.join(testAppDir, "node_modules", "vite", "bin", "vite.js");
const verbose = process.argv.includes("--verbose");

function log(line) {
  process.stdout.write(`${line}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getNpmExecutable() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureTestAppDependencies() {
  if (await pathExists(path.join(testAppDir, "node_modules"))) {
    return;
  }

  log("info - installing test-app dependencies with npm ci");
  const result = await runCommand(getNpmExecutable(), ["ci"], {
    cwd: testAppDir,
    timeoutMs: 180000,
  });
  ensureCommandOk("test-app npm ci", result);
}

async function findAvailablePort(startPort = 4310, maxAttempts = 20) {
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const port = startPort + offset;
    if (port === 3000) {
      continue;
    }

    const available = await new Promise((resolve) => {
      const server = net.createServer();
      server.unref();
      server.on("error", () => resolve(false));
      server.listen({ host: "127.0.0.1", port }, () => {
        server.close(() => resolve(true));
      });
    });

    if (available) {
      return port;
    }
  }

  throw new Error(`Unable to find an available port starting from ${startPort}.`);
}

function terminateProcessTree(pid) {
  if (!pid) {
    return;
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      encoding: "utf8",
      windowsHide: true,
    });
    return;
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
}

async function runCommand(command, args, options = {}) {
  const {
    cwd = rootDir,
    env = process.env,
    timeoutMs = 60000,
  } = options;

  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      terminateProcessTree(child.pid);
      resolve({
        command,
        args,
        cwd,
        code: null,
        signal: "SIGKILL",
        stdout,
        stderr,
        timedOut: true,
      });
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      if (verbose) {
        process.stdout.write(text);
      }
    });

    child.stderr?.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      if (verbose) {
        process.stderr.write(text);
      }
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        command,
        args,
        cwd,
        code: null,
        signal: null,
        stdout,
        stderr: `${stderr}${error.stack || error.message || String(error)}`,
        timedOut: false,
      });
    });

    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        command,
        args,
        cwd,
        code,
        signal,
        stdout,
        stderr,
        timedOut: false,
      });
    });
  });
}

function formatCommand(result) {
  return `${result.command} ${result.args.join(" ")}`.trim();
}

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function ensureCommandOk(label, result) {
  if (result.code === 0 && !result.timedOut) {
    return;
  }

  throw new Error(
    `${label} failed\ncommand: ${formatCommand(result)}\ncode: ${result.code}\nsignal: ${result.signal}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
}

function parseJsonResult(label, result) {
  ensureCommandOk(label, result);
  ensure(result.stdout.trim(), `${label} returned empty stdout\ncommand: ${formatCommand(result)}\nstderr:\n${result.stderr}`);

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `${label} returned non-JSON stdout\ncommand: ${formatCommand(result)}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}\nparse error: ${error.message}`,
    );
  }
}

async function waitForHttpReady(url, child, logs, timeoutMs = 30000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode != null) {
      throw new Error(`dev server exited early\nstdout:\n${logs.stdout}\nstderr:\n${logs.stderr}`);
    }

    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {}

    await sleep(250);
  }

  throw new Error(`Timed out waiting for ${url}\nstdout:\n${logs.stdout}\nstderr:\n${logs.stderr}`);
}

async function startDevServer(port) {
  const child = spawn(process.execPath, [viteBinPath, "--host", "127.0.0.1", "--port", String(port)], {
    cwd: testAppDir,
    windowsHide: true,
  });

  const logs = { stdout: "", stderr: "" };
  child.stdout?.on("data", (chunk) => {
    const text = String(chunk);
    logs.stdout += text;
    if (verbose) {
      process.stdout.write(text);
    }
  });
  child.stderr?.on("data", (chunk) => {
    const text = String(chunk);
    logs.stderr += text;
    if (verbose) {
      process.stderr.write(text);
    }
  });

  const url = `http://127.0.0.1:${port}`;
  await waitForHttpReady(url, child, logs);
  return { child, url, logs };
}

async function stopDevServer(server) {
  if (!server?.child?.pid) {
    return;
  }

  terminateProcessTree(server.child.pid);
  await sleep(500);
}

async function runRdt(args, timeoutMs = 60000) {
  return await runCommand(process.execPath, [path.join("bin", "rdt.js"), ...args], {
    cwd: rootDir,
    timeoutMs,
  });
}

function logScenarioOk(name) {
  log(`ok - ${name}`);
}

async function closeSession(sessionName) {
  const result = await runRdt(["session", "close", "--session", sessionName, "--format", "json"], 30000);
  if (result.code !== 0) {
    log(`warn - session close failed for ${sessionName}\n${result.stderr}`);
  }
}

async function main() {
  await ensureTestAppDependencies();

  const port = await findAvailablePort(4310, 30);
  const server = await startDevServer(port);
  const sessionName = `harness-${Date.now().toString(36)}`;

  try {
    const openResult = await runRdt([
      "session",
      "open",
      "--url",
      server.url,
      "--session",
      sessionName,
      "--timeout",
      "10000",
      "--format",
      "json",
    ], 120000);
    const openPayload = parseJsonResult("session-open-json", openResult);
    ensure(openPayload.sessionName === sessionName, "session-open-json returned an unexpected sessionName");
    ensure(typeof openPayload.target === "string" && openPayload.target.startsWith(server.url), "session-open-json returned an unexpected target");
    ensure(typeof openPayload.reactDetected === "boolean", "session-open-json did not report reactDetected");
    logScenarioOk("session-open-json");

    const doctorPayload = parseJsonResult(
      "doctor-alias",
      await runRdt(["doctor", "--session", sessionName, "--format", "json"]),
    );
    ensure(doctorPayload.sessionName === sessionName, "doctor alias returned an unexpected sessionName");

    const statsPayload = parseJsonResult(
      "tree-stats",
      await runRdt(["tree", "stats", "--session", sessionName, "--top", "5", "--format", "json"]),
    );
    ensure(typeof statsPayload.snapshotId === "string" && statsPayload.snapshotId.length > 0, "tree-stats did not return snapshotId");
    ensure(Array.isArray(statsPayload.rootSummaries), "tree-stats did not return rootSummaries");
    ensure(Array.isArray(statsPayload.topLevelComponents), "tree-stats did not return topLevelComponents");

    const searchPayload = parseJsonResult(
      "node-search-structured",
      await runRdt([
        "node",
        "search",
        "App",
        "--session",
        sessionName,
        "--snapshot",
        statsPayload.snapshotId,
        "--structured",
        "--format",
        "json",
      ]),
    );
    ensure(Array.isArray(searchPayload.items) && searchPayload.matchCount >= 1, "node-search-structured did not return any App matches");

    const limitedSearchPayload = parseJsonResult(
      "node-search-limit",
      await runRdt([
        "node",
        "search",
        "ResultRow",
        "--session",
        sessionName,
        "--snapshot",
        statsPayload.snapshotId,
        "--structured",
        "--limit",
        "5",
        "--format",
        "json",
      ]),
    );
    ensure(Array.isArray(limitedSearchPayload.items) && limitedSearchPayload.items.length === 5, "node-search-limit did not truncate items to 5");
    ensure(limitedSearchPayload.returnedCount === 5, "node-search-limit did not report returnedCount 5");
    ensure(limitedSearchPayload.matchCount > limitedSearchPayload.returnedCount, "node-search-limit did not report a truncated result set");
    ensure(limitedSearchPayload.truncated === true, "node-search-limit did not report truncated=true");
    ensure(
      Array.isArray(limitedSearchPayload.runtimeWarnings)
        && limitedSearchPayload.runtimeWarnings.some((warning) => warning.includes("--limit 5")),
      "node-search-limit did not report the limit warning",
    );

    const zeroMatchPayload = parseJsonResult(
      "node-search-zero-match",
      await runRdt([
        "node",
        "search",
        "__MissingHarnessComponent__",
        "--session",
        sessionName,
        "--snapshot",
        statsPayload.snapshotId,
        "--structured",
        "--format",
        "json",
      ]),
    );
    ensure(zeroMatchPayload.matchCount === 0, "node-search-zero-match did not return matchCount 0");
    ensure(Array.isArray(zeroMatchPayload.runtimeWarnings) && zeroMatchPayload.runtimeWarnings.length > 0, "node-search-zero-match did not return runtimeWarnings");

    const invalidSearchLimitResult = await runRdt([
      "node",
      "search",
      "ResultRow",
      "--session",
      sessionName,
      "--structured",
      "--limit",
      "0",
      "--format",
      "json",
    ]);
    ensure(invalidSearchLimitResult.code !== 0, "node-search-invalid-limit unexpectedly succeeded");
    ensure(invalidSearchLimitResult.stderr.includes("--limit"), "node-search-invalid-limit did not explain the limit failure");
    logScenarioOk("tree-stats-and-structured-search");

    const appNodeId = searchPayload.items[0]?.id;
    ensure(appNodeId, "node-search-structured did not produce a node id");

    const rawSourceResult = await runRdt([
      "source",
      "reveal",
      appNodeId,
      "--session",
      sessionName,
      "--snapshot",
      statsPayload.snapshotId,
      "--format",
      "json",
    ]);
    ensureCommandOk("source-reveal-raw", rawSourceResult);
    ensure(rawSourceResult.stdout.trim() === "null", `source-reveal-raw expected null stdout but received:\n${rawSourceResult.stdout}`);

    const structuredSourcePayload = parseJsonResult(
      "source-reveal-structured",
      await runRdt([
        "source",
        "reveal",
        appNodeId,
        "--session",
        sessionName,
        "--snapshot",
        statsPayload.snapshotId,
        "--structured",
        "--format",
        "json",
      ]),
    );
    ensure(structuredSourcePayload.status === "unavailable", "source-reveal-structured did not report unavailable status");
    ensure(structuredSourcePayload.available === false, "source-reveal-structured did not report available=false");
    ensure(typeof structuredSourcePayload.mode === "string", "source-reveal-structured did not return mode");
    ensure(typeof structuredSourcePayload.reason === "string", "source-reveal-structured did not return reason");
    logScenarioOk("structured-source-reveal");

    const strictSelectorClick = parseJsonResult(
      "click-selector-strict",
      await runRdt([
        "interact",
        "click",
        "--session",
        sessionName,
        "--selector",
        "button.counter",
        "--strict",
        "--delivery",
        "playwright",
        "--format",
        "json",
      ]),
    );
    ensure(strictSelectorClick.targetingStrategy === "selector", "click-selector-strict did not use selector targeting");
    ensure(strictSelectorClick.strict === true, "click-selector-strict did not report strict=true");
    ensure(strictSelectorClick.matchCount === 1, "click-selector-strict did not report matchCount 1");
    ensure(strictSelectorClick.effectiveDelivery === "playwright", "click-selector-strict did not use playwright delivery");

    const textClick = parseJsonResult(
      "click-text-targeting",
      await runRdt([
        "interact",
        "click",
        "--session",
        sessionName,
        "--text",
        "Count is",
        "--delivery",
        "playwright",
        "--format",
        "json",
      ]),
    );
    ensure(textClick.targetingStrategy === "text", "click-text-targeting did not use text targeting");
    ensure(textClick.effectiveDelivery === "playwright", "click-text-targeting did not use playwright delivery");

    const roleClick = parseJsonResult(
      "click-role-targeting",
      await runRdt([
        "interact",
        "click",
        "--session",
        sessionName,
        "--role",
        "button",
        "--nth",
        "0",
        "--delivery",
        "dom",
        "--format",
        "json",
      ]),
    );
    ensure(roleClick.targetingStrategy === "role", "click-role-targeting did not use role targeting");
    ensure(roleClick.resolvedNth === 0, "click-role-targeting did not report resolvedNth 0");
    ensure(roleClick.effectiveDelivery === "dom-click", "click-role-targeting did not use DOM delivery");

    parseJsonResult(
      "profiler-start",
      await runRdt(["profiler", "start", "--session", sessionName, "--format", "json"]),
    );
    const autoFallbackClick = parseJsonResult(
      "click-delivery-auto-profiler",
      await runRdt([
        "interact",
        "click",
        "--session",
        sessionName,
        "--selector",
        "button.counter",
        "--delivery",
        "auto",
        "--format",
        "json",
      ]),
    );
    ensure(autoFallbackClick.profilerActive === true, "click-delivery-auto-profiler did not detect active profiler");
    ensure(autoFallbackClick.fallbackApplied === true, "click-delivery-auto-profiler did not report fallbackApplied=true");
    ensure(autoFallbackClick.effectiveDelivery === "dom-click", "click-delivery-auto-profiler did not fall back to dom-click");
    parseJsonResult(
      "profiler-stop",
      await runRdt(["profiler", "stop", "--session", sessionName, "--format", "json"]),
    );

    const targetTextType = parseJsonResult(
      "type-target-text",
      await runRdt([
        "interact",
        "type",
        "--session",
        sessionName,
        "--target-text",
        "Filter inventory",
        "--text",
        "billing",
        "--format",
        "json",
      ]),
    );
    ensure(targetTextType.targetingStrategy === "target-text", "type-target-text did not use target-text targeting");
    ensure(targetTextType.targetingResolution === "label-control", "type-target-text did not resolve through label-control");
    ensure(targetTextType.target?.tagName === "input", "type-target-text did not resolve to an input");
    ensure(targetTextType.textLength === 7, "type-target-text did not report the expected text length");

    const targetTextPress = parseJsonResult(
      "press-target-text",
      await runRdt([
        "interact",
        "press",
        "--session",
        sessionName,
        "--key",
        "Enter",
        "--target-text",
        "Filter inventory",
        "--format",
        "json",
      ]),
    );
    ensure(targetTextPress.targetingStrategy === "target-text", "press-target-text did not use target-text targeting");
    ensure(targetTextPress.targetingResolution === "label-control", "press-target-text did not resolve through label-control");
    ensure(targetTextPress.target?.tagName === "input", "press-target-text did not resolve to an input");

    const roleType = parseJsonResult(
      "type-role-targeting",
      await runRdt([
        "interact",
        "type",
        "--session",
        sessionName,
        "--role",
        "textbox",
        "--strict",
        "--text",
        "analytics",
        "--format",
        "json",
      ]),
    );
    ensure(roleType.action === "type", "type-role-targeting did not report type action");
    ensure(roleType.targetingStrategy === "role", "type-role-targeting did not use role targeting");
    ensure(roleType.strict === true, "type-role-targeting did not report strict=true");

    const rolePress = parseJsonResult(
      "press-role-targeting",
      await runRdt([
        "interact",
        "press",
        "--session",
        sessionName,
        "--key",
        "Enter",
        "--role",
        "textbox",
        "--strict",
        "--format",
        "json",
      ]),
    );
    ensure(rolePress.action === "press", "press-role-targeting did not report press action");
    ensure(rolePress.targetingStrategy === "role", "press-role-targeting did not use role targeting");
    ensure(rolePress.strict === true, "press-role-targeting did not report strict=true");
    ensure(rolePress.effectiveDelivery === "keyboard", "press-role-targeting did not use keyboard delivery");

    const invalidClickResult = await runRdt([
      "interact",
      "click",
      "--session",
      sessionName,
      "--selector",
      "button.counter",
      "--text",
      "Count is",
    ]);
    ensure(invalidClickResult.code !== 0, "invalid-click-targeting unexpectedly succeeded");
    ensure(invalidClickResult.stderr.includes("Use exactly one"), "invalid-click-targeting did not explain the conflicting target failure");

    const invalidTypeResult = await runRdt([
      "interact",
      "type",
      "--session",
      sessionName,
      "--text",
      "hello",
    ]);
    ensure(invalidTypeResult.code !== 0, "invalid-type-targeting unexpectedly succeeded");
    ensure(invalidTypeResult.stderr.includes("Missing type target"), "invalid-type-targeting did not explain the missing target failure");

    const invalidPressResult = await runRdt([
      "interact",
      "press",
      "--session",
      sessionName,
      "--key",
      "Enter",
      "--strict",
    ]);
    ensure(invalidPressResult.code !== 0, "invalid-press-targeting unexpectedly succeeded");
    ensure(invalidPressResult.stderr.includes("Missing press target"), "invalid-press-targeting did not explain the missing target failure");
    logScenarioOk("click-targeting-and-delivery");
  } finally {
    await closeSession(sessionName);
    await stopDevServer(server);
  }
}

main().catch((error) => {
  process.stderr.write(`not ok - integration-harness\n${error.stack || error.message || String(error)}\n`);
  process.exit(1);
});
