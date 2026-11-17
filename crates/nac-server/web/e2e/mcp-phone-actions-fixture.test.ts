// @vitest-environment node
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { TestInfo } from "@playwright/test";
import { afterEach, expect, test, vi } from "vitest";

type Guard = { environment: Record<string, string>; denied: string[] };
type NetworkFixture = (
  options: { baseURL: undefined },
  use: (guard: Guard) => Promise<void>,
  info: TestInfo,
) => Promise<void>;
const owner = vi.hoisted(() => ({ network: undefined as NetworkFixture | undefined }));
vi.mock("./harness", async () => ({
  expect: (await import("vitest")).expect,
  test: {
    extend(fixtures: { f1Network: NetworkFixture }) {
      owner.network = fixtures.f1Network;
      return {};
    },
  },
}));
vi.mock("./settings-focus", () => ({ openSettingsSection: vi.fn() }));
// Register and exercise the actual private fixture, without launching a browser.
import "./mcp-phone-actions-fixture";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function denyConnection(error?: NodeJS.ErrnoException) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nac-mcp-deny-"));
  roots.push(directory);
  const info = {
    outputPath: (name: string) => path.join(directory, name),
    attach: vi.fn(async () => {}),
  } as unknown as TestInfo;
  const createServer = http.createServer;
  let server!: http.Server;
  vi.spyOn(http, "createServer").mockImplementation((...args) => {
    server = Reflect.apply(createServer, http, args);
    return server;
  });
  let propagated: unknown;
  let response = "";
  let socketClosed = false;
  await owner.network!(
    { baseURL: undefined },
    async (guard) => {
      const proxy = new URL(guard.environment.HTTPS_PROXY);
      const client = net.createConnection({ host: proxy.hostname, port: Number(proxy.port) });
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const serverClosed = new Promise<void>((resolve) => {
        // Appended after the fixture's real deny callback: reset only an admitted peer.
        server.on("connect", (_request, socket) => {
          socket.once("close", () => {
            socketClosed = true;
            resolve();
          });
          if (error) {
            try {
              socket.emit("error", error);
            } catch (caught) {
              propagated = caught;
            }
          } else client.resetAndDestroy();
        });
      });
      const clientClosed = new Promise<void>((resolve, reject) => {
        client.once("error", reject);
        client.once("close", () => resolve());
        client.on("data", (data) => (response += data.toString()));
        client.once("connect", () =>
          client.write("CONNECT fixture.invalid:443 HTTP/1.1\r\nHost: fixture.invalid:443\r\n\r\n"),
        );
      });
      try {
        await Promise.race([
          Promise.all([serverClosed, clientClosed]),
          new Promise<never>((_resolve, reject) => {
            deadline = setTimeout(
              () => reject(new Error("Owned deny sockets did not close")),
              2000,
            );
          }),
        ]);
        expect(guard.denied).toEqual(["CONNECT fixture.invalid:443"]);
      } finally {
        clearTimeout(deadline);
        client.destroy();
      }
    },
    info,
  );
  expect(socketClosed).toBe(true);
  expect(server.listening).toBe(false);
  expect(server.address()).toBeNull();
  const evidence = JSON.parse(
    await fs.readFile(info.outputPath("loopback-egress-guard.json"), "utf8"),
  );
  expect(evidence.forwardsTraffic).toBe(false);
  return { propagated, response, evidence };
}

test("an actual denied CONNECT peer reset stays local and closes both owned sockets", async () => {
  const result = await denyConnection();
  expect(result.propagated).toBeUndefined();
  expect(result.evidence.peerResets).toBe(1);
});

test.each(["EPIPE", "EACCES"])(
  "unexpected CONNECT error %s still propagates exactly",
  async (code) => {
    const error = Object.assign(new Error("unexpected owned socket failure"), { code });
    const result = await denyConnection(error);
    expect(result.propagated).toBe(error);
    expect(result.evidence.peerResets).toBe(0);
    expect(result.response).toBe("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
  },
);
