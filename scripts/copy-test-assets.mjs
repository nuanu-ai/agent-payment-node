import { cp } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const target = process.argv[2];
if (!target) throw new Error("test output root required");
await cp(fileURLToPath(new URL("../tests/fixtures/", import.meta.url)), resolve(target, "tests/fixtures"), {
  recursive: true,
  filter: path => !path.endsWith(".ts"),
});
