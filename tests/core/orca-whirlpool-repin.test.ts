// Fake RPC over captured public bytes. No live read, signature, send or paid swap.
import assert from "node:assert/strict";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import type { SolanaRpcPort } from "../../src/solana/rpc.js";
import { swapMechanismDigest } from "../../src/swap/pin.js";
import { requireSwapProtocol } from "../../src/swap/protocol-registry.js";
import { isOrcaKeylessMechanismDigest, ORCA_KEYLESS_MECHANISM_PIN, ORCA_KEYLESS_MECHANISM_PIN_SLOT_440170207, ORCA_KEYLESS_PROTOCOL_REGISTRY,
  ORCA_PROGRAM_PINS, PROGRAMDATA_CHUNK_BYTES, verifyOrcaProgramPins, WHIRLPOOL_PROGRAMDATA } from "../../src/swap/orca-solana/pins.js";
import { isOrcaStableGuardedMechanismDigest, orcaStableGuardedRegistryDigest, ORCA_PROTOCOL_REGISTRY, ORCA_PROTOCOL_REGISTRY_SLOT_440170207,
  ORCA_STABLE_GUARDED_MECHANISM_DIGEST, ORCA_STABLE_GUARDED_MECHANISM_PIN, ORCA_STABLE_GUARDED_MECHANISM_PIN_SLOT_440170207,
  ORCA_STABLE_MECHANISM_DIGEST, ORCA_STABLE_MECHANISM_PIN_SLOT_440170207 } from "../../src/swap/orca-solana/stable-mechanism.js";
import { fixture } from "../fixtures/jupiter-v1/material.js";
import { WHIRLPOOL_C422B2, whirlpoolC422b2ProgramData } from "../fixtures/whirlpool-runtime-c422b2/programdata.js";

const captured = fixture().semanticAccounts;
const previousProgramData = Buffer.from(captured.find((a) => a.address === WHIRLPOOL_PROGRAMDATA)!.dataBase64, "base64");
function reason(error: unknown): string { return error instanceof ApnError ? String(error.details?.reason ?? error.code) : String(error); }

/** Serves the six account pins from the earlier public capture and the given Whirlpool ProgramData bytes. */
function port(programData: Buffer, laterChunkOwner?: string) {
  const slices: number[] = [], plain: string[][] = [];
  const rpc: SolanaRpcPort = { originHash: "0".repeat(64), async call(method, params) {
    if (method !== "getMultipleAccounts") throw new Error(`Only account reads are allowed: ${method}`);
    const keys = params[0] as string[], slice = (params[1] as { dataSlice?: { offset: number; length: number } }).dataSlice;
    if (slice === undefined) plain.push(keys); else slices.push(slice.offset);
    return { context: { slot: 457_553_900 }, value: keys.map((key) => {
      const isProgramData = key === WHIRLPOOL_PROGRAMDATA, row = captured.find((a) => a.address === key);
      if (!isProgramData && row === undefined) return null;
      const data = isProgramData ? programData : Buffer.from(row!.dataBase64, "base64");
      const owner = isProgramData ? (slice !== undefined && slice.offset > 0 && laterChunkOwner !== undefined ? laterChunkOwner
        : "BPFLoaderUpgradeab1e11111111111111111111111") : row!.owner!;
      const bytes = slice === undefined ? data : data.subarray(slice.offset, slice.offset + slice.length);
      return { data: [bytes.toString("base64"), "base64"], executable: isProgramData ? false : row!.executable, lamports: 1, owner, rentEpoch: 0, space: data.length };
    }) };
  } };
  return { rpc, slices, plain };
}
function flipped(offset: number): Buffer { const d = whirlpoolC422b2ProgramData(); d[offset] = d[offset]! ^ 1; return d; }

