import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { sha256 } from "../../src/canonical.js";
import { HISTORICAL_JUPITER_IDS } from "../../src/swap/jupiter-solana/historical-pins.js";
import { historicalFixture } from "./jupiter-historical-authentication-fixture.js";
import { temporaryState } from "./helpers.js";

// Install fixed transport doubles before importing the owner: its consumer and
// custody imports are static. These doubles never mint or consume authority.
const calls = {recovery: 0, consumption: 0, keys: 0};
const consumer = test.mock.module("../../src/swap/jupiter-solana/historical-retirement-consumer.js", {namedExports: {
  recoverCommittedJupiterHistoricalRetirement: async () => {calls.recovery++; return null;},
  consumeJupiterHistoricalRetirement: async () => {calls.consumption++; assert.fail("Counterfeit cannot reach consumer");},
}});
const keychain = test.mock.module("../../src/macos-keychain.js", {namedExports: {MacOSLoginKeychainSecret: class {
  async load() {calls.keys++; assert.fail("Counterfeit cannot reach production wrapping key");}
  async create() {assert.fail("Creation is forbidden");}
}}});
const {executeJupiterHistoricalRetirement, claimOwnedJupiterRetirementScope, assertOwnedJupiterRetirementScope} =
  await import("../../src/swap/jupiter-solana/historical-retirement-owner.js");
after(() => {consumer.restore(); keychain.restore();});

async function persistentSnapshot(root: string, prefix = ""): Promise<Record<string, string>> {
  const output: Record<string, string> = {};
  for (const entry of await readdir(join(root, prefix), {withFileTypes: true})) {
    if (prefix === "" && entry.name === "locks") continue;
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(output, await persistentSnapshot(root, path));
    else output[path] = sha256(await readFile(join(root, path)));
  }
  return output;
}

test("retirement private scope refuses fabricated, cloned and projection authority before state access", async () => {
  for (const token of [{}, Object.freeze({}), {projection: {operationId: HISTORICAL_JUPITER_IDS[0]}}, structuredClone({})]) {
    const context = new Proxy({}, {get() {assert.fail("Fake context must never be inspected");}});
    await assert.rejects(claimOwnedJupiterRetirementScope(token as never, context as never));
    await assert.rejects(assertOwnedJupiterRetirementScope(token as never, context as never));
  }
});

test("retirement fixed owner refuses unknown operation and absent root without initialization", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  await assert.rejects(executeJupiterHistoricalRetirement("f".repeat(64), temp.root));
  await assert.rejects(executeJupiterHistoricalRetirement(HISTORICAL_JUPITER_IDS[0]!, temp.root));
  assert.deepEqual(await readdir(temp.base), []);
});

// Generated TEST wallets are deliberately not production-owner positives. Recovery is
// isolated solely to reach the real owner refusal, never to mint or consume a token.
for (const id of HISTORICAL_JUPITER_IDS) test(`retirement fixed owner refuses generated TEST wallet ${id}`, async t => {
  const fixture = await historicalFixture({operationId: id}); t.after(fixture.temp.cleanup);
  calls.recovery = 0; calls.consumption = 0; calls.keys = 0;
  const before = await persistentSnapshot(fixture.temp.root);
  await assert.rejects(executeJupiterHistoricalRetirement(id, fixture.temp.root));
  assert.equal(calls.recovery, 1); assert.equal(calls.consumption, 0); assert.equal(calls.keys, 0);
  assert.deepEqual(await persistentSnapshot(fixture.temp.root), before);
});
