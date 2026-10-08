import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const product = resolve(import.meta.dirname, "../..");
const sourceVendor = join(product, "vendor/metamask-evm-sdk");
const sourceLoader = join(product, "dist/metamask-gasless/client/sdk-vendor.js");
const refused = "APN EVM SDK vendor integrity rejected";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "apn-sdk-integrity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const loader = join(root, "dist/metamask-gasless/client/sdk-vendor.js");
  const vendor = join(root, "vendor/metamask-evm-sdk");
  await mkdir(resolve(loader, ".."), { recursive: true });
  await writeFile(join(root, "package.json"), '{"type":"module"}\n');
  await cp(sourceLoader, loader);
  await cp(sourceVendor, vendor, { recursive: true });
  return { root, loader, vendor };
}

function run(loader, expectRejected) {
  const script = `
    import assert from "node:assert/strict";
    import http from "node:http"; import https from "node:https"; import net from "node:net";
    import cp from "node:child_process"; import {syncBuiltinESMExports} from "node:module";
    let effects = 0;
    const deny = () => { effects++; throw Error("SDK import attempted an effect"); };
    process.dlopen = deny; globalThis.fetch = deny;
    http.request = http.get = https.request = https.get = deny;
    net.connect = net.createConnection = net.Socket.prototype.connect = deny;
    for (const key of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) cp[key] = deny;
    syncBuiltinESMExports();
    const sdk = await import(${JSON.stringify(pathToFileURL(loader).href)});
    if (${expectRejected}) {
      await assert.rejects(sdk.foxEvm(), error => String(error).includes(${JSON.stringify(refused)}));
      assert.equal(globalThis.APNSdkTamperedEvaluated, undefined);
    } else {
      for (const [name, fields] of Object.entries({
        agentSdk: ["NetworkRegistry", "PriceService", "createWalletServiceFromSession", "disableAnalytics"],
        agentBase: ["SessionManager", "WalletStateManager"],
        agentEvm: ["getAgenticEvmChains", "withEvmRpcTarget"],
        foxEvm: ["prepareDelegation", "executionsToWire", "unsignedDelegationToWire", "EvmServerAdapter", "evmServerAdapter", "SIGN_REQUEST_KIND"],
        foxKeyring: ["createKeyringController", "KEYRING_KIND"],
        ethereumControllers: ["getDelegationHashOffchain"]
      })) { const api = await sdk[name](); for (const field of fields) assert.ok(field in api, field); }
    }
    assert.equal(effects, 0);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script],
    { encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("shipped EVM SDK loads all six entries without parent packages or network/native/process effects", async t => {
  const f = await fixture(t);
  run(f.loader, false);
});

for (const kind of ["entry", "shared-chunk", "manifest", "file-symlink", "directory-symlink"]) {
  test(`shipped EVM SDK refuses ${kind} substitution before evaluation`, async t => {
    const f = await fixture(t);
    if (kind === "entry" || kind === "shared-chunk") {
      const manifest = JSON.parse(await readFile(join(f.vendor, "manifest.json"), "utf8"));
      const name = kind === "entry" ? "fox-evm.mjs" : Object.keys(manifest.files).find(name => name.startsWith("chunk-"));
      const path = join(f.vendor, name);
      await writeFile(path, "globalThis.APNSdkTamperedEvaluated = true;\n");
    } else if (kind === "manifest") {
      await writeFile(join(f.vendor, "manifest.json"), '{"files":{}}\n');
    } else if (kind === "file-symlink") {
      const path = join(f.vendor, "fox-evm.mjs"), target = join(f.root, "matching-entry.mjs");
      await cp(path, target); await rm(path); await symlink(target, path);
    } else {
      const target = join(f.root, "matching-sdk");
      await cp(f.vendor, target, { recursive: true }); await rm(f.vendor, { recursive: true });
      await symlink(target, f.vendor, "dir");
    }
    run(f.loader, true);
  });
}
