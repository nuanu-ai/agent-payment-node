/** Read-only preparation of an unchecked NEAR/1Click Base source call. No execution imports. */
import { decodeFunctionResult, encodeFunctionData, getAddress, parseAbi } from "viem";
import { canonicalJson, hashObject, sha256 } from "../canonical.js";
import { validateNonEvmBridgeOperation } from "./non-evm-operation.js";
import { inspectNearBaseTronQuoteOffline } from "./near-tron-offline.js";
import { preflightNearBaseTronSourceReadOnly } from "./near-tron-preflight.js";
import { BRIDGE_DIAMOND, bridgeFailure, bridgeRecord } from "./validation.js";
const erc20 = parseAbi(["function balanceOf(address owner) view returns (uint256)", "function allowance(address owner,address spender) view returns (uint256)"]);
const UINT = /^(0|[1-9][0-9]*)$/u;
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u;
const HASH = /^[0-9a-f]{64}$/u;
const MAX_UINT256 = (1n << 256n) - 1n;
function fail(reason) { return bridgeFailure("APN_OPERATION_BLOCKED", `near_tron_prepare_${reason}`); }
function uint(value) { if (typeof value !== "string" || !UINT.test(value))
    fail("integer"); const n = BigInt(value); if (n > MAX_UINT256)
    fail("integer_overflow"); return n; }
function quantity(value) { if (typeof value !== "string" || !QUANTITY.test(value))
    fail("rpc_quantity"); const n = BigInt(value); if (n > MAX_UINT256)
    fail("rpc_quantity_overflow"); return n; }
function time(value) { const n = Date.parse(value); if (!Number.isFinite(n))
    fail("draft_time"); return BigInt(Math.floor(n / 1000)); }
