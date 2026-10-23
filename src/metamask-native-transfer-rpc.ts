import { performance } from "node:perf_hooks";
import { nativeDeadlineRemaining, type MetaMaskNativeDeadlineInput } from "./metamask-native-diagnostic.js";
import { getAddress, type Address } from "viem";
import { hashObject } from "./canonical.js";
import { ApnError } from "./errors.js";
import { evmUint } from "./evm-asset.js";
import { chainDisplay } from "./chain-policy.js";
import { directEvmRequiresSafeHead, evmNativeCurrencyLabel } from "./evm-direct-networks.js";
import { EvmRpc } from "./evm-rpc.js";
import { evmRpcAddress, evmRpcBlock, evmRpcHex, evmRpcQuantity, evmRpcRecord } from "./evm-rpc-codec.js";
import { decodeRelayBaseReceiptFee } from "./relay/source-fee-proof.js";
import type { EvmBalanceSnapshot } from "./evm-ports.js";
import { HttpsBaseRpc } from "./rpc.js";
import type { Hex } from "./model.js";
import { METAMASK_NATIVE_FEE_RECEIPT_SCHEMA, METAMASK_NATIVE_FEE_QUOTE_SCHEMA_V2, metaMaskNativeTransferData, metaMaskNativeUsdc,
  validateMetaMaskNativeFeeQuote, validateMetaMaskNativeFeeReceipt, type MetaMaskNativeFeeChainId,
  type MetaMaskNativeFeeQuote, type MetaMaskNativeFeeReceiptEvidence, type MetaMaskNativeFeeReceiptVerdict } from "./metamask-native-fee-evidence.js";

const ENVS = { 1: "APN_ETHEREUM_RPC_URL", 10: "APN_OPTIMISM_RPC_URL", 143: "APN_MONAD_RPC_URL", 59144: "APN_LINEA_RPC_URL", 1329: "APN_SEI_RPC_URL" } as const;
/** The OP-stack fee rule read from the receipt, as the Relay and LI.FI rails read it. */
const OP_RECEIPT_FEE_RULE = "receipt l1Fee + gasUsed * operatorFeeScalar * 100 + operatorFeeConstant";
export type MetaMaskNativeObservation =
  { readonly kind: "accepted"; readonly receipt: MetaMaskNativeFeeReceiptVerdict; readonly evidence: MetaMaskNativeFeeReceiptEvidence } |
  { readonly kind: "pending" | "inconclusive"; readonly reason: string };
export interface MetaMaskNativeQuoteInput {
  readonly chainId: MetaMaskNativeFeeChainId;
  readonly maximumNativeFeeWei: string;
  readonly sender: Address;
  readonly recipient: Address;
  readonly amountAtomic: string;
}
/** Funding read on one endpoint: the sender's native and USDC balances, and its pending nonce when asked for. */
export interface MetaMaskNativeFunding { readonly balances: EvmBalanceSnapshot; readonly nonceAtomic?: string }

function nativeChain(value: unknown): MetaMaskNativeFeeChainId {
  if (typeof value !== "number" || !(value in ENVS)) throw new ApnError("APN_INVALID_INPUT", "Chain is outside the MetaMask native transfer networks.");
  return value as MetaMaskNativeFeeChainId;
}
function productionEndpoint(chainId: MetaMaskNativeFeeChainId, options: {readonly totalDeadlineMs?:number;readonly abortSignal?:AbortSignal} = {}): HttpsBaseRpc {
  const endpoint = process.env[ENVS[nativeChain(chainId)]];
  if (!endpoint) throw new ApnError("APN_RPC_CONFIG", `${ENVS[chainId]} is required.`);
  const url = new URL(endpoint);
  if (url.search !== "" || url.hash !== "") throw new ApnError("APN_RPC_CONFIG", "RPC URL must have no query or fragment.");
  return new HttpsBaseRpc(endpoint, {totalDeadlineMs:performance.now()+120000,...options});
}
function productionRpc(chainId: MetaMaskNativeFeeChainId, options: {readonly totalDeadlineMs?:number;readonly abortSignal?:AbortSignal} = {}): EvmRpc {
  return productionEndpoint(chainId, options).evm;
}
/** Private read-only bounded transport. A timeout cannot authorize or launch a financial effect. */
async function deadlineRead<T>(chainId:MetaMaskNativeFeeChainId,deadline:MetaMaskNativeDeadlineInput|undefined,read:(rpc:EvmRpc)=>Promise<T>):Promise<T> {
  if(deadline===undefined)return await read(productionRpc(chainId));
  const budget=nativeDeadlineRemaining(deadline),controller=new AbortController();
  let timeout:ReturnType<typeof setTimeout>|undefined;
  try {
    return await Promise.race([read(productionRpc(chainId,{totalDeadlineMs:typeof deadline==="string"?performance.now()+budget:deadline.monotonicDeadlineMs,abortSignal:controller.signal})),new Promise<never>((_,reject)=>{
      timeout=setTimeout(()=>{controller.abort();reject(new ApnError("APN_RPC_AMBIGUOUS","Native transfer RPC deadline reached."));},budget);
    })]);
  } finally {if(timeout!==undefined)clearTimeout(timeout);controller.abort();}
}

