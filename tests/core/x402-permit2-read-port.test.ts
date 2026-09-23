import assert from "node:assert/strict";
import test from "node:test";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { ApnError } from "../../src/errors.js";
import { createPermit2ProductionReadPort } from "../../src/x402-permit2/read-port.js";
import { X402_PERMIT2_ASSETS, X402_PERMIT2_MECHANISM } from "../../src/x402-permit2/registry.js";
import { activateDirectPolicy, revokeDirectPolicy } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";

const asset = X402_PERMIT2_ASSETS[0]!;
const payer = "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4" as const;
const instant = new Date("2026-09-23T04:00:00.000Z");
const request = { payer, chainId: 43114 as const, token: asset.token,
  challengeHash: "a".repeat(64), offerHash: "b".repeat(64), amountAtomic: "10000",
  nonceBitmapWordIndex: "0" };

function refusal(reason: string) {
  return (error: unknown) => error instanceof ApnError && error.details?.reason === reason;
}

test("production read port refuses without an authenticated active owner admission before any network read", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  let rpcCalls = 0, httpCalls = 0;
  const port = createPermit2ProductionReadPort({ profile: "owner", stateRoot: temp.root,
    localAccount: async () => payer, usage: new AssetUsageLedger(temp.root), now: () => instant,
    rpc: async () => { rpcCalls++; throw new Error("unexpected RPC"); },
    transport: { request: async () => { httpCalls++; throw new Error("unexpected HTTP"); } } });
  await assert.rejects(port.read(request), refusal("x402_permit2_owner_admission_required"));
  assert.equal(rpcCalls, 0); assert.equal(httpCalls, 0);
});

test("active rail pin, account, amount cap and revocation are enforced before RPC", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const active = async (mechanism: { readonly provider: string; readonly reference: string }, cap = "20000") =>
    await activateDirectPolicy(temp.root, "owner", { accounts: { evm: payer }, now: instant,
      admissions: [{ chain: asset.chain, kind: "token", identifier: asset.token, rail: "x402",
        maximumPerTransferAtomic: cap, dailyLimitAtomic: "30000", mechanism }] });
  const port = createPermit2ProductionReadPort({ profile: "owner", stateRoot: temp.root,
    localAccount: async () => payer, usage: new AssetUsageLedger(temp.root), now: () => instant,
    rpc: async () => { throw new Error("RPC must be gated by owner policy"); },
    transport: { request: async () => { throw new Error("HTTP must be gated by owner policy"); } } });
  await active({ provider: "other", reference: X402_PERMIT2_MECHANISM.reference });
  await assert.rejects(port.read(request), refusal("x402_permit2_owner_admission_required"));
  await active(X402_PERMIT2_MECHANISM, "9999");
  await assert.rejects(port.read(request), (error: unknown) => error instanceof ApnError && error.code === "APN_OPERATION_BLOCKED");
  await active(X402_PERMIT2_MECHANISM);
  await assert.rejects(port.read({ ...request, payer: "0x1111111111111111111111111111111111111111" }),
    refusal("x402_permit2_read_binding"));
  await revokeDirectPolicy(temp.root, "owner", instant);
  await assert.rejects(port.read(request), refusal("x402_permit2_owner_admission_required"));
});

test("finalized chain identity and freshness fail closed without facilitator or transaction calls", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  await activateDirectPolicy(temp.root, "owner", { accounts: { evm: payer }, now: instant,
    admissions: [{ chain: asset.chain, kind: "token", identifier: asset.token, rail: "x402",
      maximumPerTransferAtomic: "20000", dailyLimitAtomic: "30000", mechanism: X402_PERMIT2_MECHANISM }] });
  const calls: string[] = [];
  const port = createPermit2ProductionReadPort({ profile: "owner", stateRoot: temp.root,
    localAccount: async () => payer, usage: new AssetUsageLedger(temp.root), now: () => instant,
    rpc: async (method, params) => { calls.push(method);
      if (method === "eth_chainId") return "0xa86a";
      if (method === "eth_getBlockByNumber") { assert.equal(params[0], "finalized");
        return { number: "0x1", hash: `0x${"1".repeat(64)}`, timestamp: "0x1" }; }
      throw new Error(`Unexpected ${method}`);
    },
    transport: { request: async () => { throw new Error("Facilitator must not be called"); } } });
  await assert.rejects(port.read(request), refusal("x402_permit2_chain_evidence_required"));
  assert.deepEqual(calls, ["eth_chainId", "eth_getBlockByNumber"]);
});
