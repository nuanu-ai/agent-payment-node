// Fake RPC over captured public bytes. No live read, signature, send or paid swap.
import assert from "node:assert/strict";
import test from "node:test";
import { address, getAddressEncoder } from "@solana/kit";
import { ApnError } from "../../src/errors.js";
import type { SolanaRpcPort } from "../../src/solana/rpc.js";
import { swapMechanismDigest } from "../../src/swap/pin.js";
import { requireSwapProtocol } from "../../src/swap/protocol-registry.js";
import { swapRouteDigest } from "../../src/swap/route-admission.js";
import { isOrcaKeylessMechanismDigest } from "../../src/swap/orca-solana/pools.js";
import { ATA_PROGRAM, ORCA_KEYLESS_MECHANISM_PIN, ORCA_KEYLESS_MECHANISM_PIN_SLOT_440170207,
  ORCA_KEYLESS_MECHANISM_PIN_SLOT_457152296, ORCA_KEYLESS_PROTOCOL_REGISTRY, ORCA_PROGRAM_AUTHORITIES, TOKEN_PROGRAMDATA, verifyOrcaProgramPins,
  WHIRLPOOL_PROGRAM, WHIRLPOOL_PROGRAMDATA } from "../../src/swap/orca-solana/pins.js";
import { isOrcaStableGuardedMechanismDigest, orcaStableGuardedRegistryDigest, ORCA_PROTOCOL_REGISTRY, ORCA_PROTOCOL_REGISTRY_SLOT_440170207,
  ORCA_PROTOCOL_REGISTRY_SLOT_457152296, ORCA_STABLE_GUARDED_MECHANISM_DIGEST, ORCA_STABLE_GUARDED_MECHANISM_PIN, ORCA_STABLE_GUARDED_MECHANISM_PIN_SLOT_440170207,
  ORCA_STABLE_GUARDED_MECHANISM_PIN_SLOT_457152296, ORCA_STABLE_MECHANISM_DIGEST, ORCA_STABLE_MECHANISM_PIN_SLOT_440170207,
  ORCA_STABLE_MECHANISM_PIN_SLOT_457152296 } from "../../src/legacy/orca-stable/mechanism.js";
import { fixture } from "../fixtures/jupiter-v1/material.js";
import { whirlpoolC422b2ProgramData } from "../fixtures/whirlpool-runtime-c422b2/programdata.js";

const captured = fixture().semanticAccounts;
const previousProgramData = Buffer.from(captured.find((a) => a.address === WHIRLPOOL_PROGRAMDATA)!.dataBase64, "base64");
function reason(error: unknown): string { return error instanceof ApnError ? String(error.details?.reason ?? error.code) : String(error); }

/** Serves the captured program accounts and the given Whirlpool ProgramData; `edit` rewrites one served account. */
function port(programData: Buffer, edit?: (key: string, data: Buffer) => { owner?: string; executable?: boolean } | void) {
  const calls: { keys: string[]; slice: unknown; bytes: number }[] = [];
  const rpc: SolanaRpcPort = { originHash: "0".repeat(64), async call(method, params) {
    if (method !== "getMultipleAccounts") throw new Error(`Only account reads are allowed: ${method}`);
    const keys = params[0] as string[], slice = (params[1] as { dataSlice?: { offset: number; length: number } }).dataSlice;
    const value = keys.map((key) => {
      const isProgramData = key === WHIRLPOOL_PROGRAMDATA, row = captured.find((a) => a.address === key);
      if (!isProgramData && row === undefined) return null;
      const data = Buffer.from(isProgramData ? programData : Buffer.from(row!.dataBase64, "base64")), patch = edit?.(key, data) ?? {};
      const bytes = slice === undefined ? data : data.subarray(slice.offset, slice.offset + slice.length);
      return { data: [bytes.toString("base64"), "base64"], executable: patch.executable ?? (isProgramData ? false : row!.executable), lamports: 1,
        owner: patch.owner ?? (isProgramData ? "BPFLoaderUpgradeab1e11111111111111111111111" : row!.owner!), rentEpoch: 0, space: data.length };
    });
    calls.push({ keys, slice, bytes: JSON.stringify(value).length });
    return { context: { slot: 457_553_900 }, value };
  } };
  return { rpc, calls };
}
const other = Buffer.from(getAddressEncoder().encode(address("11111111111111111111111111111112")));