test("the slot 457152296 capture passes every Orca program pin: one account read plus seven ProgramData chunks", async () => {
  const p = port(whirlpoolC422b2ProgramData());
  assert.equal(await verifyOrcaProgramPins(p.rpc), ORCA_PROGRAM_PINS);
  assert.deepEqual(p.plain, [ORCA_PROGRAM_PINS.filter((pin) => pin.scope === "account").map((pin) => pin.address)]);
  assert.deepEqual(p.slices, [0, 1, 2, 3, 4, 5, 6].map((i) => i * PROGRAMDATA_CHUNK_BYTES));
  const programData = ORCA_PROGRAM_PINS.filter((pin) => pin.address === WHIRLPOOL_PROGRAMDATA);
  assert.deepEqual(programData.map((pin) => [pin.role, pin.dataSha256]), [
    ["whirlpool_programdata_header", WHIRLPOOL_C422B2.headerHash], ["whirlpool_programdata_payload", WHIRLPOOL_C422B2.payloadHash]]);
});

test("the previous slot 440170207 bytes refuse at the header before the remaining chunks are read", async () => {
  assert.equal(previousProgramData.readBigUInt64LE(4), 440_170_207n);
  const p = port(previousProgramData);
  await assert.rejects(verifyOrcaProgramPins(p.rpc), (error) => reason(error) === "orca_program_pin_drift" &&
    /whirlpool_programdata_header/u.test((error as Error).message));
  assert.deepEqual(p.slices, [0]);
});

for (const [name, offset, role] of [["one executable bit", 45 + 1_000, "payload"], ["the last padding byte", WHIRLPOOL_C422B2.space - 1, "payload"],
  ["one byte in the final chunk", 6 * PROGRAMDATA_CHUNK_BYTES + 7, "payload"], ["the deployment slot", 4, "header"],
  ["the upgrade authority", 20, "header"]] as const)
  test(`changing ${name} refuses as Whirlpool ${role} drift`, async () => {
    await assert.rejects(verifyOrcaProgramPins(port(flipped(offset)).rpc), (error) => reason(error) === "orca_program_pin_drift" &&
      new RegExp(`whirlpool_programdata_${role}`, "u").test((error as Error).message));
  });

test("a ProgramData chunk under another owner refuses", async () => {
  await assert.rejects(verifyOrcaProgramPins(port(whirlpoolC422b2ProgramData(), "BPFLoader2111111111111111111111111111111111").rpc),
    (error) => reason(error) === "orca_program_pin_drift");
});

