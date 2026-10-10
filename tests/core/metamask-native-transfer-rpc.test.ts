import test from "node:test";
import assert from "node:assert/strict";
import { toHex } from "viem";
import { EvmRpc } from "../../src/evm-rpc.js";
import { prepareWithRpc, observeWithRpc, METAMASK_NATIVE_FIXED_SENDER } from "../../src/metamask-native-transfer-rpc.js";
import type { MetaMaskNativeFeeChainId, MetaMaskNativeFeeQuote } from "../../src/metamask-native-fee-evidence.js";
import type { Hex } from "../../src/model.js";

const HASH = `0x${"a".repeat(64)}` as Hex, BLOCKHASH = `0x${"b".repeat(64)}` as Hex;
const topic = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
class Wire {
  quote?: MetaMaskNativeFeeQuote;
  pending = false; missingFee = false; missingL1 = false; oracleFail = false;
  wrongChain = false; reorg = false; unsafe = false; gasPrice = "0x2";
  mutateTx: Record<string, unknown> = {}; duplicate = false;
  methods: string[] = [];
  constructor(readonly chainId: MetaMaskNativeFeeChainId) {}
  block = (tag: unknown) => ({ number: this.unsafe && tag === "safe" ? "0x1" : "0x2", hash: this.reorg ? HASH : BLOCKHASH, baseFeePerGas: "0x1" });
  receipt() {
    if (this.pending) return null;
    const q = this.quote!;
    const log = { address: q.token, topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", topic(q.sender), topic(q.seller)], data: toHex(1000n, { size: 32 }),
      transactionHash: HASH, blockHash: BLOCKHASH, blockNumber: "0x2", removed: false };
    return { transactionHash: HASH, blockHash: BLOCKHASH, blockNumber: "0x2", status: "0x1", logs: this.duplicate ? [log,log] : [log],
      gasUsed: "0x32", ...this.missingFee ? {} : { effectiveGasPrice: this.gasPrice }, ...this.missingL1 ? {} : { l1Fee: "0x5" } };
  }
  call = async (method: string, params: readonly unknown[]) => {
    this.methods.push(method);
    switch (method) {
      case "eth_chainId": return toHex(this.wrongChain ? 8453 : this.chainId);
      case "eth_getTransactionCount": return "0x7";
      case "eth_estimateGas": return "0x64";
      case "eth_maxPriorityFeePerGas": return "0x1";
      case "eth_getBlockByNumber": return this.block(params[0]);
      case "eth_call": if (this.oracleFail) throw new Error("unavailable"); return toHex(5n,{size:32});
      case "eth_getTransactionReceipt": return this.receipt();
      case "eth_getTransactionByHash": {
        const q = this.quote!;
        return { hash: HASH, chainId: toHex(this.chainId), blockHash: BLOCKHASH, blockNumber: "0x2", from: q.sender, to:q.token,
          type:"0x2", value:"0x0", nonce:"0x7", gas:"0x64", maxFeePerGas:"0x3", maxPriorityFeePerGas:"0x1", input:q.transaction.data, ...this.mutateTx };
      }
      default: throw new Error(`Forbidden method ${method}`);
    }
  };
  rpc = () => new EvmRpc(this.call,"https://fixed.example");
  async prepare() { this.quote = await prepareWithRpc(this.rpc(), {chainId:this.chainId,maximumNativeFeeWei:"1000"}); return this.quote; }
  async observe() { return observeWithRpc(this.rpc(),this.quote!,HASH); }
}
for (const chainId of [1,10,143,59144,1329] as const) test(`rich source binds exact native transfer on chain ${chainId}`, async () => {
  const w = new Wire(chainId); const q = await w.prepare(); const r = await w.observe();
  assert.equal(q.sender,METAMASK_NATIVE_FIXED_SENDER); assert.equal(Date.parse(q.expiresAt)-Date.parse(q.feeQuote.observedAt),60000);
  assert.equal(r.kind,"accepted"); if (r.kind === "accepted") {
    assert.equal(r.receipt.transferAccepted,true); assert.equal(r.receipt.nativeFeeAtomic,chainId === 143 ? "200" : chainId === 10 ? "110" : "100");
    assert.equal(r.evidence.effectiveGasPriceAtomic,"2"); assert.equal(r.evidence.gasUsedAtomic,"50");
  }
  assert.ok(w.methods.every(m=>!m.includes("send") && !m.includes("sign")));
});
test("wrong chain and ceiling refuse before accepted quote", async () => {
  const w=new Wire(1);w.wrongChain=true;await assert.rejects(w.prepare(),{code:"APN_CHAIN_MISMATCH"});
  const x=new Wire(1);await assert.rejects(prepareWithRpc(x.rpc(),{chainId:1,maximumNativeFeeWei:"299"}),{code:"APN_STATE_CORRUPT"});
});
test("pending and missing execution or OP data never complete payment", async () => {
  for (const condition of ["pending","missingFee","missingL1","oracleFail"] as const) {
    const w=new Wire(condition === "missingL1" || condition === "oracleFail" ? 10 : 1);await w.prepare();w[condition]=true;
    const r=await w.observe();assert.equal(r.kind, condition === "pending" ? "pending" : "inconclusive");assert.equal("receipt" in r,false);
  }
});
test("exact payload, transaction type, fee bounds and authorizations cannot drift",async()=>{
  for (const mutateTx of [{chainId:"0x2105"},{type:"0x4"},{from:`0x${"d".repeat(40)}`},{to:`0x${"d".repeat(40)}`},{input:"0x"},{nonce:"0x8"},{gas:"0x65"},{value:"0x1"},{maxFeePerGas:"0x4"},{maxPriorityFeePerGas:"0x2"},{authorizationList:[{}]}]) {
    const w=new Wire(1);await w.prepare();w.mutateTx=mutateTx;await assert.rejects(w.observe());
  }
  const w=new Wire(1);await w.prepare();w.gasPrice="0x4";await assert.rejects(w.observe(),{code:"APN_STATE_CORRUPT"});
});
test("canonical reorg, unsafe head, duplicate Transfer and quote origin prevent acceptance",async()=>{
  const a=new Wire(1);await a.prepare();a.reorg=true;await assert.rejects(a.observe(),{code:"APN_RPC_PROTOCOL"});
  const b=new Wire(143);await b.prepare();b.unsafe=true;assert.equal((await b.observe()).kind,"pending");
  const c=new Wire(1);await c.prepare();c.duplicate=true;assert.equal((await c.observe()).kind,"inconclusive");
  const d=new Wire(1);await d.prepare();await assert.rejects(observeWithRpc(new EvmRpc(d.call,"https://other.example"),d.quote!,HASH),{code:"APN_RPC_PROTOCOL"});
});
test("read-only transport runtime allowlist rejects write methods",async()=>{
  const w=new Wire(1);
  await assert.rejects(w.rpc().nativeFeeRead("eth_sendRawTransaction" as never,[]),{code:"APN_INVALID_INPUT"});
  assert.equal(w.methods.length,0);
});
