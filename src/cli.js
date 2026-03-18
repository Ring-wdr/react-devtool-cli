import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { parseArgv } from "./args.js";
import { CliError, ensure, normalizeError } from "./errors.js";
import { formatOutput } from "./format.js";
import { requestSession } from "./http-client.js";
import { normalizeBrowserName, normalizeEngine, normalizeTransport, resolveTimeoutMs } from "./session-model.js";
import {
  createSessionName,
  ensureSessionDir,
  getSessionPaths,
  readMetadata,
  removeSessionFiles,
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

function resolveCommitId(positionals, options, message) {
  const commitId = positionals[0] ? String(positionals[0]) : (options.commit ? String(options.commit) : null);
  ensure(commitId, message, { code: "missing-commit-id" });
  return commitId;
}

function writeStdout(value, format) {
  process.stdout.write(formatOutput(value, format));
}

function isMissingProcessMessage(message) {
  const normalized = String(message || "").toLowerCase();
  return normalized.includes("not found")
    || normalized.includes("cannot find")
    || normalized.includes("no running instance")
    || normalized.includes("no instance")
    || normalized.includes("not exist");
}

export function forceKillProcessTree(pid, dependencies = {}) {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new CliError(`Invalid session pid: ${pid}`, { code: "invalid-session-pid" });
  }

  const spawnSyncImpl = dependencies.spawnSyncImpl ?? spawnSync;
  const killImpl = dependencies.killImpl ?? process.kill;
  const platform = dependencies.platform ?? process.platform;

  if (platform === "win32") {
    const result = spawnSyncImpl("taskkill", ["/PID", String(pid), "/T", "/F"], {
      encoding: "utf8",
      windowsHide: true,
    });

    if (result.status === 0 || isMissingProcessMessage(result.stdout) || isMissingProcessMessage(result.stderr)) {
      return { ok: true, strategy: "taskkill" };
    }

    throw new CliError(
      `Failed to terminate session process tree ${pid}: ${result.stderr?.trim() || result.stdout?.trim() || "taskkill failed"}`,
      { code: "session-force-close-failed" },
    );
  }

  try {
    killImpl(-pid, "SIGKILL");
    return { ok: true, strategy: "process-group" };
  } catch (error) {
    if (error?.code !== "ESRCH") {
      try {
        killImpl(pid, "SIGKILL");
        return { ok: true, strategy: "process" };
      } catch (innerError) {
        if (innerError?.code !== "ESRCH") {
          throw new CliError(
            `Failed to terminate session process tree ${pid}: ${innerError?.message ?? String(innerError)}`,
            { code: "session-force-close-failed" },
          );
        }
      }
    }
  }

  return { ok: true, strategy: "process-missing", missing: true };
}

export async function closeSessionWithFallback(sessionName, dependencies = {}) {
  const requestSessionImpl = dependencies.requestSessionImpl ?? requestSession;
  const readMetadataImpl = dependencies.readMetadataImpl ?? readMetadata;
  const removeSessionFilesImpl = dependencies.removeSessionFilesImpl ?? removeSessionFiles;
  const forceKillProcessTreeImpl = dependencies.forceKillProcessTreeImpl ?? forceKillProcessTree;

  try {
    const response = await requestSessionImpl(sessionName, "session.close", {}, { timeoutMs: 3000 });
    return {
      ...response.result,
      forced: false,
    };
  } catch (error) {
    let metadata;
    try {
      metadata = await readMetadataImpl(sessionName);
    } catch (metadataError) {
      if (metadataError?.code === "ENOENT") {
        return {
          closed: true,
          sessionName,
          forced: false,
        };
      }
      throw metadataError;
    }

    forceKillProcessTreeImpl(Number(metadata.pid));
    await removeSessionFilesImpl(sessionName);

    return {
      closed: true,
      sessionName,
      forced: true,
      recoveredFrom: error?.code ?? "session-close-failed",
    };
  }
}

