import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const guard = pathToFileURL(resolve(import.meta.dirname, "../../dist/runtime-dependency-boundary.js")).href;
const refused = "APN dependency boundary rejected unreviewed package version";
const versions = [["axios", "0.34.0", "0.33.0"], ["axios", "1.20.0", "1.18.0"],
  ["fast-uri", "3.1.8", "3.1.6"], ["brace-expansion", "5.0.12", "5.0.9"], ["pbkdf2", "3.1.7", "3.1.6"]];

for (const [name, patched, old] of versions) test(`${name} allows reviewed version metadata and rejects consumer substitution before ESM/CJS evaluation`, async t => {
  const root = await mkdtemp(join(tmpdir(), "apn-reviewed-versions-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [version, allowed] of [[patched, true], [old, false]]) {
    const packageRoot = join(root, version, "node_modules", name);
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name, version, main: "index.cjs" }));
    await writeFile(join(packageRoot, "index.cjs"), "globalThis.APNEvaluated = true; module.exports = 7;\n");
    const target = pathToFileURL(join(packageRoot, "index.cjs")).href;
    const script = `import assert from 'node:assert/strict'; import {createRequire} from 'node:module'; import {fileURLToPath} from 'node:url';
      const {installRuntimeDependencyBoundary}=await import(${JSON.stringify(guard)}); installRuntimeDependencyBoundary();
      let addons=0; process.dlopen=()=>{addons++;throw Error('native forbidden');};
      const require=createRequire(import.meta.url), target=${JSON.stringify(target)};
      for(const load of [()=>import(target),()=>require(fileURLToPath(target))]){
        if(${allowed}) await load();
        else {try{await load();throw Error('unexpected evaluation');}catch(e){assert.ok(String(e).includes(${JSON.stringify(refused)}),String(e));}}
      }
      assert.equal(globalThis.APNEvaluated,${allowed ? "true" : "undefined"}); assert.equal(addons,0);`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 15000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
});

test("missing, malformed, oversized or wrong-name metadata refuses before package evaluation", async t => {
  const root = await mkdtemp(join(tmpdir(), "apn-reviewed-metadata-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [i, metadata] of [null, "{", JSON.stringify({ name: "axios", version: "1.20.0", description: "x".repeat(65537) }), JSON.stringify({ name: "other", version: "1.20.0" })].entries()) {
    const packageRoot = join(root, String(i), "node_modules", "axios");
    await mkdir(packageRoot, { recursive: true });
    if (metadata !== null) await writeFile(join(packageRoot, "package.json"), metadata);
    await writeFile(join(packageRoot, "index.cjs"), "throw Error('package evaluated');\n");
    const target = pathToFileURL(join(packageRoot, "index.cjs")).href;
    const script = `const {installRuntimeDependencyBoundary}=await import(${JSON.stringify(guard)}); installRuntimeDependencyBoundary();
      try {await import(${JSON.stringify(target)});throw Error('unexpected evaluation');}
      catch(e){if(!String(e).includes(${JSON.stringify(refused)})&&!String(e).includes('Invalid package config'))throw e;}`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 15000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
});
