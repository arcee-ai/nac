import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { EmbeddedHarness } from "./harness";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Local mediated proxy; intentionally has no product identity/admission implementation. */
export async function startHostedFixture(harness: EmbeddedHarness, sessionId: string) {
  const output = path.join(harness.runRoot, "hosted-dist");
  await new Promise<void>((resolve, reject) => {
    const build = spawn(
      path.join(web, "node_modules/.bin/vite"),
      ["build", "--config", "e2e/hosted-vite.config.ts"],
      {
        cwd: web,
        env: { ...process.env, NAC_HOSTED_FIXTURE_OUTPUT: output },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const logs: string[] = [];
    build.stdout.on("data", (data) => logs.push(String(data)));
    build.stderr.on("data", (data) => logs.push(String(data)));
    build.once("error", reject);
    build.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(logs.join("")))));
  });
  const calls: { method: string; path: string }[] = [];
  const upstream = new Set<http.ClientRequest>();
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://fixture.invalid");
    if (url.pathname === "/fixture-config") {
      response.setHeader("Content-Type", "application/json");
      response.setHeader(
        "Set-Cookie",
        "native_fixture=fixture-only; Path=/fixture-runtime; HttpOnly; SameSite=Strict",
      );
      response.end(JSON.stringify({ sessionId }));
      return;
    }
    if (url.pathname.startsWith("/fixture-runtime/")) {
      const isStream = url.pathname.endsWith("/events/stream");
      const authorized = isStream
        ? request.headers.cookie?.includes("native_fixture=fixture-only")
        : request.headers["x-fixture-auth"] === "fixture-only";
      if (!authorized) {
        response.writeHead(401);
        response.end();
        return;
      }
      const resource = url.pathname.slice("/fixture-runtime".length) + url.search;
      calls.push({ method: request.method ?? "GET", path: resource });
      const proxy = http.request(
        new URL(resource, harness.baseUrl),
        {
          method: request.method,
          headers: { ...request.headers, host: new URL(harness.baseUrl).host },
        },
        (result) => {
          response.writeHead(result.statusCode ?? 500, result.headers);
          result.pipe(response);
        },
      );
      upstream.add(proxy);
      proxy.once("close", () => upstream.delete(proxy));
      response.once("close", () => proxy.destroy());
      proxy.once("error", () => {
        if (!response.headersSent) response.writeHead(502);
        response.end();
      });
      request.pipe(proxy);
      return;
    }
    const relative =
      url.pathname === "/" ? "e2e/fixtures/hosted.html" : decodeURIComponent(url.pathname.slice(1));
    const file = path.resolve(output, relative);
    if (!file.startsWith(output + path.sep)) {
      response.writeHead(404);
      response.end();
      return;
    }
    void fs
      .readFile(file)
      .then((content) => {
        response.setHeader(
          "Content-Type",
          file.endsWith(".html")
            ? "text/html"
            : file.endsWith(".js")
              ? "application/javascript"
              : file.endsWith(".css")
                ? "text/css"
                : "application/octet-stream",
        );
        response.end(content);
      })
      .catch(() => {
        response.writeHead(404);
        response.end();
      });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture listener unavailable");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    calls,
    stop: async () => {
      for (const request of upstream) request.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
