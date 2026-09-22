import { encodeFunctionData, getAddress, keccak256, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, domainHash } from "../../canonical.js";
import { EncryptedWalletStore, walletCustodyLock } from "../../encrypted-wallet-store.js";
import { ApnError } from "../../errors.js";
import { evmRpcHex, evmRpcQuantity } from "../../evm-rpc-codec.js";
import { UniswapTokenEffectJournal } from "./token-effects.js";
import { UniswapTokenJournal } from "./token-operation.js";
import { encodeUniswapTokenApproval } from "./token-route.js";
import { UniswapTokenNonceStore } from "./token-nonce.js";
const ERC20 = parseAbi(["function allowance(address owner,address spender) view returns (uint256)"]);
/** Local encrypted-wallet custody plus the durable one-way broadcast boundary. */
export class UniswapTokenCustody {
    state;
    call;
    now;
    effects;
    wallets;
    nonces;
    operations;
    constructor(state, wrapping, call, now, effects = new UniswapTokenEffectJournal(state.root)) {
        this.state = state;
        this.call = call;
        this.now = now;
        this.effects = effects;
        this.wallets = new EncryptedWalletStore(state, wrapping);
        this.nonces = new UniswapTokenNonceStore(state.root);
        this.operations = new UniswapTokenJournal(state.root);
    }
    async withAccountLock(op, work) {
        return await this.state.withLocks([walletCustodyLock(this.state, op.profile)], work);
    }
    async allocateNonce(op, kind) {
        const pending = evmRpcQuantity(await this.call("eth_getTransactionCount", [op.account, "pending"]));
        const occupied = (await this.state.listOperations(this.state.profileHash(op.profile)))
            .filter((operation) => !operation.terminal && operation.walletAddress === op.account && operation.evm?.asset.chainId === 1 && operation.economics !== undefined)
            .map((operation) => BigInt(operation.economics.nonceAtomic));
        return await this.nonces.allocate(op, kind, pending, async (operationId, effectKind) => await this.hasDurableEffect(operationId, effectKind), occupied);
    }
    async releaseNonce(op, kind, nonce) {
        await this.nonces.release(op, kind, nonce, async (operationId, effectKind) => await this.hasDurableEffect(operationId, effectKind));
    }
    async commitNonce(op, kind, nonce) { await this.nonces.commit(op, kind, nonce); }
    async hasDurableEffect(operationId, kind) {
        const op = await this.operations.load(operationId);
        if (op === null)
            return false;
        const attempt = kind === "approval" ? op.approvalAttempt : kind === "swap" ? op.swapAttempt : op.cleanupAttempt;
        return attempt?.transactionHash !== null && attempt?.transactionHash !== undefined || await this.effects.load(op, kind) !== null ||
            attempt !== null && await this.probeSealed(op, kind, attempt.nonce) !== null;
    }
    async currentAllowance(op) {
        const data = encodeFunctionData({ abi: ERC20, functionName: "allowance", args: [op.account, op.route.router] });
        return BigInt(evmRpcHex(await this.call("eth_call", [{ to: op.route.inputToken, data }, "latest"]), 32)).toString();
    }
    async seal(op, kind, nonce) {
        return await this.state.withLocks([`uniswap-token-custody:${op.operationId}:${kind}`], async () => await this.sealUnlocked(op, kind, nonce));
    }
    async sealUnlocked(op, kind, nonce) {
        const envelope = envelopeOf(op, kind, nonce), envelopeHash = domainHash("apn.uniswap-token-envelope.v1", canonicalJson(envelope)), key = effectKey(op, kind), existing = await this.effects.load(op, kind);
        const wallet = await this.wallets.describe(op.profile);
        if (wallet === null)
            blocked("The encrypted EVM wallet is unavailable.", "uniswap_token_wallet_missing");
        try {
            if (wallet.identity.address !== op.account || getAddress(wallet.identity.address) !== op.account)
                throw new ApnError("APN_WALLET_MISMATCH", "Uniswap token signer changed.");
            const cached = wallet.secret.directEffects[key];
            if (existing !== null) {
                if (cached === undefined || cached.transactionHash !== existing.transactionHash || cached.payloadHash !== existing.envelopeHash)
                    corrupt("Uniswap token signed effect is missing or changed.");
                return { transactionHash: existing.transactionHash, envelopeHash: existing.envelopeHash };
            }
            if (cached !== undefined) {
                if (cached.payloadHash !== envelopeHash || cached.transactionHash !== cached.rawTransactionHash || keccak256(cached.rawTransaction) !== cached.transactionHash)
                    corrupt("Uniswap token cached effect changed.");
                await this.effects.seal(op, kind, cached.transactionHash, envelope, this.now());
                return { transactionHash: cached.transactionHash, envelopeHash };
            }
            const account = privateKeyToAccount(wallet.secret.privateKey), n = BigInt(nonce);
            if (n > BigInt(Number.MAX_SAFE_INTEGER))
                blocked("Uniswap token nonce exceeds signer bounds.", "uniswap_token_nonce_bound");
            const raw = await account.signTransaction({ type: "eip1559", chainId: 1, to: envelope.to, data: envelope.data,
                value: 0n, nonce: Number(n), gas: BigInt(envelope.gasLimit), maxFeePerGas: BigInt(envelope.maxFeePerGas),
                maxPriorityFeePerGas: BigInt(envelope.maxPriorityFeePerGas), accessList: [] });
            const transactionHash = keccak256(raw);
            wallet.secret.directEffects[key] = { payloadHash: envelopeHash, transactionHash, rawTransaction: raw, rawTransactionHash: transactionHash };
            await this.wallets.save(wallet.identity, wallet.secret);
            await this.effects.seal(op, kind, transactionHash, envelope, this.now());
            return { transactionHash, envelopeHash };
        }
        finally {
            this.wallets.clear(wallet.secret);
        }
    }
    async probeSealed(op, kind, nonce) {
        const envelopeHash = domainHash("apn.uniswap-token-envelope.v1", canonicalJson(envelopeOf(op, kind, nonce))), wallet = await this.wallets.describe(op.profile);
        if (wallet === null)
            return null;
        try {
            const cached = wallet.secret.directEffects[effectKey(op, kind)];
            if (cached === undefined)
                return null;
            if (cached.payloadHash !== envelopeHash || cached.transactionHash !== cached.rawTransactionHash || keccak256(cached.rawTransaction) !== cached.transactionHash)
                corrupt("Uniswap token cached effect changed.");
            return { transactionHash: cached.transactionHash, envelopeHash };
        }
        finally {
            this.wallets.clear(wallet.secret);
        }
    }
    async send(op, kind) {
        return await this.state.withLocks([`uniswap-token-custody:${op.operationId}:${kind}`], async () => await this.sendUnlocked(op, kind));
    }
    async sendUnlocked(op, kind) {
        const effect = await this.effects.load(op, kind);
        if (effect === null || effect.phase !== "sealed")
            blocked("Uniswap token effect is unavailable or already attempted.", "uniswap_token_single_send");
        const wallet = await this.wallets.describe(op.profile);
        if (wallet === null)
            corrupt("Uniswap token wallet disappeared.");
        try {
            const material = wallet.secret.directEffects[effectKey(op, kind)];
            if (material === undefined || material.transactionHash !== effect.transactionHash || material.payloadHash !== effect.envelopeHash)
                corrupt("Uniswap token raw effect binding changed.");
            await this.effects.markStarted(op, kind, this.now());
            let accepted = false;
            try {
                accepted = evmRpcHex(await this.call("eth_sendRawTransaction", [material.rawTransaction]), 32) === effect.transactionHash;
            }
            catch {
                accepted = false;
            }
            try {
                await this.effects.markOutcome(op, kind, accepted ? "send_accepted" : "send_ambiguous", this.now());
            }
            catch { /* send_started remains the no-resend boundary */ }
            return accepted ? "accepted" : "ambiguous";
        }
        finally {
            this.wallets.clear(wallet.secret);
        }
    }
}
export function envelopeOf(op, kind, nonce) {
    const gas = kind === "approval" ? op.approvalGas : kind === "swap" ? op.swapGas : op.cleanupGas;
    const call = kind === "swap" ? { to: op.route.router, data: op.route.calldata } : encodeUniswapTokenApproval(op.route.inputToken, kind === "approval" ? op.route.amountIn : "0");
    return { chainId: 1, from: op.account, to: call.to, data: call.data, value: "0", nonce,
        gasLimit: gas.gasLimit, maxFeePerGas: gas.maxFeePerGas, maxPriorityFeePerGas: gas.maxPriorityFeePerGas };
}
function effectKey(op, kind) { return domainHash("apn.uniswap-token-wallet-effect.v1", canonicalJson({ operationId: op.operationId, kind })); }
function corrupt(message) { throw new ApnError("APN_STATE_CORRUPT", message); }
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=token-custody.js.map