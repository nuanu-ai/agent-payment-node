import { decodeFunctionResult, encodeFunctionData, getAddress, parseAbi, type Hex } from "viem";
import { canonicalJson, domainHash } from "../../canonical.js";
import type { CommandRequest } from "../../commands.js";
import { ApnError } from "../../errors.js";
import type { EvmRpcCall } from "../../evm-ports.js";
import { evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../../evm-rpc-codec.js";
import { parseAtomic } from "../../money.js";
import { swapMechanismDigest } from "../pin.js";
import { UNISWAP_V3_QUOTER_V2 } from "./pins.js";
import { createUniswapTokenMaterial, type SavedUniswapTokenMaterialStore } from "./token-material.js";
import { createUniswapTokenRoute, encodeUniswapTokenApproval, UNISWAP_TOKEN_MECHANISM_PIN, UNISWAP_V3_SWAP_ROUTER, verifyUniswapTokenRoutePins } from "./token-route.js";
import { tokenBatch, tokenBlock, tokenChain, tokenHex, tokenQuantity, type TokenRpcCall } from "./token-rpc.js";
const ERC20 = parseAbi(["function allowance(address owner,address spender) view returns (uint256)"]);
const QUOTER = parseAbi(["function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)"]);
export type UniswapTokenQuoteRequest = Extract<CommandRequest, {
    readonly command: "swap.uniswap-token.quote";
}>;
export type UniswapTokenPolicyAdmission = (request: UniswapTokenQuoteRequest, now: Date) => Promise<string>;
export class UniswapTokenQuoteBuilder {
    constructor(private readonly call: EvmRpcCall, private readonly store: SavedUniswapTokenMaterialStore, private readonly admit: UniswapTokenPolicyAdmission, private readonly now: () => Date,
        private readonly verifyPins: (call: EvmRpcCall, tag: Hex) => Promise<void> = verifyUniswapTokenRoutePins) { }
    inventory() {
        return { chain: "eip155:1", router: UNISWAP_V3_SWAP_ROUTER, pair: "USDC/USDT", fee: 100,
            mechanism: UNISWAP_TOKEN_MECHANISM_PIN, approval: "exact_input_only", transactionValue: "0" };
    }
    async quote(input: UniswapTokenQuoteRequest): Promise<unknown> {
        const request = valid(input), at = this.now(), seconds = Math.floor(at.getTime() / 1000);
        if (request.deadline <= seconds || request.deadline - seconds > 1800)
            invalid("Uniswap token deadline must be in the next 30 minutes.");
        const rpc = this.call as TokenRpcCall, [chain, rawBlock] = await tokenBatch(rpc, "primary", [
            { method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: tokenChain },
            { method: "eth_getBlockByNumber", params: ["latest", false], cachePolicy: "none", decoder: tokenBlock },
        ]);
        if (evmRpcQuantity(chain) !== 1n)
            throw new ApnError("APN_CHAIN_MISMATCH", "Uniswap token route requires Ethereum chain 1.");
        const block = decodedBlock(rawBlock);
        await this.verifyPins(this.call, block.tag);
        const policyDigest = await this.admit(input, at), allowanceData = encodeFunctionData({ abi: ERC20, functionName: "allowance", args: [request.account, UNISWAP_V3_SWAP_ROUTER] });
        const quoteCall = encodeFunctionData({ abi: QUOTER, functionName: "quoteExactInputSingle", args: [{ tokenIn: request.inputToken,
                    tokenOut: request.outputToken, amountIn: request.amount, fee: 100, sqrtPriceLimitX96: 0n }] });
        const [rawAllowance, rawQuote] = await tokenBatch(rpc, "archive", [
            { method: "eth_call", params: [{ to: request.inputToken, data: allowanceData }, block.tag], cachePolicy: "snapshot", decoder: allowanceDecoder },
            { method: "eth_call", params: [{ to: UNISWAP_V3_QUOTER_V2, data: quoteCall }, block.tag], cachePolicy: "snapshot", decoder: quoteDecoder },
        ]);
        const allowance = decodeFunctionResult({ abi: ERC20, functionName: "allowance", data: evmRpcHex(rawAllowance, 32) });
        if (allowance !== 0n && allowance !== request.amount)
            blocked("Allowance must start at zero or the exact input amount.", "uniswap_allowance_mismatch");
        const [expected] = decodeFunctionResult({ abi: QUOTER, functionName: "quoteExactInputSingle", data: evmRpcHex(rawQuote) });
        if (expected < request.minimum)
            blocked("Quoted output is below the explicit minimum.", "uniswap_output_floor");
        const route = createUniswapTokenRoute({ inputToken: request.inputToken, outputToken: request.outputToken, recipient: request.recipient,
            amountIn: request.amount.toString(), amountOutMinimum: request.minimum.toString(), deadline: request.deadline });
        const approval = encodeUniswapTokenApproval(route.inputToken, route.amountIn), approvalTx = { from: request.account, to: approval.to, data: approval.data, value: "0x0" }, swapTx = { from: request.account, to: route.router, data: route.calldata, value: "0x0" };
        let rechecked: unknown, rawBalance: unknown;
        if (allowance === 0n) {
            const [result] = await tokenBatch(rpc, "archive", [{ method: "eth_call", params: [approvalTx, block.tag], cachePolicy: "none", decoder: approvalDecoder }]);
            const approvalResult = evmRpcHex(result); if (approvalResult !== "0x" && approvalResult !== `0x${"0".repeat(63)}1`)
                blocked("Token approval simulation returned an unsafe result.", "uniswap_approval_simulation");
            [rawBalance, rechecked] = await tokenBatch(rpc, "primary", [
                { method: "eth_getBalance", params: [request.account, block.tag], cachePolicy: "snapshot", decoder: tokenQuantity },
                { method: "eth_getBlockByNumber", params: [block.tag, false], cachePolicy: "none", decoder: tokenBlock },
            ]);
        } else {
            await tokenBatch(rpc, "archive", [{ method: "eth_call", params: [swapTx, block.tag], cachePolicy: "none", decoder: tokenHex() }]);
            const [estimate, balanceValue, blockAgain] = await tokenBatch(rpc, "primary", [
                { method: "eth_estimateGas", params: [swapTx, block.tag], cachePolicy: "none", decoder: tokenQuantity },
                { method: "eth_getBalance", params: [request.account, block.tag], cachePolicy: "snapshot", decoder: tokenQuantity },
                { method: "eth_getBlockByNumber", params: [block.tag, false], cachePolicy: "none", decoder: tokenBlock },
            ]);
            if (evmRpcQuantity(estimate) > request.maxSwapGas) blocked("Exact transaction gas estimate exceeds the owner cap.", "uniswap_gas_cap");
            rawBalance = balanceValue; rechecked = blockAgain;
        }
        const balance = evmRpcQuantity(rawBalance);
        const required = (request.maxApprovalGas + request.maxSwapGas + request.maxCleanupGas) * request.maxFee;
        if (required > request.maxNativeDebit || balance < required)
            blocked("Native balance or debit cap does not cover approval, swap, and cleanup.", "uniswap_native_debit");
        if (decodedBlock(rechecked).hash !== block.hash) throw new ApnError("APN_RPC_PROTOCOL", "EVM block changed around pinned reads.");
        const material = createUniswapTokenMaterial({ profile: request.profile, account: request.account, route, expectedOutputAtomic: expected.toString(),
            approvalCapAtomic: request.amount.toString(), allowanceAtPrepare: allowance.toString(),
            approvalGas: gas(request.maxApprovalGas, request.maxFee, request.maxPriority), swapGas: gas(request.maxSwapGas, request.maxFee, request.maxPriority),
            cleanupGas: gas(request.maxCleanupGas, request.maxFee, request.maxPriority), maximumNativeDebitWei: request.maxNativeDebit.toString(),
            policyDigest, mechanismDigest: swapMechanismDigest(UNISWAP_TOKEN_MECHANISM_PIN), blockNumber: block.number, blockHash: block.hash,
            createdAt: at.toISOString() });
        await this.store.save(material);
        return { quoteHash: material.quoteHash, route, expectedOutputAtomic: material.expectedOutputAtomic,
            approval: { token: route.inputToken, spender: route.router, capAtomic: material.approvalCapAtomic, currentAllowanceAtomic: allowance.toString() },
            gas: { approval: material.approvalGas, swap: material.swapGas, cleanup: material.cleanupGas, maximumNativeDebitWei: material.maximumNativeDebitWei },
            simulation: { blockNumber: block.number, blockHash: block.hash, swap: allowance === request.amount ? "exact" : "staged_after_exact_approval" },
            policyDigest, mechanismDigest: material.mechanismDigest, signed: false, broadcast: false };
    }
}
function allowanceDecoder(value: unknown) { decodeFunctionResult({ abi: ERC20, functionName: "allowance", data: evmRpcHex(value, 32) }); return value; }
function quoteDecoder(value: unknown) { decodeFunctionResult({ abi: QUOTER, functionName: "quoteExactInputSingle", data: evmRpcHex(value) }); return value; }
function approvalDecoder(value: unknown) { const result = evmRpcHex(value); if (result !== "0x" && result !== `0x${"0".repeat(63)}1`)
  throw new ApnError("APN_RPC_PROTOCOL", "Token approval simulation result is malformed."); return value; }
function decodedBlock(value: unknown) { const raw = evmRpcRecord(value), number = evmRpcQuantity(raw.number), hash = evmRpcHex(raw.hash, 32);
    return { tag: `0x${number.toString(16)}` as Hex, number: number.toString(), hash, raw }; }
function valid(input: UniswapTokenQuoteRequest) {
    const account = address(input.account), recipient = address(input.recipient), inputToken = address(input.sourceToken), outputToken = address(input.outputToken);
    const amount = uint(input.amountAtomic), minimum = uint(input.minimumOutputAtomic), cap = uint(input.approvalCapAtomic), maxApprovalGas = uint(input.maxApprovalGasLimit), maxSwapGas = uint(input.maxSwapGasLimit), maxCleanupGas = uint(input.maxCleanupGasLimit), maxFee = uint(input.maxFeePerGas), maxPriority = uint(input.maxPriorityFeePerGas, false), maxNativeDebit = uint(input.maxNativeDebitWei);
    if (cap !== amount || maxPriority > maxFee || maxApprovalGas > 30000000n || maxSwapGas > 30000000n || maxCleanupGas > 30000000n)
        invalid("Uniswap token caps are inconsistent.");
    createUniswapTokenRoute({ inputToken, outputToken, recipient, amountIn: amount.toString(), amountOutMinimum: minimum.toString(), deadline: input.deadline });
    return { profile: input.profile, account, recipient, inputToken, outputToken, amount, minimum, deadline: input.deadline,
        maxApprovalGas, maxSwapGas, maxCleanupGas, maxFee, maxPriority, maxNativeDebit };
}
function gas(gasLimit: bigint, maxFeePerGas: bigint, maxPriorityFeePerGas: bigint) { return { gasLimit: gasLimit.toString(), maxFeePerGas: maxFeePerGas.toString(), maxPriorityFeePerGas: maxPriorityFeePerGas.toString() }; }
function address(value: string) { try {
    const result = getAddress(value);
    if (result !== value)
        throw new Error();
    return result as Hex;
}
catch {
    return invalid("Uniswap token address is invalid.");
} }
function uint(value: string, positive = true) { try {
    return parseAtomic(value, { positive });
}
catch {
    return invalid("Uniswap token integer is invalid.");
} }
function invalid(message: string): never { throw new ApnError("APN_INVALID_INPUT", message); }
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