test("one 45-byte read checks every Orca program; the slot 457152296 and 440170207 deployments by the same authority both pass", async () => {
  for (const [programData, slot] of [[whirlpoolC422b2ProgramData(), "457152296"], [previousProgramData, "440170207"]] as const) {
    const p = port(programData), seen = await verifyOrcaProgramPins(p.rpc);
    assert.equal(p.calls.length, 1); assert.deepEqual(p.calls[0]!.slice, { offset: 0, length: 45 });
    assert.deepEqual(p.calls[0]!.keys, [...ORCA_PROGRAM_AUTHORITIES.map((pin) => pin.programId), WHIRLPOOL_PROGRAMDATA, TOKEN_PROGRAMDATA]);
    assert.ok(p.calls[0]!.bytes < 2_000, `response bytes ${p.calls[0]!.bytes}`);
    const whirlpool = seen.find((row) => row.programId === WHIRLPOOL_PROGRAM)!;
    assert.deepEqual([whirlpool.deploymentSlot, whirlpool.upgradeAuthority], [slot, "GwH3Hiv5mACLX3ufTw1pFsrhSPon5tdw252DBs4Rx4PV"]);
    assert.equal(seen.find((row) => row.role === "spl_token_program")!.upgradeAuthority, null);
  }
});

for (const [label, edit, expected] of [
  ["another Whirlpool authority", (key: string, data: Buffer) => { if (key === WHIRLPOOL_PROGRAMDATA) other.copy(data, 13); }, "solana_program_authority_changed"],
  ["a removed Whirlpool authority", (key: string, data: Buffer) => { if (key === WHIRLPOOL_PROGRAMDATA) data[12] = 0; }, "solana_program_authority_changed"],
  ["a new SPL Token authority", (key: string, data: Buffer) => { if (key === TOKEN_PROGRAMDATA) { data[12] = 1; other.copy(data, 13); } }, "solana_program_authority_changed"],
  ["another ProgramData address", (key: string, data: Buffer) => { if (key === WHIRLPOOL_PROGRAM) other.copy(data, 4); }, "solana_program_identity_changed"],
  ["a non-ProgramData header", (key: string, data: Buffer) => { if (key === WHIRLPOOL_PROGRAMDATA) data.writeUInt32LE(2, 0); }, "solana_program_identity_changed"],
  ["an upgradeable ATA program", (key: string) => key === ATA_PROGRAM ? { owner: "BPFLoaderUpgradeab1e11111111111111111111111" } : undefined, "solana_program_identity_changed"],
  ["a non-executable Whirlpool program", (key: string) => key === WHIRLPOOL_PROGRAM ? { executable: false } : undefined, "solana_program_identity_changed"],
] as const) test(`${label} refuses`, async () => {
  await assert.rejects(verifyOrcaProgramPins(port(whirlpoolC422b2ProgramData(), edit).rpc), (error) => reason(error) === expected);
});

test("a changed deployment slot alone is accepted and reported", async () => {
  const seen = await verifyOrcaProgramPins(port(whirlpoolC422b2ProgramData(), (key, data) => {
    if (key === WHIRLPOOL_PROGRAMDATA) data.writeBigUInt64LE(470_000_000n, 4); }).rpc);
  assert.equal(seen.find((row) => row.programId === WHIRLPOOL_PROGRAM)!.deploymentSlot, "470000000");
});

