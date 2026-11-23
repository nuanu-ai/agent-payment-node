import { decodeFunctionResult, encodeFunctionData, getAddress, parseAbi } from "viem";
import { canonicalJson, domainHash } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../../evm-rpc-codec.js";
import { parseAtomic } from "../../money.js";
import { swapMechanismDigest } from "../pin.js";
import { ETHEREUM_UNISWAP_TOKEN_LANE } from "./token-lane.js";
import { createUniswapTokenMaterial } from "./token-material.js";
import { verifyUniswapTokenRoutePins } from "./token-route.js";
import { tokenBatch, tokenBlock, tokenHex, tokenQuantity } from "./token-rpc.js";
const ERC20 = parseAbi(["function allowance(address owner,address spender) view returns (uint256)"]);
const QUOTER = parseAbi(["function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)"]);
/**
 * The token lane's quote of one chain: the lane's pinned route and router, its QuoterV2 and its pins, read at one block
 * of the lane's own RPC. A request of another lane's command family refuses before any read.
 */
export class UniswapTokenLaneQuoteBuilder {
    lane;
    call;
    store;
    admit;
    now;
    verifyPins;
    constructor(lane, call, store, admit, now, verifyPins) {
        this.lane = lane;
        this.call = call;
        this.store = store;
        this.admit = admit;
        this.now = now;
        this.verifyPins = verifyPins;
    }
    inventory() { return this.lane.inventory(); }
    async quote(input) {
        const lane = this.lane;
        if (input.command !== `${lane.requestFamily}.quote`)
            invalid(`This quote belongs to another lane than ${lane.commandPrefix}.`);
        const request = valid(input, lane), at = this.now(), seconds = Math.floor(at.getTime() / 1000);
        if (request.deadline <= seconds || request.deadline - seconds > 1800)
            invalid("Uniswap token deadline must be in the next 30 minutes.");
        const rpc = this.call, [chain, rawBlock] = await tokenBatch(rpc, "primary", [
            { method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: lane.chainDecoder },
            { method: "eth_getBlockByNumber", params: ["latest", false], cachePolicy: "none", decoder: tokenBlock },
        ]);
        if (evmRpcQuantity(chain) !== BigInt(lane.chainId))
            throw new ApnError("APN_CHAIN_MISMATCH", `Uniswap token route requires ${lane.chainLabel}.`);
        const block = decodedBlock(rawBlock);
        await this.verifyPins(this.call, block.tag);
        // The route the request names (its pool's output token and fee) is fixed before any quote read; its router is the spender.
        const route = request.route, policyDigest = await this.admit(input, at), allowanceData = encodeFunctionData({ abi: ERC20, functionName: "allowance", args: [request.account, route.router] });
        const quoteCall = encodeFunctionData({ abi: QUOTER, functionName: "quoteExactInputSingle", args: [{ tokenIn: route.inputToken,
                    tokenOut: route.outputToken, amountIn: request.amount, fee: route.fee, sqrtPriceLimitX96: 0n }] });
        const [rawAllowance, rawQuote] = await tokenBatch(rpc, "archive", [
            { method: "eth_call", params: [{ to: route.inputToken, data: allowanceData }, block.tag], cachePolicy: "snapshot", decoder: allowanceDecoder },
            { method: "eth_call", params: [{ to: lane.quoter, data: quoteCall }, block.tag], cachePolicy: "snapshot", decoder: quoteDecoder },
        ]);
        const allowance = decodeFunctionResult({ abi: ERC20, functionName: "allowance", data: evmRpcHex(rawAllowance, 32) });
        if (allowance !== 0n && allowance !== request.amount)
            blocked("Allowance must start at zero or the exact input amount.", "uniswap_allowance_mismatch");
        const [expected] = decodeFunctionResult({ abi: QUOTER, functionName: "quoteExactInputSingle", data: evmRpcHex(rawQuote) });
        if (expected < request.minimum)
            blocked("Quoted output is below the explicit minimum.", "uniswap_output_floor");
        const approval = lane.encodeApproval(route.inputToken, route.amountIn), approvalTx = { from: request.account, to: approval.to, data: approval.data, value: "0x0" }, swapTx = { from: request.account, to: route.router, data: route.calldata, value: "0x0" };
        let rechecked, rawBalance;
        if (allowance === 0n) {
            const [result] = await tokenBatch(rpc, "archive", [{ method: "eth_call", params: [approvalTx, block.tag], cachePolicy: "none", decoder: approvalDecoder }]);
            const approvalResult = evmRpcHex(result);
            if (approvalResult !== "0x" && approvalResult !== `0x${"0".repeat(63)}1`)
                blocked("Token approval simulation returned an unsafe result.", "uniswap_approval_simulation");
            [rawBalance, rechecked] = await tokenBatch(rpc, "primary", [
                { method: "eth_getBalance", params: [request.account, block.tag], cachePolicy: "snapshot", decoder: tokenQuantity },
                { method: "eth_getBlockByNumber", params: [block.tag, false], cachePolicy: "none", decoder: tokenBlock },
            ]);
        }
        else {
            await tokenBatch(rpc, "archive", [{ method: "eth_call", params: [swapTx, block.tag], cachePolicy: "none", decoder: tokenHex() }]);
            const [estimate, balanceValue, blockAgain] = await tokenBatch(rpc, "primary", [
                { method: "eth_estimateGas", params: [swapTx, block.tag], cachePolicy: "none", decoder: tokenQuantity },
                { method: "eth_getBalance", params: [request.account, block.tag], cachePolicy: "snapshot", decoder: tokenQuantity },
                { method: "eth_getBlockByNumber", params: [block.tag, false], cachePolicy: "none", decoder: tokenBlock },
            ]);
            if (evmRpcQuantity(estimate) > request.maxSwapGas)
                blocked("Exact transaction gas estimate exceeds the owner cap.", "uniswap_gas_cap");
            rawBalance = balanceValue;
            rechecked = blockAgain;
        }
        const balance = evmRpcQuantity(rawBalance);
        const required = (request.maxApprovalGas + request.maxSwapGas + request.maxCleanupGas) * request.maxFee;
        if (required > request.maxNativeDebit || balance < required)
            blocked("Native balance or debit cap does not cover approval, swap, and cleanup.", "uniswap_native_debit");
        if (decodedBlock(rechecked).hash !== block.hash)
            throw new ApnError("APN_RPC_PROTOCOL", "EVM block changed around pinned reads.");
        const material = createUniswapTokenMaterial({ profile: request.profile, account: request.account, route, expectedOutputAtomic: expected.toString(),
            approvalCapAtomic: request.amount.toString(), allowanceAtPrepare: allowance.toString(),
            approvalGas: gas(request.maxApprovalGas, request.maxFee, request.maxPriority), swapGas: gas(request.maxSwapGas, request.maxFee, request.maxPriority),
            cleanupGas: gas(request.maxCleanupGas, request.maxFee, request.maxPriority), maximumNativeDebitWei: request.maxNativeDebit.toString(),
            policyDigest, mechanismDigest: swapMechanismDigest(lane.mechanismPin), blockNumber: block.number, blockHash: block.hash,
            createdAt: at.toISOString() });
        await this.store.save(material);
        return { quoteHash: material.quoteHash, route, expectedOutputAtomic: material.expectedOutputAtomic,
            approval: { token: route.inputToken, spender: route.router, capAtomic: material.approvalCapAtomic, currentAllowanceAtomic: allowance.toString() },
            gas: { approval: material.approvalGas, swap: material.swapGas, cleanup: material.cleanupGas, maximumNativeDebitWei: material.maximumNativeDebitWei },
            simulation: { blockNumber: block.number, blockHash: block.hash, swap: allowance === request.amount ? "exact" : "staged_after_exact_approval" },
            policyDigest, mechanismDigest: material.mechanismDigest, signed: false, broadcast: false };
    }
}
/** The Ethereum token lane's quote builder: canonical USDC and USDT through the original SwapRouter. */
export class UniswapTokenQuoteBuilder extends UniswapTokenLaneQuoteBuilder {
    constructor(call, store, admit, now, verifyPins = verifyUniswapTokenRoutePins) {
        super(ETHEREUM_UNISWAP_TOKEN_LANE, call, store, admit, now, verifyPins);
    }
}
function allowanceDecoder(value) { decodeFunctionResult({ abi: ERC20, functionName: "allowance", data: evmRpcHex(value, 32) }); return value; }
function quoteDecoder(value) { decodeFunctionResult({ abi: QUOTER, functionName: "quoteExactInputSingle", data: evmRpcHex(value) }); return value; }
function approvalDecoder(value) {
    const result = evmRpcHex(value);
    if (result !== "0x" && result !== `0x${"0".repeat(63)}1`)
        throw new ApnError("APN_RPC_PROTOCOL", "Token approval simulation result is malformed.");
    return value;
}
function decodedBlock(value) {
    const raw = evmRpcRecord(value), number = evmRpcQuantity(raw.number), hash = evmRpcHex(raw.hash, 32);
    return { tag: `0x${number.toString(16)}`, number: number.toString(), hash, raw };
}
/**
 * The request's own route, created by its lane (the BNB lane also takes `native` as the output). A lane without a base
 * fee (BNB Smart Chain) refuses a zero priority fee cap here, before any read: a zero-price transaction never lands.
 */
