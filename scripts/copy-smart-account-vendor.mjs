import { cp } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const target = process.argv[2];
if (!target) throw new Error("test vendor destination required");
await cp(fileURLToPath(new URL("../vendor/metamask-smart-account/", import.meta.url)), resolve(target), { recursive: true });