test("historical Orca identities keep their exact 0.5.40 digests; the slot 457152296 generation is new", () => {
  assert.equal(swapMechanismDigest(ORCA_KEYLESS_MECHANISM_PIN_SLOT_440170207), "7cef079e773ae2cc19e53714edce77873e2d1abb4acee3bf5af70f7090295928");
  assert.equal(swapMechanismDigest(ORCA_STABLE_MECHANISM_PIN_SLOT_440170207), "a64a464a26f017af9c57d7528e9baa95b3cb41322e7384e36b9beffd97e08095");
  assert.equal(swapMechanismDigest(ORCA_STABLE_GUARDED_MECHANISM_PIN_SLOT_440170207), "419bdd5d4a1f663ffa9c1a4b0e4dc5ff7428cb7f0882417ecb16c39115c5aefc");
  assert.equal(ORCA_PROTOCOL_REGISTRY_SLOT_440170207.registryDigest, "c1651aabba1e93ba2c5f0f30a59ebce0e6cdec75b90022e203f933ca3a7bef98");
  assert.equal(ORCA_KEYLESS_MECHANISM_PIN.protocolVersion, "whirlpool-slot-457152296");
  assert.equal(ORCA_STABLE_GUARDED_MECHANISM_PIN.protocolVersion, "whirlpool-stable-slot-457152296");
  const { protocolVersion: _a, ...current } = ORCA_KEYLESS_MECHANISM_PIN, { protocolVersion: _b, ...previous } = ORCA_KEYLESS_MECHANISM_PIN_SLOT_440170207;
  assert.deepEqual(current, previous);
  const fresh = [swapMechanismDigest(ORCA_KEYLESS_MECHANISM_PIN), ORCA_STABLE_MECHANISM_DIGEST, ORCA_STABLE_GUARDED_MECHANISM_DIGEST,
    ORCA_KEYLESS_PROTOCOL_REGISTRY.registryDigest, ORCA_PROTOCOL_REGISTRY.registryDigest];
  assert.deepEqual(fresh, ["3daa0909114ad86a7c4c95d17ddc9ecebbecd22e7b9b74452e3745500dc442cb",
    "27d5bdce74ccc5e9aa65df4ec3c596bdf4f9e202dd3444eb802835d57bb4764f", "f11383d8bb5344ca73f5af43c0640749d7bbb36344f43914ad3765684c7c2ce9",
    "a154c98d2b3c36b51bedeb90750b7e279b10f0f577189f50eb1c11533c4e76e5", "edd3f14d873a2e722923322a4137261441832afbab1eb3c66ae878f7d078ce49"]);
  for (const digest of fresh) assert.equal(["7cef079e773ae2cc19e53714edce77873e2d1abb4acee3bf5af70f7090295928",
    "a64a464a26f017af9c57d7528e9baa95b3cb41322e7384e36b9beffd97e08095", "419bdd5d4a1f663ffa9c1a4b0e4dc5ff7428cb7f0882417ecb16c39115c5aefc",
    "22a852572794017d6add9f306cb007a4a3b6fb8939bcf58f6f9b8c8a0a130c8d", "c1651aabba1e93ba2c5f0f30a59ebce0e6cdec75b90022e203f933ca3a7bef98"].includes(digest), false);
});

test("existing operations of either generation stay readable; only the current one pairs with the current registry", () => {
  const oldGuarded = swapMechanismDigest(ORCA_STABLE_GUARDED_MECHANISM_PIN_SLOT_440170207);
  assert.equal(isOrcaStableGuardedMechanismDigest(ORCA_STABLE_GUARDED_MECHANISM_DIGEST), true);
  assert.equal(isOrcaStableGuardedMechanismDigest(oldGuarded), true);
  assert.equal(isOrcaStableGuardedMechanismDigest(ORCA_STABLE_MECHANISM_DIGEST), false);
  assert.equal(orcaStableGuardedRegistryDigest(ORCA_STABLE_GUARDED_MECHANISM_DIGEST), ORCA_PROTOCOL_REGISTRY.registryDigest);
  assert.equal(orcaStableGuardedRegistryDigest(oldGuarded), ORCA_PROTOCOL_REGISTRY_SLOT_440170207.registryDigest);
  assert.equal(orcaStableGuardedRegistryDigest("0".repeat(64)), null);
  assert.equal(isOrcaKeylessMechanismDigest(swapMechanismDigest(ORCA_KEYLESS_MECHANISM_PIN)), true);
  assert.equal(isOrcaKeylessMechanismDigest(swapMechanismDigest(ORCA_KEYLESS_MECHANISM_PIN_SLOT_440170207)), true);
  assert.equal(isOrcaKeylessMechanismDigest(ORCA_STABLE_GUARDED_MECHANISM_DIGEST), false);
  // New preparation and owner admission resolve only through the current registries.
  assert.throws(() => requireSwapProtocol(ORCA_PROTOCOL_REGISTRY, oldGuarded), { code: "APN_OPERATION_BLOCKED" });
  assert.throws(() => requireSwapProtocol(ORCA_KEYLESS_PROTOCOL_REGISTRY, swapMechanismDigest(ORCA_KEYLESS_MECHANISM_PIN_SLOT_440170207)),
    { code: "APN_OPERATION_BLOCKED" });
  assert.equal(requireSwapProtocol(ORCA_PROTOCOL_REGISTRY_SLOT_440170207, oldGuarded).mechanismDigest, oldGuarded);
});
