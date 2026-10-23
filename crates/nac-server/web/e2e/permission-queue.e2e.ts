import fs from "node:fs/promises";
import path from "node:path";

import { createDirectSession, expect, test, waitForRunIdle } from "./harness";
import { ScriptGate } from "./scripted-provider";

for (const mobile of [false, true]) {
  test(`consolidates scoped parent and child approvals ${mobile ? "mobile" : "desktop"}`, async ({
    harness,
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 720 });
    const file = path.join(harness.runRoot, "external-permission.txt");
    await fs.writeFile(file, "scoped permission fixture\n");
    const childGate = new ScriptGate();
    for (const owner of ["parent", "first", "second"]) {
      harness.provider.enqueue(
        `ask-${owner}`,
        { token: `ALL333_${owner}_TOKEN` },
        {
          kind: "function_call",
          name: "read",
          callId: `read-${owner}`,
          arguments: { path: file },
          stream: "request",
        },
        owner === "parent" ? undefined : childGate,
      );
      harness.provider.enqueue(
        `done-${owner}`,
        { functionOutputCallId: `read-${owner}` },
        {
          kind: "text",
          text: `${owner} finished`,
          stream: "request",
        },
      );
    }
    const parent = await createDirectSession(request, harness);
    // Foreground completion stays in the launch reply rather than waking a
    // separate parent turn via the background inbox.
    const descriptions = {
      first: "Review persistence, inherited approval mode, and narrow remembered-grant ownership",
      second:
        "Verify permission queue recovery, sibling isolation, and completed-child grant revocation",
    };
    const owners = ["first", "second"] as const;
    const starts = owners.map((owner) =>
      request.post(`${harness.baseUrl}/sessions/${parent}/children`, {
        data: {
          profile: "general",
          description: descriptions[owner],
          prompt: `ALL333_${owner}_TOKEN`,
          background: false,
        },
        timeout: 90_000,
      }),
    );
    await harness.provider.waitForRequestCount(2);
    const childrenResponse = await request.get(`${harness.baseUrl}/sessions/${parent}/children`);
    const records = (await childrenResponse.json()) as Array<{
      child_session_id: string;
      description: string;
    }>;
    const children = owners.map(
      (owner) =>
        records.find((child) => child.description === descriptions[owner])!.child_session_id,
    );
    // A child broker gives an unattached parent only a short connect grace.
    // Hold the model before it can ask until both actual UI streams are live.
    const connected = children.map((id) =>
      page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/sessions/${id}/events/stream` && response.ok(),
      ),
    );
    await page.goto(`${harness.baseUrl}/#/session/${parent}/delegated`);
    await Promise.all(connected);
    await expect(page.getByRole("button", { name: "Permissions", exact: true })).toHaveCount(1);
    for (const id of children) {
      const response = await request.get(`${harness.baseUrl}/sessions/${id}/permissions`);
      expect((await response.json()).requests).toHaveLength(0);
    }
    childGate.release();
    await expect(page.getByRole("region", { name: "Pending permission requests" })).toContainText(
      "Pending requests (2)",
    );
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Permissions (2)", exact: true })).toHaveCount(1);
    await page.getByRole("combobox", { name: "Message" }).fill("ALL333_parent_TOKEN");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await harness.provider.waitForRequestCount(3);
    const dialog = page.getByRole("dialog", { name: "Permission required", exact: true });
    await expect(dialog).toHaveCount(1);
    await expect(dialog.getByRole("region", { name: "Pending permission requests" })).toContainText(
      "Pending requests (3)",
    );
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Permissions (3)", exact: true })).toHaveCount(1);
    await expect(page.getByText("(3 pending)", { exact: true })).toBeVisible();

    // The broker intentionally rejects pending asks when its LAST interactive
    // client disconnects. Keep additional observers attached so this reload
    // exercises UI recovery without weakening that existing fail-closed rule.
    const observer = new AbortController();
    try {
      const observed = await Promise.all(
        [parent, ...children].map((id) =>
          fetch(`${harness.baseUrl}/sessions/${id}/events/stream`, { signal: observer.signal }),
        ),
      );
      for (const response of observed) expect(response.ok).toBe(true);
      const subscriptions = new Set<string>();
      page.on("request", (entry) => {
        if (entry.resourceType() === "eventsource") subscriptions.add(entry.url());
      });
      await page.reload();
      await expect(dialog).toHaveCount(1);
      await expect(
        dialog.getByRole("region", { name: "Pending permission requests" }),
      ).toContainText("Pending requests (3)");
      for (const child of children) {
        await expect
          .poll(() => [...subscriptions].some((url) => url.includes(`/sessions/${child}/`)))
          .toBe(true);
      }
      if (mobile) await expect.poll(async () => (await dialog.boundingBox())?.x).toBe(0);
      // Check actual rendered text bounds, including long child descriptions
      // and unbroken session IDs. The atom's nowrap/fixed-height styles must
      // not clip an approval choice on a narrow viewport.
      const rows = await dialog
        .getByRole("region", { name: "Pending permission requests" })
        .getByRole("button")
        .evaluateAll((buttons) =>
          buttons.map((button) => {
            const bounds = button.getBoundingClientRect();
            const range = button.ownerDocument.createRange();
            range.selectNodeContents(button);
            return {
              left: bounds.left,
              right: bounds.right,
              top: bounds.top,
              bottom: bounds.bottom,
              viewport: button.ownerDocument.defaultView!.innerWidth,
              text: Array.from(
                range.getClientRects() as ArrayLike<{
                  left: number;
                  right: number;
                  top: number;
                  bottom: number;
                }>,
                (rect) => ({
                  left: rect.left,
                  right: rect.right,
                  top: rect.top,
                  bottom: rect.bottom,
                }),
              ),
            };
          }),
        );
      for (const row of rows) {
        expect(row.left).toBeGreaterThanOrEqual(0);
        expect(row.right).toBeLessThanOrEqual(row.viewport);
        for (const text of row.text) {
          expect(text.left).toBeGreaterThanOrEqual(row.left - 1);
          expect(text.right).toBeLessThanOrEqual(row.right + 1);
          expect(text.top).toBeGreaterThanOrEqual(row.top - 1);
          expect(text.bottom).toBeLessThanOrEqual(row.bottom + 1);
        }
      }
      const first = dialog.getByRole("button", {
        name: `child agent “${descriptions.first}” (${children[0]}): read`,
      });
      const access = dialog.getByRole("region", { name: "Requested access" });
      await dialog.getByRole("button", { name: `this session (${parent}): read` }).click();
      await expect(access).toContainText(`Requested by this session (${parent})`);
      await dialog.getByRole("button", { name: "Allow once", exact: true }).click();
      await waitForRunIdle(request, harness, parent);
      await first.click();
      await expect(access).toContainText(
        `Requested by child agent “${descriptions.first}” (${children[0]})`,
      );
      await expect(access).toContainText(file);
      await dialog.getByRole("button", { name: "Always allow", exact: true }).click();
      await expect(first).toHaveCount(0);
      const state = async (id: string) => {
        const response = await request.get(`${harness.baseUrl}/sessions/${id}/permissions`);
        expect(response.ok()).toBe(true);
        return response.json();
      };
      await expect.poll(async () => (await state(children[0])).grants.length).toBe(2);
      expect((await state(parent)).grants).toHaveLength(0);
      expect((await state(children[1])).grants).toHaveLength(0);
      expect((await state(parent)).requests).toHaveLength(0);
      expect((await state(children[1])).requests).toHaveLength(1);

      await dialog
        .getByRole("button", {
          name: `child agent “${descriptions.second}” (${children[1]}): read`,
        })
        .click();
      await expect(access).toContainText(
        `Requested by child agent “${descriptions.second}” (${children[1]})`,
      );
      await dialog.getByRole("button", { name: "Reject", exact: true }).click();
      await harness.provider.waitForRequestCount(6);
      for (const response of await Promise.all(starts)) expect(response.status()).toBe(201);
      await waitForRunIdle(request, harness, parent);
      await expect
        .poll(async () => {
          const response = await request.get(`${harness.baseUrl}/sessions/${parent}/children`);
          return (await response.json()).every(
            (child: { status: string }) => child.status !== "running",
          );
        })
        .toBe(true);
      await page.reload();
      await page.getByRole("button", { name: "Permissions (2)", exact: true }).click();
      const manager = page.getByRole("dialog", { name: "Permissions", exact: true });
      const scope = manager.getByRole("region", {
        name: `Remembered for child agent “${descriptions.first}”`,
      });
      await expect(scope).toContainText(children[0]);
      await expect(scope).toContainText(file);
      await scope.getByRole("button", { name: "Forget read permission" }).click();
      await expect
        .poll(async () =>
          (await state(children[0])).grants.map((grant: { action: string }) => grant.action),
        )
        .toEqual(["external_directory"]);
      await scope.getByRole("button", { name: "Forget external_directory permission" }).click();
      await expect(scope).toContainText("No remembered permissions.");
      expect((await state(children[0])).grants).toHaveLength(0);
      expect((await state(parent)).grants).toHaveLength(0);
      expect((await state(children[1])).grants).toHaveLength(0);
      await expect(manager.getByRole("radiogroup", { name: "Approval mode" })).toHaveCount(1);
      for (const mode of ["Manual", "Approve all", "Approve for me"]) {
        await expect(manager.getByRole("radio", { name: mode, exact: true })).toHaveCount(1);
      }
      harness.provider.assertConsumed();
    } finally {
      observer.abort();
    }
  });
}

