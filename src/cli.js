import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { parseArgv } from "./args.js";
import { CliError, ensure, normalizeError } from "./errors.js";
import { formatOutput } from "./format.js";
import { requestSession } from "./http-client.js";
import { normalizeBrowserName, normalizeTransport, resolveTimeoutMs } from "./session-model.js";
import {
  createSessionName,
  ensureSessionDir,
  getSessionPaths,
  readMetadata,
} from "./session-store.js";

async function waitForSessionReady(sessionName, timeoutMs = 15000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await readMetadata(sessionName);
      const response = await requestSession(sessionName, "session.status");
      return response.result;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  const paths = await getSessionPaths(sessionName);
  let logs = "";
  try {
    logs = await fsPromises.readFile(paths.logPath, "utf8");
  } catch {}

  throw new CliError(
    `Session "${sessionName}" did not become ready in time.${logs ? `\n\n${logs}` : ""}`,
    { code: "session-start-timeout" },
  );
}

async function spawnSessionServer(mode, sessionName, options) {
  const paths = await ensureSessionDir(sessionName);
  const logFd = fs.openSync(paths.logPath, "a");
  const serverPath = fileURLToPath(new URL("./server.js", import.meta.url));

  const args = [
    serverPath,
    "--transport",
    mode,
    "--session-name",
    sessionName,
    "--secret",
    randomUUID(),
  ];

  for (const [key, value] of Object.entries(options)) {
    if (value === undefined || value === null || value === false) {
      continue;
    }

    const flag = `--${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`;
    if (value === true) {
      args.push(flag);
      continue;
    }

    args.push(flag, String(value));
  }

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
  });

  child.unref();
  fs.closeSync(logFd);
}

function resolveFormat(options, fallback = "json") {
  return options.format ? String(options.format) : fallback;
}

function collectSnapshotPayload(options) {
  return options.snapshot ? { snapshotId: String(options.snapshot) } : {};
}

function writeStdout(value, format) {
  process.stdout.write(formatOutput(value, format));
}

function collectSharedSessionOptions(options, transport) {
  const timeout = resolveTimeoutMs(options);
  const result = {
    browser: normalizeBrowserName(options.browser, transport),
    channel: options.channel,
    device: options.device,
    storageState: options.storageState,
    userDataDir: options.userDataDir,
    timeout,
    headless: transport === "open" ? options.headless ?? true : undefined,
    targetUrl: options.targetUrl,
  };

  return result;
}

async function handleSessionCommand(command, options) {
  if (command === "status") {
    ensure(options.session, "Missing required option --session", { code: "missing-session" });
    const response = await requestSession(options.session, "session.status");
    writeStdout(response.result, resolveFormat(options));
    return;
  }

  if (command === "close") {
    ensure(options.session, "Missing required option --session", { code: "missing-session" });
    const response = await requestSession(options.session, "session.close");
    writeStdout(response.result, resolveFormat(options));
    return;
  }

  const transport = normalizeTransport(command);

  if (transport === "open") {
    ensure(options.url, "Missing required option --url", { code: "missing-url" });
    const sessionName = options.session ? String(options.session) : createSessionName();
    await spawnSessionServer("open", sessionName, {
      ...collectSharedSessionOptions(options, "open"),
      url: options.url,
    });
    const status = await waitForSessionReady(sessionName);
    writeStdout(status, resolveFormat(options));
    return;
  }

  if (transport === "connect") {
    ensure(options.wsEndpoint, "Missing required option --ws-endpoint", { code: "missing-ws-endpoint" });
    const sessionName = options.session ? String(options.session) : createSessionName();
    await spawnSessionServer("connect", sessionName, {
      ...collectSharedSessionOptions(options, "connect"),
      wsEndpoint: options.wsEndpoint,
    });
    const status = await waitForSessionReady(sessionName);
    writeStdout(status, resolveFormat(options));
    return;
  }

  if (transport === "attach") {
    ensure(options.cdpUrl, "Missing required option --cdp-url", { code: "missing-cdp-url" });
    const sessionName = options.session ? String(options.session) : createSessionName();
    await spawnSessionServer("attach", sessionName, {
      ...collectSharedSessionOptions(options, "attach"),
      cdpUrl: options.cdpUrl,
    });
    const status = await waitForSessionReady(sessionName);
    writeStdout(status, resolveFormat(options));
    return;
  }

  throw new CliError(`Unsupported session command: ${command}`, { code: "unsupported-command" });
}

