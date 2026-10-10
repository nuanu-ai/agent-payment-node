import { performance } from "node:perf_hooks";
import { nativeDeadlineRemaining } from "./metamask-native-diagnostic.js";
import { encodeFunctionData, getAddress } from "viem";
import { hashObject } from "./canonical.js";
import { ApnError } from "./errors.js";
import { evmUint } from "./evm-asset.js";
import { directEvmListRows, directEvmRequiresSafeHead } from "./evm-direct-networks.js";
import { EvmRpc } from "./evm-rpc.js";
import { evmRpcAddress, evmRpcBlock, evmRpcHex, evmRpcQuantity, evmRpcRecord, evmRpcWord, recheckEvmBlock } from "./evm-rpc-codec.js";
import type { EvmBalanceSnapshot } from "./evm-ports.js";
import { HttpsBaseRpc } from "./rpc.js";
import type { Hex } from "./model.js";
import { METAMASK_NATIVE_FEE_RECEIPT_SCHEMA, METAMASK_NATIVE_FEE_QUOTE_SCHEMA, METAMASK_NATIVE_FEE_SELLER,
  validateMetaMaskNativeFeeQuote, validateMetaMaskNativeFeeReceipt, type MetaMaskNativeFeeChainId,
  type MetaMaskNativeFeeQuote, type MetaMaskNativeFeeReceiptEvidence, type MetaMaskNativeFeeReceiptVerdict } from "./metamask-native-fee-evidence.js";

export const METAMASK_NATIVE_FIXED_SENDER = getAddress("0xf41170df51aab52aaa04fbc3ff325cf051644aca");
const ENVS = { 1: "APN_ETHEREUM_RPC_URL", 10: "APN_OPTIMISM_RPC_URL", 143: "APN_MONAD_RPC_URL", 59144: "APN_LINEA_RPC_URL", 1329: "APN_SEI_RPC_URL" } as const;
const TRANSFER = [{ type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }] as const;
const OP_ORACLE = "0x420000000000000000000000000000000000000F";
const OP_ABI = [{ type: "function", name: "getOperatorFee", stateMutability: "view", inputs: [{ name: "gas", type: "uint256" }], outputs: [{ type: "uint256" }] }] as const;
export type FixedMetaMaskNativeObservation =
  { readonly kind: "accepted"; readonly receipt: MetaMaskNativeFeeReceiptVerdict; readonly evidence: MetaMaskNativeFeeReceiptEvidence } |
  { readonly kind: "pending" | "inconclusive"; readonly reason: string };

