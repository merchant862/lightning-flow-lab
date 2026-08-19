import { readFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";

export async function readHexFile(path) {
  return (await readFile(path)).toString("hex");
}

export function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(url);
    const transport = endpoint.protocol === "https:" ? https : http;
    const request = transport.request(
      endpoint,
      {
        method: options.method ?? "GET",
        headers: options.headers,
        rejectUnauthorized: options.rejectUnauthorized ?? true,
        timeout: options.timeoutMs ?? 15_000
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`HTTP ${response.statusCode}: ${body}`));
            return;
          }
          try {
            resolve(body ? JSON.parse(body) : null);
          } catch (error) {
            reject(new Error(`Invalid JSON response from ${endpoint.href}: ${error.message}`));
          }
        });
      }
    );

    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error(`Request timed out: ${endpoint.href}`)));
    if (options.body) request.write(options.body);
    request.end();
  });
}

export function formBody(values = {}) {
  return new URLSearchParams(values).toString();
}
