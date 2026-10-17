import assert from "node:assert/strict";
import test from "node:test";
import { solanaJsonAccountKeys } from "../../src/lifi/solana-destination-candidate.js";

const recipient = "So11111111111111111111111111111111111111112";
const other = "11111111111111111111111111111111";
const ata = "95eqQDmQG7y8gad3yReqXqzyFoiQ4LYD9iAY1PMtuyRj";

function legacy() {
  return { version: "legacy" as "legacy" | 0,
    meta: { loadedAddresses: { writable: [] as string[], readonly: [] as string[] } },
    transaction: { message: { accountKeys: [other, recipient, ata],
      addressTableLookups: undefined as undefined | { accountKey: string; writableIndexes: number[]; readonlyIndexes: number[] }[] } } };
}

test("legacy transactions resolve to their static keys and refuse loaded addresses", () => {
  assert.deepEqual(solanaJsonAccountKeys(legacy()), [other, recipient, ata]);
  const loaded = legacy(); loaded.meta.loadedAddresses.writable = [ata];
  assert.throws(() => solanaJsonAccountKeys(loaded), { code: "APN_RPC_PROTOCOL" });
  const duplicate = legacy(); duplicate.transaction.message.accountKeys.push(other);
  assert.throws(() => solanaJsonAccountKeys(duplicate), { code: "APN_RPC_PROTOCOL" });
});

test("resolves v0 writable ALT addresses after static keys and rejects missing loaded addresses", () => {
  const v = legacy();
  v.transaction.message.accountKeys.pop();
  v.version = 0;
  v.transaction.message.addressTableLookups = [{ accountKey: other, writableIndexes: [0], readonlyIndexes: [] }];
  v.meta.loadedAddresses.writable = [ata];
  assert.deepEqual(solanaJsonAccountKeys(v), [other, recipient, ata]);
  v.meta.loadedAddresses.writable = [];
  assert.throws(() => solanaJsonAccountKeys(v), { code: "APN_RPC_PROTOCOL" });
  v.meta.loadedAddresses.writable = [ata];
  v.transaction.message.addressTableLookups[0]!.writableIndexes[0] = 256;
  assert.throws(() => solanaJsonAccountKeys(v), { code: "APN_RPC_PROTOCOL" });
});