function valid(input, lane) {
    const account = address(input.account), recipient = address(input.recipient), inputToken = address(input.sourceToken), outputToken = lane.chainId !== 1 && input.outputToken === "native" ? "native" : address(input.outputToken);
    const amount = uint(input.amountAtomic), minimum = uint(input.minimumOutputAtomic), cap = uint(input.approvalCapAtomic), maxApprovalGas = uint(input.maxApprovalGasLimit), maxSwapGas = uint(input.maxSwapGasLimit), maxCleanupGas = uint(input.maxCleanupGasLimit), maxFee = uint(input.maxFeePerGas), maxPriority = uint(input.maxPriorityFeePerGas, false), maxNativeDebit = uint(input.maxNativeDebitWei);
    if (cap !== amount || maxPriority > maxFee || maxApprovalGas > 30000000n || maxSwapGas > 30000000n || maxCleanupGas > 30000000n)
        invalid("Uniswap token caps are inconsistent.");
    const route = lane.createRoute({ inputToken, outputToken, recipient, amountIn: amount.toString(), amountOutMinimum: minimum.toString(), deadline: input.deadline });
    if (lane.refusesZeroGasPrice && maxPriority === 0n)
        blocked(`A zero priority fee is a zero gas price on ${lane.networkName}, which never lands; set a positive priority fee.`, "uniswap_zero_gas_price");
    return { profile: input.profile, account, recipient, inputToken, outputToken, amount, minimum, deadline: input.deadline,
        maxApprovalGas, maxSwapGas, maxCleanupGas, maxFee, maxPriority, maxNativeDebit, route };
}
function gas(gasLimit, maxFeePerGas, maxPriorityFeePerGas) { return { gasLimit: gasLimit.toString(), maxFeePerGas: maxFeePerGas.toString(), maxPriorityFeePerGas: maxPriorityFeePerGas.toString() }; }
function address(value) {
    try {
        const result = getAddress(value);
        if (result !== value)
            throw new Error();
        return result;
    }
    catch {
        return invalid("Uniswap token address is invalid.");
    }
}
function uint(value, positive = true) {
    try {
        return parseAtomic(value, { positive });
    }
    catch {
        return invalid("Uniswap token integer is invalid.");
    }
}
function invalid(message) { throw new ApnError("APN_INVALID_INPUT", message); }
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=token-builder.js.map