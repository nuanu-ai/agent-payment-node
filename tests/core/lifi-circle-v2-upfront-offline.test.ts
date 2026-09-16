import assert from "node:assert/strict";
import test from "node:test";
import { getBase58Encoder } from "@solana/kit";
import { encodeFunctionData, parseAbi } from "viem";
import { associatedUsdc } from "../../src/solana/accounts.js";
import { inspectCircleV2UpfrontOffline } from "../../src/lifi/circle-v2-upfront-offline.js";

const ABI = parseAbi([
  "function depositForBurnWithFees(uint256,uint32,bytes32,address,bytes32,(bytes signedQuote,address refundAddress)) payable",
  "function depositForBurnWithHookAndFees(uint256,uint32,bytes32,address,bytes32,bytes,(bytes signedQuote,address refundAddress)) payable",
]);
const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const wrapper = "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408";
const wallet = "95eqQDmQG7y8gad3yReqXqzyFoiQ4LYD9iAY1PMtuyRj";
const refundAddress = "0x000000000000000000000000000000000000dEaD";
const zero = `0x${"0".repeat(64)}`;
const signedQuote = "0x01020304";
async function fixture(setup: "existing_ata" | "create_ata" = "existing_ata") {
  const ata = await associatedUsdc(wallet);
  const recipient = `0x${Buffer.from(getBase58Encoder().encode(ata)).toString("hex")}`;
  const hook = `0x636374702d666f7277617264000000000000000000000000000000000000002101${Buffer.from(getBase58Encoder().encode(wallet)).toString("hex")}`;
  const withSetup = setup === "create_ata";
  const data = withSetup ? encodeFunctionData({ abi: ABI, functionName: "depositForBurnWithHookAndFees", args: [1_000_000n, 5, recipient as `0x${string}`, usdc, zero as `0x${string}`, hook as `0x${string}`, { signedQuote, refundAddress }] }) :
    encodeFunctionData({ abi: ABI, functionName: "depositForBurnWithFees", args: [1_000_000n, 5, recipient as `0x${string}`, usdc, zero as `0x${string}`, { signedQuote, refundAddress }] });
  return { quoteEndpoint: "https://iris-api.circle.com/v2/quote/burn/usdc/6/5", quoteRequest: { amount: "1000000", feeToken: usdc, requests: [{ type: "FORWARD", ...(withSetup ? { hookData: hook } : {}) }] },
    quoteResponse: { signedQuote, issuedAt: 1000, expiry: { mode: "BLOCK_NUMBER", expiresAtBlock: 100 }, feeTotalAmount: "20000", feeToken: usdc,
      items: [{ type: "FORWARD", amount: "20000", args: [], argsHash: `0x${"1".repeat(64)}` }], nonce: "0" },
    transaction: { to: wrapper, chainId: 8453, valueAtomic: "0", refundAddress, data },
    recipientWallet: wallet, amountAtomic: "1000000", maxSourceFeeAtomic: "25000", sourceBlockNumber: "99", recipientSetup: setup };
}
test("inspects the opaque quote and canonical default or setup burn calldata without admitting execution", async () => {
  for (const setup of ["existing_ata", "create_ata"] as const) {
    const result = await inspectCircleV2UpfrontOffline(await fixture(setup));
    assert.equal(result.executionAdmitted, false);
    assert.equal(result.recipientSetup, setup);
    assert.equal(result.quotedFeeAtomic, "20000");
    assert.ok(result.blockers.some(value => value.includes("authenticity")));
  }
});
test("rejects fee, route, recipient, expiry, and setup mutations", async () => {
  const mutate = async (change: (value: Awaited<ReturnType<typeof fixture>>) => void) => {
    const value = await fixture(); change(value);
    await assert.rejects(inspectCircleV2UpfrontOffline(value), { code: "APN_PROVIDER_PROTOCOL" });
  };
  await mutate(v => { v.quoteResponse.feeTotalAmount = "25001"; });
  await mutate(v => { v.quoteRequest.amount = "999999"; });
  await mutate(v => { v.quoteEndpoint = "https://iris-api.circle.com/v2/quote/burn/usdc/5/6"; });
  await mutate(v => { v.quoteResponse.expiry.expiresAtBlock = 99; });
  await mutate(v => { v.transaction.chainId = 1; });
  await mutate(v => { v.transaction.refundAddress = "0x0000000000000000000000000000000000000000"; });
  await mutate(v => { v.transaction.data = `0x00000000${v.transaction.data.slice(10)}`; });
  await mutate(v => { v.recipientWallet = "11111111111111111111111111111111"; });
  const setup = await fixture("create_ata");
  setup.quoteRequest.requests[0]!.hookData = "0x";
  await assert.rejects(inspectCircleV2UpfrontOffline(setup), { code: "APN_PROVIDER_PROTOCOL" });
});
