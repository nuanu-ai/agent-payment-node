import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const entries = (await readdir(scriptsDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .sort();

for (const name of entries.filter((entry) => entry.endsWith(".mjs"))) {
  check(process.execPath, ["--check", join(scriptsDirectory, name)], name);
}
for (const name of entries.filter((entry) => entry.endsWith(".sh"))) {
  check("bash", ["-n", join(scriptsDirectory, name)], name);
}

process.stdout.write(`packaging script syntax passed (${entries.length} scripts)\n`);

function check(command, arguments_, label) {
  const result = spawnSync(command, arguments_, { encoding: "utf8" });
  if (result.error !== undefined || result.status !== 0) {
    process.stderr.write(String(result.stderr ?? ""));
    throw new Error(`syntax check failed: ${label}`);
  }
}
