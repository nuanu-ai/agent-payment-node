import assert from "node:assert/strict";
import test from "node:test";
import { getAddress } from "viem";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { StateStore } from "../../src/state.js";
import { STARGATE_NATIVE_MECHANISM } from "../../src/stargate-v2/native-record.js";
import { StargateNativeUsage } from "../../src/stargate-v2/native-usage.js";
import { STARGATE_TOKEN_MECHANISM, STARGATE_TOKEN_SOURCE_TOKEN } from "../../src/stargate-v2/token-execution.js";
import { StargateTokenService } from "../../src/stargate-v2/token-runtime.js";
import { activateDirectPolicy } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";

const OWNER = getAddress("0x1111111111111111111111111111111111111111");
const OTHER = getAddress("0x5555555555555555555555555555555555555555");
const NOW = new Date("2026-09-20T10:00:00.000Z");
const pinned = (error: any) => error.code === "APN_ALLOWLIST_REFUSED" && error.details?.reason === "allowlist_recipient_not_admitted";

// Both Stargate lanes pay only the owner, yet the owner's recipient pin still decides: a pin without the owner refuses.
test("Stargate native: a recipient pin without the owner refuses at prepare and at the hold, one with the owner admits", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const admission = (recipients: string[]) => ({ chain: "eip155:1", kind: "native" as const, rail: "bridge" as const,
    maximumPerTransferAtomic: "150", dailyLimitAtomic: "150", mechanism: STARGATE_NATIVE_MECHANISM, recipients });
  await activateDirectPolicy(temporary.root, "owner", { accounts: { evm: OWNER }, admissions: [admission([OTHER])], now: NOW });
  const state = new StateStore(temporary.root); await state.initialize(); const usage = new StargateNativeUsage(state, () => NOW.getTime());
  await assert.rejects(usage.admitPolicy({ profile: "owner", owner: OWNER, recipient: OWNER, amountAtomic: "100" }), pinned);
  await activateDirectPolicy(temporary.root, "owner", { accounts: { evm: OWNER }, admissions: [admission([OTHER, OWNER])], now: NOW });
  const policy = await usage.admitPolicy({ profile: "owner", owner: OWNER, recipient: OWNER, amountAtomic: "100" });
  const op = { operationId: "1".repeat(64), profile: "owner", owner: OWNER, recipient: OWNER, amountAtomic: "100", policy, integrityHash: "b".repeat(64) } as any;
  await usage.reserve(op); await usage.reserve(op);
  // A record whose recipient the pin does not list never takes (or re-confirms) a hold.
  await assert.rejects(usage.reserve({ ...op, operationId: "2".repeat(64), amountAtomic: "40", recipient: getAddress("0x6666666666666666666666666666666666666666") }), pinned);
  await assert.rejects(usage.reserve({ ...op, recipient: getAddress("0x6666666666666666666666666666666666666666") }), pinned);
  const identity = { account: OWNER, chain: "eip155:1", asset: { kind: "native" as const, identifier: null } };
  assert.equal((await new AssetUsageLedger(temporary.root).usage(identity, NOW)).amountAtomic, "100");
});

async function tokenPorts(root: string) {
  const state = new StateStore(root); await state.initialize();
  const service = new StargateTokenService(state, {} as any,
    { APN_OPTIMISM_RPC_URL: "https://optimism.example", APN_POLYGON_RPC_URL: "https://polygon.example" }, () => NOW.getTime());
  (service as any).local = { port: async () => ({ kind: "imported_evm_signer", address: OWNER, signTransaction: async () => "0x" }), identity: async () => ({ profile: "owner", address: OWNER }) };
  (service as any).source = { call: async () => { throw new Error("unused"); } };
  (service as any).destination = { call: async () => { throw new Error("unused"); } };
  return await (service as any).ports("owner", OWNER);
}

test("Stargate token: a recipient pin applies at prepare, approval and the hold", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const admission = (recipients: string[]) => ({ chain: "eip155:10", kind: "token" as const, identifier: STARGATE_TOKEN_SOURCE_TOKEN,
    rail: "bridge" as const, maximumPerTransferAtomic: "150", dailyLimitAtomic: "150", mechanism: STARGATE_TOKEN_MECHANISM, recipients });
  await activateDirectPolicy(temporary.root, "owner", { accounts: { evm: OWNER }, admissions: [admission([OTHER])], now: NOW });
  const ports = await tokenPorts(temporary.root), base = { profile: "owner", owner: OWNER, recipient: OWNER, amountAtomic: "100", operationId: "a".repeat(64) };
  await assert.rejects(ports.admitPolicy(base), pinned);
  await activateDirectPolicy(temporary.root, "owner", { accounts: { evm: OWNER }, admissions: [admission([OWNER])], now: NOW });
  const binding = await ports.admitPolicy(base), operation = { ...base, policy: binding, integrityHash: "b".repeat(64) } as any;
  await ports.confirmPolicy(operation); await ports.reserveUsage(operation);
  const stray = { ...operation, amountAtomic: "40", recipient: OTHER };
  await assert.rejects(ports.confirmPolicy(stray), pinned); await assert.rejects(ports.reserveUsage({ ...stray, operationId: "c".repeat(64) }), pinned);
});
