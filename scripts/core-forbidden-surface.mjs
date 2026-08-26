import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const productRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = join(productRoot, "src");
const forbidden = [
  "--yes",
  "--mock",
  "--private-key",
  "--raw-key",
  "--insecure",
  "privateKey.read",
  "signMessage",
  "signTypedData",
  "node:child_process",
  "createServer(",
  "http://",
  "x402",
];

const files = await collect(sourceRoot);
const violations = [];
for (const file of files) {
  const text = await readFile(file, "utf8");
  for (const needle of forbidden) {
    if (text.includes(needle)) violations.push(`${file.slice(productRoot.length + 1)}: ${needle}`);
  }
}
if (violations.length > 0) {
  process.stderr.write(`Forbidden shipping surface detected:\n${violations.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`core forbidden-surface scan passed (${files.length} files)\n`);
}

async function collect(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await collect(path));
    else if (entry.isFile() && entry.name.endsWith(".ts")) output.push(path);
  }
  return output;
}
