import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { SUPPORTED_NODE_RANGE, unsupportedNodeMessage } from "../../src/node-version-guard.js";

// Regression: on Node 20 `apn` died with a raw SyntaxError (node:module has no `registerHooks` export there).
test("the Node.js guard admits exactly the package.json engines range and names it with the running version otherwise", async () => {
  const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8")) as { readonly engines: { readonly node: string } };
  assert.equal(SUPPORTED_NODE_RANGE, packageJson.engines.node);
  for (const version of ["24.0.0", "24.15.0", "26.99.1"]) assert.equal(unsupportedNodeMessage(version), null, version);
  for (const version of ["20.19.5", "22.15.0", "23.11.1", "27.0.0", "not-a-version"]) {
    const message = unsupportedNodeMessage(version) ?? "";
    assert.ok(message.startsWith("APN_NODE_UNSUPPORTED: APN requires Node.js >=24 <27; "), version);
    assert.ok(message.includes(`this is Node.js ${version}.`), version);
    assert.doesNotMatch(message, /\n/u, "one line");
  }
});

test("on an unsupported Node.js the CLI and the MCP server print one stderr line, nothing on stdout, and exit 1", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "apn-node-guard-"));
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  // process.versions.node is read-only but configurable: this preload makes the shipped executable see Node.js 20.
  const preload = join(directory, "node-20.mjs");
  await writeFile(preload, `Object.defineProperty(process.versions, "node", { value: "20.19.5" });\n`, { mode: 0o600 });
  for (const argv of [["--version"], ["mcp", "serve"]]) {
    const result = spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, resolve("bin/apn.js"), ...argv],
      { encoding: "utf8", input: "", timeout: 30_000 });
    assert.equal(result.status, 1, `${argv.join(" ")}: ${result.stderr}`);
    assert.equal(result.stdout, "", "no envelope and no MCP frame");
    assert.equal(result.stderr, `${unsupportedNodeMessage("20.19.5")}\n`);
  }
});
