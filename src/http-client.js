import http from "node:http";

import { CliError } from "./errors.js";
import { readMetadata } from "./session-store.js";

export const DEFAULT_SESSION_REQUEST_TIMEOUT_MS = 30000;

export async function requestSession(sessionName, action, payload = {}, options = {}) {
  const metadata = options.metadata ?? await readMetadata(sessionName);
  const timeoutMs = options.timeoutMs == null
    ? DEFAULT_SESSION_REQUEST_TIMEOUT_MS
    : Number(options.timeoutMs);

  return new Promise((resolve, reject) => {
    let settled = false;
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: metadata.port,
        path: "/command",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-rdt-session-secret": metadata.secret,
        },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if (settled) {
            return;
          }
          settled = true;

          try {
            const parsed = body ? JSON.parse(body) : {};
            if (response.statusCode && response.statusCode >= 400) {
              reject(
                new CliError(parsed.error?.message ?? "Session request failed", {
                  code: parsed.error?.code ?? "session-request-failed",
                }),
              );
              return;
            }

            resolve(parsed);
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    request.setTimeout(timeoutMs, () => {
      if (settled) {
        return;
      }
      settled = true;
      request.destroy();
      reject(
        new CliError(`Session "${sessionName}" did not respond to ${action} within ${timeoutMs}ms.`, {
          code: "session-request-timeout",
        }),
      );
    });

    request.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(
        new CliError(`Failed to contact session "${sessionName}": ${error.message}`, {
          code: "session-unreachable",
        }),
      );
    });

    request.write(JSON.stringify({ action, payload }));
    request.end();
  });
}
