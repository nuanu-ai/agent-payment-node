import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

// X402-ANY-SELLER-DOC-NOT-SHIPPED-053-001: README linked docs/x402-any-seller.md, but package.json `files` left it out of
// the tgz. Every docs/ page the README links must exist and ship.
test("every docs page the README links exists and is listed in package.json files", () => {
  const readme = readFileSync(resolve("README.md"), "utf8");
  const files = new Set((JSON.parse(readFileSync(resolve("package.json"), "utf8")) as { files: string[] }).files);
  const links = [...new Set([...readme.matchAll(/\((docs\/[A-Za-z0-9_./-]+\.md)/gu)].map((match) => match[1]!))];
  assert.ok(links.length > 0);
  assert.deepEqual(links.filter((link) => !existsSync(resolve(link))), []);
  assert.deepEqual(links.filter((link) => !files.has(link)), []);
});
