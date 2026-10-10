import { spawnSync } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";

/** Retain actual interleaved child bytes while it runs, including refused gates. */
export function runLoggedGate(command, args, cwd, logPath) {
  const descriptor = openSync(logPath, "wx", 0o600);
  let result;
  try {
    result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
      stdio: ["pipe", descriptor, descriptor] });
  } finally {
    closeSync(descriptor);
  }
  const bytes = readFileSync(logPath);
  if (result.error || result.status !== 0 || result.signal !== null) {
    throw new Error(`local release command failed: ${command} ${args.join(" ")} status=${result.status} signal=${result.signal}; retained log: ${logPath}`, { cause: result.error });
  }
  return bytes;
}
