/** Read-only preparation of an unchecked NEAR/1Click Base source call. No execution imports. */
import { decodeFunctionResult, encodeFunctionData, getAddress, parseAbi, type Address, type Hex } from "viem";
import { canonicalJson, hashObject, sha256 } from "../canonical.js";
import { validateNonEvmBridgeOperation } from "./non-evm-operation.js";
import { inspectNearBaseTronQuoteOffline } from "./near-tron-offline.js";
import { preflightNearBaseTronSourceReadOnly, type NearTronPreflightPins, type NearTronReadOnlyRpc } from "./near-tron-preflight.js";
import { BRIDGE_DIAMOND, bridgeFailure, bridgeRecord } from "./validation.js";

const erc20 = parseAbi(["function balanceOf(address owner) view returns (uint256)", "function allowance(address owner,address spender) view returns (uint256)"]);
const UINT = /^(0|[1-9][0-9]*)$/u;
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u;
const HASH = /^[0-9a-f]{64}$/u;
function fail(reason: string): never { return bridgeFailure("APN_OPERATION_BLOCKED", `near_tron_prepare_${reason}`); }
function uint(value: unknown): bigint { if (typeof value !== "string" || !UINT.test(value)) fail("integer"); return BigInt(value); }
function quantity(value: unknown): bigint { if (typeof value !== "string" || !QUANTITY.test(value)) fail("rpc_quantity"); return BigInt(value); }
function time(value: string): bigint { const n = Date.parse(value); if (!Number.isFinite(n)) fail("draft_time"); return BigInt(Math.floor(n / 1000)); }

export interface NearTronSourcePreparationInput {
  /** Reloaded draft (repository load or equivalent); never a projection of its unchecked fields. */
  readonly draft: unknown;
  readonly quote: unknown;
  readonly pins: NearTronPreflightPins;
  readonly rpc: NearTronReadOnlyRpc;
}
export interface NearTronSourcePreparation {
  readonly kind: "read_only_near_tron_source_preparation";
  readonly executionAdmitted: false;
  readonly draftIntegrityHash: string;
  readonly quoteHash: string;
  readonly quoteId: Hex;
  readonly preflightBlockHash: Hex;
  readonly sourceCall: Readonly<{ chainId: 8453; from: Address; to: Address; valueAtomic: string; data: Hex; dataSha256: string;
    type: "eip1559"; nonceAtomic: string; gasLimitAtomic: string; maxFeePerGasAtomic: string;
    maxPriorityFeePerGasAtomic: string; accessList: readonly [] }>;
  readonly maxSourceNativeDebitWei: string;
  readonly preparationDigest: string;
}

