import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { hashObject } from "../../src/canonical.js";
import { assertStoredFieldsEqual, protocolRow, sealedStoredRecord, type StoredRecordFailureReason } from "../../src/stored-record-binding.js";

const fail = (reason: StoredRecordFailureReason): never => { throw new Error(reason); };
const CORPUS = join("tests", "fixtures", "legacy-corpus");
const A = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";

test("a stored record is checked against its own seal and keys; optional keys widen only when present", () => {
  const body = { schemaVersion: "x.v1", account: A, amountAtomic: "1" };
  const record = { ...body, integrityHash: hashObject(body) };
  const spec = { keys: ["schemaVersion", "account", "amountAtomic", "integrityHash"], optionalKeys: ["memo"], sealField: "integrityHash", seal: hashObject };
  assert.equal(sealedStoredRecord(record, spec, fail), record);
  const widened = { ...body, memo: "m" };
  assert.equal(sealedStoredRecord<typeof widened>({ ...widened, integrityHash: hashObject(widened) }, spec, fail).amountAtomic, "1");
  assert.throws(() => sealedStoredRecord({ ...record, extra: 1 }, spec, fail), /stored_record_shape/);
  assert.throws(() => sealedStoredRecord({ ...record, amountAtomic: "2" }, spec, fail), /stored_record_seal/);
  assert.throws(() => sealedStoredRecord({ ...body }, spec, fail), /stored_record_shape/);
  assert.throws(() => sealedStoredRecord(record, { ...spec, sealField: "quoteDigest" }, fail), /stored_record_shape/);
});

test("identity and protocol fields compare with the record's own values; EVM case differs only in spelling", () => {
  assertStoredFieldsEqual({ payer: A.toLowerCase(), chain: 56, route: { domain: 3 } }, { payer: A, chain: 56, route: { domain: 3 } }, fail);
  assert.throws(() => assertStoredFieldsEqual({ payer: A }, { payer: "0x823A00000000000000000000000000000000Ce71" }, fail), /stored_record_binding/);
  assert.throws(() => assertStoredFieldsEqual({ chain: "56" }, { chain: 56 }, fail), /stored_record_binding/);
  assert.throws(() => assertStoredFieldsEqual({}, { payer: A }, fail), /stored_record_binding/);
  const current = { "bnb-native-monad-native-v1": { sourceChainId: 56, chainId: 143 } };
  const legacy = { "bnb-native-monad-native-default-v1": { sourceChainId: 56, chainId: 143 } };
  assert.deepEqual(protocolRow("bnb-native-monad-native-v1", current, legacy), { row: current["bnb-native-monad-native-v1"], legacy: false });
  assert.deepEqual(protocolRow("bnb-native-monad-native-default-v1", current, legacy)?.legacy, true);
  assert.equal(protocolRow("toString", current, legacy), null);
  assert.equal(protocolRow("unknown", current), null);
});

/** The helpers accept the real stored records of the legacy corpus without any owner constant or route rebuild. */
test("legacy Circle bindings, Relay native quotes and merchant custody validate against their own stored fields", async () => {
  let circle = 0, relay = 0, merchant = 0;
  for (const name of await readdir(CORPUS)) {
    if (name === "manifest.json") continue;
    for (const [directory, file] of await files(join(CORPUS, name))) {
      const value = JSON.parse(await readFile(join(CORPUS, name, directory, file), "utf8")) as Record<string, any>;
      if (directory === "circle-v2-evm" && value.schemaVersion === "apn.circle-v2-evm-operation.v2") {
        const binding = sealedStoredRecord<Record<string, unknown>>(value.funding, { keys: Object.keys(value.funding), sealField: "bindingHash", seal: hashObject }, fail);
        assertStoredFieldsEqual(binding, { sourceOwner: value.sourceCustody.walletAddress, gasPayer: value.destinationCustody.walletAddress,
          destinationProfile: value.destinationProfile, destinationChain: value.destinationChain }, fail);
        circle++;
      }
      if (directory.startsWith("relay-unsigned-operations/") && value.nativeQuote !== undefined) {
        const quote = sealedStoredRecord<Record<string, unknown>>(value.nativeQuote, { keys: Object.keys(value.nativeQuote), sealField: "quoteDigest", seal: hashObject }, fail);
        assertStoredFieldsEqual(quote, { payer: value.sourceAccount, recipient: value.recipient, principalAtomic: value.amountAtomic,
          minimumOutputWei: value.minOutputAtomic, quoteDigest: value.quoteDigest }, fail);
        relay++;
      }
      if (directory === "merchant-x402") {
        assertStoredFieldsEqual(value.custody, { profileHash: value.profileHash }, fail);
        merchant++;
      }
    }
  }
  assert.ok(circle > 0 && relay >= 5 && merchant > 0, JSON.stringify({ circle, relay, merchant }));
});

async function files(root: string, prefix = ""): Promise<readonly (readonly [string, string])[]> {
  const result: (readonly [string, string])[] = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    if (entry.isDirectory()) result.push(...await files(root, prefix === "" ? entry.name : `${prefix}/${entry.name}`));
    else if (entry.name.endsWith(".json")) result.push([prefix, entry.name]);
  }
  return result;
}
