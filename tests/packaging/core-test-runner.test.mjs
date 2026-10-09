import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const runner = new URL("../../scripts/run-core-tests.mjs", import.meta.url);
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "apn-core-runner-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const marker = join(root, "child-ran"), first = join(root, "first.test.js"), second = join(root, "second.test.js");
  await writeFile(join(root, "package.json"), '{"type":"module"}');
  await writeFile(join(root, "dependency.js"), "export const value = 1;\n");
  await writeFile(first, `import test from 'node:test'; import assert from 'node:assert/strict'; import {writeFileSync} from 'node:fs';
test('official module mocks run in the direct child', async t => {
  assert.ok(process.execArgv.includes('--experimental-test-module-mocks'));
  t.mock.module(new URL('./dependency.js', import.meta.url).href, {namedExports:{value:2}});
  assert.equal((await import('./dependency.js')).value, 2);
  assert.equal(process.env.APN_RUNNER_BOUNDARY_MARKER, 'retained');
  writeFileSync(${JSON.stringify(marker)}, 'ran');
});\n`);
  await writeFile(second, "import test from 'node:test'; test('second selected file also runs', () => {});\n");
  return { root, marker, first, second };
}
function run(files, value, context = process.env.NODE_TEST_CONTEXT) {
  const env = { ...process.env, APN_RUNNER_BOUNDARY_MARKER: "retained" }; delete env.NODE_OPTIONS; delete env.APN_CORE_TEST_CONCURRENCY;
  if (context === undefined) delete env.NODE_TEST_CONTEXT; else env.NODE_TEST_CONTEXT = context;
  if (value !== undefined) env.APN_CORE_TEST_CONCURRENCY = value;
  return spawnSync(process.execPath, [fileURLToPath(runner), ...files], { env, encoding: "utf8" });
}
for (const value of [undefined, "1", "4"]) test(`real core child preserves files and mocks with concurrency ${value ?? "default"}`, async t => {
  const f = await fixture(t), files = [f.second, f.first], result = run(files, value);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(JSON.parse(result.stdout.split("\n")[0]), {coreTestConcurrency: Number(value ?? "1"), testFileCount: 2, files});
  assert.match(result.stdout, /second selected file also runs/); assert.match(result.stdout, /official module mocks run/);
  assert.equal(await readFile(f.marker, "utf8"), "ran");
});
test("invalid concurrency refuses before a child runs", async t => {
  const f = await fixture(t);
  for (const value of ["", "0", "2", "04", "4 ", "--test-only"]) {
    const result = run([f.first], value); assert.equal(result.status, 1); assert.match(result.stderr, /must be 1 or 4/);
    await assert.rejects(readFile(f.marker), {code:"ENOENT"});
  }
});
test("empty selection and injected filters refuse before a child runs", async t => {
  const f = await fixture(t);
  for (const files of [[], ["--test-name-pattern=skip", f.first], ["--test-only", f.first], [f.root]]) {
    const result = run(files, "4"); assert.equal(result.status, 1); assert.match(result.stderr, /requires explicit test files/);
    await assert.rejects(readFile(f.marker), {code:"ENOENT"});
  }
});
test("a genuine failed child propagates its exit status", async t => {
  const f = await fixture(t);
  await writeFile(f.second, "import test from 'node:test'; test('real failure', () => { throw Error('boundary failure'); });\n");
  const result = run([f.second], "4"); assert.equal(result.status, 1); assert.match(result.stdout, /boundary failure/);
});
test("inherited parent-test context cannot skip either a passing or failed child", async t => {
  const f = await fixture(t);
  const passing = run([f.first, f.second], "4", "child-v8");
  assert.equal(passing.status, 0, `${passing.stdout}\n${passing.stderr}`);
  assert.equal(await readFile(f.marker, "utf8"), "ran");
  assert.match(passing.stdout, /second selected file also runs/);
  await writeFile(f.second, "import test from 'node:test'; test('context failure', () => { throw Error('context must not bypass'); });\n");
  const failing = run([f.second], "4", "child-v8");
  assert.equal(failing.status, 1); assert.match(failing.stdout, /context must not bypass/);
});
