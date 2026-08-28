import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const productRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = join(productRoot, "src");
const forbidden = [
  "--yes",
  "--mock",
  "--header",
  "--method",
  "--body",
  "--allow-http",
  "--allow-private",
  "--allow-localhost",
  "--allow-redirects",
  "--skip-tls",
  "--tls-insecure",
  "--ca-file",
  "--proxy",
  "--signer",
  "--no-redact",
  "--disable-redaction",
  "--facilitator",
  "--network",
  "--chain-id",
  "--token",
  "--scheme",
  "--payment-flow",
  "--private-key",
  "--raw-key",
  "--insecure",
  "localhost",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NODE_OPTIONS",
  "rejectUnauthorized: false",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "NODE_EXTRA_CA_CERTS",
  "checkServerIdentity:",
  "privateKey.read",
  "signMessage",
  "signTypedData",
  "node:child_process",
  "createServer(",
  "http://",
  "@x402/fetch",
  "x402Hub",
  "facilitator.verify",
  "facilitator.settle",
];

const files = await collect(sourceRoot);
const violations = [];
for (const file of files) {
  const text = await readFile(file, "utf8");
  for (const needle of forbidden) {
    if (
      needle === "node:child_process" &&
      (file === join(sourceRoot, "macos-keychain.ts") || file === join(sourceRoot, "macos-advisory-lock.ts"))
    ) continue;
    if (needle === "signTypedData" && file === join(sourceRoot, "local-wallet-native.ts")) continue;
    if (text.includes(needle)) violations.push(`${file.slice(productRoot.length + 1)}: ${needle}`);
  }
  if (file !== join(sourceRoot, "x402-codec.ts") && text.includes("@x402/core")) {
    violations.push(`${file.slice(productRoot.length + 1)}: @x402/core outside codec`);
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
