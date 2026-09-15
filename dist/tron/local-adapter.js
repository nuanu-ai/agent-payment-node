import { randomBytes } from "node:crypto";
import { utils } from "tronweb";
import { canonicalJson, hashObject, sha256 } from "../canonical.js";
import { atomic, chainAsset } from "../chain-policy.js";
import { ApnError } from "../errors.js";
import { validateRailPrepared } from "../rail-operation-model.js";
import { readTronAccount, requireTronOwner, requireTronUsdt, tronEnergyEstimate, tronUsdtBalance } from "./accounts.js";
import { TRON_GENESIS, tronAddress, tronAtomic, tronRecord, tronReprepare } from "./codec.js";
import { inspectTron } from "./evidence.js";
import { tronBandwidthBytes } from "./resource-model.js";
import { readTronWindow, revalidateTronWindow } from "./resources.js";
import { assertTronNetwork, tronBlock } from "./rpc.js";
import { buildTronTransaction, signTronTransaction, unsignedTronPrepared, validateTronEffect } from "./transaction.js";
export class TronLocalAdapter {
    storage;
    rpc;
    now;
    rail = "tron";
    provider = "local";
    execution = "local_signed";
    constructor(storage, rpc, now = () => new Date()) {
        this.storage = storage;
        this.rpc = rpc;
        this.now = now;
    }
    asset(alias) { return chainAsset("tron", alias); }
    canonicalAddress(input) { return tronAddress(input); }
    async assertNetwork() { return await assertTronNetwork(this.rpc); }
    async account(profile) {
        const account = await this.storage.account(profile, "tron");
        if (account !== null && (account.provider !== "local" || tronAddress(account.address) !== account.address))
            mismatch();
        return account;
    }
    async ensureAccount(profile) {
        return await this.storage.ensureLocal({ profile, rail: "tron", create: async () => {
                const seed = randomBytes(32);
                const bytes = [...seed];
                try {
                    return { seed, address: tronAddress(utils.crypto.getBase58CheckAddress(utils.crypto.getAddressFromPriKey(bytes))) };
                }
                catch {
                    seed.fill(0);
                    throw new ApnError("APN_NATIVE_REJECTED", "The separate TRON key could not be generated.");
                }
                finally {
                    bytes.fill(0);
                }
            } });
    }
    async balance(account, asset) {
        await this.currentAccount(account);
        this.requireAsset(asset);
        await this.assertNetwork();
        if (asset.kind === "token")
            await requireTronUsdt(this.rpc);
        const header = tronBlock(await this.rpc.call("walletsolidity/getnowblock", {}));
        const native = await readTronAccount(this.rpc, account.address, true);
        const amount = asset.kind === "native" ? native.balance : await tronUsdtBalance(this.rpc, account.address, true);
        return { account, asset, amountAtomic: amount.toString(), nativeBalanceAtomic: native.balance.toString(), networkIdentity: TRON_GENESIS,
            blockNumberAtomic: header.number.toString(), observedAt: this.now().toISOString(), rpcOriginHash: this.rpc.originHash };
    }
    async prepare(input) {
        const { account, asset } = input;
        await this.currentAccount(account);
        this.requireAsset(asset);
        tronAddress(input.recipient);
        if (input.recipient === account.address)
            throw new ApnError("APN_INVALID_INPUT", "The TRON recipient must differ from the sender.");
        atomic(input.amountAtomic, true);
        const cap = atomic(input.maximumFeeAtomic, true);
        await this.assertNetwork();
        const window = await readTronWindow(this.rpc, this.now);
        const p = window.parameters;
        const owner = await readTronAccount(this.rpc, account.address);
        requireTronOwner(owner, account.address);
        // A solidified activation cannot disappear in an ordinary unfinalized fork.
        const solid = tronBlock(await this.rpc.call("walletsolidity/getnowblock", {}));
        const recipient = await readTronAccount(this.rpc, input.recipient, true);
        if (solid.number > window.header.number || asset.kind === "native" && !recipient.normal)
            throw new ApnError("APN_OPERATION_BLOCKED", "The TRON recipient or reference state is not admitted by this transfer profile.");
        let tokenBalance = 0n;
        let estimate = 0n;
        if (asset.kind === "token") {
            await requireTronUsdt(this.rpc);
            tokenBalance = await tronUsdtBalance(this.rpc, account.address);
            if (tokenBalance < atomic(input.amountAtomic))
                insufficientAsset();
            estimate = await tronEnergyEstimate(this.rpc, account.address, input.recipient, input.amountAtomic);
        }
        const intent = { token: asset.kind === "token", sender: account.address, recipient: input.recipient, amountAtomic: input.amountAtomic,
            blockId: window.header.id, timestamp: window.header.timestamp.toString(), expiration: window.expiration.toString() };
        const maximumEnergy = asset.kind === "token" ? atomic(p.maximumFeeLimitAtomic) : 0n;
        const trial = buildTronTransaction({ ...intent, energyFeeLimitAtomic: maximumEnergy.toString() });
        const reserve = tronBandwidthBytes(BigInt(trial.raw_data_hex.length / 2)) * atomic(p.bandwidthPriceAtomic);
        let energyLimit = 0n;
        if (asset.kind === "token") {
            if (cap <= reserve)
                feeExceeded();
            energyLimit = cap - reserve < maximumEnergy ? cap - reserve : maximumEnergy;
            // fee_limit bounds caller Energy including stake; stake does not raise it.
            if (estimate > energyLimit / atomic(p.energyPriceAtomic))
                feeExceeded();
        }
        const transaction = buildTronTransaction({ ...intent, energyFeeLimitAtomic: energyLimit.toString() });
        const rawSize = BigInt(transaction.raw_data_hex.length / 2);
        const bytes = tronBandwidthBytes(rawSize);
        const bandwidth = bytes * atomic(p.bandwidthPriceAtomic);
        const creates = asset.kind === "native" && !recipient.exists;
        const activation = creates ? atomic(p.systemCreateFeeAtomic) : 0n;
        const creationCost = activation + (creates ? atomic(p.fixedCreateBandwidthFeeAtomic) : 0n);
        const total = asset.kind === "token" ? bandwidth + energyLimit : bandwidth > creationCost ? bandwidth : creationCost;
        if (total > cap)
            feeExceeded();
        requireFunds(owner.balance, tokenBalance, atomic(input.amountAtomic), total, asset.kind === "native");
        if (BigInt(this.now().getTime()) + 10000n >= window.expiration)
            tronReprepare();
        const resources = { schemaVersion: "apn.tron-resources.v1", protocolVersion: "4.8.2.1", parameters: p, parameterHash: hashObject(p),
            referenceBlockId: window.header.id, referenceBlockNumberAtomic: window.header.number.toString(), referenceTimestampMsAtomic: window.header.timestamp.toString(),
            nextMaintenanceMsAtomic: window.nextMaintenance.toString(), expirationMsAtomic: window.expiration.toString(), rawDataBytesAtomic: rawSize.toString(),
            bandwidthBytesAtomic: bytes.toString(), bandwidthMaximumAtomic: bandwidth.toString(), energyFeeLimitAtomic: energyLimit.toString(), energyEstimateAtomic: estimate.toString(),
            accountActivationMaximumAtomic: activation.toString(), recipientActivatedAtSolidHead: recipient.exists, recipientSolidHeadNumberAtomic: solid.number.toString(), recipientSolidHeadId: solid.id,
            totalFeeMaximumAtomic: total.toString(), costRule: asset.kind === "token" ? "energy_limit_plus_bandwidth" : creates ? "native_activation_or_bandwidth" : "ordinary_bandwidth" };
        return validateRailPrepared({ rail: "tron", networkIdentity: TRON_GENESIS, asset, sender: account.address, recipient: input.recipient,
            amountAtomic: input.amountAtomic, maximumFeeAtomic: input.maximumFeeAtomic, preparedAt: input.now.toISOString(), expiresAt: new Date(Number(window.expiration)).toISOString(),
            blockReference: window.header.id, lastValidBlockHeight: null, unsignedPayload: canonicalJson(transaction), sourceTokenAccount: null, destinationTokenAccount: null, createsRecipientAccount: creates, resources,
            economics: { networkFeeMaximumAtomic: total.toString(), recipientRentAtomic: "0", maximumNativeDebitAtomic: total.toString(), networkFeePayer: account.address, rentPayer: null, feeControl: "tron_governance_window" },
        }, account);
    }
    async revalidate(account, prepared) {
        await this.currentAccount(account);
        validateRailPrepared(prepared, account);
        unsignedTronPrepared(prepared);
        await this.assertNetwork();
        const snapshot = prepared.resources;
        if (snapshot === undefined)
            mismatch();
        await revalidateTronWindow(this.rpc, snapshot, this.now);
        const owner = await readTronAccount(this.rpc, account.address);
        requireTronOwner(owner, account.address);
        let token = 0n;
        if (prepared.asset.kind === "native") {
            const recipient = await readTronAccount(this.rpc, prepared.recipient, true);
            if (!recipient.normal || snapshot.recipientActivatedAtSolidHead && !recipient.exists)
                tronReprepare();
        }
        else {
            await requireTronUsdt(this.rpc);
            token = await tronUsdtBalance(this.rpc, account.address);
            const estimate = await tronEnergyEstimate(this.rpc, account.address, prepared.recipient, prepared.amountAtomic);
            if (estimate > atomic(snapshot.energyFeeLimitAtomic) / atomic(snapshot.parameters.energyPriceAtomic))
                tronReprepare();
        }
        requireFunds(owner.balance, token, atomic(prepared.amountAtomic), atomic(snapshot.totalFeeMaximumAtomic), prepared.asset.kind === "native");
        if (BigInt(this.now().getTime()) + 10000n >= atomic(snapshot.expirationMsAtomic))
            tronReprepare();
    }
    async sign(binding) {
        const previous = await this.recoverEffect(binding);
        if (previous !== null)
            return previous;
        await this.revalidate(binding.account, binding.prepared);
        const effect = await this.storage.withSeed(binding.account, async (seed) => {
            const transaction = signTronTransaction(binding.prepared, seed);
            const rawPayload = canonicalJson(transaction);
            return { operationId: binding.operationId, fingerprint: binding.fingerprint, transactionId: transaction.txID, rawPayload, rawPayloadHash: sha256(rawPayload) };
        });
        validateTronEffect(binding.prepared, effect);
        await this.storage.saveEffect(binding.account, effect);
        return effect;
    }
    async recoverEffect(binding) {
        await this.currentAccount(binding.account);
        const effect = await this.storage.effect(binding.account, binding.operationId, binding.fingerprint);
        if (effect !== null)
            validateTronEffect(binding.prepared, effect);
        return effect;
    }
    async submit(binding, effect) {
        if (effect === null)
            mismatch();
        const stored = await this.recoverEffect(binding);
        if (stored === null || canonicalJson(stored) !== canonicalJson(effect))
            mismatch();
        const transaction = validateTronEffect(binding.prepared, effect);
        await this.revalidate(binding.account, binding.prepared);
        const result = tronRecord(await this.rpc.call("wallet/broadcasttransaction", transaction));
        if (result.result !== true || result.txid !== effect.transactionId)
            throw new ApnError("APN_RPC_AMBIGUOUS", "TRON did not acknowledge the exact frozen transaction identity.");
        return { transactionId: effect.transactionId };
    }
    async inspect(account, prepared, transactionId, expectedRawPayloadHash) {
        await this.currentAccount(account);
        validateRailPrepared(prepared, account);
        if (expectedRawPayloadHash === undefined)
            mismatch();
        return await inspectTron(this.rpc, account, prepared, transactionId, expectedRawPayloadHash, this.now());
    }
    async assertValidityExpired(account, prepared, transactionId) {
        await this.currentAccount(account);
        validateRailPrepared(prepared, account);
        await assertTronNetwork(this.rpc);
        const snapshot = prepared.resources;
        if (snapshot === undefined || unsignedTronPrepared(prepared).txID !== transactionId)
            mismatch();
        // Consensus checks expiration against the previous head, so no block after this solidified head can include it.
        if (tronBlock(await this.rpc.call("walletsolidity/getnowblock", {})).timestamp <= atomic(snapshot.expirationMsAtomic) + 3000n)
            validityOpen();
        const body = tronRecord(await this.rpc.call("walletsolidity/gettransactionbyid", { value: transactionId }));
        const info = tronRecord(await this.rpc.call("walletsolidity/gettransactioninfobyid", { value: transactionId }));
        if (Object.keys(body).length !== 0 || Object.keys(info).length !== 0)
            validityOpen();
    }
    requireAsset(asset) { if (canonicalJson(asset) !== canonicalJson(this.asset(asset.alias)))
        mismatch(); }
    async currentAccount(account) {
        const stored = await this.account(account.profile);
        if (stored === null || canonicalJson(stored) !== canonicalJson(account))
            mismatch();
    }
}
function requireFunds(native, token, amount, maximumFee, isNative) {
    if (!isNative && token < amount)
        insufficientAsset();
    if (native < maximumFee + (isNative ? amount : 0n))
        throw new ApnError("APN_INSUFFICIENT_GAS", "The TRON balance does not cover the full frozen native debit bound.");
}
function insufficientAsset() { throw new ApnError("APN_INSUFFICIENT_ASSET", "The canonical USDT balance is insufficient."); }
function feeExceeded() { throw new ApnError("APN_FEE_BUDGET_EXCEEDED", "TRON Bandwidth, activation or Energy cannot fit the selected total TRX fee cap."); }
function mismatch() { throw new ApnError("APN_WALLET_MISMATCH", "The TRON account, asset or sealed effect does not match this operation."); }
function validityOpen() { throw new ApnError("APN_OPERATION_BLOCKED", "The TRON transfer is still inside its validity window or visible in solidified history; use operation resume."); }
//# sourceMappingURL=local-adapter.js.map