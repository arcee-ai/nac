import type { Page } from "@playwright/test";
import { expect } from "./harness";
import { openSettingsSection } from "./settings-focus";

/** Source of a local stdio MCP double with one inert tool; it ignores its arguments. */
export const STDIO_MCP_SERVER = `const rl=require('node:readline').createInterface({input:process.stdin});
rl.on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;
const result=m.method==='initialize'?{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:
m.method==='tools/list'?{tools:[{name:'fixture_echo',description:'Local inert fixture',inputSchema:{type:'object',properties:{}}}]}:{};
process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});\n`;

/**
 * Opens Settings › MCP servers on a blank custom-server form and returns the
 * form's owner: the page's "MCP servers" manager (list beside form) at tablet
 * and desktop widths, or the pushed "Custom server" sheet on a phone.
 */
export async function openCustomMcpServer(page: Page, mobile: boolean) {
  const section = await openSettingsSection(page, "MCP servers");
  if (mobile) {
    await section.getByRole("button", { name: "Add server", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Add server", exact: true })
      .getByRole("button", { name: "Custom", exact: true })
      .click();
    const form = page.getByRole("dialog", { name: "Custom server", exact: true });
    await expect(form).toBeVisible();
    return form;
  }
  const manager = section.getByRole("region", { name: "MCP servers", exact: true });
  const custom = manager.getByRole("button", { name: "Custom server", exact: true });
  // The manager selects the newest stored server; the draft row leads to the catalog.
  if (!(await custom.isVisible()))
    await manager.getByRole("button", { name: "Add server", exact: true }).click();
  await custom.click();
  await expect(manager.getByPlaceholder("my_server")).toBeVisible();
  return manager;
}

/** Whether the app lays out for a phone (its own breakpoint, after browser zoom). */
export function phoneLayout(page: Page) {
  return page.evaluate(
    () =>
      (globalThis as unknown as { matchMedia(query: string): { matches: boolean } }).matchMedia(
        "(max-width: 767.98px)",
      ).matches,
  );
}