/** Every RPC is injected, read-only and repeated against the exact quote immediately before the envelope is returned. */
export async function prepareNearTronBaseSourceReadOnly(input) {
    const draft = validateNonEvmBridgeOperation(input.draft);
    if (draft.route !== "base_usdc_to_tron_usdt_lifi_near_intents" || !HASH.test(input.pins.quoteSha256) ||
        draft.provider.quoteHash !== input.pins.quoteSha256 || sha256(canonicalJson(input.quote)) !== draft.provider.quoteHash)
        fail("quote_hash");
    // The quote hash uses canonical JSON, exactly as the existing preflight does.
    const binding = { sender: getAddress(draft.source.owner), tronRecipient: draft.destination.recipient,
        sourceAmountAtomic: draft.source.amountAtomic, maxFeeAtomic: draft.maxProviderFeeAtomic,
        minOutputAtomic: draft.destination.minimumReceivedAtomic };
    const inspection = inspectNearBaseTronQuoteOffline(input.quote, binding);
    const q = bridgeRecord(input.quote), tx = bridgeRecord(q.transactionRequest);
    if (draft.sourceCall.to !== inspection.transactionTarget || draft.sourceCall.from !== getAddress(tx.from) ||
        draft.sourceCall.valueAtomic !== "0" || draft.sourceCall.data !== tx.data ||
        draft.sourceCall.dataSha256 !== inspection.calldataSha256 || draft.provider.quoteId !== inspection.quoteId ||
        draft.provider.transactionId !== q.transactionId || draft.provider.depositAddress !== inspection.depositAddress ||
        draft.provider.routeId !== q.id || draft.provider.stepId !== bridgeRecord(q.includedSteps[1]).id ||
        BigInt(inspection.feeAmountAtomic) > uint(draft.maxProviderFeeAtomic))
        fail("draft_quote_binding");
    const now = uint(input.pins.nowUnixSeconds);
    if (now >= time(draft.expiresAt) || now >= uint(inspection.deadline))
        fail("expired");
    const proof = await preflightNearBaseTronSourceReadOnly(input.quote, binding, input.pins, input.rpc);
    if (proof.quoteSha256 !== draft.provider.quoteHash || proof.quoteId !== draft.provider.quoteId ||
        proof.calldataSha256 !== draft.sourceCall.dataSha256 || proof.simulation !== "success")
        fail("preflight_binding");
    const rpc = async (method, params) => {
        try {
            return await input.rpc.request(method, params);
        }
        catch {
            return fail(`rpc_${method}`);
        }
    };
    const from = getAddress(draft.source.owner), token = getAddress(draft.source.token);
    const latest = quantity(await rpc("eth_getTransactionCount", [from, "latest"]));
    const pending = quantity(await rpc("eth_getTransactionCount", [from, "pending"]));
    if (latest !== pending)
        fail("pending_nonce");
    const balanceCall = encodeFunctionData({ abi: erc20, functionName: "balanceOf", args: [from] });
    const allowanceCall = encodeFunctionData({ abi: erc20, functionName: "allowance", args: [from, BRIDGE_DIAMOND] });
    const readToken = async (data, functionName) => {
        try {
            return decodeFunctionResult({ abi: erc20, functionName, data: await rpc("eth_call", [{ to: token, data }, proof.blockNumber]) });
        }
        catch {
            return fail("token_state");
        }
    };
    if (await readToken(balanceCall, "balanceOf") < uint(draft.source.amountAtomic))
        fail("usdc_balance");
    if (await readToken(allowanceCall, "allowance") < uint(draft.source.amountAtomic))
        fail("diamond_allowance");
    const gasLimit = quantity(tx.gasLimit);
    if (gasLimit <= 0n || gasLimit > 5000000n)
        fail("gas_limit");
    const estimated = quantity(await rpc("eth_estimateGas", [{ from, to: BRIDGE_DIAMOND, value: "0x0", data: draft.sourceCall.data }]));
    if (estimated === 0n || estimated > gasLimit)
        fail("gas_estimate");
    const head = bridgeRecord(await rpc("eth_getBlockByNumber", ["latest", false]));
    const baseFee = quantity(head.baseFeePerGas);
    const tip = quantity(await rpc("eth_maxPriorityFeePerGas", []));
    const maxFee = baseFee * 2n + tip;
    if (tip === 0n || maxFee <= tip || maxFee > MAX_UINT256)
        fail("fee");
    const cap = uint(draft.maxSourceNativeDebitWei), debit = gasLimit * maxFee;
    if (debit > MAX_UINT256 || debit > cap || quantity(await rpc("eth_getBalance", [from, "latest"])) < debit)
        fail("native_balance_or_cap");
    if (quantity(await rpc("eth_getTransactionCount", [from, "pending"])) !== latest)
        fail("nonce_changed");
    const safeFinal = bridgeRecord(await rpc("eth_getBlockByNumber", [proof.blockNumber, false]));
    if (safeFinal.hash !== proof.blockHash)
        fail("safe_block_changed");
    const final = bridgeRecord(await rpc("eth_getBlockByNumber", ["latest", false]));
    if (head.hash !== final.hash || head.number !== final.number || head.timestamp !== final.timestamp ||
        quantity(head.timestamp) > now || now - quantity(head.timestamp) > BigInt(input.pins.maxSafeBlockAgeSeconds) ||
        now >= time(draft.expiresAt) || now >= uint(inspection.deadline))
        fail("head_changed_or_expired");
    const sourceCall = Object.freeze({ chainId: 8453, from, to: BRIDGE_DIAMOND, valueAtomic: "0", data: draft.sourceCall.data,
        dataSha256: inspection.calldataSha256, type: "eip1559", nonceAtomic: latest.toString(), gasLimitAtomic: gasLimit.toString(),
        maxFeePerGasAtomic: maxFee.toString(), maxPriorityFeePerGasAtomic: tip.toString(), accessList: Object.freeze([]) });
    const body = { kind: "read_only_near_tron_source_preparation", executionAdmitted: false,
        evidenceTrust: "untrusted_quote_and_rpc",
        draftIntegrityHash: draft.integrityHash, quoteHash: proof.quoteSha256, quoteId: proof.quoteId,
        preflightBlockHash: proof.blockHash, sourceCall, maxSourceNativeDebitWei: cap.toString() };
    return Object.freeze({ ...body, preparationDigest: hashObject(body) });
}
//# sourceMappingURL=near-tron-source-preparation.js.map