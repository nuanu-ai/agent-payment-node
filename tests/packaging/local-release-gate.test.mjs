import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { runLoggedGate } from "../../scripts/local-release-gate.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "apn-real-gate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, log: join(root, "gate.log") };
}
test("real gate bytes are visible before the actual child exits", async t => {
  const { root, log } = await fixture(t), helper = new URL("../../scripts/local-release-gate.mjs", import.meta.url).href;
  const body = 'console.log("live-stdout"); console.error("live-stderr"); setTimeout(() => console.log("finished"), 1200)';
  const controller = spawn(process.execPath, ["--input-type=module", "-e",
    `import {runLoggedGate} from ${JSON.stringify(helper)}; const bytes=runLoggedGate(process.execPath,["-e",${JSON.stringify(body)}],${JSON.stringify(root)},${JSON.stringify(log)}); if(!bytes.includes(Buffer.from("finished"))) throw Error("missing body");`,
  ], { cwd: root, stdio: "pipe" });
  const completion = new Promise((resolve, reject) => { controller.once("error", reject); controller.once("close", (code, signal) => resolve({ code, signal })); });
  let observed = "";
  for (let attempt = 0; attempt < 100; attempt++) {
    try { observed = await readFile(log, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (observed.includes("live-stderr")) break;
    await setTimeout(20);
  }
  assert.match(observed, /live-stdout/); assert.match(observed, /live-stderr/);
  assert.equal(controller.exitCode, null); assert.equal(controller.signalCode, null);
  assert.deepEqual(await completion, { code: 0, signal: null });
  assert.match(await readFile(log, "utf8"), /finished/);
});
test("actual failing child refuses the gate and retains stdout and stderr", async t => {
  const { root, log } = await fixture(t);
  assert.throws(() => runLoggedGate(process.execPath, ["-e", 'console.log("failure-stdout"); console.error("failure-stderr"); process.exit(7)'], root, log), /status=7/);
  const bytes = await readFile(log, "utf8"); assert.match(bytes, /failure-stdout/); assert.match(bytes, /failure-stderr/);
});
test("actual signaled child refuses the gate and retains preceding bytes", async t => {
  const { root, log } = await fixture(t);
  assert.throws(() => runLoggedGate(process.execPath, ["-e", 'console.log("signal-start"); process.kill(process.pid,"SIGTERM")'], root, log), /signal=SIGTERM/);
  assert.match(await readFile(log, "utf8"), /signal-start/);
});
test("an existing gate log refuses before a child starts and preserves original bytes", async t => {
  const { root, log } = await fixture(t), marker = join(root, "child-started"); await writeFile(log, "original");
  assert.throws(() => runLoggedGate(process.execPath, ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)},"started")`], root, log), { code: "EEXIST" });
  assert.equal(await readFile(log, "utf8"), "original"); await assert.rejects(stat(marker), { code: "ENOENT" });
});
