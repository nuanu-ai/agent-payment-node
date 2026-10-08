import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const product = resolve(import.meta.dirname, "../..");
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "apn-tron-integrity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const loader = join(root, "dist/tron/utils.js"), vendor = join(root, "vendor/tron-utils");
  await mkdir(resolve(loader, ".."), { recursive: true });
  await writeFile(join(root, "package.json"), '{"type":"module"}\n');
  await cp(join(product, "dist/tron/utils.js"), loader);
  await cp(join(product, "vendor/tron-utils"), vendor, { recursive: true });
  return { root, loader, vendor };
}
function run(loader, rejected) {
  const script = `
    import assert from "node:assert/strict"; import http from "node:http";
    import https from "node:https"; import net from "node:net"; import cp from "node:child_process";
    import {syncBuiltinESMExports} from "node:module";
    let effects = 0; const deny = () => { effects++; throw Error("TRON import attempted an effect"); };
    process.dlopen = deny; globalThis.fetch = deny;
    http.request = http.get = https.request = https.get = deny;
    net.connect = net.createConnection = net.Socket.prototype.connect = deny;
    for (const key of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) cp[key] = deny;
    syncBuiltinESMExports();
    const load = () => import(${JSON.stringify(pathToFileURL(loader).href)});
    if (${rejected}) {
      await assert.rejects(load(), error => String(error).includes("APN TRON utility vendor integrity rejected"));
      assert.equal(globalThis.APNSdkTamperedEvaluated, undefined);
    } else {
      const { utils } = await load();
      for (const [name, methods] of Object.entries({ crypto: ["decodeBase58Address", "getBase58CheckAddress", "getAddressFromPriKey", "ecRecover", "signTransaction"],
        address: ["toHex"], transaction: ["txJsonToPb", "txPbToRawDataHex", "txPbToTxID"] })) {
        for (const method of methods) assert.equal(typeof utils[name][method], "function", method);
      }
    }
    assert.equal(effects, 0);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
test("shipped TRON utilities load offline without parent packages or network/native/process effects", async t => {
  const f = await fixture(t); run(f.loader, false);
});
for (const kind of ["entry", "manifest", "file-symlink", "directory-symlink"]) test(`shipped TRON utilities refuse ${kind} substitution before evaluation`, async t => {
  const f = await fixture(t);
  if (kind === "entry") await writeFile(join(f.vendor, "utils.mjs"), "globalThis.APNSdkTamperedEvaluated = true;\n");
  else if (kind === "manifest") await writeFile(join(f.vendor, "manifest.json"), '{"files":{}}\n');
  else if (kind === "file-symlink") {
    const path = join(f.vendor, "utils.mjs"), target = join(f.root, "matching-entry.mjs");
    await cp(path, target); await rm(path); await symlink(target, path);
  } else {
    const target = join(f.root, "matching-sdk");
    await cp(f.vendor, target, { recursive: true }); await rm(f.vendor, { recursive: true }); await symlink(target, f.vendor, "dir");
  }
  run(f.loader, true);
});
