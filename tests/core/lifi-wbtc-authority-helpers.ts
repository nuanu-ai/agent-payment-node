import { activateDirectPolicy, WIDE_CAPS } from "./direct-allowlist-helpers.js";
import { bridgeMechanism } from "../../src/lifi/allowlist.js";
import { LIFI_SYNTHETIC_SENDER } from "./lifi-helpers.js";
import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, encodeFunctionData, getAddress, type Hex } from "viem";
import { acrossBridgeAbi, feeForwarderAbi, FEE_RECIPIENT } from "../../src/lifi/abi.js";
import { hashObject } from "../../src/canonical.js";
import { bridgeDeployment } from "../../src/lifi/deployments.js";
import { bridgeRpcPhysicalPolicy } from "../../src/lifi/rpc-execution-budget.js";
import { guardBridgeEffect } from "../../src/lifi/economics.js";
import { BridgeRpcPhysicalBudget, RpcReadSession } from "../../src/lifi/rpc.js";
import type { BridgeEnvelope } from "../../src/lifi/model.js";
import { LifiTestProvider, lifiFixture, lifiSteps } from "./lifi-helpers.js";
import { addressWord } from "./lifi-event-fixtures.js";
import { temporaryState } from "./helpers.js";
import { ETH_WBTC, ARB_WBTC, wbtcBudgetSpy } from "./lifi-wbtc-budget-helpers.js";

export async function preparedWbtc(root: string, now: Date, policyExpiresAt?: string, allowance?: string) {
  const step = (await lifiSteps("eth-base", now))[0]!;
  const transform = (value: any): any => {
    if (Array.isArray(value)) return value.map(transform);
    if (value && typeof value === "object") {
      const result = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, transform(v)]));
      if (result.symbol === "USDC") Object.assign(result, { address: result.chainId === 1 ? ETH_WBTC : ARB_WBTC,
        chainId: result.chainId === 1 ? 1 : 42161, symbol: "WBTC", name: "Wrapped BTC", coinKey: "WBTC", decimals: 8 });
      return result;
    }
    if (value === 8453) return 42161;
    return ({ "10000000": "1000", "9975000": "998", "9970607": "991", "25000": "2", "997": "0", "3396": "7" } as Record<string, string>)[String(value)] ?? value;
  };
  const wbtc = transform(step), decoded = decodeFunctionData({ abi: acrossBridgeAbi, data: step.transactionRequest.data });
  const args = structuredClone(decoded.args) as unknown as any[];
  args[0].sendingAssetId = ETH_WBTC; args[0].minAmount = 998n; args[0].destinationChainId = 42161n;
  args[1][0].sendingAssetId = ETH_WBTC; args[1][0].receivingAssetId = ETH_WBTC; args[1][0].fromAmount = 1000n;
  args[1][0].callData = encodeFunctionData({ abi: feeForwarderAbi, functionName: "forwardERC20Fees", args: [ETH_WBTC, [{ recipient: FEE_RECIPIENT, amount: 2n }]] });
  args[2].sendingAssetId = addressWord(ETH_WBTC); args[2].receivingAssetId = addressWord(ARB_WBTC);
  args[2].outputAmount = 991n; args[2].outputAmountMultiplier = (991n * 10n ** 18n + 997n) / 998n;
  wbtc.transactionRequest.data = encodeFunctionData({ abi: acrossBridgeAbi, functionName: decoded.functionName, args: args as never });
  const f = await lifiFixture(root, "eth-base", { now, provider: new LifiTestProvider([wbtc], now) });
  for (const rpc of [f.source, f.destination]) {
    const original = rpc.deployment.bind(rpc);
    rpc.deployment = async (...args) => {
      const identity = await original(...args), contract = bridgeDeployment(rpc.chainId, args[1], args[0], args[2]);
      return { ...identity, contractHash: hashObject({ protocol: contract, feeContract: { code: [], reads: [] } }) };
    };
  }
  if (policyExpiresAt !== undefined) await activateDirectPolicy(root, f.profile, { now, expiresAt: policyExpiresAt, accounts: { evm: LIFI_SYNTHETIC_SENDER },
    admissions: [{ chain: "eip155:1", kind: "token", identifier: ETH_WBTC, rail: "bridge", ...WIDE_CAPS, mechanism: bridgeMechanism("across") }] });
  if (allowance !== undefined) f.source.allowance = allowance;
  const request = { ...f.request, minOutputAtomic: "980", maxRouteFeeAtomic: "20" };
  const quote = await f.core.execute({ command: "bridge.routes", profile: f.profile, request });
  assert.equal(quote.ok, true, JSON.stringify(quote.error));
  const prepared = await f.core.execute({ command: "bridge.prepare", profile: f.profile,
    quote: (quote.data as { quote_hash: string }).quote_hash, route: "route-across", idempotencyKey: "wbtc-budget-model" });
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  const op = (await f.core.bridges.records.findOperation((prepared.operation as { operation_id: string }).operation_id))!;
  f.source.op = op; f.destination.op = op;
  return { op, f };
}

