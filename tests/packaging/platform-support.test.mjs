import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const sourceRoot = resolve(import.meta.dirname, "../..");
const packageJson = JSON.parse(readFileSync(resolve(sourceRoot, "package.json"), "utf8"));
const supportMatrix = readFileSync(resolve(sourceRoot, "docs/platform-support.md"), "utf8");
const workflowText = ["supply-chain.yml", "release.yml"]
  .map((name) => readFileSync(resolve(sourceRoot, ".github/workflows", name), "utf8"))
  .join("\n");

test("platform support matrix preserves the current macOS-only package contract", () => {
  assert.deepEqual(packageJson.os, ["darwin"]);
  assert.deepEqual(packageJson.cpu, ["arm64"]);
  assert.match(packageJson.scripts["build:native"], /--target aarch64-apple-darwin/u);
  assert.ok(packageJson.files.includes("docs/platform-support.md"));
  assert.equal((workflowText.match(/runs-on: macos-15/gu) ?? []).length, 2);
  assert.equal(workflowText.split('test "$(uname -s)" = "Darwin"').length - 1, 2);
  assert.equal(workflowText.split('test "$(uname -m)" = "arm64"').length - 1, 2);
  assert.match(supportMatrix, /macOS Apple Silicon \(`darwin` \/ `arm64`\).*Supported/su);
  assert.match(supportMatrix, /Homebrew Formula \(`nuanu-ai\/tap\/apn`\)/u);
  assert.match(supportMatrix, /macOS login Keychain.*`\/usr\/bin\/security`/su);
  assert.match(supportMatrix, /Linux.*Unsupported/su);
  assert.match(supportMatrix, /Windows.*Unsupported/su);
  for (const requirement of [
    "Credential backend",
    "Native host and IPC",
    "Locking",
    "Signing and toolchain",
    "CI and release",
  ]) {
    assert.match(supportMatrix, new RegExp(`\\*\\*${requirement}:\\*\\*`, "u"));
  }
});
