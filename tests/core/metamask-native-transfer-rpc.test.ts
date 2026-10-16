import test from "node:test";
import assert from "node:assert/strict";
import { getAddress, toHex } from "viem";
import { EvmRpc } from "../../src/evm-rpc.js";
import { prepareWithRpc, observeWithRpc, fundingWithRpc } from "../../src/metamask-native-transfer-rpc.js";
import { metaMaskNativeQuoteTransfer, type MetaMaskNativeFeeChainId, type MetaMaskNativeFeeQuote } from "../../src/metamask-native-fee-evidence.js";
import type { Hex } from "../../src/model.js";

const HASH = `0x${"a".repeat(64)}` as Hex, BLOCKHASH = `0x${"b".repeat(64)}` as Hex, ORIGIN = "https://fixed.example";
const SENDER = getAddress("0x4444444444444444444444444444444444444444"), RECIPIENT = getAddress("0x5555555555555555555555555555555555555555");
const topic = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
class Wire {
  quote?: MetaMaskNativeFeeQuote;
  pending = false; missingFee = false; missingL1 = false; archive = true;
  /** OP receipt fee fields; operatorFeeConstant 5 gives the operator fee the oracle quoted, so totals are unchanged. */
  operatorFields: Record<string, string> = { operatorFeeScalar: "0x0", operatorFeeConstant: "0x5" };
  wrongChain = false; reorg = false; unsafe = false; gasPrice = "0x2";
  mutateTx: Record<string, unknown> = {}; duplicate = false;
  methods: string[] = [];
  constructor(readonly chainId: MetaMaskNativeFeeChainId) {}
  block = (tag: unknown) => ({ number: this.unsafe && tag === "safe" ? "0x1" : "0x2", hash: this.reorg && tag === "0x2" ? HASH : BLOCKHASH, baseFeePerGas: "0x1" });
  receipt() {
    if (this.pending) return null;
    const q = this.quote!, transfer = metaMaskNativeQuoteTransfer(q);
    const log = { address: q.token, topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", topic(q.sender), topic(transfer.recipient)],
      data: toHex(BigInt(transfer.amountAtomic), { size: 32 }), transactionHash: HASH, blockHash: BLOCKHASH, blockNumber: "0x2", removed: false };
    return { transactionHash: HASH, blockHash: BLOCKHASH, blockNumber: "0x2", status: "0x1", logs: this.duplicate ? [log,log] : [log],
      gasUsed: "0x32", ...this.missingFee ? {} : { effectiveGasPrice: this.gasPrice },
      ...this.chainId !== 10 ? {} : { ...this.missingL1 ? {} : { l1Fee: "0x5" }, ...this.operatorFields } };
  }
  call = async (method: string, params: readonly unknown[]) => {
    this.methods.push(method);
    switch (method) {
      case "eth_chainId": return toHex(this.wrongChain ? 8453 : this.chainId);
      case "eth_getTransactionCount": return "0x7";
      case "eth_estimateGas": return "0x64";
      case "eth_maxPriorityFeePerGas": return "0x1";
      case "eth_getBlockByNumber": return this.block(params[0]);
      case "eth_getBalance": return "0x100000";
      case "eth_getCode": return "0x6080";
      case "eth_call": {
        const data = (params[0] as { data: string }).data;
        if (data === "0x313ce567") return toHex(6n, { size: 32 });
        if (data.startsWith("0x70a08231")) return toHex(5000n, { size: 32 });
        // A pruned node refuses state at a past block; only the prepare-time oracle reads at the head are served.
        if (!this.archive) throw new Error("missing trie node");
        return toHex(5n, { size: 32 });
      }
      case "eth_getTransactionReceipt": return this.receipt();
      case "eth_getTransactionByHash": {
        const q = this.quote!;
        return { hash: HASH, chainId: toHex(this.chainId), blockHash: BLOCKHASH, blockNumber: "0x2", from: q.sender, to:q.token,
          type:"0x2", value:"0x0", nonce:"0x7", gas:"0x64", maxFeePerGas:"0x3", maxPriorityFeePerGas:"0x1", input:q.transaction.data, ...this.mutateTx };
      }
      default: throw new Error(`Forbidden method ${method}`);
    }
  };
  rpc = () => new EvmRpc(this.call, ORIGIN);
  async prepare() { this.quote = await prepareWithRpc(this.rpc(), { chainId: this.chainId, maximumNativeFeeWei: "1000", sender: SENDER, recipient: RECIPIENT, amountAtomic: "2500" }); return this.quote; }
  async observe() { return observeWithRpc(this.rpc(), ORIGIN, this.quote!, HASH); }
}
for (const chainId of [1,10,143,59144,1329] as const) test(`version 2 quote and one-pass observation bind the exact transfer on chain ${chainId}`, async () => {
  const w = new Wire(chainId); const q = await w.prepare();
  assert.equal(q.schemaVersion, "apn.metamask-native-fee-quote.v2"); assert.equal(q.sender, SENDER);
  assert.deepEqual(metaMaskNativeQuoteTransfer(q), { recipient: RECIPIENT, amountAtomic: "2500" });
  assert.equal(Date.parse(q.expiresAt)-Date.parse(q.feeQuote.observedAt),60000);
  // One chain-id proof, nonce, estimate, priority, head, fee head (+ two OP oracle reads).
  assert.equal(w.methods.length, chainId === 10 ? 8 : 6); assert.equal(w.methods.filter(m => m === "eth_chainId").length, 1);
  w.methods = [];
  const r = await w.observe();
  assert.equal(r.kind,"accepted"); if (r.kind === "accepted") {
    assert.equal(r.receipt.transferAccepted,true); assert.equal(r.receipt.nativeFeeAtomic,chainId === 143 ? "200" : chainId === 10 ? "110" : "100");
    assert.equal(r.evidence.effectiveGasPriceAtomic,"2"); assert.equal(r.evidence.gasUsedAtomic,"50"); assert.equal(r.evidence.rpcOrigin, ORIGIN);
  }
  // PROV-12: chain id, receipt, its block, the finality head and the transaction once each; was 13 (14 on OP).
  assert.deepEqual(w.methods, ["eth_chainId", "eth_getTransactionReceipt", "eth_getBlockByNumber", "eth_getBlockByNumber", "eth_getTransactionByHash"]);
  assert.ok(w.methods.every(m=>!m.includes("send") && !m.includes("sign")));
});
test("funding reads balances and the pending nonce on one endpoint with one chain-id proof", async () => {
  const w = new Wire(1), funding = await fundingWithRpc(w.rpc(), 1, SENDER, true);
  assert.equal(funding.nonceAtomic, "7"); assert.equal(funding.balances.assetAtomic, "5000"); assert.equal(funding.balances.nativeAtomic, String(0x100000));
  assert.deepEqual(w.methods, ["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getCode", "eth_call", "eth_call", "eth_getTransactionCount"]);
});
test("wrong chain and ceiling refuse before accepted quote", async () => {
  const w=new Wire(1);w.wrongChain=true;await assert.rejects(w.prepare(),{code:"APN_CHAIN_MISMATCH"});
  const x=new Wire(1);await assert.rejects(prepareWithRpc(x.rpc(),{chainId:1,maximumNativeFeeWei:"299",sender:SENDER,recipient:RECIPIENT,amountAtomic:"2500"}),{code:"APN_STATE_CORRUPT"});
});
test("pending and missing execution or OP data never complete payment", async () => {
  for (const condition of ["pending","missingFee","missingL1"] as const) {
    const w=new Wire(condition === "missingL1" ? 10 : 1);await w.prepare();w[condition]=true;
    const r=await w.observe();assert.equal(r.kind, condition === "pending" ? "pending" : "inconclusive");assert.equal("receipt" in r,false);
  }
});
test("the OP operator fee comes from the receipt's own fields, so a node without history proves the receipt", async () => {
  const w=new Wire(10);await w.prepare();w.archive=false;w.methods=[];
  const r=await w.observe();assert.equal(r.kind,"accepted");
  if(r.kind==="accepted"){assert.equal(r.receipt.nativeFeeAtomic,"110");assert.deepEqual([r.evidence.opStackFeeComponents?.l1DataFeeAtomic,r.evidence.opStackFeeComponents?.operatorFeeAtomic],["5","5"]);}
  assert.ok(!w.methods.includes("eth_call"));
  // Absent operator fields are zero parameters (pre-Isthmus receipts).
  const z=new Wire(10);await z.prepare();z.archive=false;z.operatorFields={};
  const zr=await z.observe();assert.equal(zr.kind,"accepted");if(zr.kind==="accepted")assert.equal(zr.receipt.nativeFeeAtomic,"105");
  // Jovian: gasUsed * scalar * 100 + constant; an operator fee above the quoted bound is refused, never settled.
  const j=new Wire(10);await j.prepare();j.operatorFields={operatorFeeScalar:"0x1",operatorFeeConstant:"0x0"};
  await assert.rejects(j.observe(),{code:"APN_STATE_CORRUPT"});
  for (const operatorFields of [{operatorFeeScalar:"0x0"},{operatorFeeScalar:"0x0",operatorFeeConstant:"0x5",operatorFee:"0x6"},{operatorFeeScalar:"0x100000000",operatorFeeConstant:"0x0"}]) {
    const b=new Wire(10);await b.prepare();b.operatorFields=operatorFields;
    await assert.rejects(b.observe(),(error:unknown)=>(error as {details?:{reason?:string}}).details?.reason==="op_receipt_fee_fields");
  }
});
test("exact payload, transaction type, fee bounds and authorizations cannot drift",async()=>{
  for (const mutateTx of [{chainId:"0x2105"},{type:"0x4"},{from:`0x${"d".repeat(40)}`},{to:`0x${"d".repeat(40)}`},{input:"0x"},{nonce:"0x8"},{gas:"0x65"},{value:"0x1"},{maxFeePerGas:"0x4"},{maxPriorityFeePerGas:"0x2"},{authorizationList:[{}]}]) {
    const w=new Wire(1);await w.prepare();w.mutateTx=mutateTx;await assert.rejects(w.observe());
  }
  const w=new Wire(1);await w.prepare();w.gasPrice="0x4";await assert.rejects(w.observe(),{code:"APN_STATE_CORRUPT"});
});
test("a non-canonical receipt block, unsafe head and duplicate Transfer prevent acceptance",async()=>{
  const a=new Wire(1);await a.prepare();a.reorg=true;assert.deepEqual(await a.observe(),{kind:"pending",reason:"receipt_block_not_canonical"});
  const b=new Wire(143);await b.prepare();b.unsafe=true;assert.equal((await b.observe()).kind,"pending");
  const c=new Wire(1);await c.prepare();c.duplicate=true;assert.equal((await c.observe()).kind,"inconclusive");
});
test("any endpoint of the quote's chain may observe; its origin is recorded as provenance; another chain is refused by eth_chainId",async()=>{
  const w=new Wire(1);await w.prepare();w.methods=[];
  const r=await observeWithRpc(new EvmRpc(w.call,"https://other.example"),"https://other.example",w.quote!,HASH);
  assert.equal(r.kind,"accepted");if(r.kind==="accepted"){assert.equal(r.evidence.rpcOrigin,"https://other.example");assert.equal(w.quote!.feeQuote.rpcOrigin,ORIGIN);}
  assert.equal(w.methods[0],"eth_chainId");
  const x=new Wire(1);await x.prepare();x.wrongChain=true;x.methods=[];
  await assert.rejects(observeWithRpc(new EvmRpc(x.call,"https://base.example"),"https://base.example",x.quote!,HASH),{code:"APN_CHAIN_MISMATCH"});
  assert.deepEqual(x.methods,["eth_chainId"]);
});
test("read-only transport runtime allowlist rejects write methods",async()=>{
  const w=new Wire(1);
  await assert.rejects(w.rpc().nativeFeeRead("eth_sendRawTransaction" as never,[]),{code:"APN_INVALID_INPUT"});
  assert.equal(w.methods.length,0);
});
test("the explicit payer binds nonce, estimate and the canonical receipt",async()=>{
  const w=new Wire(1);
  const captured: {method:string;params:readonly unknown[]}[]=[];
  const rpc=new EvmRpc(async(method,params)=>{captured.push({method,params});return w.call(method,params);},ORIGIN);
  w.quote=await prepareWithRpc(rpc,{chainId:1,maximumNativeFeeWei:"1000",sender:SENDER,recipient:RECIPIENT,amountAtomic:"2500"});
  assert.equal(captured.find(c=>c.method==="eth_getTransactionCount")?.params[0],SENDER);
  assert.equal((captured.find(c=>c.method==="eth_estimateGas")?.params[0] as {from:string}).from,SENDER);
  assert.equal((await w.observe()).kind,"accepted");
  w.mutateTx={from:"0xf41170df51aab52aaa04fbc3ff325cf051644aca"};await assert.rejects(w.observe());
});
