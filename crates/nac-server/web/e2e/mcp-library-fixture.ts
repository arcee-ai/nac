import type { Page } from "@playwright/test";

/** Source of a local stdio MCP double with one inert tool; it ignores its arguments. */
export const STDIO_MCP_SERVER = `const rl=require('node:readline').createInterface({input:process.stdin});
rl.on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;
const result=m.method==='initialize'?{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:
m.method==='tools/list'?{tools:[{name:'fixture_echo',description:'Local inert fixture',inputSchema:{type:'object',properties:{}}}]}:{};
process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});\n`;

/** Opens the MCP servers modal on a blank custom-server form and returns its dialog. */
export async function openCustomMcpServer(page: Page, mobile: boolean) {
  await page.getByRole("button", { name: /^MCP servers/ }).click();
  await page
    .getByRole("button", { name: mobile ? "Add server" : "Custom server", exact: true })
    .click();
  if (mobile) await page.getByRole("button", { name: "Custom", exact: true }).click();
  return page.getByRole("dialog").last();
}
