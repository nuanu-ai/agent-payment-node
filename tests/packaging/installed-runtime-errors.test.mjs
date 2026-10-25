import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const CORE = "tests/core";
const SOURCE_APN_ERROR = /^import \{[^}]*\bApnError\b[^}]*\} from "\.\.\/\.\.\/src\/errors\.js";$/mu;

/** Local fixtures a test file imports, transitively. */
function fixtures(file, seen) {
  for (const [, name] of readFileSync(file, "utf8").matchAll(/from "\.\/([^"]+)\.js"/gu)) {
    const path = join(CORE, `${name}.ts`);
    if (existsSync(path) && !seen.has(path)) { seen.add(path); fixtures(path, seen); }
  }
  return seen;
}

// With APN_TEST_PACKAGE_ROOT the CLI and MCP come from the installed package; an ApnError built from the source tree is
// not that runtime's ApnError, so the error boundary reports APN_INTERNAL. Fixtures take ApnError through testRuntime.
test("tests that load the installed runtime build every thrown ApnError from that runtime", () => {
  const offenders = new Set();
  for (const entry of readdirSync(CORE).filter((name) => name.endsWith(".test.ts"))) {
    const file = join(CORE, entry);
    if (!readFileSync(file, "utf8").includes("testRuntime(")) continue;
    for (const path of fixtures(file, new Set([file]))) {
      const source = readFileSync(path, "utf8");
      if (SOURCE_APN_ERROR.test(source) && /\bnew ApnError\(/u.test(source)) offenders.add(path);
    }
  }
  assert.deepEqual([...offenders].sort(), []);
});