async function handleTreeCommand(command, options) {
  ensure(command === "get", "Only `rdt tree get` is supported.", { code: "unsupported-command" });
  ensure(options.session, "Missing required option --session", { code: "missing-session" });
  const response = await requestSession(options.session, "tree.get");
  writeStdout(response.result, resolveFormat(options));
}

async function handleNodeCommand(command, positionals, options) {
  ensure(options.session, "Missing required option --session", { code: "missing-session" });

  if (command === "inspect") {
    const nodeId = positionals[0];
    ensure(nodeId, "Missing node id for `rdt node inspect`.", { code: "missing-node-id" });
    const response = await requestSession(options.session, "node.inspect", {
      nodeId,
      ...collectSnapshotPayload(options),
    });
    writeStdout(response.result, resolveFormat(options));
    return;
  }

  if (command === "search") {
    const query = positionals.join(" ");
    ensure(query, "Missing query for `rdt node search`.", { code: "missing-query" });
    const response = await requestSession(options.session, "node.search", {
      query,
      ...collectSnapshotPayload(options),
    });
    writeStdout(response.result, resolveFormat(options));
    return;
  }

  if (command === "highlight") {
    const nodeId = positionals[0];
    ensure(nodeId, "Missing node id for `rdt node highlight`.", { code: "missing-node-id" });
    const response = await requestSession(options.session, "node.highlight", {
      nodeId,
      ...collectSnapshotPayload(options),
    });
    writeStdout(response.result, resolveFormat(options));
    return;
  }

  if (command === "pick") {
    const response = await requestSession(options.session, "node.pick", {
      timeoutMs: options.timeoutMs ?? 30000,
    });
    writeStdout(response.result, resolveFormat(options));
    return;
  }

  throw new CliError(`Unsupported node command: ${command}`, { code: "unsupported-command" });
}

async function writeProfilerExport(sessionName, exported, options) {
  const outputPath = options.output
    ? path.resolve(String(options.output))
    : path.resolve(process.cwd(), `${sessionName}-${exported.profileId || Date.now()}.jsonl${options.compress ? ".gz" : ""}`);

  const lines = exported.events.map((event) =>
    JSON.stringify({
      sessionId: sessionName,
      profileId: exported.profileId,
      eventType: event.eventType,
      timestamp: event.timestamp,
      payload: event,
    }),
  );

  const contents = `${lines.join("\n")}${lines.length ? "\n" : ""}`;

  if (options.compress) {
    await fsPromises.writeFile(outputPath, gzipSync(Buffer.from(contents, "utf8")));
  } else {
    await fsPromises.writeFile(outputPath, contents, "utf8");
  }

  return {
    outputPath,
    eventCount: exported.events.length,
    compressed: Boolean(options.compress),
    summary: exported.summary,
  };
}

