import fs from "node:fs/promises";
import path from "node:path";

const BASE_DIR = process.env.RDT_HOME
  ? path.join(path.resolve(process.env.RDT_HOME), "sessions")
  : path.join(process.cwd(), ".react-devtool-cli", "sessions");

function sanitizeSessionName(name) {
  return String(name).trim().replace(/[^a-zA-Z0-9_-]+/g, "-");
}

export function createSessionName() {
  return `session-${Date.now().toString(36)}`;
}

export async function ensureBaseDir() {
  await fs.mkdir(BASE_DIR, { recursive: true });
  return BASE_DIR;
}

export function getBaseDir() {
  return BASE_DIR;
}

export async function getSessionPaths(name) {
  const safeName = sanitizeSessionName(name);
  const baseDir = await ensureBaseDir();
  const sessionDir = path.join(baseDir, safeName);

  return {
    sessionName: safeName,
    sessionDir,
    metadataPath: path.join(sessionDir, "metadata.json"),
    runtimePath: path.join(sessionDir, "runtime.json"),
    logPath: path.join(sessionDir, "server.log"),
  };
}

export async function ensureSessionDir(name) {
  const paths = await getSessionPaths(name);
  await fs.mkdir(paths.sessionDir, { recursive: true });
  return paths;
}

export async function writeMetadata(name, metadata) {
  const paths = await ensureSessionDir(name);
  await fs.writeFile(paths.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  return paths;
}

export async function writeRuntime(name, runtime) {
  const paths = await ensureSessionDir(name);
  await fs.writeFile(paths.runtimePath, `${JSON.stringify(runtime, null, 2)}\n`, "utf8");
  return paths;
}

export async function readJsonFile(filePath) {
  const contents = await fs.readFile(filePath, "utf8");
  return JSON.parse(contents);
}

export async function readMetadata(name) {
  const paths = await getSessionPaths(name);
  return readJsonFile(paths.metadataPath);
}

export async function readRuntime(name) {
  const paths = await getSessionPaths(name);
  return readJsonFile(paths.runtimePath);
}

export async function removeSessionFiles(name) {
  const paths = await getSessionPaths(name);
  await fs.rm(paths.sessionDir, { recursive: true, force: true });
}