function fixedChain(value: unknown): MetaMaskNativeFeeChainId {
  if (typeof value !== "number" || !(value in ENVS)) throw new ApnError("APN_INVALID_INPUT", "Chain is outside fixed native-fee scope.");
  return value as MetaMaskNativeFeeChainId;
}
function token(chainId: MetaMaskNativeFeeChainId) {
  const rows = directEvmListRows(chainId).filter(row => row.symbol === "USDC" && row.kind === "token" && row.decimals === 6);
  if (rows.length !== 1 || !rows[0]?.identifier) throw new ApnError("APN_RPC_CONFIG", "Canonical USDC entry unavailable.");
  return getAddress(rows[0].identifier);
}
function productionRpc(chainId: MetaMaskNativeFeeChainId, options: {readonly totalDeadlineMs?:number;readonly abortSignal?:AbortSignal} = {}): EvmRpc {
  const endpoint = process.env[ENVS[fixedChain(chainId)]];
  if (!endpoint) throw new ApnError("APN_RPC_CONFIG", `${ENVS[chainId]} is required.`);
  const url = new URL(endpoint);
  if (url.search !== "" || url.hash !== "") throw new ApnError("APN_RPC_CONFIG", "RPC URL must have no query or fragment.");
  return new HttpsBaseRpc(endpoint, {totalDeadlineMs:performance.now()+120000,...options}).evm;
}
/** Private read-only bounded transport. A timeout cannot authorize or launch a financial effect. */
async function deadlineRead<T>(chainId:MetaMaskNativeFeeChainId,deadline:string|undefined,read:(rpc:EvmRpc)=>Promise<T>):Promise<T> {
  if(deadline===undefined)return await read(productionRpc(chainId));
  const budget=nativeDeadlineRemaining(deadline),controller=new AbortController();
  let timeout:ReturnType<typeof setTimeout>|undefined;
  try {
    return await Promise.race([read(productionRpc(chainId,{totalDeadlineMs:performance.now()+budget,abortSignal:controller.signal})),new Promise<never>((_,reject)=>{
      timeout=setTimeout(()=>{controller.abort();reject(new ApnError("APN_RPC_AMBIGUOUS","Native transfer RPC deadline reached."));},budget);
    })]);
  } finally {if(timeout!==undefined)clearTimeout(timeout);controller.abort();}
}
/** Recheck the fixed owner's current pending nonce before a private signing handoff. */
export async function readFixedMetaMaskNativeNonce(chainId: MetaMaskNativeFeeChainId,deadline?:string): Promise<string> {
  return await deadlineRead(chainId,deadline,rpc=>rpc.nonce(fixedChain(chainId),METAMASK_NATIVE_FIXED_SENDER,"pending"));
}
export async function readFixedMetaMaskNativeBalances(chainId: MetaMaskNativeFeeChainId,deadline?:string): Promise<EvmBalanceSnapshot> {
  return await deadlineRead(chainId,deadline,rpc=>rpc.balance(METAMASK_NATIVE_FIXED_SENDER,{chainId,token:token(chainId),decimals:6}));
}
export async function prepareFixedMetaMaskNativeQuote(input: { readonly chainId: MetaMaskNativeFeeChainId; readonly maximumNativeFeeWei: string }): Promise<MetaMaskNativeFeeQuote> {
  return await prepareWithRpc(productionRpc(input.chainId), input);
}

