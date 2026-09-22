import { encodeFunctionData, parseAbi } from "viem";
import { EncryptedWalletStore } from "../../encrypted-wallet-store.js";
import { ApnError } from "../../errors.js";
import { evmRpcBlock, evmRpcHex, evmRpcQuantity, recheckEvmBlock } from "../../evm-rpc-codec.js";
import { encodeUniswapTokenApproval, verifyUniswapTokenRoutePins } from "./token-route.js";
import { UniswapTokenRevalidator } from "./token-revalidation.js";
const ERC20 = parseAbi(["function allowance(address owner,address spender) view returns (uint256)", "function balanceOf(address owner) view returns (uint256)"]);
export class UniswapTokenSigningGuard {
    state;
    call;
    usage;
    now;
    wallets;
    constructor(state, wrapping, call, usage, now) {
        this.state = state;
        this.call = call;
        this.usage = usage;
        this.now = now;
        this.wallets = new EncryptedWalletStore(state, wrapping);
    }
    async confirm(material) {
        await this.usage.confirmMaterial(material);
        await this.wallet(material.profile, material.account);
        const at = this.now();
        if (at.getTime() >= material.route.deadline * 1000)
            blocked("Token quote expired.", "uniswap_token_quote_expired");
        const block = await this.common(material.account, material.route.inputToken, material.route.router, material.route.deadline, material.maximumNativeDebitWei);
        const allowance = await allowanceAt(this.call, material.account, material.route.inputToken, material.route.router, block.tag);
        if (allowance !== 0n && allowance !== BigInt(material.route.amountIn))
            blocked("Token allowance changed.", "uniswap_token_allowance_drift");
        if (await tokenBalanceAt(this.call, material.account, material.route.inputToken, block.tag) < BigInt(material.route.amountIn))
            blocked("Source token balance is below the exact input.", "uniswap_token_source_balance");
        const tx = allowance === 0n ? encodeUniswapTokenApproval(material.route.inputToken, material.route.amountIn) :
            { to: material.route.router, data: material.route.calldata };
        evmRpcQuantity(await this.call("eth_getTransactionCount", [material.account, "pending"]));
        await simulate(this.call, { from: material.account, to: tx.to, data: tx.data, value: "0x0" }, block.tag, allowance === 0n ? material.approvalGas.gasLimit : material.swapGas.gasLimit, allowance === 0n);
        const gas = allowance === 0n ? material.approvalGas : material.swapGas;
        await fee(this.call, block.raw, gas.maxFeePerGas, gas.maxPriorityFeePerGas);
        await recheckEvmBlock(this.call, block);
    }
    async inspect(op, kind, nonce) {
        if (kind === "cleanup")
            await this.usage.confirmCleanup(op);
        else
            await this.usage.confirmReserved(op);
        await this.wallet(op.profile, op.account);
        if (kind !== "cleanup" && this.now().getTime() >= op.route.deadline * 1000)
            blocked("Token route expired before signing.", "uniswap_token_deadline");
        const gas = kind === "approval" ? op.approvalGas : kind === "swap" ? op.swapGas : op.cleanupGas;
        const block = await this.common(op.account, op.route.inputToken, op.route.router, op.route.deadline, (BigInt(op.maximumNativeDebitWei) - BigInt(op.accumulatedNativeDebitWei)).toString());
        const pending = evmRpcQuantity(await this.call("eth_getTransactionCount", [op.account, "pending"]));
        if (BigInt(nonce) < pending)
            blocked("Reserved nonce is stale.", "uniswap_token_nonce_drift");
        const allowance = await allowanceAt(this.call, op.account, op.route.inputToken, op.route.router, block.tag);
        if (kind === "approval" && allowance !== 0n || kind === "swap" && allowance !== BigInt(op.route.amountIn) || kind === "cleanup" && allowance === 0n) {
            blocked("Token allowance changed before signing.", "uniswap_token_allowance_drift");
        }
        if (kind !== "cleanup" && await tokenBalanceAt(this.call, op.account, op.route.inputToken, block.tag) < BigInt(op.route.amountIn))
            blocked("Source token balance is below the exact input.", "uniswap_token_source_balance");
        if (kind === "swap")
            await new UniswapTokenRevalidator(this.call).revalidate(op);
        else {
            const approval = encodeUniswapTokenApproval(op.route.inputToken, kind === "approval" ? op.route.amountIn : "0");
            await simulate(this.call, { from: op.account, to: approval.to, data: approval.data, value: "0x0" }, block.tag, gas.gasLimit, true);
        }
        await fee(this.call, block.raw, gas.maxFeePerGas, gas.maxPriorityFeePerGas);
        await recheckEvmBlock(this.call, block);
    }
    async common(account, token, router, deadline, nativeCap) {
        if (evmRpcQuantity(await this.call("eth_chainId", [])) !== 1n)
            throw new ApnError("APN_CHAIN_MISMATCH", "Uniswap token signing requires Ethereum chain 1.");
        const block = await evmRpcBlock(this.call, "latest");
        await verifyUniswapTokenRoutePins(this.call, block.tag);
        if (router === token || !Number.isSafeInteger(deadline))
            corrupt("Uniswap token signing material changed.");
        if (evmRpcQuantity(await this.call("eth_getBalance", [account, block.tag])) < BigInt(nativeCap))
            blocked("Native fee balance is below the approved bound.", "uniswap_token_native_balance");
        return block;
    }
    async wallet(profile, account) {
        const wallet = await this.wallets.describe(profile);
        if (wallet === null || wallet.identity.address !== account)
            blocked("The admitted encrypted wallet changed.", "uniswap_token_wallet_drift");
        this.wallets.clear(wallet.secret);
    }
}
async function allowanceAt(call, owner, token, router, tag) {
    const data = encodeFunctionData({ abi: ERC20,
        functionName: "allowance", args: [owner, router] });
    return BigInt(evmRpcHex(await call("eth_call", [{ to: token, data }, tag]), 32));
}
async function tokenBalanceAt(call, owner, token, tag) {
    const data = encodeFunctionData({ abi: ERC20,
        functionName: "balanceOf", args: [owner] });
    return BigInt(evmRpcHex(await call("eth_call", [{ to: token, data }, tag]), 32));
}
async function simulate(call, tx, tag, limit, noReturn) {
    const result = evmRpcHex(await call("eth_call", [tx, tag]));
    if (noReturn && result !== "0x" && result !== `0x${"0".repeat(63)}1`)
        blocked("Token approval simulation returned an unsafe result.", "uniswap_token_approval_simulation");
    if (evmRpcQuantity(await call("eth_estimateGas", [tx, tag])) > BigInt(limit))
        blocked("Token transaction gas exceeds its cap.", "uniswap_token_gas_cap");
}
async function fee(call, block, maxFee, maxPriority) {
    const base = evmRpcQuantity(block.baseFeePerGas), priority = evmRpcQuantity(await call("eth_maxPriorityFeePerGas", []));
    if (priority > BigInt(maxPriority) || base * 2n + priority > BigInt(maxFee)) {
        blocked("Current EIP-1559 fees exceed the approved caps.", "uniswap_token_fee_cap");
    }
}
function corrupt(message) { throw new ApnError("APN_STATE_CORRUPT", message); }
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=token-guard.js.map