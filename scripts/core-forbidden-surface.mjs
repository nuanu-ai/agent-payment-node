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
  const lineCount = text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
  if (lineCount > 500) violations.push(`${file.slice(productRoot.length + 1)}: ${lineCount} lines exceeds 500`);
  for (const needle of forbidden) {
    if (needle === "node:child_process" && [
      "macos-keychain.ts", "macos-advisory-lock.ts", "awal-process-adapter.ts",
      "awal-direct-adapter.ts", "awal-x402-adapter.ts", "metamask-process-runner.ts",
    ].some((name) => file === join(sourceRoot, name))) continue;
    if (["--chain-id", "--token"].includes(needle) && file === join(sourceRoot, "metamask-direct-adapter.ts")) continue;
    if (needle === "--chain-id" && file === join(sourceRoot, "metamask-x402-adapter.ts")) continue;
    if (needle === "--scheme" && file === join(sourceRoot, "awal-x402-adapter.ts")) continue;
    if (needle === "signTypedData" && file === join(sourceRoot, "local-wallet-native.ts")) continue;
    if (text.includes(needle)) violations.push(`${file.slice(productRoot.length + 1)}: ${needle}`);
  }
  if (file !== join(sourceRoot, "x402-codec.ts") && text.includes("@x402/core")) {
    violations.push(`${file.slice(productRoot.length + 1)}: @x402/core outside codec`);
  }
  if (file === join(sourceRoot, "awal-process-adapter.ts")) {
    for (const required of ["process.execPath", "shell: false", "[script, ...argv]"]) {
      if (!text.includes(required)) violations.push(`src/awal-process-adapter.ts: missing ${required}`);
    }
    for (const disallowed of ["npx", "execFile(", "process.env.PATH", "shell: true", "fork(", "ipc"]) {
      if (text.includes(disallowed)) violations.push(`src/awal-process-adapter.ts: ${disallowed}`);
    }
  }
  if (file === join(sourceRoot, "awal-direct-adapter.ts")) {
    for (const required of [
      "process.execPath", "shell: false", "script, \"send\"", "\"--chain\", \"base\"", "\"--asset\", \"usdc\"", "\"--json\"",
    ]) {
      if (!text.includes(required)) violations.push(`src/awal-direct-adapter.ts: missing ${required}`);
    }
    for (const disallowed of ["npx", "execFile(", "process.env.PATH", "shell: true", "fork(", "ipc"]) {
      if (text.includes(disallowed)) violations.push(`src/awal-direct-adapter.ts: ${disallowed}`);
    }
  }
  if (file === join(sourceRoot, "awal-x402-adapter.ts")) {
    for (const required of [
      "process.execPath", "shell: false", "script, \"x402\", \"pay\"", "\"-X\", \"GET\"",
      "\"--max-amount\"", "\"--scheme\", \"exact\"", "\"--correlation-id\"", "\"--json\"",
      "AWAL_X402_PROCESS_TIMEOUT_MS = 210_000",
    ]) {
      if (!text.includes(required)) violations.push(`src/awal-x402-adapter.ts: missing ${required}`);
    }
    for (const disallowed of ["npx", "execFile(", "process.env.PATH", "shell: true", "fork(", "ipc", "\"-d\""]) {
      if (text.includes(disallowed)) violations.push(`src/awal-x402-adapter.ts: ${disallowed}`);
    }
  }
  if (file === join(sourceRoot, "metamask-direct-adapter.ts")) {
    for (const required of [
      "\"wallet\", \"select\"", "\"--chain-namespace\", \"evm\"", "\"transfer\"",
      "\"--chain-id\", String(CHAIN_ID)", "\"--token\", BASE_USDC", "\"wallet\", \"requests\", \"watch\"",
    ]) {
      if (!text.includes(required)) violations.push(`src/metamask-direct-adapter.ts: missing ${required}`);
    }
    for (const disallowed of ["npx", "execFile(", "process.env.PATH", "shell: true", "fork(", "ipc"]) {
      if (text.includes(disallowed)) violations.push(`src/metamask-direct-adapter.ts: ${disallowed}`);
    }
  }
  if (file === join(sourceRoot, "metamask-x402-adapter.ts")) {
    for (const required of [
      "\"wallet\", \"select\"", "\"--chain-namespace\", \"evm\"", "\"wallet\", \"sign-typed-data\"",
      "\"--chain-id\", input.chainId", "\"--payload\", payload", "\"--intent\", input.humanIntent",
      "\"wallet\", \"requests\", \"watch\"",
    ]) {
      if (!text.includes(required)) violations.push(`src/metamask-x402-adapter.ts: missing ${required}`);
    }
    for (const disallowed of ["npx", "execFile(", "process.env.PATH", "shell: true", "fork(", "ipc", "\"x402\", \"pay\""]) {
      if (text.includes(disallowed)) violations.push(`src/metamask-x402-adapter.ts: ${disallowed}`);
    }
  }
}
if (violations.length > 0) {
  process.stderr.write(`Forbidden shipping surface detected:\n${violations.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`core forbidden-surface and 500-line-limit scan passed (${files.length} files)\n`);
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