/** The last pre-send read: balances and the pending nonce through one endpoint, so its chain id is proven once. */
export async function readMetaMaskNativeFunding(chainId: MetaMaskNativeFeeChainId, sender: Address, deadline: MetaMaskNativeDeadlineInput): Promise<Required<MetaMaskNativeFunding>> {
  return await deadlineRead(chainId, deadline, rpc => fundingWithRpc(rpc, chainId, getAddress(sender), true) as Promise<Required<MetaMaskNativeFunding>>);
}
export async function fundingWithRpc(rpc: EvmRpc, chainId: MetaMaskNativeFeeChainId, sender: Address, withNonce: boolean): Promise<MetaMaskNativeFunding> {
  const balances = await rpc.balance(sender, { chainId, token: metaMaskNativeUsdc(chainId), decimals: 6 });
  return withNonce ? { balances, nonceAtomic: await rpc.nonce(chainId, sender, "pending") } : { balances };
}

/** Quote and the sender's balances through one endpoint (one chain-id proof for the whole prepare). */
export async function prepareMetaMaskNativeQuote(input: MetaMaskNativeQuoteInput): Promise<{ readonly quote: MetaMaskNativeFeeQuote; readonly funding: MetaMaskNativeFunding }> {
  const rpc = productionRpc(input.chainId);
  const quote = await prepareWithRpc(rpc, input);
  return { quote, funding: await fundingWithRpc(rpc, quote.chainId, quote.sender, false) };
}

/** Test injection is the existing EvmRpc read-only transport, never a signing or payment callback. */
export async function prepareWithRpc(rpc: EvmRpc, input: MetaMaskNativeQuoteInput): Promise<MetaMaskNativeFeeQuote> {
  const sender = getAddress(input.sender), recipient = getAddress(input.recipient), amountAtomic = evmUint(input.amountAtomic, true).toString();
  const chainId = nativeChain(input.chainId), cap = evmUint(input.maximumNativeFeeWei, true).toString(), to = metaMaskNativeUsdc(chainId);
  const data = metaMaskNativeTransferData(recipient, amountAtomic);
  const nonceAtomic = await rpc.nonce(chainId, sender, "pending");
  const estimated = await rpc.estimate({ chainId, from: sender, to, data, valueAtomic: "0" });
  const economics = { nonceAtomic, ...estimated, maximumGasCostAtomic: (evmUint(estimated.gasLimitAtomic, true) * evmUint(estimated.maxFeePerGasAtomic, true)).toString() };
  const feeQuote = await rpc.feeQuote(chainId, economics);
  // A fresh quote above the owner's ceiling is a budget refusal before anything is prepared, not a damaged record (QA 0.5.71).
  if (evmUint(feeQuote.totalQuoteWei, true) > BigInt(cap)) throw new ApnError("APN_FEE_BUDGET_EXCEEDED",
    `The current network-fee quote (${chainDisplay(feeQuote.totalQuoteWei, 18)} ${evmNativeCurrencyLabel(chainId)}) exceeds the owner's native fee ceiling ` +
    `for this transfer (${chainDisplay(cap, 18)} ${evmNativeCurrencyLabel(chainId)}).`, { reason: "native_fee_quote_above_owner_cap", chain: `eip155:${chainId}`,
      native_symbol: evmNativeCurrencyLabel(chainId), quoted_fee_wei: feeQuote.totalQuoteWei, fee_cap_wei: cap });
  const body = { schemaVersion: METAMASK_NATIVE_FEE_QUOTE_SCHEMA_V2, chainId, sender, token: to, tokenDecimals: 6 as const,
    recipient, amountAtomic, nativeFeeCapAtomic: cap, transaction: { type: 2 as const, to, data, valueAtomic: "0" as const,
      nonceAtomic, gasLimitAtomic: estimated.gasLimitAtomic, maxFeePerGasAtomic: estimated.maxFeePerGasAtomic,
      maxPriorityFeePerGasAtomic: estimated.maxPriorityFeePerGasAtomic, authorizationList: [] as const }, feeQuote,
    expiresAt: new Date(Date.parse(feeQuote.observedAt) + 60000).toISOString() };
  return validateMetaMaskNativeFeeQuote({ ...body, quoteHash: hashObject(body) });
}
export async function observeMetaMaskNativeTransfer(quote: MetaMaskNativeFeeQuote, transactionHash: Hex): Promise<MetaMaskNativeObservation> {
  const endpoint = productionEndpoint(nativeChain(quote.chainId));
  return await observeWithRpc(endpoint.evm, endpoint.rpcOrigin, quote, transactionHash);
}

