import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { access, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import test from "node:test";

import { createSandbox as createEsmSandbox } from "@metamask/utils/node";

const require = createRequire(import.meta.url);
const { createSandbox: createCommonJsSandbox } = require("@metamask/utils/node");
const packageRoot = new URL("../../", import.meta.url);
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, packageRoot), "utf8"));
}

async function exerciseSandbox(createSandbox, label) {
  const sandbox = createSandbox(`apn-${label}`);
  assert.match(basename(sandbox.directoryPath), uuidV4Pattern);

  await sandbox.withinSandbox(async ({ directoryPath }) => {
    assert.equal(directoryPath, sandbox.directoryPath);
    const probePath = join(directoryPath, "probe.txt");
    await writeFile(probePath, label, "utf8");
    assert.equal(await readFile(probePath, "utf8"), label);
  });

  await assert.rejects(access(sandbox.directoryPath), { code: "ENOENT" });
}

test("MetaMask utils UUID override and production lock closure are exact", async () => {
  const manifest = await readJson("package.json");
  const lockBytes = await readFile(new URL("package-lock.json", packageRoot));
  const shrinkwrapBytes = await readFile(new URL("npm-shrinkwrap.json", packageRoot));
  const lock = JSON.parse(lockBytes.toString("utf8"));

  assert.deepEqual(manifest.overrides, {
    "@metamask/utils": {
      uuid: "11.1.1",
    },
  });
  assert.deepEqual(lockBytes, shrinkwrapBytes);

  const uuidNodes = Object.entries(lock.packages).filter(([path]) =>
    /(?:^|\/)node_modules\/uuid$/u.test(path),
  );
  assert.equal(uuidNodes.length, 1);
  assert.equal(uuidNodes[0][0], "node_modules/uuid");
  assert.equal(uuidNodes[0][1].version, "11.1.1");
  assert.equal(lock.packages["node_modules/@metamask/utils"].dependencies.uuid, "^9.0.1");
});

test("direct MetaMask package identities remain on the accepted graph", async () => {
  const manifest = await readJson("package.json");
  const lock = await readJson("package-lock.json");
  const expected = {
    "@metamask/7715-permission-types": {
      version: "2.0.0",
      integrity: "sha512-NS6NolXd7fDQhMZoEmzyQcLuJ9NtIPntKOAEOMdFQuR8y1HWpN6PYx1BrY6OgHmJ1D/P4vuWlCooDlh+L8CmVw==",
    },
    "@metamask/smart-accounts-kit": {
      version: "2.0.0",
      integrity: "sha512-eye6GMdOyhL9SPaWwwE0Zlk1466JFxQqB5NH5lHaTo8htibFZmjnKctbKzhdW+FOx53R767BRZXQx7bq6/KACA==",
    },
    "@metamask/x402": {
      version: "1.0.0",
      integrity: "sha512-jgQ7iCBKPE+k3dPCgEIBKrt1xFLfwyaXVBIa9dxuN5dkXTkQs9X9gmY4V/7wRqN32WoeV4qhEj/L/6qcHw+i9g==",
    },
  };

  for (const [name, identity] of Object.entries(expected)) {
    assert.equal(manifest.dependencies[name], identity.version);
    assert.equal(lock.packages[`node_modules/${name}`].version, identity.version);
    assert.equal(lock.packages[`node_modules/${name}`].integrity, identity.integrity);
  }
});

test("MetaMask utils ESM and CommonJS filesystem paths use only UUID v4", async () => {
  const utilsRoot = dirname(require.resolve("@metamask/utils/package.json"));
  for (const filename of ["fs.mjs", "fs.cjs"]) {
    const source = await readFile(join(utilsRoot, "dist", filename), "utf8");
    const calls = [...source.matchAll(/\buuid\.v(\d+)\s*\(/gu)].map((match) => match[1]);
    assert.deepEqual(calls, ["4"], `${filename} must contain only the existing uuid.v4 call`);
    assert.doesNotMatch(source, /\buuid\.v(?:3|5|6)\s*\(/u);
  }

  await exerciseSandbox(createEsmSandbox, "uuid-esm");
  await exerciseSandbox(createCommonJsSandbox, "uuid-commonjs");
});
