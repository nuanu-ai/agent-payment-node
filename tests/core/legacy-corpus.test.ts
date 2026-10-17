import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { installLegacyCase, legacyCaseDigest, readEveryLegacyRecord } from "./legacy-corpus-readers.js";
import { temporaryState } from "./helpers.js";

/**
 * OWNR 5.1: anything a previous release wrote for the owner-bound families must keep loading, because OperationService
 * reads every one of these stores on every prepare of every rail. The corpus holds real records written by the
 * 0.5.38 and 0.5.43 writers (see manifest.json); this test must pass before and after any validator change.
 */
const CORPUS = join("tests", "fixtures", "legacy-corpus");
const AT = new Date("2026-10-17T00:00:00.000Z");
interface LegacyCase { readonly name: string; readonly writtenBy: string; readonly origin: string; readonly kinds: readonly string[] }

/** The record kinds the owner-bound lanes persist; losing one from the corpus would silently drop its migration guard. */
const REQUIRED_KINDS = [
  "relay:quote-less:56:policy-unbound", "relay:erc20:ethereum-usdc-bnb-native-v1", "relay:erc20:ethereum-usdc-base-eth-v1",
  "relay:native:bnb-native-polygon-native-v1", "relay:native:bnb-native-monad-native-v1", "relay:native:bnb-native-monad-native-default-v1",
  "relay:native:base-native-mega-usdm-default-v1", "relay:native:base-native-polygon-native-buyer-v1", "relay:arbitrum-draft",
  "relay-lifecycle:active", "relay-lifecycle:retired", "relay-lifecycle:source_confirmed", "relay-lifecycle:failed_confirmed_revert",
  "relay-lifecycle:failed_before_effect",
  "circle:apn.circle-v2-evm-operation.v1:1329:cleanup_required", "circle:apn.circle-v2-evm-operation.v1:143:external_fulfilled",
  "circle:apn.circle-v2-evm-operation.v1:59144:completed", "circle:apn.circle-v2-evm-operation.v2:143:awaiting_mint",
  "circle:apn.circle-v2-evm-operation.v2:1329:awaiting_source", "circle-sidecar:v2:external-claim",
  "merchant:prepared", "merchant:delivered", "merchant:retired_unsent", "mega-gaszip:prepared", "sei-gaszip:completed",
  "metamask-native:confirmed", "metamask-native:unknown",
  "ledger:x402:consumedAtomic+merchantNativeActualFee:finalized", "ledger:direct:cleanup85NativeReservation:reserved",
  "ledger:direct:metamaskNativeReservation:finalized", "ledger:direct:consumedAtomic+metamaskNativeActualFee+metamaskNativeReservation:finalized",
] as const;

test("every stored owner-bound record kind loads through every reader, unchanged and without a corrupt-state refusal", async (t) => {
  const cases = JSON.parse(await readFile(join(CORPUS, "manifest.json"), "utf8")) as readonly LegacyCase[];
  assert.deepEqual((await readdir(CORPUS)).filter((name) => name !== "manifest.json").sort(),
    cases.map((entry) => entry.name).sort());
  const seen = new Set<string>();
  for (const entry of cases) {
    await t.test(`${entry.name} (${entry.writtenBy}, ${entry.origin})`, async (sub) => {
      const temporary = await temporaryState(); sub.after(temporary.cleanup);
      await installLegacyCase(join(CORPUS, entry.name), temporary.root);
      const before = await legacyCaseDigest(temporary.root);
      const kinds = await readEveryLegacyRecord(temporary.root, AT);
      assert.deepEqual([...kinds].sort(), [...entry.kinds].sort());
      // A second pass reads the same kinds: no reader consumed, moved or repaired a record on the first one.
      assert.deepEqual([...await readEveryLegacyRecord(temporary.root, AT)].sort(), [...entry.kinds].sort());
      assert.deepEqual(await legacyCaseDigest(temporary.root), before);
      for (const kind of kinds) seen.add(kind);
    });
  }
  assert.deepEqual(REQUIRED_KINDS.filter((kind) => !seen.has(kind)), []);
});