/**
 * One observation of the stored hash on one endpoint of the quote's chain (any endpoint: its eth_chainId binds it, and
 * its origin is recorded as provenance only). P2: the chain id once, the receipt once, the receipt's block by
 * number, the finality head and the transaction once. The receipt's block hash binds everything read with it; nothing
 * is re-read around it, and the quote's own block is not re-proven (it says nothing about the transfer). OP-stack:
 * the L1 data fee and the operator fee come from the receipt's own fields (P1, no state read at the receipt block), so
 * a non-archive node proves an old receipt too.
 */
export async function observeWithRpc(rpc: EvmRpc, rpcOrigin: string, quoteValue: MetaMaskNativeFeeQuote, transactionHash: Hex): Promise<MetaMaskNativeObservation> {
  // A mined receipt remains observable after quote TTL; TTL still gates preparing/submitting the frozen transaction.
  const quote = validateMetaMaskNativeFeeQuote(quoteValue, new Date(quoteValue.feeQuote.observedAt));
  const chainId = nativeChain(quote.chainId), hash = evmRpcHex(transactionHash, 32);
  if (hash === `0x${"0".repeat(64)}`) throw new ApnError("APN_INVALID_INPUT", "Transaction hash must be nonzero.");
  await rpc.assertChain(chainId);
  const call = (method: string, params: readonly unknown[]) => rpc.nativeFeeRead(method as Parameters<EvmRpc["nativeFeeRead"]>[0], params);
  const rawValue = await call("eth_getTransactionReceipt", [hash]);
  if (rawValue === null) return { kind: "pending", reason: "receipt_unavailable" };
  const raw = evmRpcRecord(rawValue), receipt = receiptFields(raw, hash);
  if (raw.gasUsed === undefined || raw.effectiveGasPrice === undefined) return { kind: "inconclusive", reason: "execution_fee_fields_unavailable" };
  const canonical = await evmRpcBlock(call, `0x${BigInt(receipt.blockNumberAtomic).toString(16)}`);
  if (canonical.hash !== receipt.blockHash) return { kind: "pending", reason: "receipt_block_not_canonical" };
  const head = await evmRpcBlock(call, directEvmRequiresSafeHead(chainId) ? "safe" : "latest");
  if (BigInt(head.number) < BigInt(receipt.blockNumberAtomic)) return { kind: "pending", reason: "receipt_not_covered_by_head" };
  const txValue = await call("eth_getTransactionByHash", [hash]);
  if (txValue === null) return { kind: "inconclusive", reason: "transaction_unavailable" };
  const tx = evmRpcRecord(txValue);
  if (evmRpcHex(tx.hash, 32) !== hash || evmRpcQuantity(tx.chainId) !== BigInt(chainId) || evmRpcHex(tx.blockHash, 32) !== receipt.blockHash ||
      evmRpcQuantity(tx.blockNumber).toString() !== receipt.blockNumberAtomic ||
      tx.authorizationList !== undefined && (!Array.isArray(tx.authorizationList) || tx.authorizationList.length !== 0)) {
    throw new ApnError("APN_RPC_PROTOCOL", "Mined transaction identity differs from receipt.");
  }
  let opStackFeeComponents: MetaMaskNativeFeeReceiptEvidence["opStackFeeComponents"];
  if (chainId === 10) {
    if (raw.l1Fee === undefined) return { kind: "inconclusive", reason: "op_l1_fee_unavailable" };
    // Absent operator fields are zero parameters; a scalar without its constant, or an operatorFee that contradicts them, is refused.
    let fee: ReturnType<typeof decodeRelayBaseReceiptFee>;
    try { fee = decodeRelayBaseReceiptFee(raw); }
    catch { throw new ApnError("APN_RPC_PROTOCOL", "OP-stack receipt fee fields are invalid.", { reason: "op_receipt_fee_fields" }); }
    opStackFeeComponents = { l1DataFeeAtomic: fee.l1FeeWei, operatorFeeAtomic: fee.operatorFeeWei,
      receiptExtensionHash: hashObject({ transactionHash: hash, blockHash: canonical.hash, rpcOrigin, rule: OP_RECEIPT_FEE_RULE,
        l1Fee: raw.l1Fee, operatorFeeScalar: raw.operatorFeeScalar ?? null, operatorFeeConstant: raw.operatorFeeConstant ?? null, operatorFee: raw.operatorFee ?? null }) };
  }
  const evidence: MetaMaskNativeFeeReceiptEvidence = { schemaVersion: METAMASK_NATIVE_FEE_RECEIPT_SCHEMA, quoteHash: quote.quoteHash,
    transactionHash: hash, chainId, sender: evmRpcAddress(tx.from), to: evmRpcAddress(tx.to), valueAtomic: evmRpcQuantity(tx.value).toString() as "0",
    transactionType: Number(evmRpcQuantity(tx.type)) as 2, nonceAtomic: evmRpcQuantity(tx.nonce).toString(), data: evmRpcHex(tx.input),
    gasLimitAtomic: evmRpcQuantity(tx.gas).toString(), maxFeePerGasAtomic: evmRpcQuantity(tx.maxFeePerGas).toString(),
    maxPriorityFeePerGasAtomic: evmRpcQuantity(tx.maxPriorityFeePerGas).toString(), authorizationList: [], status: receipt.status,
    gasUsedAtomic: evmRpcQuantity(raw.gasUsed).toString(), effectiveGasPriceAtomic: evmRpcQuantity(raw.effectiveGasPrice).toString(),
    receiptBlock: { numberAtomic: receipt.blockNumberAtomic, hash: receipt.blockHash }, canonicalBlock: { numberAtomic: canonical.number, hash: canonical.hash },
    ...(directEvmRequiresSafeHead(chainId) ? { safeHead: { numberAtomic: head.number, hash: head.hash } } : {}), logs: receipt.logs,
    rpcOrigin, observedAt: new Date().toISOString(), ...(opStackFeeComponents === undefined ? {} : { opStackFeeComponents }) };
  try { return { kind: "accepted", receipt: validateMetaMaskNativeFeeReceipt(evidence, quote), evidence }; }
  catch (error) { if (error instanceof ApnError && error.code === "APN_RPC_AMBIGUOUS") return { kind: "inconclusive", reason: String(error.details?.reason ?? "receipt_incomplete") }; throw error; }
}

