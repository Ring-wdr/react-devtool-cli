import http from "node:http";

import { CliError } from "./errors.js";
import { readMetadata } from "./session-store.js";

export async function requestSession(sessionName, action, payload = {}) {
  const metadata = await readMetadata(sessionName);

  return new Promise((resolve, reject) => {
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

    request.on("error", (error) => {
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
