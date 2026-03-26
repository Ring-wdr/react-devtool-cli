import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { CliError, normalizeError } from "./errors.js";
import { createRuntimeScript } from "./runtime-script.js";
import {
  buildSessionCapabilities,
  getSessionEndpoint,
  normalizeBrowserName,
  normalizeEngine,
  normalizeTransport,
  resolveTimeoutMs,
} from "./session-model.js";
import { ensureSessionDir, removeSessionFiles, writeMetadata, writeRuntime } from "./session-store.js";

const require = createRequire(import.meta.url);

function resolveLocalPackage(packageName) {
  try {
    return require.resolve(packageName, { paths: [process.cwd()] });
  } catch {
    return null;
  }
}

function resolveGlobalPackage(packageName) {
  const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmExecutable, ["root", "-g"], {
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.status !== 0) {
    return null;
  }

  const globalRoot = result.stdout.trim();
  if (!globalRoot) {
    return null;
  }

  try {
    return require.resolve(packageName, { paths: [globalRoot] });
  } catch {
    return null;
  }
}

async function loadPlaywright() {
  const envPath = process.env.RDT_PLAYWRIGHT_PATH;
  const candidates = [
    () => {
      const resolved = resolveLocalPackage("playwright");
      if (!resolved) {
        throw new Error("skip");
      }
      return import(pathToFileURL(resolved).href).then((loaded) => ({
        loaded,
        source: "local-playwright",
        resolvedPath: resolved,
      }));
    },
    () => {
      const resolved = resolveLocalPackage("playwright-core");
      if (!resolved) {
        throw new Error("skip");
      }
      return import(pathToFileURL(resolved).href).then((loaded) => ({
        loaded,
        source: "local-playwright-core",
        resolvedPath: resolved,
      }));
    },
    () => {
      if (!envPath) {
        throw new Error("skip");
      }
      return import(pathToFileURL(envPath).href).then((loaded) => ({
        loaded,
        source: "env-path",
        resolvedPath: envPath,
      }));
    },
    () => {
      const resolved = resolveGlobalPackage("playwright");
      if (!resolved) {
        throw new Error("skip");
      }
      return import(pathToFileURL(resolved).href).then((loaded) => ({
        loaded,
        source: "global-playwright",
        resolvedPath: resolved,
      }));
    },
    () => {
      const resolved = resolveGlobalPackage("playwright-core");
      if (!resolved) {
        throw new Error("skip");
      }
      return import(pathToFileURL(resolved).href).then((loaded) => ({
        loaded,
        source: "global-playwright-core",
        resolvedPath: resolved,
      }));
    },
  ];

  for (const candidate of candidates) {
    try {
      const resolved = await candidate();
      if (resolved?.loaded?.chromium) {
        return resolved;
      }
    } catch {}
  }

  try {
    const resolved = resolveLocalPackage("playwright");
    const loaded = await import("playwright");
    return {
      loaded,
      source: "local-playwright",
      resolvedPath: resolved || "playwright",
    };
  } catch (error) {
    throw new CliError(
      'Playwright runtime was not found. Install `playwright` locally, install it globally, or set `RDT_PLAYWRIGHT_PATH` to a resolvable module entry.',
      { code: "missing-playwright" },
    );
  }
}

function buildHelperImportTarget(resolvedPath) {
  if (!resolvedPath || resolvedPath === "playwright" || resolvedPath === "playwright-core") {
    return null;
  }

  try {
    return pathToFileURL(resolvedPath).href;
  } catch {
    return null;
  }
}

