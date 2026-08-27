import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
