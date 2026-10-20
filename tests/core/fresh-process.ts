import { spawn } from "node:child_process";
import type { TestContext } from "node:test";

/**
 * The test-level limit of a test that runs crash/recovery phases in fresh processes: a hang guard only, never the answer
 * of a phase. Generous on purpose: under the full suite (four files at once) a cold child that loads the whole runtime
 * is slow, and that must never read as a failure.
 */
export const FRESH_PROCESS_TEST_TIMEOUT_MS = 600_000;

/**
 * One fresh worker process, run to its own end. No per-child wall clock decides its answer: QA 0.5.52 saw a 15 s spawnSync
 * kill read as `status null` instead of the phase's own exit code. A real hang is bounded by the test's
 * `FRESH_PROCESS_TEST_TIMEOUT_MS`, after which this child is killed by its own pid (never by a name pattern).
 */
export async function freshProcess(context: TestContext, args: readonly string[]) {
  const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
  context.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  const [status, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve, reject) => {
    child.once("error", reject); child.once("close", (code, by) => resolve([code, by]));
  });
  return { status, stdout, stderr: `${signal === null ? "" : `terminated by ${signal}\n`}${stderr}` };
}
