import { createProject, createSession, expect, showSidePanel, test } from "./harness";
import type {
  HeartbeatCalendarPreview,
  HeartbeatInspection,
  HeartbeatSchedule,
} from "../src/app/types/api";

test.use({ managedNativeWeb: false });

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`human calendar controls retain the saved zone and reconcile lost acknowledgement at ${viewport.width}px`, async ({
    harness,
    page,
    request,
    browser,
  }, info) => {
    test.setTimeout(90000);
    await page.setViewportSize(viewport);
    const project = await createProject(request, harness);
    const session = await createSession(request, harness, "direct", project);
    await page.goto(`${harness.baseUrl}/#/session/${session}/heartbeats`);
    if (viewport.width === 390) {
      await page.getByRole("button", { name: "Open panel", exact: true }).click();
    } else {
      await showSidePanel(page);
    }
    await page.getByRole("button", { name: "New heartbeat", exact: true }).click();
    await page.getByLabel("Heartbeat name", { exact: true }).fill("Weekday Local check");
    await page
      .getByLabel("Heartbeat instructions", { exact: true })
      .fill("Check the authorized Local job on the selected weekdays until ready.");
    await page.getByRole("button", { name: "Cadence: Elapsed interval", exact: true }).click();
    await page.getByRole("button", { name: "Selected weekdays", exact: true }).click();
    await page.getByLabel("IANA timezone", { exact: true }).fill("Invalid/Zone");
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create heartbeat", exact: true }),
    ).toBeDisabled();
    await page.getByLabel("IANA timezone", { exact: true }).fill("America/Los_Angeles");
    await page.getByLabel("Local time", { exact: true }).fill("09:00");
    await expect(page.getByRole("button", { name: "Create heartbeat", exact: true })).toBeEnabled();
    const before = page.getByRole("region", { name: "Upcoming calendar checks" });
    await expect(before).toContainText("09:00:00 · America/Los_Angeles");
    await expect(before).toContainText("UTC");
    await page.screenshot({
      path: info.outputPath("calendar-preview-before-save.png"),
      fullPage: true,
    });
    const requests: Array<{ request_id: string; operation: unknown }> = [];
    const controlPath = `**/sessions/${session}/heartbeats/control`;
    await page.route(controlPath, async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fetch();
      await route.abort("failed");
    });
    await page.getByRole("button", { name: "Create heartbeat", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Retry same request", exact: true }),
    ).toBeVisible();
    await page.unroute(controlPath);
    await page.route(controlPath, async (route) => {
      requests.push(route.request().postDataJSON());
      await route.continue();
    });
    await page.getByRole("button", { name: "Retry same request", exact: true }).click();
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeEnabled();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    const inventory: HeartbeatSchedule[] = await (
      await request.get(`${harness.baseUrl}/heartbeats?session_id=${session}`)
    ).json();
    expect(inventory).toHaveLength(1);
    const id = inventory[0].schedule_id;
    const inspect = async (): Promise<HeartbeatInspection> =>
      (await request.get(`${harness.baseUrl}/sessions/${session}/heartbeats/${id}`)).json();
    const original = await inspect();
    expect(original.schedule.spec).not.toHaveProperty("interval_ms");
    expect(original.schedule.spec.calendar).toEqual({
      zone: "America/Los_Angeles",
      data_version: "2026f",
      hour: 9,
      minute: 0,
      days: { kind: "weekdays", days: [1, 2, 3, 4, 5] },
    });
    expect(original.history).toEqual([]);
    await expect(page.getByRole("region", { name: "Upcoming calendar checks" })).toContainText(
      "America/Los_Angeles",
    );
    const other = await browser.newContext({ timezoneId: "Asia/Tokyo", viewport });
    try {
      const viewing = await other.newPage();
      await viewing.goto(`${harness.baseUrl}/#/session/${session}/heartbeats?heartbeat=${id}`);
      if (viewport.width === 390) {
        await viewing.getByRole("button", { name: "Open panel", exact: true }).click();
        const selected = viewing.getByRole("button", { name: /^Weekday Local check\b/ });
        await expect(selected).toHaveAttribute("aria-pressed", "true");
        await selected.click();
      } else {
        await showSidePanel(viewing);
      }
      await expect(viewing.getByRole("region", { name: "Upcoming calendar checks" })).toContainText(
        "09:00:00 · America/Los_Angeles",
      );
      expect((await inspect()).schedule).toEqual(original.schedule);
      await viewing.screenshot({
        path: info.outputPath("calendar-tokyo-viewing-zone.png"),
        fullPage: true,
      });
    } finally {
      await other.close();
    }
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("IANA timezone", { exact: true }).fill("Asia/Kolkata");
    await page.getByLabel("Local time", { exact: true }).fill("18:45");
    const friday = page.getByRole("checkbox", { name: "Friday", exact: true });
    await expect(friday).toBeChecked();
    await page.locator("label").filter({ has: friday }).click();
    await expect(friday).not.toBeChecked();
    const saturday = page.getByRole("checkbox", { name: "Saturday", exact: true });
    await expect(saturday).not.toBeChecked();
    await page.locator("label").filter({ has: saturday }).click();
    await expect(saturday).toBeChecked();
    await expect(page.getByRole("button", { name: "Save heartbeat", exact: true })).toBeEnabled();
    await expect(page.getByRole("region", { name: "Upcoming calendar checks" })).toContainText(
      "18:45:00 · Asia/Kolkata",
    );
    const editPreview: HeartbeatCalendarPreview = await (
      await request.post(`${harness.baseUrl}/sessions/${session}/heartbeats/preview`, {
        data: {
          calendar: {
            zone: "Asia/Kolkata",
            data_version: "2026f",
            hour: 18,
            minute: 45,
            days: { kind: "weekdays", days: [1, 2, 3, 4, 6] },
          },
          count: 3,
        },
      })
    ).json();
    await page.screenshot({ path: info.outputPath("calendar-edit-preview.png"), fullPage: true });
    await page.getByRole("button", { name: "Save heartbeat", exact: true }).click();
    await expect.poll(async () => (await inspect()).schedule.version).toBe(2);
    const edited = await inspect();
    expect(edited.schedule.spec.calendar).toEqual(editPreview.calendar);
    expect(edited.schedule.next_due_ms).toBe(editPreview.occurrences[0].due_ms);
    await expect(page.getByRole("region", { name: "Upcoming calendar checks" })).toContainText(
      "18:45:00 · Asia/Kolkata",
    );
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeEnabled();
    await expect.poll(async () => (await inspect()).schedule.state).toBe("paused");
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeEnabled();
    const resumed = await inspect();
    expect(resumed.schedule.spec.calendar).toEqual(editPreview.calendar);
    expect(resumed.history).toEqual([]);
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeDisabled();
    await expect.poll(async () => (await inspect()).schedule.state).toBe("deleted");
    expect((await inspect()).history).toEqual([]);
    await info.attach("calendar-controls", {
      body: JSON.stringify(
        { original, editPreview, edited, resumed, deleted: await inspect(), requests },
        null,
        2,
      ),
      contentType: "application/json",
    });
    harness.provider.assertConsumed();
  });
}