function checkExternalNodePlaywrightImport() {
  const scriptPath = path.join(os.tmpdir(), `rdt-playwright-check-${randomUUID()}.mjs`);
  const scriptContents = `import("playwright").then(() => {
  process.stdout.write(JSON.stringify({ ok: true }) + "\\n");
}).catch((error) => {
  process.stderr.write(JSON.stringify({
    ok: false,
    code: error?.code || null,
    message: error?.message || String(error),
  }) + "\\n");
  process.exit(1);
});\n`;

  try {
    fs.writeFileSync(scriptPath, scriptContents, "utf8");
    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: "utf8",
      windowsHide: true,
    });

    if (result.status === 0) {
      return {
        ok: true,
        status: "ok",
        mode: "tmp-script",
      };
    }

    let details = null;
    try {
      details = JSON.parse(result.stderr.trim().split("\n").pop() || "{}");
    } catch {}

    return {
      ok: false,
      status: details?.code === "ERR_MODULE_NOT_FOUND" ? "missing-package" : "resolution-mismatch",
      mode: "tmp-script",
      code: details?.code || null,
      message: details?.message || result.stderr.trim() || result.stdout.trim() || null,
    };
  } finally {
    try {
      fs.unlinkSync(scriptPath);
    } catch {}
  }
}

function unwrapRuntimeResult(result) {
  if (result?.__rdtError) {
    throw new CliError(result.message, {
      code: result.code,
      details: result.details,
    });
  }

  return result;
}

function normalizeClickDeliveryMode(value) {
  if (value == null) {
    return "auto";
  }

  const normalized = String(value);
  if (normalized === "auto" || normalized === "playwright" || normalized === "dom") {
    return normalized;
  }

  throw new CliError(`Unsupported interact click delivery mode: ${normalized}`, {
    code: "unsupported-delivery-mode",
  });
}

function parseServerArgv(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const [, rawKey, inlineValue] = token.match(/^--([^=]+)(?:=(.*))?$/) ?? [];
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (inlineValue !== undefined) {
      options[key] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return options;
}

async function findTargetPage(browser, targetUrl) {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (!targetUrl || page.url().includes(targetUrl)) {
        return page;
      }
    }
  }

  return null;
}

function resolveBrowserType(playwright, browserName, transport) {
  const normalized = normalizeBrowserName(browserName, transport);
  const browserType = playwright[normalized];

  if (!browserType) {
    throw new CliError(`Playwright runtime does not provide browser: ${normalized}`, {
      code: "unsupported-browser",
    });
  }

  return { browserName: normalized, browserType };
}

function resolveContextOptions(playwright, options) {
  const contextOptions = {};

  if (options.device) {
    const device = playwright.devices?.[String(options.device)];
    if (!device) {
      throw new CliError(`Unknown Playwright device: ${options.device}`, {
        code: "invalid-device",
      });
    }
    Object.assign(contextOptions, device);
  }

  if (options.storageState) {
    contextOptions.storageState = String(options.storageState);
  }

  return contextOptions;
}

class SessionServer {
  constructor(options) {
    this.options = options;
    this.sessionName = options.sessionName;
    this.secret = options.secret;
    this.transport = normalizeTransport(options.transport ?? options.mode);
    this.browserName = normalizeBrowserName(options.browser, this.transport);
    this.enginePreference = normalizeEngine(options.engine);
    this.timeoutMs = resolveTimeoutMs(options);
    this.endpoint = getSessionEndpoint(this.transport, options);
    this.persistent = false;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.server = null;
    this.playwrightResolution = {
      source: "unresolved",
      resolvedPath: null,
    };
  }

