import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const rejected = "APN dependency boundary rejected Solana decoder";

test("shipped executable installs the guard before its runtime graph", () => {
  const bootstrap = readFileSync(resolve(root, "bin/apn.js"), "utf8");
  assert.doesNotMatch(bootstrap, /^import\s+["']\.\.\/dist\/bin\.js["']/mu);
  assert.ok(bootstrap.indexOf("installRuntimeDependencyBoundary();") >= 0);
  assert.ok(bootstrap.indexOf("installRuntimeDependencyBoundary();") < bootstrap.indexOf('await import("../dist/bin.js")'));
});

// A static import links (and an older Node fails to link) before any statement runs: only the Node.js guard is static.
test("shipped executable checks the Node.js version before it links the boundary or the runtime", () => {
  const bootstrap = readFileSync(resolve(root, "bin/apn.js"), "utf8");
  const staticImports = [...bootstrap.matchAll(/^import\s[^;]*?["']([^"']+)["']/gmu)].map((match) => match[1]);
  assert.deepEqual(staticImports, ["../dist/node-version-guard.js"]);
  const check = bootstrap.indexOf("unsupportedNodeMessage(process.versions.node)");
  assert.ok(check > 0 && check < bootstrap.indexOf('await import("../dist/runtime-dependency-boundary.js")'));
  const guard = readFileSync(resolve(root, "dist/node-version-guard.js"), "utf8");
  assert.doesNotMatch(guard, /^\s*(?:import\b|export\b[^;]*\bfrom\b)/mu, "the guard module links nothing else");
});

for (const argv of [["--help"], ["mcp", "config"]]) {
  test(`shipped APN ${argv.join(" ")} bootstrap guards ESM and CommonJS loads`, () => {
    const script = `
      import { createRequire } from "node:module";
      process.argv = [process.execPath, "apn", ...${JSON.stringify(argv)}];
      await import("./bin/apn.js");
      const require = createRequire(import.meta.url);
      for (const specifier of ["bigint-buffer", "@solana/buffer-layout-utils", "@solana/spl-token",
        "@metamask/fox-sdk/wallets/solana", "./node_modules/bigint-buffer/dist/node.js",
        "./node_modules/@metamask/fox-sdk/dist/wallets/solana/index.js"]) {
        try { await import(specifier); throw Error("ESM reached " + specifier); }
        catch (error) { if (!String(error).includes(${JSON.stringify(rejected)})) throw error; }
      }
      for (const specifier of ["bigint-buffer", "@solana/buffer-layout-utils", "@solana/spl-token",
        "./node_modules/bigint-buffer/dist/node.js",
        "./node_modules/@metamask/fox-sdk/dist/wallets/solana/index.js"]) {
        try { require(specifier); throw Error("CommonJS reached " + specifier); }
        catch (error) { if (!String(error).includes(${JSON.stringify(rejected)})) throw error; }
      }
      await import("@solana/kit");
      console.log("APN_RUNTIME_BOUNDARY_OK");
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script],
      { cwd: root, encoding: "utf8", timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /APN_RUNTIME_BOUNDARY_OK/u);
  });
}