/** Every RPC is injected, read-only and repeated against the exact quote immediately before the envelope is returned. */
export async function prepareNearTronBaseSourceReadOnly(input: NearTronSourcePreparationInput): Promise<NearTronSourcePreparation> {
  const draft = validateNonEvmBridgeOperation(input.draft);
  if (draft.route !== "base_usdc_to_tron_usdt_lifi_near_intents" || !HASH.test(input.pins.quoteSha256) ||
    draft.provider.quoteHash !== input.pins.quoteSha256 || sha256(canonicalJson(input.quote)) !== draft.provider.quoteHash) fail("quote_hash");
  // The quote hash uses canonical JSON, exactly as the existing preflight does.
  const binding = { sender: getAddress(draft.source.owner), tronRecipient: draft.destination.recipient,
    sourceAmountAtomic: draft.source.amountAtomic, maxFeeAtomic: draft.maxProviderFeeAtomic,
    minOutputAtomic: draft.destination.minimumReceivedAtomic };
  const inspection = inspectNearBaseTronQuoteOffline(input.quote, binding);
  const q = bridgeRecord(input.quote), tx = bridgeRecord(q.transactionRequest);
  if (draft.sourceCall.to !== inspection.transactionTarget || draft.sourceCall.from !== getAddress(tx.from as string) ||
    draft.sourceCall.valueAtomic !== "0" || draft.sourceCall.data !== tx.data ||
    draft.sourceCall.dataSha256 !== inspection.calldataSha256 || draft.provider.quoteId !== inspection.quoteId ||
    draft.provider.transactionId !== q.transactionId || draft.provider.depositAddress !== inspection.depositAddress ||
    draft.provider.routeId !== q.id || draft.provider.stepId !== bridgeRecord((q.includedSteps as unknown[])[1]).id ||
    BigInt(inspection.feeAmountAtomic) > uint(draft.maxProviderFeeAtomic)) fail("draft_quote_binding");
  const now = uint(input.pins.nowUnixSeconds);
  if (now >= time(draft.expiresAt) || now >= uint(inspection.deadline)) fail("expired");
  const proof = await preflightNearBaseTronSourceReadOnly(input.quote, binding, input.pins, input.rpc);
  if (proof.quoteSha256 !== draft.provider.quoteHash || proof.quoteId !== draft.provider.quoteId ||
    proof.calldataSha256 !== draft.sourceCall.dataSha256 || proof.simulation !== "success") fail("preflight_binding");
  const rpc = async (method: string, params: readonly unknown[]): Promise<unknown> => {
    try { return await input.rpc.request(method, params); } catch { return fail(`rpc_${method}`); }
  };
  const from = getAddress(draft.source.owner), token = getAddress(draft.source.token);
  const latest = quantity(await rpc("eth_getTransactionCount", [from, "latest"]));
  const pending = quantity(await rpc("eth_getTransactionCount", [from, "pending"]));
  if (latest !== pending) fail("pending_nonce");
  const balanceCall = encodeFunctionData({ abi: erc20, functionName: "balanceOf", args: [from] });
  const allowanceCall = encodeFunctionData({ abi: erc20, functionName: "allowance", args: [from, BRIDGE_DIAMOND] });
  const readToken = async (data: Hex, functionName: "balanceOf" | "allowance"): Promise<bigint> => {
    try { return decodeFunctionResult({ abi: erc20, functionName, data: await rpc("eth_call", [{ to: token, data }, proof.blockNumber]) as Hex }); }
    catch { return fail("token_state"); }
  };
  if (await readToken(balanceCall, "balanceOf") < uint(draft.source.amountAtomic)) fail("usdc_balance");
  if (await readToken(allowanceCall, "allowance") < uint(draft.source.amountAtomic)) fail("diamond_allowance");
  const gasLimit = quantity(tx.gasLimit);
  if (gasLimit <= 0n || gasLimit > 5_000_000n) fail("gas_limit");
  const estimated = quantity(await rpc("eth_estimateGas", [{ from, to: BRIDGE_DIAMOND, value: "0x0", data: draft.sourceCall.data }]));
  if (estimated > gasLimit) fail("gas_estimate");
  const head = bridgeRecord(await rpc("eth_getBlockByNumber", ["latest", false]));
  const baseFee = quantity(head.baseFeePerGas);
  const tip = quantity(await rpc("eth_maxPriorityFeePerGas", []));
  const maxFee = baseFee * 2n + tip;
  if (tip === 0n || maxFee <= tip) fail("fee");
  const cap = uint(draft.maxSourceNativeDebitWei), debit = gasLimit * maxFee;
  if (debit > cap || quantity(await rpc("eth_getBalance", [from, "latest"])) < debit) fail("native_balance_or_cap");
  if (quantity(await rpc("eth_getTransactionCount", [from, "pending"])) !== latest) fail("nonce_changed");
  const safeFinal = bridgeRecord(await rpc("eth_getBlockByNumber", [proof.blockNumber, false]));
  if (safeFinal.hash !== proof.blockHash) fail("safe_block_changed");
  const final = bridgeRecord(await rpc("eth_getBlockByNumber", ["latest", false]));
  if (head.hash !== final.hash || head.number !== final.number || head.timestamp !== final.timestamp ||
    quantity(head.timestamp) > now || now - quantity(head.timestamp) > BigInt(input.pins.maxSafeBlockAgeSeconds) ||
    now >= time(draft.expiresAt) || now >= uint(inspection.deadline)) fail("head_changed_or_expired");
  const sourceCall = Object.freeze({ chainId: 8453 as const, from, to: BRIDGE_DIAMOND, valueAtomic: "0", data: draft.sourceCall.data as Hex,
    dataSha256: inspection.calldataSha256, type: "eip1559" as const, nonceAtomic: latest.toString(), gasLimitAtomic: gasLimit.toString(),
    maxFeePerGasAtomic: maxFee.toString(), maxPriorityFeePerGasAtomic: tip.toString(), accessList: Object.freeze([]) as readonly [] });
  const body = { kind: "read_only_near_tron_source_preparation" as const, executionAdmitted: false as const,
    draftIntegrityHash: draft.integrityHash, quoteHash: proof.quoteSha256, quoteId: proof.quoteId,
    preflightBlockHash: proof.blockHash, sourceCall, maxSourceNativeDebitWei: cap.toString() };
  return Object.freeze({ ...body, preparationDigest: hashObject(body) });
}