test("historical Orca identities keep their exact 0.5.40 and 0.5.41 digests; the current ones name no deployment", () => {
  assert.equal(swapMechanismDigest(ORCA_KEYLESS_MECHANISM_PIN_SLOT_440170207), "7cef079e773ae2cc19e53714edce77873e2d1abb4acee3bf5af70f7090295928");
  assert.equal(swapMechanismDigest(ORCA_STABLE_MECHANISM_PIN_SLOT_440170207), "a64a464a26f017af9c57d7528e9baa95b3cb41322e7384e36b9beffd97e08095");
  assert.equal(swapMechanismDigest(ORCA_STABLE_GUARDED_MECHANISM_PIN_SLOT_440170207), "419bdd5d4a1f663ffa9c1a4b0e4dc5ff7428cb7f0882417ecb16c39115c5aefc");
  assert.equal(ORCA_PROTOCOL_REGISTRY_SLOT_440170207.registryDigest, "c1651aabba1e93ba2c5f0f30a59ebce0e6cdec75b90022e203f933ca3a7bef98");
  assert.deepEqual([swapMechanismDigest(ORCA_KEYLESS_MECHANISM_PIN_SLOT_457152296), swapMechanismDigest(ORCA_STABLE_MECHANISM_PIN_SLOT_457152296),
    swapMechanismDigest(ORCA_STABLE_GUARDED_MECHANISM_PIN_SLOT_457152296), ORCA_PROTOCOL_REGISTRY_SLOT_457152296.registryDigest],
  ["3daa0909114ad86a7c4c95d17ddc9ecebbecd22e7b9b74452e3745500dc442cb", "27d5bdce74ccc5e9aa65df4ec3c596bdf4f9e202dd3444eb802835d57bb4764f",
    "f11383d8bb5344ca73f5af43c0640749d7bbb36344f43914ad3765684c7c2ce9", "edd3f14d873a2e722923322a4137261441832afbab1eb3c66ae878f7d078ce49"]);
  assert.equal(ORCA_KEYLESS_MECHANISM_PIN.protocolVersion, "whirlpool-upgrade-authority.1");
  assert.equal(ORCA_STABLE_GUARDED_MECHANISM_PIN.protocolVersion, "whirlpool-stable-upgrade-authority.1");
  const { protocolVersion: _a, validationPolicyVersion: _b, ...current } = ORCA_KEYLESS_MECHANISM_PIN;
  const { protocolVersion: _c, validationPolicyVersion: _d, ...previous } = ORCA_KEYLESS_MECHANISM_PIN_SLOT_440170207;
  assert.deepEqual(current, previous);
  assert.equal(swapRouteDigest(ORCA_KEYLESS_MECHANISM_PIN), swapRouteDigest(ORCA_KEYLESS_MECHANISM_PIN_SLOT_457152296));
  assert.equal(swapRouteDigest(ORCA_STABLE_GUARDED_MECHANISM_PIN), swapRouteDigest(ORCA_STABLE_GUARDED_MECHANISM_PIN_SLOT_457152296));
  const fresh = [swapMechanismDigest(ORCA_KEYLESS_MECHANISM_PIN), ORCA_STABLE_MECHANISM_DIGEST, ORCA_STABLE_GUARDED_MECHANISM_DIGEST,
    ORCA_KEYLESS_PROTOCOL_REGISTRY.registryDigest, ORCA_PROTOCOL_REGISTRY.registryDigest];
  assert.deepEqual(fresh, ["bf55422e985eaa33dc1ee952e3d71dde28af0fc2092fb47041a8b5ffff5d6081", ORCA_STABLE_MECHANISM_DIGEST,
    "a2d7b04169a6a5f68f5625f5585490707fd1a414bdbc727292658d42dd1230ca", "83c4b5acac83b0a93a191f2fa8f7cd764660e4475a57ebfb1e4ebe7647e92d39",
    "ff6ffcc763c8644b778a1615626e3ef4c4b896289756a83a9a171672b7d06845"]);
  assert.equal(new Set(fresh).size, 5);
  for (const digest of fresh) assert.equal(["7cef079e773ae2cc19e53714edce77873e2d1abb4acee3bf5af70f7090295928", "3daa0909114ad86a7c4c95d17ddc9ecebbecd22e7b9b74452e3745500dc442cb",
    "a154c98d2b3c36b51bedeb90750b7e279b10f0f577189f50eb1c11533c4e76e5", "edd3f14d873a2e722923322a4137261441832afbab1eb3c66ae878f7d078ce49",
    "f11383d8bb5344ca73f5af43c0640749d7bbb36344f43914ad3765684c7c2ce9"].includes(digest), false);
});

test("existing operations of every generation stay readable; only the current one pairs with the current registry", () => {
  const generations = [[ORCA_STABLE_GUARDED_MECHANISM_PIN_SLOT_440170207, ORCA_PROTOCOL_REGISTRY_SLOT_440170207],
    [ORCA_STABLE_GUARDED_MECHANISM_PIN_SLOT_457152296, ORCA_PROTOCOL_REGISTRY_SLOT_457152296], [ORCA_STABLE_GUARDED_MECHANISM_PIN, ORCA_PROTOCOL_REGISTRY]] as const;
  for (const [pin, registry] of generations) {
    assert.equal(isOrcaStableGuardedMechanismDigest(swapMechanismDigest(pin)), true);
    assert.equal(orcaStableGuardedRegistryDigest(swapMechanismDigest(pin)), registry.registryDigest);
    assert.equal(requireSwapProtocol(registry, swapMechanismDigest(pin)).mechanismDigest, swapMechanismDigest(pin));
  }
  assert.equal(isOrcaStableGuardedMechanismDigest(ORCA_STABLE_MECHANISM_DIGEST), false);
  assert.equal(orcaStableGuardedRegistryDigest("0".repeat(64)), null);
  for (const pin of [ORCA_KEYLESS_MECHANISM_PIN, ORCA_KEYLESS_MECHANISM_PIN_SLOT_457152296, ORCA_KEYLESS_MECHANISM_PIN_SLOT_440170207])
    assert.equal(isOrcaKeylessMechanismDigest(swapMechanismDigest(pin)), true);
  assert.equal(isOrcaKeylessMechanismDigest(ORCA_STABLE_GUARDED_MECHANISM_DIGEST), false);
  // New preparation and owner admission resolve only through the current registries.
  for (const old of [ORCA_STABLE_GUARDED_MECHANISM_PIN_SLOT_440170207, ORCA_STABLE_GUARDED_MECHANISM_PIN_SLOT_457152296])
    assert.throws(() => requireSwapProtocol(ORCA_PROTOCOL_REGISTRY, swapMechanismDigest(old)), { code: "APN_OPERATION_BLOCKED" });
  for (const old of [ORCA_KEYLESS_MECHANISM_PIN_SLOT_440170207, ORCA_KEYLESS_MECHANISM_PIN_SLOT_457152296])
    assert.throws(() => requireSwapProtocol(ORCA_KEYLESS_PROTOCOL_REGISTRY, swapMechanismDigest(old)), { code: "APN_OPERATION_BLOCKED" });
});
