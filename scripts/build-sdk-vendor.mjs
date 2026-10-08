import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire, isBuiltin } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const tron = process.argv[2] === "--tron-utils";
const relay = process.argv[2] === "--relay-order-id";
const smart = process.argv[2] === "--smart-account";
const args = process.argv.slice(tron || relay || smart ? 3 : 2);
const check = args[0] === "--check" && args.length === 1;
const destination = args[0] === "--out-dir" ? args[1] : undefined;
assert(check || (destination && args.length === 2), "use [--tron-utils|--relay-order-id|--smart-account] --check or --out-dir <new directory>");
const vendorName = smart ? "metamask-smart-account" : tron ? "tron-utils" : relay ? "relay-order-id" : "metamask-evm-sdk";
const temporary = await mkdtemp(join(tmpdir(), "apn-sdk-build-"));
const output = join(temporary, "vendor");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const entries = smart ? {
  "smart-utils": [
    "@metamask/smart-accounts-kit/utils",
    [
      "SIGNABLE_DELEGATION_TYPED_DATA",
      "decodeDelegations",
      "encodeDelegations",
      "toDelegationStruct"
    ]
  ],
  "smart-root": [
    "@metamask/smart-accounts-kit",
    [
      "ExecutionMode",
      "ROOT_AUTHORITY",
      "createExecution",
      "getSmartAccountsEnvironment"
    ]
  ],
  "smart-actions": [
    "@metamask/smart-accounts-kit/actions",
    [
      "getErc20PeriodTransferEnforcerAvailableAmount",
      "redelegatePermissionContextAction"
    ]
  ],
  "smart-contracts": [
    "@metamask/smart-accounts-kit/contracts",
    [
      "DelegationManager"
    ]
  ],
  "permission-types": [
    "@metamask/7715-permission-types",
    [
      "ALL_METAMASK_FACILITATOR_ADDRESSES",
      "METAMASK_FACILITATOR_ADDRESSES",
      "makePermissionDecoderConfigs",
      "createErc20TokenAllowanceCaveats"
    ]
  ],
  "smart-experimental": [
    "@metamask/smart-accounts-kit/experimental",
    [
      "createx402DelegationProvider"
    ]
  ],
  "x402-client": [
    "@metamask/x402",
    [
      "x402Erc7710Client"
    ]
  ],
  "delegation-core": [
    "@metamask/delegation-core",
    [
      "ANY_BENEFICIARY",
      "decodeAllowedCalldataTerms",
      "decodeERC20TransferAmountTerms",
      "decodeRedeemerTerms",
      "decodeTimestampTerms",
      "decodeValueLteTerms",
      "hashDelegation"
    ]
  ]
} : tron ? { utils: ["tronweb", ["utils"]] } : relay ? { "order-id": ["@relay-protocol/settlement-sdk", ["getOrderId"]] } : {
  "sdk-root": ["@metamask/agent-sdk", ["NetworkRegistry", "PriceService", "createWalletServiceFromSession", "disableAnalytics"]],
  "sdk-base": ["@metamask/agent-sdk/base", ["SessionManager", "WalletStateManager"]],
  "sdk-evm": ["@metamask/agent-sdk/evm", ["getAgenticEvmChains", "withEvmRpcTarget"]],
  "fox-evm": ["@metamask/fox-sdk/wallets/evm", ["prepareDelegation", "executionsToWire", "unsignedDelegationToWire", "EvmServerAdapter", "evmServerAdapter", "SIGN_REQUEST_KIND"]],
  "fox-keyring": ["@metamask/fox-sdk/wallets/keyring", ["createKeyringController", "KEYRING_KIND"]],
  controller: ["@toruslabs/ethereum-controllers", ["getDelegationHashOffchain"]],
};
const entrySource = name => `export { ${entries[name][1].join(", ")} } from ${JSON.stringify(entries[name][0])};\n`;
const forbiddenPackage = /^(?:@metamask\/fox-sdk\/wallets\/solana|@solana\/(?:spl-token|buffer-layout-utils)|bigint-buffer)(?:\/|$)/;
const forbiddenFile = /(?:^|\/)node_modules\/(?:@metamask\/fox-sdk\/dist\/wallets\/solana|@solana\/(?:spl-token|buffer-layout-utils)|bigint-buffer)(?:\/|$)/u;
const versions = smart ? { smartAccountsKit: "2.0.0", permissionTypes: "2.0.0", x402: "1.0.0", delegationCore: "3.0.0" } : tron ? { tronweb: "6.5.0" } : relay ? { settlementSdk: "0.0.143" } : { agentSdk: "6.1.4", foxSdk: "2.7.0", ethereumControllers: "9.12.0" };
const binaryHash = "10b6243df618d374bb2d5c9cfbe7052e1405f6aa4e53a6164f11a91b9f2e1384";
try {
  assert.equal(process.platform, "darwin"); assert.equal(process.arch, "arm64");
  const upstreamPackages = smart ? [["@metamask/smart-accounts-kit", versions.smartAccountsKit], ["@metamask/7715-permission-types", versions.permissionTypes], ["@metamask/x402", versions.x402], ["@metamask/delegation-core", versions.delegationCore]] : tron ? [["tronweb", versions.tronweb]] : relay ? [["@relay-protocol/settlement-sdk", versions.settlementSdk]] : [["@metamask/agent-sdk", versions.agentSdk], ["@metamask/fox-sdk", versions.foxSdk], ["@toruslabs/ethereum-controllers", versions.ethereumControllers]];
  for (const [name, version] of [...upstreamPackages, ["esbuild", "0.28.2"], ["punycode", "2.3.1"]]) {
    const path = join(root, "node_modules", name, "package.json");
    assert.equal(JSON.parse(await readFile(path, "utf8")).version, version, name);
  }
  if (smart) for (const [name] of upstreamPackages) {
    const metadata = JSON.parse(await readFile(join(root, "node_modules", name, "package.json"), "utf8"));
    assert.equal(metadata.name, name); assert.equal(metadata.license, "(MIT-0 OR Apache-2.0)");
    assert.equal(metadata.repository?.url, "https://github.com/MetaMask/smart-accounts-kit.git");
  }
  const binary = require.resolve("@esbuild/darwin-arm64/bin/esbuild");
  assert.equal(sha(await readFile(binary)), binaryHash, "unreviewed esbuild binary");
  process.env.ESBUILD_BINARY_PATH = binary;
  const { build } = await import("esbuild");
  const result = await build({
    absWorkingDir: root, entryPoints: Object.fromEntries(Object.keys(entries).map(name => [name, `apn-sdk:${name}`])),
    outdir: output, bundle: true, splitting: true, preserveSymlinks: true,
    outExtension: { ".js": ".mjs" }, format: "esm", platform: "node", target: "node24",
    nodePaths: [join(root, "node_modules")], metafile: true, write: true, logLevel: "silent", legalComments: "external",
    banner: { js: 'import { createRequire as __apnSdkCreateRequire, isBuiltin as __apnSdkIsBuiltin } from "node:module"; const __apnSdkRequire = __apnSdkCreateRequire(import.meta.url); const require = (name) => { if (typeof name !== "string" || !__apnSdkIsBuiltin(name)) throw new Error("APN SDK refuses non-builtin dynamic require"); return __apnSdkRequire(name); };' },
    plugins: [{ name: "apn-evm-sdk-boundary", setup(builder) {
      builder.onResolve({ filter: /^apn-sdk:/ }, args => ({ path: args.path.slice(8), namespace: "apn-sdk" }));
      builder.onLoad({ filter: /.*/, namespace: "apn-sdk" }, args => {
        assert(args.path in entries); return { contents: entrySource(args.path), loader: "js", resolveDir: root };
      });
      builder.onResolve({ filter: /^punycode$/ }, () => ({ path: require.resolve("punycode/") }));
      builder.onResolve({ filter: forbiddenPackage }, args => { throw Error(`forbidden SDK dependency: ${args.path}`); });
      builder.onLoad({ filter: /.*/, namespace: "file" }, args => {
        assert(!forbiddenFile.test(args.path), `forbidden decoder input: ${args.path}`);
      });
    } }],
  });
  const external = [...new Set(Object.values(result.metafile.outputs).flatMap(row => row.imports.filter(item => item.external).map(item => item.path)))].sort();
  const externalRows = Object.values(result.metafile.outputs).flatMap(row => row.imports.filter(item => item.external));
  // node-fetch's optional encoding require is caught upstream. The banner rejects it before
  // parent resolution, preserving the absent-package fallback even when a parent installs it.
  assert(externalRows.every(item => isBuiltin(item.path) || relay && item.path === "encoding" && item.kind === "require-call"), `SDK has external package imports: ${external}`);
  const files = {};
  for (const name of (await readdir(output)).sort()) {
    const bytes = await readFile(join(output, name)); files[name] = { bytes: bytes.length, sha256: sha(bytes) };
  }
  const manifest = { schemaVersion: `apn.${vendorName}.v1`, upstreamVersions: versions,
    bundler: { version: "0.28.2", target: "node24" }, builtinSubstitutions: { punycode: "punycode.js@2.3.1" }, files, entryNames: Object.keys(entries) };
  const packages = {}, inputs = [], licenses = new Map();
  for (const name of Object.keys(result.metafile.inputs).sort()) {
    if (name.startsWith("apn-sdk:")) {
      const entry = name.slice(8), bytes = Buffer.from(entrySource(entry));
      inputs.push({ identity: "apn-owned-entry", file: `${entry}.mjs`, sha256: sha(bytes), bytes: bytes.length });
      continue;
    }
    const path = resolve(root, name); assert(!forbiddenFile.test(path));
    let parent = dirname(path), metadata;
    while (parent !== dirname(parent)) {
      try {
        const found = JSON.parse(await readFile(join(parent, "package.json"), "utf8"));
        if (found.name && found.version) { metadata = found; break; }
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      parent = dirname(parent);
    }
    assert(metadata?.name && metadata.version, `missing input provenance: ${name}`);
    const identity = `${metadata.name}@${metadata.version}`, bytes = await readFile(path);
    packages[identity] = { name: metadata.name, version: metadata.version, license: metadata.license ?? null };
    inputs.push({ identity, file: path.slice(parent.length + 1), sha256: sha(bytes), bytes: bytes.length });
    for (const license of (await readdir(parent, { withFileTypes: true })).filter(item => item.isFile() && /^(license|licence|copying|notice)(\.|$)/iu.test(item.name)).map(item => item.name)) {
      const key = `${identity.replaceAll("/", "__")}__${license}`;
      const content = await readFile(join(parent, license));
      if (licenses.has(key)) assert(licenses.get(key).equals(content), `conflicting license: ${key}`);
      licenses.set(key, content);
    }
  }
  const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === "object" ?
    Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
  const json = value => JSON.stringify(sorted(value), null, 2) + "\n";
  await writeFile(join(output, "manifest.json"), json(manifest));
  await mkdir(join(output, "licenses"));
  for (const [name, bytes] of [...licenses].sort(([a], [b]) => a.localeCompare(b, "en"))) await writeFile(join(output, "licenses", name), bytes);
  inputs.sort((a, b) => a.identity.localeCompare(b.identity, "en") || a.file.localeCompare(b.file, "en"));
  await writeFile(join(output, "provenance.json"), json({
    schemaVersion: `apn.${vendorName}.provenance.v1`, inputFiles: inputs, packages, externalImports: external,
    bundler: { version: "0.28.2", binarySha256: binaryHash, target: "node24" },
    ...(relay ? { disabledOptionalPackages: ["encoding"], dynamicPackageRequires: "rejected before parent resolution by bundled builtin-only require" } : {}),
    scope: smart ? "Smart Account exports; original package identities checked; other upstream advisories are not declared patched" : tron ? "Offline TRON utilities only; forbidden decoder inputs absent; other upstream advisories are not declared patched" : relay ? "Relay getOrderId only; forbidden decoder inputs absent; other upstream advisories are not declared patched" : "EVM SDK slice; forbidden decoder inputs absent; other upstream advisories are not declared patched",
  }));
  async function inventory(directory, prefix = "") {
    const rows = {};
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const name = `${prefix}${item.name}`, path = join(directory, item.name);
      if (item.isDirectory()) Object.assign(rows, await inventory(path, `${name}/`));
      else { assert(item.isFile(), `non-regular vendor file: ${name}`); rows[name] = sha(await readFile(path)); }
    }
    return Object.fromEntries(Object.entries(rows).sort(([a], [b]) => a.localeCompare(b, "en")));
  }
  if (check) assert.deepEqual(await inventory(join(root, "vendor", vendorName)), await inventory(output), "SDK regeneration differs from tracked files");
  else await cp(output, resolve(destination), { recursive: true, force: false, errorOnExist: true });
  console.log(JSON.stringify({ mode: check ? "check" : "generate", files: Object.keys(files).length,
    inputFiles: inputs.length, licenses: licenses.size, manifestSha256: sha(await readFile(join(output, "manifest.json"))) }));
} finally { await rm(temporary, { recursive: true, force: true }); }