/** The receipt's identity, status and logs, each log bound to this receipt exactly as the generic EVM reader binds it. */
function receiptFields(raw: Record<string, unknown>, hash: Hex) {
  const blockHash = evmRpcHex(raw.blockHash, 32), blockNumber = evmRpcQuantity(raw.blockNumber), status = evmRpcQuantity(raw.status);
  if (evmRpcHex(raw.transactionHash, 32) !== hash || blockHash === `0x${"0".repeat(64)}` || (status !== 0n && status !== 1n) ||
      !Array.isArray(raw.logs) || raw.logs.length > 256) throw new ApnError("APN_RPC_PROTOCOL", "Rich receipt identity mismatch.");
  const logs = raw.logs.map((value) => {
    const log = evmRpcRecord(value);
    if (!Array.isArray(log.topics) || log.topics.length > 4 || evmRpcHex(log.transactionHash, 32) !== hash || evmRpcHex(log.blockHash, 32) !== blockHash ||
        evmRpcQuantity(log.blockNumber) !== blockNumber || log.removed !== false || typeof log.data !== "string" || log.data.length > 131074) {
      throw new ApnError("APN_RPC_PROTOCOL", "EVM log does not belong to its canonical receipt.");
    }
    return { address: evmRpcAddress(log.address), topics: log.topics.map((topic) => evmRpcHex(topic, 32)), data: evmRpcHex(log.data) };
  });
  return { blockHash, blockNumberAtomic: blockNumber.toString(), status: status === 1n ? "success" as const : "reverted" as const, logs };
}
