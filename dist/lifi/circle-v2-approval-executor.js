/** One-shot, durable Base USDC allowance effect. This does not execute a Circle transfer. */
import { hashObject } from "../canonical.js";
import { EncryptedWalletStore } from "../encrypted-wallet-store.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { encodeFunctionData, getAddress, keccak256, parseAbi, parseTransaction, recoverTransactionAddress, serializeTransaction } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { approvalIncluded } from "./transaction.js";
import { prepareCircleV2BaseUsdcApprovalReadOnly } from "./circle-v2-approval-preparation.js";
import { bridgeOwner } from "./owner.js";
import { BRIDGE_MIN_REMAINING_MS, bridgeAddress, bridgeFailure, bridgeHex, bridgeUint } from "./validation.js";
export function publicCircleApproval(record) {
    const { rawTransaction: _raw, ...publicRecord } = record;
    return publicRecord;
}
/** Use APN's canonical Base RPC reader, which verifies receipt membership and safe block ancestry. */
export function circleApprovalRpcFromBridge(rpc) {
    if (rpc.chainId !== 8453)
        bridgeFailure("APN_RPC_CONFIG", "circle_approval_base_only");
    return {
        chainId: 8453,
        origin: rpc.origin,
        read: async (query) => {
            await rpc.assertChain();
            const payer = bridgeAddress(query.payer), token = bridgeAddress(query.token), spender = bridgeAddress(query.spender);
            const [account, gas, prices] = await Promise.all([
                rpc.account(payer, spender, token),
                rpc.estimate({ chainId: 8453, from: payer, to: token, data: bridgeHex(query.data), valueAtomic: "0", gasLimitAtomic: "0" }),
                rpc.prices(),
            ]);
            if (account.chainId !== 8453 || account.rpcOrigin !== rpc.origin || account.owner !== payer ||
                account.token !== token || account.spender !== spender)
                bridgeFailure("APN_RPC_PROTOCOL", "circle_approval_account_identity");
            const maximumGasCostAtomic = (BigInt(gas.gasLimitAtomic) * BigInt(prices.maxFeePerGasAtomic)).toString();
            const quote = await rpc.feeQuote({ economics: { nonceAtomic: account.latestNonceAtomic,
                    gasLimitAtomic: gas.gasLimitAtomic, maxFeePerGasAtomic: prices.maxFeePerGasAtomic,
                    maxPriorityFeePerGasAtomic: prices.maxPriorityFeePerGasAtomic, maximumGasCostAtomic } });
            if (quote.chainId !== 8453 || BigInt(quote.totalQuoteWei) < BigInt(maximumGasCostAtomic))
                bridgeFailure("APN_RPC_PROTOCOL", "circle_approval_base_fee_quote");
            return { chainId: 8453, payer, token, spender, blockNumber: account.block.numberAtomic,
                blockHash: account.block.hash, latestNonceAtomic: account.latestNonceAtomic,
                pendingNonceAtomic: account.pendingNonceAtomic, usdcBalanceAtomic: account.balanceAtomic,
                usdcAllowanceAtomic: account.allowanceAtomic, nativeBalanceWei: account.nativeBalanceWei,
                gasLimitAtomic: gas.gasLimitAtomic, maxFeePerGasWei: prices.maxFeePerGasAtomic,
                maxPriorityFeePerGasWei: prices.maxPriorityFeePerGasAtomic, totalNativeDebitWei: quote.totalQuoteWei };
        },
        send: async (raw) => await rpc.send(raw),
        observe: async (hash) => {
            const found = await rpc.observe(hash);
            if (found === null || found.transaction.safeBlock === null)
                return null;
            const tx = found.transaction, receipt = found.receipt;
            if (tx.chainId !== 8453 || tx.rpcOrigin !== rpc.origin || tx.transactionHash !== hash ||
                tx.block.numberAtomic !== receipt.blockNumberAtomic || tx.block.hash !== receipt.blockHash ||
                receipt.chainId !== 8453 || receipt.transactionHash !== hash)
                bridgeFailure("APN_RPC_PROTOCOL", "circle_approval_receipt_binding");
            return { receipt, status: tx.status, safe: true };
        },
    };
}
class CircleApprovalJournal extends SecureStateStore {
    async load(id) {
        stateIdentifier(id, "Circle approval ID");
        const value = await this.readJson(`circle-approvals/${id}.json`);
        if (value === null)
            return null;
        const { integrityHash, ...body } = value;
        if (value.schemaVersion !== "apn.circle-v2-approval.v1" || value.id !== id ||
            integrityHash !== hashObject(body) || ![0, 1].includes(value.submissionAttempts))
            bridgeFailure("APN_STATE_CORRUPT", "circle_approval_journal");
        return value;
    }
    async save(record) {
        const old = await this.load(record.id);
        if (old !== null && (old.profileHash !== record.profileHash || old.rpcOrigin !== record.rpcOrigin || old.preparation.intentDigest !== record.preparation.intentDigest ||
            record.submissionAttempts < old.submissionAttempts || (old.transactionHash !== null && old.transactionHash !== record.transactionHash) ||
            (old.rawTransaction !== null && old.rawTransaction !== record.rawTransaction)))
            bridgeFailure("APN_STATE_CORRUPT", "circle_approval_continuity");
        await this.initialize();
        await this.ensureDirectory("circle-approvals");
        await this.writeJson(`circle-approvals/${record.id}.json`, record);
    }
}
function update(record, patch) {
    const { integrityHash: _ignored, ...body } = { ...record, ...patch };
    return { ...body, integrityHash: hashObject(body) };
}
function bound(record, now) {
    if (Date.parse(record.preparation.expiresAt) - now < BRIDGE_MIN_REMAINING_MS)
        bridgeFailure("APN_REPREPARE_REQUIRED", "circle_approval_expired");
}
async function verifySigned(raw, record) {
    bridgeHex(raw, 16 * 1024);
    const e = record.preparation.transaction;
    try {
        const t = parseTransaction(raw), from = getAddress(await recoverTransactionAddress({ serializedTransaction: raw }));
        if (t.type !== "eip1559" || t.chainId !== 8453 || from !== e.from || t.to === null || t.to === undefined ||
            getAddress(t.to) !== e.to || (t.data ?? "0x") !== e.data || (t.value ?? 0n) !== 0n ||
            (t.nonce ?? 0).toString() !== e.nonceAtomic || t.gas?.toString() !== e.gasLimitAtomic ||
            t.maxFeePerGas?.toString() !== e.maxFeePerGasWei || t.maxPriorityFeePerGas?.toString() !== e.maxPriorityFeePerGasWei ||
            (t.accessList ?? []).length !== 0 || t.r === undefined || t.s === undefined ||
            BigInt(t.s) <= 0n || BigInt(t.s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n ||
            (t.yParity !== 0 && t.yParity !== 1) ||
            serializeTransaction(t, { r: t.r, s: t.s, yParity: t.yParity }) !== raw)
            throw new Error("binding");
        return keccak256(raw);
    }
    catch {
        return bridgeFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "circle_approval_signed_binding");
    }
}
/** APN encrypted local wallet is opened solely in the signing call; no secret enters the journal. */
export class LocalCircleApprovalSigner {
    state;
    wallets;
    journal;
    constructor(state, wrapping) {
        this.state = state;
        this.wallets = new EncryptedWalletStore(state, wrapping);
        this.journal = new CircleApprovalJournal(state.root);
    }
    async sign(record) {
        if (record.phase !== "signing_started" || record.submissionAttempts !== 0 ||
            record.rawTransaction !== null || record.transactionHash !== null ||
            record.profileHash !== this.state.profileHash(record.profile) ||
            Date.parse(record.preparation.expiresAt) - Date.now() < BRIDGE_MIN_REMAINING_MS)
            bridgeFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "circle_approval_signing_gate");
        const p = record.preparation, expectedData = encodeFunctionData({
            abi: parseAbi(["function approve(address spender,uint256 value) returns (bool)"]), functionName: "approve",
            args: ["0x71f54F818671cD0D7ea140Da213e5C8b5C92a408", bridgeUint(p.approvalCapAtomic, true)],
        });
        if (p.transaction.chainId !== 8453 || p.token !== "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" ||
            p.spender !== "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408" || p.transaction.to !== p.token ||
            p.transaction.data !== expectedData || p.transaction.valueAtomic !== "0")
            bridgeFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "circle_approval_scope");
        const saved = await this.journal.load(record.id);
        if (saved === null || saved.integrityHash !== record.integrityHash)
            bridgeFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "circle_approval_durable_gate");
        const wallet = await this.wallets.describe(record.profile);
        if (wallet === null)
            bridgeFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "circle_approval_wallet_missing");
        try {
            if (wallet.identity.profile !== record.profile || wallet.identity.address !== record.preparation.transaction.from ||
                wallet.identity.bindingHash !== record.walletBindingHash || wallet.identity.createdAt !== record.walletCreatedAt)
                bridgeFailure("APN_WALLET_MISMATCH", "circle_approval_wallet_binding");
            const t = record.preparation.transaction, nonce = bridgeUint(t.nonceAtomic);
            if (nonce > BigInt(Number.MAX_SAFE_INTEGER))
                bridgeFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "circle_approval_nonce_bound");
            return await privateKeyToAccount(wallet.secret.privateKey).signTransaction({ type: "eip1559", chainId: 8453,
                to: bridgeAddress(t.to), data: t.data, value: 0n, nonce: Number(nonce), gas: BigInt(t.gasLimitAtomic),
                maxFeePerGas: BigInt(t.maxFeePerGasWei), maxPriorityFeePerGas: BigInt(t.maxPriorityFeePerGasWei), accessList: [] });
        }
        finally {
            this.wallets.clear(wallet.secret);
        }
    }
}
export class CircleV2ApprovalExecutor {
    state;
    rpc;
    signer;
    limits;
    now;
    journal;
    constructor(state, rpc, signer, limits, now = Date.now) {
        this.state = state;
        this.rpc = rpc;
        this.signer = signer;
        this.limits = limits;
        this.now = now;
        this.journal = new CircleApprovalJournal(state.root);
        if (rpc.chainId !== 8453)
            bridgeFailure("APN_RPC_CONFIG", "circle_approval_base_only");
    }
    async prepare(input) {
        await this.state.initialize();
        const profileHash = this.state.profileHash(input.profile);
        return await this.state.withLocks([`profile:${profileHash}`], async () => {
            const p = await prepareCircleV2BaseUsdcApprovalReadOnly({ chainId: 8453, payer: input.payer,
                token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", spender: "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408",
                approvalCapAtomic: input.approvalCapAtomic }, this.rpc.read, this.limits, this.now);
            const id = hashObject({ profileHash, intentDigest: p.intentDigest });
            const existing = await this.journal.load(id);
            if (existing !== null) {
                if (existing.walletBindingHash !== input.walletBindingHash || existing.walletCreatedAt !== input.walletCreatedAt ||
                    existing.profile !== input.profile)
                    bridgeFailure("APN_OPERATION_BLOCKED", "circle_approval_existing_owner");
                return existing;
            }
            const body = { schemaVersion: "apn.circle-v2-approval.v1", id, profile: input.profile, profileHash, rpcOrigin: this.rpc.origin,
                walletBindingHash: input.walletBindingHash, walletCreatedAt: input.walletCreatedAt, preparation: p, limits: this.limits,
                phase: "prepared", rawTransaction: null, transactionHash: null,
                submissionAttempts: 0, observedAllowanceAtomic: null };
            const record = { ...body, integrityHash: hashObject(body) };
            await this.journal.save(record);
            return record;
        });
    }
    async execute(id, confirm) {
        await this.state.initialize();
        const initial = await this.journal.load(id);
        if (initial === null)
            bridgeFailure("APN_OPERATION_NOT_FOUND", "circle_approval_missing");
        return await this.state.withLocks([`profile:${initial.profileHash}`, `operation:${id}`], async () => {
            let r = await this.journal.load(id);
            if (r === null)
                bridgeFailure("APN_STATE_CORRUPT", "circle_approval_disappeared");
            if (r.rpcOrigin !== this.rpc.origin)
                bridgeFailure("APN_RPC_CONFIG", "circle_approval_rpc_origin_changed");
            if (r.phase !== "prepared")
                return await this.observe(r);
            bound(r, this.now());
            if (!await confirm(r)) {
                r = update(r, { phase: "failed_before_effect" });
                await this.journal.save(r);
                return r;
            }
            await this.fresh(r);
            r = update(r, { phase: "signing_started" });
            await this.journal.save(r);
            // A crash during signing is ambiguous: never sign again or submit automatically.
            let raw;
            try {
                raw = await this.signer.sign(r);
            }
            catch {
                return await this.unknown(r);
            }
            const hash = await verifySigned(raw, r);
            r = update(r, { phase: "sealed", rawTransaction: raw, transactionHash: hash });
            await this.journal.save(r);
            try {
                await this.fresh(r);
            }
            catch {
                return await this.unknown(r);
            }
            r = update(r, { phase: "submitting", submissionAttempts: 1 });
            await this.journal.save(r);
            try {
                if (await this.rpc.send(raw) !== hash)
                    return await this.unknown(r);
            }
            catch {
                return await this.unknown(r);
            }
            return await this.observe(r);
        });
    }
    async status(id) {
        await this.state.initialize();
        const initial = await this.journal.load(id);
        if (initial === null)
            bridgeFailure("APN_OPERATION_NOT_FOUND", "circle_approval_missing");
        return await this.state.withLocks([`profile:${initial.profileHash}`, `operation:${id}`], async () => {
            const r = await this.journal.load(id);
            if (r === null)
                bridgeFailure("APN_STATE_CORRUPT", "circle_approval_disappeared");
            if (r.rpcOrigin !== this.rpc.origin)
                bridgeFailure("APN_RPC_CONFIG", "circle_approval_rpc_origin_changed");
            return await this.observe(r);
        });
    }
    async fresh(record) {
        bound(record, this.now());
        const owner = (await bridgeOwner(this.state, record.profile)).owner;
        if (owner.profileHash !== record.profileHash || owner.address !== record.preparation.transaction.from ||
            owner.walletBindingHash !== record.walletBindingHash || owner.walletCreatedAt !== record.walletCreatedAt)
            bridgeFailure("APN_PROFILE_DRIFT", "circle_approval_owner_changed");
        const p = record.preparation;
        const next = await prepareCircleV2BaseUsdcApprovalReadOnly({ chainId: 8453, payer: p.transaction.from,
            token: p.token, spender: p.spender, approvalCapAtomic: p.approvalCapAtomic }, this.rpc.read, record.limits, this.now);
        if (next.transaction.nonceAtomic !== p.transaction.nonceAtomic ||
            BigInt(next.transaction.gasLimitAtomic) > BigInt(p.transaction.gasLimitAtomic) ||
            BigInt(next.transaction.maxFeePerGasWei) > BigInt(p.transaction.maxFeePerGasWei) ||
            BigInt(next.transaction.maxPriorityFeePerGasWei) > BigInt(p.transaction.maxPriorityFeePerGasWei) ||
            next.transaction.from !== p.transaction.from || next.transaction.data !== p.transaction.data)
            bridgeFailure("APN_REPREPARE_REQUIRED", "circle_approval_fresh_bounds");
    }
    async unknown(r) {
        r = update(r, { phase: "unknown_finality" });
        await this.journal.save(r);
        return r;
    }
    async observe(r) {
        if (r.phase === "completed" || r.phase === "confirmed_revert" || r.phase === "failed_before_effect" || r.phase === "prepared")
            return r;
        if (r.submissionAttempts === 0 || r.transactionHash === null || r.rawTransaction === null)
            return await this.unknown(r);
        try {
            if (await verifySigned(r.rawTransaction, r) !== r.transactionHash)
                throw new Error("signed hash");
            const found = await this.rpc.observe(r.transactionHash);
            if (found === null)
                return await this.unknown(r);
            const receipt = found.receipt;
            if (found.safe !== true || receipt.chainId !== 8453 || receipt.transactionHash !== r.transactionHash)
                throw new Error("receipt identity");
            if (found.status === "reverted") {
                r = update(r, { phase: "confirmed_revert" });
                await this.journal.save(r);
                return r;
            }
            const p = r.preparation;
            approvalIncluded(receipt, bridgeAddress(p.token), bridgeAddress(p.transaction.from), bridgeAddress(p.spender), p.approvalCapAtomic);
            const state = await this.rpc.read({ chainId: 8453, payer: p.transaction.from, token: p.token,
                spender: p.spender, data: p.transaction.data });
            if (state.chainId !== 8453 || bridgeAddress(state.payer) !== p.transaction.from ||
                bridgeAddress(state.token) !== p.token || bridgeAddress(state.spender) !== p.spender ||
                bridgeUint(state.blockNumber) < bridgeUint(receipt.blockNumberAtomic) ||
                bridgeUint(state.usdcAllowanceAtomic) !== bridgeUint(p.approvalCapAtomic))
                throw new Error("fresh allowance");
            r = update(r, { phase: "completed", observedAllowanceAtomic: state.usdcAllowanceAtomic });
            await this.journal.save(r);
            return r;
        }
        catch {
            return await this.unknown(r);
        }
    }
}
//# sourceMappingURL=circle-v2-approval-executor.js.map