function collectSharedSessionOptions(options, transport) {
  const timeout = resolveTimeoutMs(options);
  const result = {
    browser: normalizeBrowserName(options.browser, transport),
    engine: normalizeEngine(options.engine),
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

  if (command === "doctor") {
    ensure(options.session, "Missing required option --session", { code: "missing-session" });
    const response = await requestSession(options.session, "session.doctor");
    writeStdout(response.result, resolveFormat(options));
    return;
  }

  if (command === "close") {
    ensure(options.session, "Missing required option --session", { code: "missing-session" });
    const result = await closeSessionWithFallback(String(options.session));
    writeStdout(result, resolveFormat(options));
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
      commitId: options.commit ? String(options.commit) : undefined,
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

async function handleInteractCommand(command, options) {
  ensure(options.session, "Missing required option --session", { code: "missing-session" });

  if (command === "click") {
    ensure(options.selector, "Missing required option --selector for `rdt interact click`.", { code: "missing-selector" });
    const response = await requestSession(options.session, "interact.click", {
      selector: String(options.selector),
      timeoutMs: options.timeoutMs ?? undefined,
    });
    writeStdout(response.result, resolveFormat(options));
    return;
  }

  if (command === "type") {
    ensure(options.selector, "Missing required option --selector for `rdt interact type`.", { code: "missing-selector" });
    ensure(options.text !== undefined, "Missing required option --text for `rdt interact type`.", { code: "missing-text" });
    const response = await requestSession(options.session, "interact.type", {
      selector: String(options.selector),
      text: String(options.text),
      timeoutMs: options.timeoutMs ?? undefined,
    });
    writeStdout(response.result, resolveFormat(options));
    return;
  }

  if (command === "press") {
    ensure(options.key, "Missing required option --key for `rdt interact press`.", { code: "missing-key" });
    const response = await requestSession(options.session, "interact.press", {
      key: String(options.key),
      selector: options.selector ? String(options.selector) : undefined,
      timeoutMs: options.timeoutMs ?? undefined,
    });
    writeStdout(response.result, resolveFormat(options));
    return;
  }

  if (command === "wait") {
    ensure(options.ms !== undefined, "Missing required option --ms for `rdt interact wait`.", { code: "missing-ms" });
    const response = await requestSession(options.session, "interact.wait", {
      ms: Number(options.ms),
    });
    writeStdout(response.result, resolveFormat(options));
    return;
  }

  throw new CliError(`Unsupported interact command: ${command}`, { code: "unsupported-command" });
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

function isExistingPath(value) {
  if (!value) {
    return false;
  }

  try {
    return fs.existsSync(path.resolve(String(value)));
  } catch {
    return false;
  }
}

async function parseProfilerExportFile(filePath) {
  const resolvedPath = path.resolve(filePath);
  const raw = await fsPromises.readFile(resolvedPath);
  const contents = resolvedPath.endsWith(".gz") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
  const events = [];
  let profileId = null;

  for (const line of contents.split("\n")) {
    if (!line.trim()) {
      continue;
    }

    const parsed = JSON.parse(line);
    profileId = profileId || parsed.profileId || null;
    if (parsed.payload) {
      events.push(parsed.payload);
    }
  }

  return {
    source: "file",
    sourceRef: resolvedPath,
    profileId,
    events,
    summary: buildProfilerArtifactSummary(profileId, events),
  };
}

function getCommitEvents(events) {
  return (events || []).filter((event) => event?.eventType === "commit");
}

function addCount(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function getHotspotScore(commit, nodeId) {
  const metrics = commit.nodeMetricsById?.[nodeId] || {};
  if (typeof metrics.totalTime === "number") {
    return metrics.totalTime;
  }
  return commit.changedDescendantCounts?.[nodeId] || 0;
}

function aggregateProfilerEvents(events) {
  const reasonCounts = {};
  const propCounts = {};
  const hookCounts = {};
  const contextCounts = {};
  const hotspotScores = {};

  for (const commit of getCommitEvents(events)) {
    for (const [reason, count] of Object.entries(commit.reasonCounts || {})) {
      addCount(reasonCounts, reason, count);
    }

    for (const nodeId of commit.changedNodeIds || []) {
      const analysis = commit.nodeAnalysisById?.[nodeId] || {};
      for (const key of analysis.changedPropKeys || []) {
        addCount(propCounts, key);
      }
      for (const index of analysis.changedHookIndexes || []) {
        addCount(hookCounts, String(index));
      }
      for (const name of analysis.changedContextNames || []) {
        addCount(contextCounts, name);
      }
    }

    for (const node of commit.treeSnapshot?.nodes || []) {
      const displayName = node.displayName || node.tagName || "Anonymous";
      addCount(hotspotScores, displayName, getHotspotScore(commit, node.id));
    }
  }

  return {
    reasonCounts,
    topChangedProps: Object.entries(propCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([key, count]) => ({ key, count })),
    topChangedHooks: Object.entries(hookCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([index, count]) => ({ index: Number(index), count })),
    topChangedContexts: Object.entries(contextCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count })),
    topHotspots: Object.entries(hotspotScores).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([displayName, score]) => ({ displayName, score })),
  };
}

function buildProfilerArtifactSummary(profileId, events) {
  const commitEvents = getCommitEvents(events);
  const nodeCounts = commitEvents.map((event) => event.nodeCount || 0);
  const totalNodeCount = nodeCounts.reduce((sum, count) => sum + count, 0);
  const measurementModes = [...new Set(commitEvents.map((event) => event.measurementMode || "structural-only"))];
  const measurementMode = measurementModes.length === 1 ? (measurementModes[0] || "structural-only") : "mixed";

  return {
    profileId,
    commitCount: commitEvents.length,
    commitIds: commitEvents.map((event) => event.commitId),
    maxNodeCount: nodeCounts.length ? Math.max(...nodeCounts) : 0,
    minNodeCount: nodeCounts.length ? Math.min(...nodeCounts) : 0,
    averageNodeCount: nodeCounts.length ? totalNodeCount / nodeCounts.length : 0,
    measurementMode,
    measuresComponentDuration: measurementMode === "actual-duration" || measurementMode === "mixed",
  };
}

function diffTopItems(leftItems, rightItems, labelKey) {
  const leftMap = new Map((leftItems || []).map((item) => [item[labelKey], item.count ?? item.score ?? 0]));
  const rightMap = new Map((rightItems || []).map((item) => [item[labelKey], item.count ?? item.score ?? 0]));
  const labels = new Set([...leftMap.keys(), ...rightMap.keys()]);
  return [...labels]
    .map((label) => ({
      [labelKey]: label,
      left: leftMap.get(label) || 0,
      right: rightMap.get(label) || 0,
      delta: (rightMap.get(label) || 0) - (leftMap.get(label) || 0),
    }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 10);
}

function compareProfiles(left, right) {
  const leftAggregates = aggregateProfilerEvents(left.events);
  const rightAggregates = aggregateProfilerEvents(right.events);
  const leftSummary = left.summary || buildProfilerArtifactSummary(left.profileId, left.events);
  const rightSummary = right.summary || buildProfilerArtifactSummary(right.profileId, right.events);

  return {
    observationLevel: "inferred",
    limitations: [
      "profile comparison is derived from previously recorded profiler artifacts",
      "reason and hotspot deltas are inferred from commit snapshot analysis",
    ],
    runtimeWarnings: leftSummary.measurementMode === "structural-only" || rightSummary.measurementMode === "structural-only"
      ? ["At least one compared profile lacked duration metrics; hotspot deltas may reflect subtree breadth instead of time"]
      : [],
    left: {
      source: left.source,
      sourceRef: left.sourceRef,
      summary: leftSummary,
    },
    right: {
      source: right.source,
      sourceRef: right.sourceRef,
      summary: rightSummary,
    },
    leftEngine: leftSummary.selectedEngine || leftSummary.engine || null,
    rightEngine: rightSummary.selectedEngine || rightSummary.engine || null,
    commitCountDelta: rightSummary.commitCount - leftSummary.commitCount,
    maxNodeCountDelta: rightSummary.maxNodeCount - leftSummary.maxNodeCount,
    averageNodeCountDelta: rightSummary.averageNodeCount - leftSummary.averageNodeCount,
    durationAvailability: {
      left: Boolean(leftSummary.measuresComponentDuration),
      right: Boolean(rightSummary.measuresComponentDuration),
    },
    topReasonDeltas: diffTopItems(
      Object.entries(leftAggregates.reasonCounts).map(([reason, count]) => ({ reason, count })),
      Object.entries(rightAggregates.reasonCounts).map(([reason, count]) => ({ reason, count })),
      "reason",
    ),
    topChangedPropDeltas: diffTopItems(leftAggregates.topChangedProps, rightAggregates.topChangedProps, "key"),
    topChangedHookDeltas: diffTopItems(
      leftAggregates.topChangedHooks.map((entry) => ({ ...entry, index: String(entry.index) })),
      rightAggregates.topChangedHooks.map((entry) => ({ ...entry, index: String(entry.index) })),
      "index",
    ),
    topChangedContextDeltas: diffTopItems(leftAggregates.topChangedContexts, rightAggregates.topChangedContexts, "name"),
    hotspotDeltas: diffTopItems(leftAggregates.topHotspots, rightAggregates.topHotspots, "displayName"),
  };
}

async function loadProfilerArtifact(sessionName, reference) {
  if (isExistingPath(reference)) {
    return parseProfilerExportFile(reference);
  }

  const response = await requestSession(sessionName, "profiler.profile", { profileId: reference });
  return {
    source: "session",
    sourceRef: reference,
    ...response.result,
  };
}

async function handleProfilerCommand(command, positionals, options) {
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

  if (command === "commits") {
    const response = await requestSession(options.session, "profiler.commits");
    writeStdout(response.result, resolveFormat(options));
    return;
  }

  if (command === "commit") {
    const commitId = resolveCommitId(positionals, options, "Missing required option --commit for `rdt profiler commit`.");
    const response = await requestSession(options.session, "profiler.commit", { commitId });
    writeStdout(response.result, resolveFormat(options));
    return;
  }

  if (command === "ranked") {
    const commitId = resolveCommitId(positionals, options, "Missing required option --commit for `rdt profiler ranked`.");
    const response = await requestSession(options.session, "profiler.ranked", {
      commitId,
      limit: options.limit ? Number(options.limit) : undefined,
    });
    writeStdout(response.result, resolveFormat(options));
    return;
  }

  if (command === "flamegraph") {
    const commitId = resolveCommitId(positionals, options, "Missing required option --commit for `rdt profiler flamegraph`.");
    const format = resolveFormat(options);
    if (format === "yaml") {
      throw new CliError("YAML is only supported for compact results. Use json or pretty for flamegraph output.", {
        code: "unsupported-format",
      });
    }
    const response = await requestSession(options.session, "profiler.flamegraph", { commitId });
    writeStdout(response.result, format);
    return;
  }

  if (command === "compare") {
    ensure(options.left, "Missing required option --left for `rdt profiler compare`.", { code: "missing-left-profile" });
    ensure(options.right, "Missing required option --right for `rdt profiler compare`.", { code: "missing-right-profile" });
    const left = await loadProfilerArtifact(options.session, String(options.left));
    const right = await loadProfilerArtifact(options.session, String(options.right));
    writeStdout(compareProfiles(left, right), resolveFormat(options));
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
  6. Use rdt doctor before profiling if helper scripts or Playwright resolution look suspicious

Usage:
  rdt session open --url <url> [--browser chromium|firefox|webkit] [--engine auto|custom|devtools] [--channel <name>] [--device <name>] [--storage-state <path>] [--user-data-dir <path>] [--timeout <ms>] [--headless=false] [--session <name>]
  rdt session connect --ws-endpoint <url> [--browser chromium|firefox|webkit] [--engine auto|custom|devtools] [--target-url <substring>] [--timeout <ms>] [--session <name>]
  rdt session attach --cdp-url <url> [--engine auto|custom|devtools] [--target-url <substring>] [--timeout <ms>] [--session <name>]
  rdt session status --session <name>
  rdt session doctor --session <name> [--format json|yaml|pretty]
  rdt session close --session <name>
  rdt tree get --session <name> [--format json|yaml|pretty]
  rdt node inspect <id> --session <name> [--snapshot <id>] [--commit <id>]
  rdt node search <query> --session <name> [--snapshot <id>]
  rdt node highlight <id> --session <name> [--snapshot <id>]
  rdt node pick --session <name> [--timeout-ms 30000]
  rdt interact click --session <name> --selector <css> [--timeout-ms <ms>]
  rdt interact type --session <name> --selector <css> --text <value> [--timeout-ms <ms>]
  rdt interact press --session <name> --key <name> [--selector <css>] [--timeout-ms <ms>]
  rdt interact wait --session <name> --ms <n>
  rdt profiler start --session <name> [--profile-id <id>]
  rdt profiler stop --session <name>
  rdt profiler summary --session <name> [--format json|yaml|pretty]
  rdt profiler commits --session <name> [--format json|yaml|pretty]
  rdt profiler commit <id> --session <name> [--format json|yaml|pretty]
  rdt profiler ranked <id> --session <name> [--limit <n>] [--format json|yaml|pretty]
  rdt profiler flamegraph <id> --session <name> [--format json|pretty]
  rdt profiler compare --session <name> --left <profileId|file> --right <profileId|file> [--format json|yaml|pretty]
  rdt profiler export --session <name> [--output file.jsonl] [--compress]
  rdt source reveal <id> --session <name> [--snapshot <id>]

Snapshot behavior:
  - tree get returns snapshotId
  - node ids are scoped to that snapshot
  - if --snapshot is omitted, commands use the latest collected snapshot
  - if an explicit snapshot has expired, commands fail with snapshot-expired

Doctor behavior:
  - reports React/runtime readiness plus Playwright resolution diagnostics
  - warns when rdt can launch Playwright but standalone helper scripts may still fail to import it
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
      case "interact":
        await handleInteractCommand(command, options);
        return;
      case "profiler":
        await handleProfilerCommand(command, rest, options);
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