async function handleProfilerCommand(command, options) {
  ensure(options.session, "Missing required option --session", { code: "missing-session" });

  if (command === "start") {
    const profileId = options.profileId ? String(options.profileId) : `profile-${Date.now().toString(36)}`;
    const response = await requestSession(options.session, "profiler.start", { profileId });
    writeStdout(response.result, resolveFormat(options));
    return;
  }

  if (command === "stop") {
    const response = await requestSession(options.session, "profiler.stop");
    writeStdout(response.result, resolveFormat(options));
    return;
  }

  if (command === "summary") {
    const response = await requestSession(options.session, "profiler.summary");
    writeStdout(response.result, resolveFormat(options));
    return;
  }

  if (command === "export") {
    const format = resolveFormat(options);
    if (format === "yaml") {
      throw new CliError("YAML is only supported for compact results. Use profiler summary or export NDJSON.", {
        code: "unsupported-format",
      });
    }

    const response = await requestSession(options.session, "profiler.export");
    const result = await writeProfilerExport(options.session, response.result, options);
    writeStdout(result, format === "pretty" ? "pretty" : "json");
    return;
  }

  throw new CliError(`Unsupported profiler command: ${command}`, { code: "unsupported-command" });
}

async function handleSourceCommand(command, positionals, options) {
  ensure(command === "reveal", "Only `rdt source reveal` is supported.", { code: "unsupported-command" });
  ensure(options.session, "Missing required option --session", { code: "missing-session" });
  const nodeId = positionals[0];
  ensure(nodeId, "Missing node id for `rdt source reveal`.", { code: "missing-node-id" });
  const response = await requestSession(options.session, "source.reveal", {
    nodeId,
    ...collectSnapshotPayload(options),
  });
  writeStdout(response.result, resolveFormat(options));
}

function printHelp() {
  process.stdout.write(`react-devtool-cli

Recommended flow:
  1. Use rdt session open for the default local Playwright path
  2. Use rdt session connect for a remote Playwright wsEndpoint
  3. Use rdt session attach only for Chromium CDP compatibility
  4. Use rdt tree/node/profiler commands for structured output
  5. For agent workflows, capture snapshotId from tree get and pass it to later node/source commands

Usage:
  rdt session open --url <url> [--browser chromium|firefox|webkit] [--channel <name>] [--device <name>] [--storage-state <path>] [--user-data-dir <path>] [--timeout <ms>] [--headless=false] [--session <name>]
  rdt session connect --ws-endpoint <url> [--browser chromium|firefox|webkit] [--target-url <substring>] [--timeout <ms>] [--session <name>]
  rdt session attach --cdp-url <url> [--target-url <substring>] [--timeout <ms>] [--session <name>]
  rdt session status --session <name>
  rdt session close --session <name>
  rdt tree get --session <name> [--format json|yaml|pretty]
  rdt node inspect <id> --session <name> [--snapshot <id>]
  rdt node search <query> --session <name> [--snapshot <id>]
  rdt node highlight <id> --session <name> [--snapshot <id>]
  rdt node pick --session <name> [--timeout-ms 30000]
  rdt profiler start --session <name> [--profile-id <id>]
  rdt profiler stop --session <name>
  rdt profiler summary --session <name> [--format json|yaml|pretty]
  rdt profiler export --session <name> [--output file.jsonl] [--compress]
  rdt source reveal <id> --session <name> [--snapshot <id>]

Snapshot behavior:
  - tree get returns snapshotId
  - node ids are scoped to that snapshot
  - if --snapshot is omitted, commands use the latest collected snapshot
  - if an explicit snapshot has expired, commands fail with snapshot-expired
`);
}

export async function runCli(argv) {
  const { positionals, options } = parseArgv(argv);

  if (positionals.length === 0 || options.help) {
    printHelp();
    return;
  }

  const [resource, command, ...rest] = positionals;

  try {
    switch (resource) {
      case "session":
        await handleSessionCommand(command, options);
        return;
      case "tree":
        await handleTreeCommand(command, options);
        return;
      case "node":
        await handleNodeCommand(command, rest, options);
        return;
      case "profiler":
        await handleProfilerCommand(command, options);
        return;
      case "source":
        await handleSourceCommand(command, rest, options);
        return;
      default:
        throw new CliError(`Unsupported resource: ${resource}`, { code: "unsupported-resource" });
    }
  } catch (error) {
    throw normalizeError(error);
  }
}
