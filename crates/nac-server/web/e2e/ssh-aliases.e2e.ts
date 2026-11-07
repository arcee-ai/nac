import fs from "node:fs/promises";
import path from "node:path";

import { expect, test } from "./harness";

// The harness starts nac-web with HOME pointed at `<runRoot>/home`, so this
// fixture stands in for the NAC server user's own OpenSSH configuration.
async function writeServerSshConfig(runRoot: string): Promise<string> {
  const ssh = path.join(runRoot, "home", ".ssh");
  const sentinel = path.join(runRoot, "match-exec-sentinel");
  await fs.mkdir(path.join(ssh, "config.d"), { recursive: true });
  await fs.writeFile(path.join(ssh, "config.d", "work"), "Host work-jump build-box\n");
  await fs.writeFile(path.join(ssh, "id_fixture"), "FIXTURE-PRIVATE-KEY-MATERIAL\n");
  await fs.writeFile(
    path.join(ssh, "config"),
    [
      "Include config.d/*",
      "Host build-box staging",
      "  HostName 192.0.2.10",
      "  User fixture-user",
      "  IdentityFile ~/.ssh/id_fixture",
      "  Port 2222",
      "Host *.corp !bastion",
      `Match exec "touch ${sentinel}"`,
      "  Include never.conf",
      "",
    ].join("\n"),
  );
  return sentinel;
}

test("lists server OpenSSH aliases beside saved profiles and fills Host without connecting", async ({
  harness,
  page,
  request,
}, testInfo) => {
  const sentinel = await writeServerSshConfig(harness.runRoot);
  const saved = await request.post(`${harness.baseUrl}/ssh-configs`, {
    data: {
      name: "Saved lab",
      ssh_host: "lab.example",
      ssh_port: 2200,
      ssh_identity_file: null,
    },
  });
  expect(saved.status()).toBe(201);

  const discovered = await request.get(`${harness.baseUrl}/ssh/aliases`);
  expect(discovered.ok()).toBe(true);
  const body = await discovered.text();
  expect(JSON.parse(body)).toEqual({
    aliases: ["work-jump", "build-box", "staging"],
    undiscoverable_patterns: 2,
    warnings: ["conditional_include_skipped"],
  });
  for (const secret of ["192.0.2.10", "fixture-user", "id_fixture", "FIXTURE-PRIVATE", "2222"]) {
    expect(body).not.toContain(secret);
  }

  const connectionAttempts: string[] = [];
  page.on("request", (sent) => {
    if (new URL(sent.url()).pathname === "/ssh/browse") connectionAttempts.push(sent.method());
  });

  // Tall enough that the open menu is not clipped by the modal's scroll area.
  await page.setViewportSize({ width: 1280, height: 1200 });
  await page.goto(harness.baseUrl);
  await page.getByRole("button", { name: "New Project", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("New Project");
  await dialog.getByRole("button", { name: "SSH", exact: true }).click();
  const selector = dialog.getByRole("button", { name: "Create New" });
  await selector.scrollIntoViewIfNeeded();
  await selector.click();
  // The modal body scrolls; bring the open menu into view for the evidence.
  await page.getByRole("button", { name: "Saved lab" }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: testInfo.outputPath("ssh-menu.png") });

  const savedGroup = page.getByRole("group", { name: "Saved NAC profiles" });
  await expect(savedGroup.getByRole("button", { name: "Saved lab" })).toBeVisible();
  const aliasGroup = page.getByRole("group", { name: "OpenSSH aliases" });
  await expect(aliasGroup).toContainText("from the NAC server's ~/.ssh/config");
  await expect(aliasGroup.getByRole("button")).toHaveText(["work-jump", "build-box", "staging"]);
  await expect(aliasGroup).toContainText("2 wildcard or negated patterns");
  await aliasGroup.getByText(/wildcard or negated/).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("ssh-menu-aliases.png") });
  // Saved profiles are never offered as aliases, nor aliases as profiles.
  await expect(savedGroup.getByRole("button", { name: "staging" })).toHaveCount(0);
  await expect(aliasGroup.getByRole("button", { name: "Saved lab" })).toHaveCount(0);

  await aliasGroup.getByRole("button", { name: "staging" }).click();
  await expect(dialog.getByPlaceholder("example@192.0.2.10 or build-box")).toHaveValue("staging");
  await expect(dialog.getByPlaceholder("22", { exact: true })).toHaveValue("");
  await expect(dialog.getByRole("button", { name: ".ssh/config" })).toBeVisible();
  await expect(dialog.getByText("Connected", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Connect", exact: true })).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("ssh-alias-selected.png"),
  });

  // Selecting is not connecting: nothing reached the SSH host and no
  // configured command ran on the server.
  await page.waitForTimeout(300);
  expect(connectionAttempts).toEqual([]);
  await expect(fs.access(sentinel)).rejects.toThrow();
});
