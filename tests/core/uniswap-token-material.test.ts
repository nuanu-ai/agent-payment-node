import assert from "node:assert/strict";
import test from "node:test";
import { createUniswapTokenMaterial, SavedUniswapTokenMaterialStore, validateUniswapTokenMaterial } from "../../src/swap/uniswap-v3/token-material.js";
import { createUniswapTokenRoute } from "../../src/swap/uniswap-v3/token-route.js";
import { ETHEREUM_USDT } from "../../src/swap/uniswap-v3/pins.js";
import { UNISWAP_USDC } from "../../src/swap/uniswap-pin.js";
import { temporaryState } from "./helpers.js";

const ACCOUNT = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7";
const H = (value: string) => value.repeat(64);

test("versioned token material round-trips and binds approval, all gas budgets, route, policy, and mechanism", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const route = createUniswapTokenRoute({ inputToken: UNISWAP_USDC, outputToken: ETHEREUM_USDT, recipient: ACCOUNT,
    amountIn: "1000000", amountOutMinimum: "999000", deadline: 1_800_000_000 });
  const gas = (gasLimit: string) => ({ gasLimit, maxFeePerGas: "2000000000", maxPriorityFeePerGas: "100000000" });
  const material = createUniswapTokenMaterial({ profile: "owner", account: ACCOUNT, route, expectedOutputAtomic: "1000100",
    approvalCapAtomic: "1000000", allowanceAtPrepare: "0", approvalGas: gas("80000"), swapGas: gas("200000"),
    cleanupGas: gas("80000"), maximumNativeDebitWei: "720000000000000", policyDigest: H("a"), mechanismDigest: H("b"),
    blockNumber: "26000000", blockHash: `0x${H("c")}`, createdAt: "2026-09-22T00:00:00.000Z" });
  const store = new SavedUniswapTokenMaterialStore(temporary.root); await store.save(material);
  assert.deepEqual(await store.load(material.quoteHash), material);
  assert.throws(() => validateUniswapTokenMaterial({ ...material, approvalCapAtomic: "1000001" }), { code: "APN_STATE_CORRUPT" });
  assert.throws(() => validateUniswapTokenMaterial({ ...material, maximumNativeDebitWei: "719999999999999" }), { code: "APN_STATE_CORRUPT" });
});