/** Test injection is the existing EvmRpc read-only transport, never a signing or payment callback. */
export async function prepareWithRpc(rpc: EvmRpc, input: { readonly chainId: MetaMaskNativeFeeChainId; readonly maximumNativeFeeWei: string }): Promise<MetaMaskNativeFeeQuote> {
  const chainId = fixedChain(input.chainId), cap = evmUint(input.maximumNativeFeeWei, true).toString(), to = token(chainId);
  const data = encodeFunctionData({ abi: TRANSFER, functionName: "transfer", args: [getAddress(METAMASK_NATIVE_FEE_SELLER), 1000n] });
  const nonceAtomic = await rpc.nonce(chainId, METAMASK_NATIVE_FIXED_SENDER, "pending");
  const estimated = await rpc.estimate({ chainId, from: METAMASK_NATIVE_FIXED_SENDER, to, data, valueAtomic: "0" });
  const economics = { nonceAtomic, ...estimated, maximumGasCostAtomic: (evmUint(estimated.gasLimitAtomic, true) * evmUint(estimated.maxFeePerGasAtomic, true)).toString() };
  const feeQuote = await rpc.feeQuote(chainId, economics);
  const body = { schemaVersion: METAMASK_NATIVE_FEE_QUOTE_SCHEMA, chainId, sender: METAMASK_NATIVE_FIXED_SENDER, token: to,
    tokenDecimals: 6 as const, seller: METAMASK_NATIVE_FEE_SELLER, grossAtomic: "1000" as const, netAtomic: "1000" as const,
    tokenFeeAtomic: "0" as const, nativeFeeCapAtomic: cap, transaction: { type: 2 as const, to, data, valueAtomic: "0" as const,
      nonceAtomic, gasLimitAtomic: estimated.gasLimitAtomic, maxFeePerGasAtomic: estimated.maxFeePerGasAtomic,
      maxPriorityFeePerGasAtomic: estimated.maxPriorityFeePerGasAtomic, authorizationList: [] as const }, feeQuote,
    expiresAt: new Date(Date.parse(feeQuote.observedAt) + 60000).toISOString() };
  return validateMetaMaskNativeFeeQuote({ ...body, quoteHash: hashObject(body) });
}
export async function observeFixedMetaMaskNativeTransfer(quote: MetaMaskNativeFeeQuote, transactionHash: Hex): Promise<FixedMetaMaskNativeObservation> {
  const rpc = productionRpc(fixedChain(quote.chainId));
  return await observeWithRpc(rpc, quote, transactionHash);
}
export async function observeWithRpc(rpc: EvmRpc, quoteValue: MetaMaskNativeFeeQuote, transactionHash: Hex): Promise<FixedMetaMaskNativeObservation> {
  // A mined receipt remains observable after quote TTL; TTL still gates preparing/submitting the frozen transaction.
  const quote = validateMetaMaskNativeFeeQuote(quoteValue, new Date(quoteValue.feeQuote.observedAt));
  if (quote.sender !== METAMASK_NATIVE_FIXED_SENDER) throw new ApnError("APN_STATE_CORRUPT", "Quote sender differs from fixed owner.");
  const chainId = fixedChain(quote.chainId), hash = evmRpcHex(transactionHash, 32);
  if (hash === `0x${"0".repeat(64)}`) throw new ApnError("APN_INVALID_INPUT", "Transaction hash must be nonzero.");
  await rpc.assertChain(chainId);
  const call = (method: string, params: readonly unknown[]) => rpc.nativeFeeRead(method as Parameters<EvmRpc["nativeFeeRead"]>[0], params);
  const rawValue = await call("eth_getTransactionReceipt", [hash]);
  if (rawValue === null) { await rpc.assertChain(chainId); return { kind: "pending", reason: "receipt_unavailable" }; }
  const raw = evmRpcRecord(rawValue), rawHash = evmRpcHex(raw.transactionHash, 32), blockHash = evmRpcHex(raw.blockHash, 32), blockNumberAtomic = evmRpcQuantity(raw.blockNumber).toString();
  if (rawHash !== hash || blockHash === `0x${"0".repeat(64)}`) throw new ApnError("APN_RPC_PROTOCOL", "Rich receipt identity mismatch.");
  if (raw.gasUsed === undefined || raw.effectiveGasPrice === undefined) return { kind: "inconclusive", reason: "execution_fee_fields_unavailable" };
  const receipt = await rpc.receipt(chainId, hash);
  if (receipt === null) return { kind: "pending", reason: "receipt_changed" };
  // Compare full source envelopes before/after parsing, so rich quantities and logs cannot come from different receipts.
  if (!Array.isArray(raw.logs) || hashObject(raw.logs.map(value => {
    const log = evmRpcRecord(value);
    if (!Array.isArray(log.topics)) throw new ApnError("APN_RPC_PROTOCOL", "Malformed rich receipt log.");
    return { address: evmRpcAddress(log.address), topics: log.topics.map(topic => evmRpcHex(topic,32)), data: evmRpcHex(log.data) };
  })) !== hashObject(receipt.logs)) throw new ApnError("APN_RPC_PROTOCOL", "Receipt logs changed during parsing.");
  const reRead = await call("eth_getTransactionReceipt", [hash]);
  if (hashObject(rawValue) !== hashObject(reRead)) throw new ApnError("APN_RPC_PROTOCOL", "Rich receipt changed during observation.");
  if (receipt.rpcOrigin !== quote.feeQuote.rpcOrigin || receipt.blockHash !== blockHash || receipt.blockNumberAtomic !== blockNumberAtomic ||
      evmRpcQuantity(raw.status) !== (receipt.status === "success" ? 1n : 0n)) throw new ApnError("APN_RPC_PROTOCOL", "Receipt source differs from frozen quote.");
  const txValue = await call("eth_getTransactionByHash", [hash]);
  if (txValue === null) return { kind: "inconclusive", reason: "transaction_unavailable" };
  const tx = evmRpcRecord(txValue);
  if (evmRpcHex(tx.hash, 32) !== hash || evmRpcQuantity(tx.chainId) !== BigInt(chainId) || evmRpcHex(tx.blockHash, 32) !== blockHash ||
      evmRpcQuantity(tx.blockNumber).toString() !== blockNumberAtomic ||
      tx.authorizationList !== undefined && (!Array.isArray(tx.authorizationList) || tx.authorizationList.length !== 0)) {
    throw new ApnError("APN_RPC_PROTOCOL", "Mined transaction identity differs from receipt.");
  }
  const quotedBlock = await evmRpcBlock(call, `0x${BigInt(quote.feeQuote.blockNumberAtomic).toString(16)}`);
  if (quotedBlock.hash !== quote.feeQuote.blockHash) throw new ApnError("APN_RPC_PROTOCOL", "Quoted block is no longer canonical.");
  const canonical = await evmRpcBlock(call, `0x${BigInt(blockNumberAtomic).toString(16)}`);
  const head = await evmRpcBlock(call, directEvmRequiresSafeHead(chainId) ? "safe" : "latest");
  if (BigInt(head.number) < BigInt(blockNumberAtomic)) return { kind: "pending", reason: "receipt_not_covered_by_head" };
  let opStackFeeComponents: MetaMaskNativeFeeReceiptEvidence["opStackFeeComponents"];
  if (chainId === 10) {
    if (raw.l1Fee === undefined) return { kind: "inconclusive", reason: "op_l1_fee_unavailable" };
    const data = encodeFunctionData({ abi: OP_ABI, functionName: "getOperatorFee", args: [evmRpcQuantity(raw.gasUsed)] });
    let operatorRaw: unknown;
    try { operatorRaw = await call("eth_call", [{ to: OP_ORACLE, data }, canonical.tag]); }
    catch { return { kind: "inconclusive", reason: "op_operator_fee_unavailable" }; }
    opStackFeeComponents = { l1DataFeeAtomic: evmRpcQuantity(raw.l1Fee).toString(), operatorFeeAtomic: evmRpcWord(operatorRaw).toString(),
      receiptExtensionHash: hashObject({ transactionHash: hash, blockHash: canonical.hash, rpcOrigin: receipt.rpcOrigin,
        l1Fee: raw.l1Fee, oracle: OP_ORACLE, data, result: operatorRaw }) };
  }
  const evidence: MetaMaskNativeFeeReceiptEvidence = { schemaVersion: METAMASK_NATIVE_FEE_RECEIPT_SCHEMA, quoteHash: quote.quoteHash,
    transactionHash: hash, chainId, sender: evmRpcAddress(tx.from), to: evmRpcAddress(tx.to), valueAtomic: evmRpcQuantity(tx.value).toString() as "0",
    transactionType: Number(evmRpcQuantity(tx.type)) as 2, nonceAtomic: evmRpcQuantity(tx.nonce).toString(), data: evmRpcHex(tx.input),
    gasLimitAtomic: evmRpcQuantity(tx.gas).toString(), maxFeePerGasAtomic: evmRpcQuantity(tx.maxFeePerGas).toString(),
    maxPriorityFeePerGasAtomic: evmRpcQuantity(tx.maxPriorityFeePerGas).toString(), authorizationList: [], status: receipt.status,
    gasUsedAtomic: evmRpcQuantity(raw.gasUsed).toString(), effectiveGasPriceAtomic: evmRpcQuantity(raw.effectiveGasPrice).toString(),
    receiptBlock: { numberAtomic: blockNumberAtomic, hash: blockHash }, canonicalBlock: { numberAtomic: canonical.number, hash: canonical.hash },
    ...(directEvmRequiresSafeHead(chainId) ? { safeHead: { numberAtomic: head.number, hash: head.hash } } : {}), logs: receipt.logs,
    rpcOrigin: receipt.rpcOrigin, observedAt: new Date().toISOString(), ...(opStackFeeComponents === undefined ? {} : { opStackFeeComponents }) };
  await recheckEvmBlock(call, canonical); await recheckEvmBlock(call, quotedBlock); await recheckEvmBlock(call, head);
  if (hashObject(txValue) !== hashObject(await call("eth_getTransactionByHash", [hash])) ||
      hashObject(rawValue) !== hashObject(await call("eth_getTransactionReceipt", [hash]))) throw new ApnError("APN_RPC_PROTOCOL", "Transaction or receipt changed around anchors.");
  await rpc.assertChain(chainId);
  try { return { kind: "accepted", receipt: validateMetaMaskNativeFeeReceipt(evidence, quote), evidence }; }
  catch (error) { if (error instanceof ApnError && error.code === "APN_RPC_AMBIGUOUS") return { kind: "inconclusive", reason: String(error.details?.reason ?? "receipt_incomplete") }; throw error; }
}
