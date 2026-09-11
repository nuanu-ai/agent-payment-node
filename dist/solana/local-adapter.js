import { randomBytes } from "node:crypto";
import { createKeyPairSignerFromPrivateKeyBytes, getBase64EncodedWireTransaction, getSignatureFromTransaction, signTransaction } from "@solana/kit";
import { canonicalJson, sha256 } from "../canonical.js";
import { atomic, chainAsset, SOLANA_GENESIS, SOLANA_USDC } from "../chain-policy.js";
import { ApnError } from "../errors.js";
import { validateRailPrepared } from "../rail-operation-model.js";
import { associatedUsdc, readAccounts, requireNativeAccount, requireSolanaFunds, requireUsdcMint, usdcAmount } from "./accounts.js";
import { inspectSolana } from "./evidence.js";
import { solanaMessage, validateSolanaEffect, validateSolanaMessage } from "./message.js";
import { assertSolanaNetwork, protocolFailure, rpcAtomic, rpcRecord, solanaAddress, solanaSignature } from "./rpc.js";
export class SolanaLocalAdapter {
    storage;
    rpc;
    now;
    rail = "solana";
    provider = "local";
    execution = "local_signed";
    constructor(storage, rpc, now = () => new Date()) {
        this.storage = storage;
        this.rpc = rpc;
        this.now = now;
    }
    asset(alias) { return chainAsset("solana", alias); }
    canonicalAddress(input) { return solanaAddress(input); }
    async assertNetwork() { return await assertSolanaNetwork(this.rpc); }
    async account(profile) {
        const account = await this.storage.account(profile, "solana");
        if (account !== null && account.provider !== "local")
            mismatch();
        if (account !== null)
            solanaAddress(account.address);
        return account;
    }
    async ensureAccount(profile) {
        return await this.storage.ensureLocal({ profile, rail: "solana", create: async () => {
                const seed = randomBytes(32);
                try {
                    const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
                    return { seed, address: signer.address };
                }
                catch {
                    seed.fill(0);
                    throw new ApnError("APN_NATIVE_REJECTED", "The Solana key could not be generated.");
                }
            } });
    }
    async balance(account, asset) {
        await this.currentAccount(account);
        await this.assertNetwork();
        return await readSolanaBalance(this.rpc, account, asset, this.now());
    }
    async prepare(input) {
        const { account, asset } = input;
        await this.currentAccount(account);
        await this.assertNetwork();
        if (canonicalJson(this.asset(asset.alias)) !== canonicalJson(asset))
            mismatch();
        solanaAddress(input.recipient);
        atomic(input.amountAtomic, true);
        atomic(input.maximumFeeAtomic, true);
        const snapshot = await transferSnapshot(this.rpc, account, asset, input.recipient);
        const block = rpcRecord(rpcRecord(await this.rpc.call("getLatestBlockhash", [{ commitment: "confirmed" }])).value);
        if (typeof block.blockhash !== "string")
            protocolFailure();
        solanaAddress(block.blockhash);
        const lastValidBlockHeight = rpcAtomic(block.lastValidBlockHeight).toString();
        const rent = snapshot.createsRecipientAccount ? rpcAtomic(await this.rpc.call("getMinimumBalanceForRentExemption", [165, { commitment: "confirmed" }])) : 0n;
        const skeleton = {
            rail: "solana", networkIdentity: SOLANA_GENESIS, asset, sender: account.address, recipient: input.recipient,
            amountAtomic: input.amountAtomic, maximumFeeAtomic: input.maximumFeeAtomic,
            preparedAt: input.now.toISOString(), expiresAt: new Date(input.now.getTime() + 60_000).toISOString(),
            blockReference: block.blockhash, lastValidBlockHeight,
            sourceTokenAccount: snapshot.source, destinationTokenAccount: snapshot.destination,
            createsRecipientAccount: snapshot.createsRecipientAccount,
        };
        const message = await solanaMessage(skeleton);
        const fee = await messageFee(this.rpc, message.messageBase64);
        if (fee + rent > atomic(input.maximumFeeAtomic))
            throw new ApnError("APN_FEE_BUDGET_EXCEEDED", "The Solana network fee and recipient rent exceed the selected cap.");
        requireSolanaFunds(snapshot.native, snapshot.token, atomic(input.amountAtomic), fee + rent, asset.kind === "native");
        return validateRailPrepared({ ...skeleton, unsignedPayload: message.unsignedPayload,
            economics: { networkFeeMaximumAtomic: fee.toString(), recipientRentAtomic: rent.toString(), maximumNativeDebitAtomic: (fee + rent).toString(),
                networkFeePayer: account.address, rentPayer: rent > 0n ? account.address : null, feeControl: "signed_message" },
        }, account);
    }
    async revalidate(account, prepared) {
        await this.currentAccount(account);
        validateRailPrepared(prepared, account);
        await this.assertNetwork();
        const message = await validateSolanaMessage(prepared);
        if (this.now().getTime() >= Date.parse(prepared.expiresAt))
            expired();
        await this.validBlock(prepared);
        const snapshot = await transferSnapshot(this.rpc, account, prepared.asset, prepared.recipient);
        if (snapshot.createsRecipientAccount && !prepared.createsRecipientAccount)
            expired();
        const rent = snapshot.createsRecipientAccount ? rpcAtomic(await this.rpc.call("getMinimumBalanceForRentExemption", [165, { commitment: "confirmed" }])) : 0n;
        const fee = await messageFee(this.rpc, message.messageBase64);
        if (fee > atomic(prepared.economics.networkFeeMaximumAtomic) || rent > atomic(prepared.economics.recipientRentAtomic))
            expired();
        requireSolanaFunds(snapshot.native, snapshot.token, atomic(prepared.amountAtomic), atomic(prepared.economics.maximumNativeDebitAtomic), prepared.asset.kind === "native");
    }
    async sign(binding) {
        const existing = await this.recoverEffect(binding);
        if (existing !== null)
            return existing;
        await this.revalidate(binding.account, binding.prepared);
        const message = await validateSolanaMessage(binding.prepared);
        const effect = await this.storage.withSeed(binding.account, async (seed) => {
            const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
            if (signer.address !== binding.account.address)
                mismatch();
            const transaction = await signTransaction([signer.keyPair], message.transaction);
            const rawPayload = getBase64EncodedWireTransaction(transaction);
            return { operationId: binding.operationId, fingerprint: binding.fingerprint,
                transactionId: getSignatureFromTransaction(transaction), rawPayload, rawPayloadHash: sha256(rawPayload) };
        });
        await validateSolanaEffect(binding.prepared, effect);
        await this.storage.saveEffect(binding.account, effect);
        return effect;
    }
    async recoverEffect(binding) {
        await this.currentAccount(binding.account);
        const effect = await this.storage.effect(binding.account, binding.operationId, binding.fingerprint);
        if (effect !== null)
            await validateSolanaEffect(binding.prepared, effect);
        return effect;
    }
    async submit(binding, effect) {
        if (effect === null)
            mismatch();
        const stored = await this.recoverEffect(binding);
        if (stored === null || canonicalJson(stored) !== canonicalJson(effect))
            mismatch();
        await this.revalidate(binding.account, binding.prepared);
        const result = await this.rpc.call("sendTransaction", [effect.rawPayload, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 }]);
        if (solanaSignature(result) !== effect.transactionId)
            throw new ApnError("APN_RPC_AMBIGUOUS", "Solana submission returned a different effect identity.");
        return { transactionId: effect.transactionId };
    }
    async inspect(account, prepared, transactionId) {
        await this.currentAccount(account);
        validateRailPrepared(prepared, account);
        return await inspectSolana(this.rpc, account, prepared, transactionId, this.now());
    }
    async currentAccount(account) {
        const stored = await this.account(account.profile);
        if (stored === null || canonicalJson(stored) !== canonicalJson(account))
            mismatch();
    }
    async validBlock(prepared) {
        if (prepared.lastValidBlockHeight === null || rpcAtomic(await this.rpc.call("getBlockHeight", [{ commitment: "confirmed" }])) > atomic(prepared.lastValidBlockHeight))
            expired();
    }
}
export async function readSolanaBalance(rpc, account, asset, now) {
    if (canonicalJson(asset) !== canonicalJson(chainAsset("solana", asset.alias)))
        mismatch();
    const source = asset.kind === "token" ? await associatedUsdc(account.address) : null;
    const response = await readAccounts(rpc, [account.address, ...(source === null ? [] : [SOLANA_USDC, source])]);
    const native = requireNativeAccount(response.accounts[0] ?? null);
    let amount = native;
    if (source !== null) {
        requireUsdcMint(response.accounts[1] ?? null);
        amount = usdcAmount(response.accounts[2] ?? null, account.address);
    }
    return { account, asset, amountAtomic: amount.toString(), nativeBalanceAtomic: native.toString(), networkIdentity: SOLANA_GENESIS,
        blockNumberAtomic: response.slot.toString(), observedAt: now.toISOString(), rpcOriginHash: rpc.originHash };
}
async function transferSnapshot(rpc, account, asset, recipient) {
    const source = asset.kind === "token" ? await associatedUsdc(account.address) : null;
    const destination = asset.kind === "token" ? await associatedUsdc(recipient) : null;
    const response = await readAccounts(rpc, [account.address, ...(source === null || destination === null ? [] : [SOLANA_USDC, source, destination])]);
    const native = requireNativeAccount(response.accounts[0] ?? null);
    let token = 0n;
    let createsRecipientAccount = false;
    if (source !== null && destination !== null) {
        requireUsdcMint(response.accounts[1] ?? null);
        token = usdcAmount(response.accounts[2] ?? null, account.address);
        usdcAmount(response.accounts[3] ?? null, recipient);
        createsRecipientAccount = response.accounts[3] === null;
    }
    return { native, token, source, destination, createsRecipientAccount };
}
async function messageFee(rpc, messageBase64) {
    const value = rpcRecord(await rpc.call("getFeeForMessage", [messageBase64, { commitment: "confirmed" }])).value;
    if (value === null)
        expired();
    const fee = rpcAtomic(value);
    if (fee === 0n)
        protocolFailure();
    return fee;
}
function mismatch() { throw new ApnError("APN_WALLET_MISMATCH", "The Solana account, asset or sealed effect does not match this operation."); }
function expired() { throw new ApnError("APN_REPREPARE_REQUIRED", "The frozen Solana transaction or its funding bounds are no longer valid."); }
//# sourceMappingURL=local-adapter.js.map