  async start() {
    await this.initializeBrowser();
    await this.ensureReactSettled();

    this.server = http.createServer((request, response) => {
      this.handleRequest(request, response).catch((error) => {
        const normalized = normalizeError(error);
        response.writeHead(500, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            error: {
              code: normalized.code,
              message: normalized.message,
            },
          }),
        );
      });
    });

    await new Promise((resolve) => {
      this.server.listen(0, "127.0.0.1", resolve);
    });

    const address = this.server.address();
    const port = typeof address === "object" && address ? address.port : null;
    const runtime = await this.status();

    await writeMetadata(this.sessionName, {
      sessionName: this.sessionName,
      pid: process.pid,
      port,
      secret: this.secret,
      transport: this.transport,
      browserName: this.browserName,
      enginePreference: this.enginePreference,
      endpoint: this.endpoint,
      persistent: this.persistent,
      createdAt: new Date().toISOString(),
    });

    await writeRuntime(this.sessionName, runtime);
  }

  async initializeBrowser() {
    const playwrightRuntime = await loadPlaywright();
    const playwright = playwrightRuntime.loaded;
    this.playwrightResolution = {
      source: playwrightRuntime.source,
      resolvedPath: playwrightRuntime.resolvedPath,
    };
    const runtimeScript = createRuntimeScript();
    const contextOptions = resolveContextOptions(playwright, this.options);

    if (this.transport === "open") {
      const { browserType } = resolveBrowserType(playwright, this.browserName, this.transport);
      const launchOptions = {
        headless: this.options.headless !== "false",
        channel: this.options.channel ? String(this.options.channel) : undefined,
      };

      if (this.options.userDataDir) {
        this.context = await browserType.launchPersistentContext(String(this.options.userDataDir), {
          ...launchOptions,
          ...contextOptions,
        });
        this.persistent = true;
        this.browser = this.context.browser();
      } else {
        this.browser = await browserType.launch(launchOptions);
        this.context = await this.browser.newContext(contextOptions);
      }

      this.applyTimeouts(this.context);
      await this.context.addInitScript({ content: runtimeScript });
      this.page = this.context.pages()[0] ?? await this.context.newPage();
      await this.page.goto(this.options.url, {
        waitUntil: "load",
        timeout: this.timeoutMs,
      });
      return;
    }

    if (this.transport === "connect") {
      const { browserType } = resolveBrowserType(playwright, this.browserName, this.transport);
      try {
        this.browser = await browserType.connect(String(this.options.wsEndpoint));
      } catch (error) {
        throw new CliError(`Failed to connect to Playwright endpoint: ${error.message}`, {
          code: "connect-failed",
        });
      }

      this.page = await findTargetPage(this.browser, this.options.targetUrl);
      if (!this.page) {
        throw new CliError("No matching page found for connect mode.", {
          code: "page-not-found",
        });
      }

      this.context = this.page.context();
      this.applyTimeouts(this.context);
      await this.context.addInitScript({ content: runtimeScript });
      await this.page.reload({
        waitUntil: "load",
        timeout: this.timeoutMs,
      });
      return;
    }

    if (this.transport === "attach") {
      try {
        this.browser = await playwright.chromium.connectOverCDP(String(this.options.cdpUrl));
      } catch (error) {
        throw new CliError(`Failed to attach to CDP endpoint: ${error.message}`, {
          code: "cdp-attach-failed",
        });
      }

      this.page = await findTargetPage(this.browser, this.options.targetUrl);
      if (!this.page) {
        throw new CliError("No matching page found for attach mode.", {
          code: "page-not-found",
        });
      }

      this.context = this.page.context();
      this.applyTimeouts(this.context);
      await this.context.addInitScript({ content: runtimeScript });
      await this.page.reload({
        waitUntil: "load",
        timeout: this.timeoutMs,
      });
      return;
    }

    throw new CliError(`Unsupported transport: ${this.transport}`, { code: "unsupported-transport" });
  }

  applyTimeouts(context) {
    if (!this.timeoutMs) {
      return;
    }

    context.setDefaultTimeout(this.timeoutMs);
    context.setDefaultNavigationTimeout(this.timeoutMs);
  }

  async ensureReactSettled() {
    const timeoutMs = 5000;
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const snapshot = await this.collectTree();
      if (snapshot.reactDetected) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  async collectTree() {
    return this.page.evaluate((preferredEngine) => window.__RDT_CLI_RUNTIME__.collectTree(preferredEngine), this.enginePreference);
  }

  async peekTree() {
    return this.page.evaluate((preferredEngine) => window.__RDT_CLI_RUNTIME__.peekTree(preferredEngine), this.enginePreference);
  }

  async getEngineInfo() {
    return this.page.evaluate((preferredEngine) => window.__RDT_CLI_RUNTIME__.getEngineInfo(preferredEngine), this.enginePreference);
  }

  async status() {
    const tree = await this.peekTree();
    const engineInfo = await this.getEngineInfo();
    return {
      sessionName: this.sessionName,
      transport: this.transport,
      browserName: this.browserName,
      enginePreference: this.enginePreference,
      selectedEngine: engineInfo.selectedEngine,
      availableEngines: engineInfo.availableEngines,
      recommendedEngine: engineInfo.recommendedEngine,
      engineFallback: engineInfo.engineFallback,
      endpoint: this.endpoint,
      persistent: this.persistent,
      target: this.page.url(),
      reactDetected: tree.reactDetected,
      roots: tree.roots,
      nodeCount: tree.nodes.length,
      title: await this.page.title(),
      capabilities: buildSessionCapabilities({
        transport: this.transport,
        persistent: this.persistent,
      }),
    };
  }

  async doctor() {
    const runtimeDoctor = unwrapRuntimeResult(await this.page.evaluate(
      (preferredEngine) => window.__RDT_CLI_RUNTIME__.doctor(preferredEngine),
      this.enginePreference,
    ));
    const externalImport = checkExternalNodePlaywrightImport();
    const runtimeWarnings = runtimeDoctor.runtimeWarnings.slice();
    let helperScriptWarning = null;
    const helperImportTarget = buildHelperImportTarget(this.playwrightResolution.resolvedPath);
    const helperImportExample = helperImportTarget
      ? `const playwright = await import(${JSON.stringify(helperImportTarget)});`
      : null;

    if (!externalImport.ok) {
      helperScriptWarning = helperImportTarget
        ? "rdt can resolve Playwright for its own session, but standalone Node helper scripts may fail to import `playwright`. Use helperImportTarget from this doctor response, or set RDT_PLAYWRIGHT_PATH to a resolvable module entry."
        : "rdt can resolve Playwright for its own session, but standalone Node helper scripts may fail to import `playwright`. Run helper code from the repo, or set RDT_PLAYWRIGHT_PATH to a resolvable module entry.";
      runtimeWarnings.push(helperScriptWarning);
    }

    const checks = {
      ...runtimeDoctor.checks,
      interaction: {
        status: this.page ? "ok" : "failed",
        hasPageTarget: Boolean(this.page),
        supportsBuiltInInteract: Boolean(this.page),
      },
      playwrightRuntime: {
        status: this.playwrightResolution.source === "unresolved" ? "failed" : "ok",
        source: this.playwrightResolution.source,
        resolvedPath: this.playwrightResolution.resolvedPath,
      },
      externalNodeImport: {
        status: externalImport.status,
        canImportPlaywright: externalImport.ok,
        mode: externalImport.mode,
        code: externalImport.code || null,
        message: externalImport.message || null,
      },
    };

    const statuses = Object.values(checks).map((check) => check.status);
    let status = "ok";
    if (statuses.includes("failed")) {
      status = "failed";
    } else if (statuses.includes("partial") || statuses.includes("degraded") || runtimeWarnings.length) {
      status = "partial";
    }

    return {
      sessionName: this.sessionName,
      transport: this.transport,
      browserName: this.browserName,
      enginePreference: this.enginePreference,
      availableEngines: runtimeDoctor.availableEngines,
      selectedEngine: runtimeDoctor.selectedEngine,
      recommendedEngine: runtimeDoctor.recommendedEngine,
      engineFallback: runtimeDoctor.engineFallback,
      engineReasons: runtimeDoctor.engineReasons,
      devtoolsCapabilities: runtimeDoctor.devtoolsCapabilities,
      sourceCapability: runtimeDoctor.sourceCapability,
      target: this.page.url(),
      status,
      observationLevel: "observed",
      limitations: runtimeDoctor.limitations.concat([
        "external helper scripts may not resolve Playwright the same way as rdt",
      ]),
      runtimeWarnings,
      checks,
      rdtPlaywrightResolution: {
        source: this.playwrightResolution.source,
        resolvedPath: this.playwrightResolution.resolvedPath,
      },
      helperImportTarget,
      helperImportExample,
      externalNodeCanImportPlaywright: externalImport.ok,
      externalNodeImportCheck: externalImport.status,
      helperScriptWarning,
      recommendedWorkflow: runtimeDoctor.recommendedWorkflow || [
        "run session doctor before profiling or scripted interactions",
        "prefer built-in interact commands over ad hoc Playwright helper scripts",
        "capture snapshotId with tree get before node search/inspect/highlight/source",
        "use profiler commits, commit, ranked, flamegraph, and compare for follow-up analysis",
      ],
      recommendedProfilerWorkflow: runtimeDoctor.recommendedProfilerWorkflow || [],
      recommendedCommitSelection: runtimeDoctor.recommendedCommitSelection || [],
      unsafeConclusions: runtimeDoctor.unsafeConclusions || [
        "all matching nodes rerendered because a commit happened",
        "external helper scripts will resolve Playwright exactly like rdt does",
      ],
      helperStrategy: externalImport.ok ? "standalone-helper-or-interact" : "prefer-built-in-interact-or-helperImportTarget",
    };
  }

  async ensureInteractivePage() {
    if (!this.page) {
      throw new CliError("The current session does not have an interactive page target.", {
        code: "page-not-found",
      });
    }

    return this.page;
  }

  async isProfilerActive() {
    const page = await this.ensureInteractivePage();

    try {
      return await page.evaluate(() => Boolean(window.__RDT_CLI_RUNTIME__?.profilerSummary?.().active));
    } catch {
      return false;
    }
  }

  async clickLocatorDom(locator, timeoutMs) {
    await locator.waitFor({ state: "visible", timeout: timeoutMs });
    await locator.scrollIntoViewIfNeeded({ timeout: timeoutMs });
    const clicked = await locator.evaluate((element) => {
      const ariaDisabled = element.getAttribute?.("aria-disabled");
      const disabled = typeof element.matches === "function" ? element.matches(":disabled") : false;
      if (disabled || ariaDisabled === "true") {
        return false;
      }

      if (typeof element.click === "function") {
        element.click();
        return true;
      }

      element.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
      }));
      return true;
    });

    if (!clicked) {
      throw new CliError("Target element is disabled.", { code: "disabled-target" });
    }

    return "dom-click";
  }

  async clickLocator(locator, timeoutMs, requestedDelivery) {
    const profilerActive = await this.isProfilerActive();

    if (requestedDelivery === "playwright") {
      await locator.click({ timeout: timeoutMs, noWaitAfter: true });
      return {
        effectiveDelivery: "playwright",
        profilerActive,
        fallbackApplied: false,
      };
    }

    if (requestedDelivery === "dom") {
      return {
        effectiveDelivery: await this.clickLocatorDom(locator, timeoutMs),
        profilerActive,
        fallbackApplied: false,
      };
    }

    if (!profilerActive) {
      await locator.click({ timeout: timeoutMs, noWaitAfter: true });
      return {
        effectiveDelivery: "playwright",
        profilerActive,
        fallbackApplied: false,
      };
    }

    return {
      effectiveDelivery: await this.clickLocatorDom(locator, timeoutMs),
      profilerActive,
      fallbackApplied: true,
    };
  }

  async interact(command, payload) {
    const page = await this.ensureInteractivePage();
    const timeoutMs = payload.timeoutMs ? Number(payload.timeoutMs) : this.timeoutMs;

    if (command === "wait") {
      const ms = Number(payload.ms);
      await page.waitForTimeout(ms);
      return {
        observationLevel: "observed",
        limitations: [],
        runtimeWarnings: [],
        action: "wait",
        ok: true,
        waitedMs: ms,
      };
    }

    const selector = payload.selector ? String(payload.selector) : null;
    const locator = selector ? page.locator(selector).first() : null;
    if (locator) {
      await locator.waitFor({ state: "attached", timeout: timeoutMs });
    }
    const target = selector
      ? await locator.evaluate((element) => ({
          tagName: element.tagName.toLowerCase(),
          id: element.id || null,
          className: element.className || null,
          textPreview: element.textContent ? element.textContent.slice(0, 80) : null,
        }))
      : null;
    let delivery = command;
    const runtimeWarnings = [];
    let requestedDelivery = null;
    let profilerActive = false;
    let fallbackApplied = false;

    if (command === "click") {
      requestedDelivery = normalizeClickDeliveryMode(payload.delivery);
      const clickResult = await this.clickLocator(locator, timeoutMs, requestedDelivery);
      delivery = clickResult.effectiveDelivery;
      profilerActive = clickResult.profilerActive;
      fallbackApplied = clickResult.fallbackApplied;
    } else if (command === "type") {
      await locator.focus({ timeout: timeoutMs });
      await locator.fill(String(payload.text), { timeout: timeoutMs });
      delivery = "fill";
    } else if (command === "press") {
      if (locator) {
        await locator.focus({ timeout: timeoutMs });
      }
      await page.keyboard.press(String(payload.key));
      delivery = "keyboard";
    } else {
      throw new CliError(`Unsupported interact action: ${command}`, { code: "unsupported-action" });
    }

    runtimeWarnings.push("Interact actions confirm dispatch only; verify post-action UI state with follow-up commands when profiling or large rerenders are active.");
    if (command === "click" && fallbackApplied) {
      runtimeWarnings.push("Profiler was active, so click used a DOM fallback instead of Playwright pointer input.");
    }
    if (command === "click" && requestedDelivery === "playwright" && profilerActive) {
      runtimeWarnings.push("Profiler is active and click delivery was forced to Playwright pointer input.");
    }
    if (command === "click" && requestedDelivery === "dom" && !profilerActive) {
      runtimeWarnings.push("Click delivery was forced to DOM dispatch even though profiler fallback was not required.");
    }

    return {
      observationLevel: "observed",
      limitations: ["selector-based interaction targets the first matching element only"],
      runtimeWarnings,
      action: command,
      ok: true,
      delivery,
      requestedDelivery,
      effectiveDelivery: delivery,
      profilerActive,
      fallbackApplied,
      selector,
      target,
      key: payload.key ? String(payload.key) : null,
      textLength: payload.text != null ? String(payload.text).length : null,
    };
  }

  async ensureReactDetected() {
    const tree = await this.peekTree();
    if (!tree.reactDetected) {
      throw new CliError("The current page does not expose a React fiber tree.", {
        code: "not-react-app",
      });
    }

    return tree;
  }

  async handleRequest(request, response) {
    if (request.method !== "POST" || request.url !== "/command") {
      response.writeHead(404);
      response.end();
      return;
    }

    if (request.headers["x-rdt-session-secret"] !== this.secret) {
      response.writeHead(403, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { code: "forbidden", message: "Invalid session secret." } }));
      return;
    }

    const body = await new Promise((resolve, reject) => {
      let data = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        data += chunk;
      });
      request.on("end", () => resolve(data));
      request.on("error", reject);
    });

    const { action, payload } = JSON.parse(body || "{}");
    const result = await this.execute(action, payload || {});

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, result }));

    if (action !== "session.close") {
      this.refreshRuntime().catch(() => {});
    }
  }

  async refreshRuntime() {
    await writeRuntime(this.sessionName, await this.status());
  }

  async execute(action, payload) {
    switch (action) {
      case "session.status":
        return this.status();
      case "session.doctor":
        return this.doctor();
      case "session.close":
        return this.close();
      case "tree.get":
        return this.collectTree();
      case "tree.stats":
        return this.page.evaluate(
          ({ top, preferredEngine }) => window.__RDT_CLI_RUNTIME__.treeStats(top, preferredEngine),
          { top: payload.top, preferredEngine: this.enginePreference },
        );
      case "node.inspect":
        await this.ensureReactDetected();
        return unwrapRuntimeResult(await this.page.evaluate(
          ({ nodeId, snapshotId, commitId }) => window.__RDT_CLI_RUNTIME__.inspectNode(nodeId, snapshotId, commitId),
          { ...payload, preferredEngine: this.enginePreference },
        ));
      case "node.search":
        await this.ensureReactDetected();
        return unwrapRuntimeResult(await this.page.evaluate(
          ({ query, snapshotId, preferredEngine, structured }) => {
            return window.__RDT_CLI_RUNTIME__.searchNodes(query, snapshotId, preferredEngine, structured);
          },
          { ...payload, preferredEngine: this.enginePreference },
        ));
      case "node.highlight":
        await this.ensureReactDetected();
        return unwrapRuntimeResult(await this.page.evaluate(
          ({ nodeId, snapshotId, preferredEngine }) => window.__RDT_CLI_RUNTIME__.highlightNode(nodeId, snapshotId, preferredEngine),
          { ...payload, preferredEngine: this.enginePreference },
        ));
      case "node.pick":
        await this.ensureReactDetected();
        return this.page.evaluate(
          ({ timeoutMs, preferredEngine }) => window.__RDT_CLI_RUNTIME__.pickNode(timeoutMs, preferredEngine),
          { timeoutMs: payload.timeoutMs ?? 30000, preferredEngine: this.enginePreference },
        );
      case "interact.click":
        return this.interact("click", payload);
      case "interact.type":
        return this.interact("type", payload);
      case "interact.press":
        return this.interact("press", payload);
      case "interact.wait":
        return this.interact("wait", payload);
      case "profiler.start":
        await this.ensureReactDetected();
        return this.page.evaluate(
          ({ profileId, preferredEngine }) => window.__RDT_CLI_RUNTIME__.startProfiler(profileId, preferredEngine),
          { profileId: payload.profileId, preferredEngine: this.enginePreference },
        );
      case "profiler.stop":
        await this.ensureReactDetected();
        return this.page.evaluate(() => window.__RDT_CLI_RUNTIME__.stopProfiler());
      case "profiler.export":
        await this.ensureReactDetected();
        return unwrapRuntimeResult(await this.page.evaluate(
          ({ profileId }) => window.__RDT_CLI_RUNTIME__.exportProfiler(profileId),
          payload,
        ));
      case "profiler.profile":
        await this.ensureReactDetected();
        return unwrapRuntimeResult(await this.page.evaluate(
          ({ profileId }) => window.__RDT_CLI_RUNTIME__.profilerProfile(profileId),
          payload,
        ));
      case "profiler.summary":
        await this.ensureReactDetected();
        return this.page.evaluate(() => window.__RDT_CLI_RUNTIME__.profilerSummary());
      case "profiler.commits":
        await this.ensureReactDetected();
        return this.page.evaluate(() => window.__RDT_CLI_RUNTIME__.profilerCommits());
      case "profiler.commit":
        await this.ensureReactDetected();
        return unwrapRuntimeResult(await this.page.evaluate(
          ({ commitId }) => window.__RDT_CLI_RUNTIME__.profilerCommit(commitId),
          payload,
        ));
      case "profiler.ranked":
        await this.ensureReactDetected();
        return unwrapRuntimeResult(await this.page.evaluate(
          ({ commitId, limit }) => window.__RDT_CLI_RUNTIME__.profilerRanked(commitId, limit),
          payload,
        ));
      case "profiler.flamegraph":
        await this.ensureReactDetected();
        return unwrapRuntimeResult(await this.page.evaluate(
          ({ commitId }) => window.__RDT_CLI_RUNTIME__.profilerFlamegraph(commitId),
          payload,
        ));
      case "source.reveal":
        await this.ensureReactDetected();
        return unwrapRuntimeResult(await this.page.evaluate(
          ({ nodeId, snapshotId, commitId, preferredEngine, structured }) => {
            return window.__RDT_CLI_RUNTIME__.revealSource(
              nodeId,
              snapshotId,
              commitId,
              preferredEngine,
              structured,
            );
          },
          { ...payload, preferredEngine: this.enginePreference },
        ));
      default:
        throw new CliError(`Unsupported action: ${action}`, { code: "unsupported-action" });
    }
  }

  async close() {
    const result = { closed: true, sessionName: this.sessionName };
    setTimeout(async () => {
      await this.dispose();
      process.exit(0);
    }, 50);
    return result;
  }

  async dispose() {
    await removeSessionFiles(this.sessionName);

    if (this.server) {
      await new Promise((resolve) => this.server.close(resolve));
    }

    if (this.browser) {
      await this.browser.close();
    }
  }
}

async function main() {
  const options = parseServerArgv(process.argv.slice(2));
  const sessionName = options.sessionName;
  const secret = options.secret || randomUUID();

  if (!sessionName) {
    throw new CliError("Missing --session-name for server bootstrap.", { code: "missing-session-name" });
  }

  await ensureSessionDir(sessionName);
  const server = new SessionServer({
    ...options,
    sessionName,
    secret,
  });

  process.on("SIGINT", async () => {
    await server.dispose();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await server.dispose();
    process.exit(0);
  });

  await server.start();
}

main().catch(async (error) => {
  const message = error?.stack ?? error?.message ?? String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
