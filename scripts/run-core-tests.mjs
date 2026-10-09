import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";

const concurrency = process.env.APN_CORE_TEST_CONCURRENCY ?? "1";
if (!["1", "4"].includes(concurrency)) throw new Error("APN_CORE_TEST_CONCURRENCY must be 1 or 4");
const files = process.argv.slice(2);
if (files.length === 0 || files.some(file => file.startsWith("-") || !file.endsWith(".test.js") || !statSync(file).isFile())) {
  throw new Error("core runner requires explicit test files, without runner options or filters");
}
console.log(JSON.stringify({ coreTestConcurrency: Number(concurrency), testFileCount: files.length, files }));
// Node's parent-test marker makes a nested --test runner skip all files.
const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
const result = spawnSync(process.execPath, ["--experimental-test-module-mocks", "--test", `--test-concurrency=${concurrency}`, ...files], { stdio: "inherit", env });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
