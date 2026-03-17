import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const distDir = path.join(rootDir, "dist");
const distBinDir = path.join(distDir, "bin");

await fs.rm(distDir, { recursive: true, force: true });
await fs.mkdir(distBinDir, { recursive: true });

const sharedOptions = {
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: false,
  minify: true,
  legalComments: "none",
  external: ["playwright", "playwright-core"],
};

await build({
  ...sharedOptions,
  entryPoints: [path.join(rootDir, "src", "cli.js")],
  outfile: path.join(distDir, "cli.js"),
});

await build({
  ...sharedOptions,
  entryPoints: [path.join(rootDir, "src", "server.js")],
  outfile: path.join(distDir, "server.js"),
});

await fs.writeFile(
  path.join(distBinDir, "rdt.js"),
  `#!/usr/bin/env node

import { runCli } from "../cli.js";

runCli(process.argv.slice(2)).catch((error) => {
  const message = error?.stack ?? error?.message ?? String(error);
  process.stderr.write(\`\${message}\\n\`);
  process.exitCode = error?.exitCode ?? 1;
});
`,
  "utf8",
);

await fs.chmod(path.join(distBinDir, "rdt.js"), 0o755);
