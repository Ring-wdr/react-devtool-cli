import http from "node:http";
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
  normalizeTransport,
  resolveTimeoutMs,
} from "./session-model.js";
import { ensureSessionDir, removeSessionFiles, writeMetadata, writeRuntime } from "./session-store.js";

const require = createRequire(import.meta.url);

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
    () => import("playwright"),
    () => import("playwright-core"),
    () => {
      if (!envPath) {
        throw new Error("skip");
      }
      return import(pathToFileURL(envPath).href);
    },
    () => {
      const resolved = resolveGlobalPackage("playwright");
      if (!resolved) {
        throw new Error("skip");
      }
      return import(pathToFileURL(resolved).href);
    },
    () => {
      const resolved = resolveGlobalPackage("playwright-core");
      if (!resolved) {
        throw new Error("skip");
      }
      return import(pathToFileURL(resolved).href);
    },
  ];

  for (const candidate of candidates) {
    try {
      const loaded = await candidate();
      if (loaded?.chromium) {
        return loaded;
      }
    } catch {}
  }

  try {
    return await import("playwright");
  } catch (error) {
    throw new CliError(
      'Playwright runtime was not found. Install `playwright` locally, install it globally, or set `RDT_PLAYWRIGHT_PATH` to a resolvable module entry.',
      { code: "missing-playwright" },
    );
  }
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
    this.timeoutMs = resolveTimeoutMs(options);
    this.endpoint = getSessionEndpoint(this.transport, options);
    this.persistent = false;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.server = null;
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
      endpoint: this.endpoint,
      persistent: this.persistent,
      createdAt: new Date().toISOString(),
    });

    await writeRuntime(this.sessionName, runtime);
  }

  async initializeBrowser() {
    const playwright = await loadPlaywright();
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
    return this.page.evaluate(() => window.__RDT_CLI_RUNTIME__.collectTree());
  }

  async status() {
    const tree = await this.collectTree();
    return {
      sessionName: this.sessionName,
      transport: this.transport,
      browserName: this.browserName,
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

  async ensureReactDetected() {
    const tree = await this.collectTree();
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
    await writeRuntime(this.sessionName, await this.status());

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, result }));
  }

  async execute(action, payload) {
    switch (action) {
      case "session.status":
        return this.status();
      case "session.close":
        return this.close();
      case "tree.get":
        return this.ensureReactDetected();
      case "node.inspect":
        await this.ensureReactDetected();
        return this.page.evaluate((nodeId) => window.__RDT_CLI_RUNTIME__.inspectNode(nodeId), payload.nodeId);
      case "node.search":
        await this.ensureReactDetected();
        return this.page.evaluate((query) => window.__RDT_CLI_RUNTIME__.searchNodes(query), payload.query);
      case "node.highlight":
        await this.ensureReactDetected();
        return this.page.evaluate((nodeId) => window.__RDT_CLI_RUNTIME__.highlightNode(nodeId), payload.nodeId);
      case "node.pick":
        await this.ensureReactDetected();
        return this.page.evaluate((timeoutMs) => window.__RDT_CLI_RUNTIME__.pickNode(timeoutMs), payload.timeoutMs ?? 30000);
      case "profiler.start":
        await this.ensureReactDetected();
        return this.page.evaluate((profileId) => window.__RDT_CLI_RUNTIME__.startProfiler(profileId), payload.profileId);
      case "profiler.stop":
        await this.ensureReactDetected();
        return this.page.evaluate(() => window.__RDT_CLI_RUNTIME__.stopProfiler());
      case "profiler.export":
        await this.ensureReactDetected();
        return this.page.evaluate(() => window.__RDT_CLI_RUNTIME__.exportProfiler());
      case "profiler.summary":
        await this.ensureReactDetected();
        return this.page.evaluate(() => window.__RDT_CLI_RUNTIME__.profilerSummary());
      case "source.reveal":
        await this.ensureReactDetected();
        return this.page.evaluate((nodeId) => {
          const node = window.__RDT_CLI_RUNTIME__.inspectNode(nodeId);
          return node ? node.source : null;
        }, payload.nodeId);
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
