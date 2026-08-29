import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("x402 core is exactly pinned and installed without fetch orchestration", async () => {
  const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  const lock = JSON.parse(await readFile(new URL("../../package-lock.json", import.meta.url), "utf8"));
  assert.equal(manifest.dependencies?.["@x402/core"], "2.23.0");
  assert.equal(manifest.dependencies?.["@x402/fetch"], undefined);
  assert.equal(lock.packages?.[""]?.dependencies?.["@x402/core"], "2.23.0");
  assert.equal(lock.packages?.["node_modules/@x402/core"]?.version, "2.23.0");
  const official = await import("@x402/core");
  assert.ok(Object.keys(official).length > 0, "the exact installed package must expose its official API");
});

test("only the local codec imports x402 core", async () => {
  const { readdir } = await import("node:fs/promises");
  const sourceRoot = new URL("../../src/", import.meta.url);
  const files = (await readdir(sourceRoot)).filter((name) => name.endsWith(".ts"));
  const importers = [];
  for (const file of files) {
    const text = await readFile(new URL(file, sourceRoot), "utf8");
    if (text.includes("@x402/core")) importers.push(file);
  }
  assert.deepEqual(importers, ["x402-codec.ts"]);
});

test("official MCP packages are exactly pinned, locked and present in the package runtime", async () => {
  const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  const lockBytes = await readFile(new URL("../../package-lock.json", import.meta.url));
  const shrinkwrapBytes = await readFile(new URL("../../npm-shrinkwrap.json", import.meta.url));
  const lock = JSON.parse(lockBytes.toString("utf8"));
  assert.equal(manifest.dependencies?.["@modelcontextprotocol/server"], "2.0.0");
  assert.equal(manifest.devDependencies?.["@modelcontextprotocol/client"], "2.0.0");
  assert.equal(manifest.dependencies?.zod, "4.5.1");
  assert.deepEqual(lockBytes, shrinkwrapBytes);
  assert.equal(lock.packages?.["node_modules/@modelcontextprotocol/server"]?.version, "2.0.0");
  assert.equal(lock.packages?.["node_modules/@modelcontextprotocol/client"]?.version, "2.0.0");
  assert.equal(lock.packages?.["node_modules/zod"]?.version, "4.5.1");
  assert.ok(Object.keys(await import("@modelcontextprotocol/server")).length > 0);
  assert.ok(Object.keys(await import("@modelcontextprotocol/client")).length > 0);

  const packed = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: resolve(import.meta.dirname, "../.."),
    encoding: "utf8",
  });
  assert.equal(packed.status, 0, packed.stderr);
  const report = JSON.parse(packed.stdout);
  const files = report[0]?.files?.map((entry) => entry.path) ?? [];
  for (const runtimeFile of ["dist/mcp-server.js", "dist/mcp-projection.js", "dist/runtime-factory.js"]) {
    assert.equal(files.includes(runtimeFile), true, `${runtimeFile} must be in the packed runtime`);
  }
});