// The consolidated UI must not resurrect a request dismissed by the safety
// broker, nor make a last-client disconnect execute a pending operation.
test("last-client disconnect dismisses queued access without executing it", async ({
  harness,
  page,
  request,
}) => {
  const destination = path.join(harness.runRoot, "must-not-be-written.txt");
  harness.provider.enqueue(
    "disconnected-write",
    { token: "ALL333_DISCONNECT_TOKEN" },
    {
      kind: "function_call",
      name: "write",
      callId: "disconnected-write",
      arguments: { path: destination, content: "must not execute", expected_revision: null },
      stream: "request",
    },
  );
  harness.provider.enqueue(
    "disconnected-complete",
    { functionOutputCallId: "disconnected-write" },
    {
      kind: "text",
      text: "disconnect failure handled",
      stream: "request",
    },
  );
  const session = await createDirectSession(request, harness);
  await page.goto(`${harness.baseUrl}/#/session/${session}/delegated`);
  await page.getByRole("combobox", { name: "Message" }).fill("ALL333_DISCONNECT_TOKEN");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Permission required", exact: true }),
  ).toBeVisible();
  await page.goto("about:blank");
  await harness.provider.waitForRequestCount(2);
  await waitForRunIdle(request, harness, session);
  const response = await request.get(`${harness.baseUrl}/sessions/${session}/permissions`);
  const state = await response.json();
  expect(state.requests).toHaveLength(0);
  expect(state.grants).toHaveLength(0);
  await expect(fs.stat(destination)).rejects.toMatchObject({ code: "ENOENT" });
  await page.goto(`${harness.baseUrl}/#/session/${session}/delegated`);
  await expect(page.getByRole("dialog", { name: "Permission required", exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator('[data-tool-call-id="disconnected-write"]')).toContainText("Failed");
  await expect(
    page.getByText(/interactive session client disconnected while approval was pending/).first(),
  ).toBeVisible();
  harness.provider.assertConsumed();
});
