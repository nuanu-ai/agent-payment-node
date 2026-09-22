import { decodeFunctionResult, encodeFunctionData, getAddress, parseAbi } from "viem";
import { canonicalJson, domainHash } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { evmRpcBlock, evmRpcHex, evmRpcQuantity, recheckEvmBlock } from "../../evm-rpc-codec.js";
import { parseAtomic } from "../../money.js";
import { swapMechanismDigest } from "../pin.js";
import { UNISWAP_V3_QUOTER_V2 } from "./pins.js";
import { createUniswapTokenMaterial } from "./token-material.js";
import { createUniswapTokenRoute, encodeUniswapTokenApproval, UNISWAP_TOKEN_MECHANISM_PIN, UNISWAP_V3_SWAP_ROUTER, verifyUniswapTokenRoutePins } from "./token-route.js";
const ERC20 = parseAbi(["function allowance(address owner,address spender) view returns (uint256)"]);
const QUOTER = parseAbi(["function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)"]);
export class UniswapTokenQuoteBuilder {
    call;
    store;
    admit;
    now;
    constructor(call, store, admit, now) {
        this.call = call;
        this.store = store;
        this.admit = admit;
        this.now = now;
    }
    inventory() {
        return { chain: "eip155:1", router: UNISWAP_V3_SWAP_ROUTER, pair: "USDC/USDT", fee: 100,
            mechanism: UNISWAP_TOKEN_MECHANISM_PIN, approval: "exact_input_only", transactionValue: "0" };
    }
    async quote(input) {
        const request = valid(input), at = this.now(), seconds = Math.floor(at.getTime() / 1000);
        if (request.deadline <= seconds || request.deadline - seconds > 1_800)
            invalid("Uniswap token deadline must be in the next 30 minutes.");
        if (evmRpcQuantity(await this.call("eth_chainId", [])) !== 1n)
            throw new ApnError("APN_CHAIN_MISMATCH", "Uniswap token route requires Ethereum chain 1.");
        const block = await evmRpcBlock(this.call, "latest");
        await verifyUniswapTokenRoutePins(this.call, block.tag);
        const policyDigest = await this.admit(input, at), allowance = await readAllowance(this.call, request.inputToken, request.account, block.tag);
        if (allowance !== 0n && allowance !== request.amount)
            blocked("Allowance must start at zero or the exact input amount.", "uniswap_allowance_mismatch");
        const quoteCall = encodeFunctionData({ abi: QUOTER, functionName: "quoteExactInputSingle", args: [{ tokenIn: request.inputToken,
                    tokenOut: request.outputToken, amountIn: request.amount, fee: 100, sqrtPriceLimitX96: 0n }] });
        const [expected] = decodeFunctionResult({ abi: QUOTER, functionName: "quoteExactInputSingle",
            data: evmRpcHex(await this.call("eth_call", [{ to: UNISWAP_V3_QUOTER_V2, data: quoteCall }, block.tag])) });
        if (expected < request.minimum)
            blocked("Quoted output is below the explicit minimum.", "uniswap_output_floor");
        const route = createUniswapTokenRoute({ inputToken: request.inputToken, outputToken: request.outputToken, recipient: request.recipient,
            amountIn: request.amount.toString(), amountOutMinimum: request.minimum.toString(), deadline: request.deadline });
        const approval = encodeUniswapTokenApproval(route.inputToken, route.amountIn), approvalTx = { from: request.account, to: approval.to, data: approval.data, value: "0x0" }, swapTx = { from: request.account, to: route.router, data: route.calldata, value: "0x0" };
        if (allowance === 0n)
            await safeApprovalCall(this.call, approvalTx, block.tag);
        else
            await simulated(this.call, swapTx, block.tag, request.maxSwapGas);
        const balance = evmRpcQuantity(await this.call("eth_getBalance", [request.account, block.tag]));
        const required = (request.maxApprovalGas + request.maxSwapGas + request.maxCleanupGas) * request.maxFee;
        if (required > request.maxNativeDebit || balance < required)
            blocked("Native balance or debit cap does not cover approval, swap, and cleanup.", "uniswap_native_debit");
        await recheckEvmBlock(this.call, block);
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
async function readAllowance(call, token, owner, tag) {
    const data = encodeFunctionData({ abi: ERC20, functionName: "allowance", args: [owner, UNISWAP_V3_SWAP_ROUTER] });
    return decodeFunctionResult({ abi: ERC20, functionName: "allowance", data: evmRpcHex(await call("eth_call", [{ to: token, data }, tag]), 32) });
}
async function simulated(call, tx, tag, cap) {
    await call("eth_call", [tx, tag]);
    const estimate = evmRpcQuantity(await call("eth_estimateGas", [tx, tag]));
    if (estimate > cap)
        blocked("Exact transaction gas estimate exceeds the owner cap.", "uniswap_gas_cap");
}
async function safeApprovalCall(call, tx, tag) {
    const result = evmRpcHex(await call("eth_call", [tx, tag]));
    if (result !== "0x" && result !== `0x${"0".repeat(63)}1`)
        blocked("Token approval simulation returned an unsafe result.", "uniswap_approval_simulation");
}
function valid(input) {
    const account = address(input.account), recipient = address(input.recipient), inputToken = address(input.sourceToken), outputToken = address(input.outputToken);
    const amount = uint(input.amountAtomic), minimum = uint(input.minimumOutputAtomic), cap = uint(input.approvalCapAtomic), maxApprovalGas = uint(input.maxApprovalGasLimit), maxSwapGas = uint(input.maxSwapGasLimit), maxCleanupGas = uint(input.maxCleanupGasLimit), maxFee = uint(input.maxFeePerGas), maxPriority = uint(input.maxPriorityFeePerGas, false), maxNativeDebit = uint(input.maxNativeDebitWei);
    if (cap !== amount || maxPriority > maxFee || maxApprovalGas > 30000000n || maxSwapGas > 30000000n || maxCleanupGas > 30000000n)
        invalid("Uniswap token caps are inconsistent.");
    createUniswapTokenRoute({ inputToken, outputToken, recipient, amountIn: amount.toString(), amountOutMinimum: minimum.toString(), deadline: input.deadline });
    return { profile: input.profile, account, recipient, inputToken, outputToken, amount, minimum, deadline: input.deadline,
        maxApprovalGas, maxSwapGas, maxCleanupGas, maxFee, maxPriority, maxNativeDebit };
}
function gas(gasLimit, maxFeePerGas, maxPriorityFeePerGas) { return { gasLimit: gasLimit.toString(), maxFeePerGas: maxFeePerGas.toString(), maxPriorityFeePerGas: maxPriorityFeePerGas.toString() }; }
function address(value) { try {
    const result = getAddress(value);
    if (result !== value)
        throw new Error();
    return result;
}
catch {
    return invalid("Uniswap token address is invalid.");
} }
function uint(value, positive = true) { try {
    return parseAtomic(value, { positive });
}
catch {
    return invalid("Uniswap token integer is invalid.");
} }
function invalid(message) { throw new ApnError("APN_INVALID_INPUT", message); }
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=token-builder.js.map