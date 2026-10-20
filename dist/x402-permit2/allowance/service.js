import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, domainHash, sha256 } from "../../canonical.js";
import { loadActiveAssetPolicyRegistry } from "../../allowlist-active-policy.js";
import { ASSET_POLICY_REGISTRY_SCHEMA_V2 } from "../../asset-policy-registry.js";
import { EncryptedWalletStore } from "../../encrypted-wallet-store.js";
import { ApnError } from "../../errors.js";
import { evmConflictDomain, conflictDomainKey } from "../../operation-conflict-domain.js";
import { admitOperation } from "../../operation-index/admission.js";
import { policyBinding } from "../../profile-policy.js";
import { StateStore } from "../../state.js";
import { canonicalIdempotencyKey } from "../../transfer-policy.js";
import { canonicalProfile } from "../../wallet-policy.js";
import { networkPolicyBinding, x402Asset, x402ProofTag } from "../../x402-network.js";
import { PERMIT2_ADDRESS, X402_PERMIT2_MECHANISM } from "../registry.js";
import { observePermit2Allowance, permit2ApproveData, readPermit2AllowancePrepare, verifyPermit2AllowanceRaw } from "./chain.js";
import { newPermit2Allowance, transitionPermit2Allowance } from "./model.js";
import { Permit2AllowanceRepository } from "./repository.js";
const CONSENT_WINDOW_MS = 240_000;
/**
 * `x402 permit2 allowance set|revoke`: one owner-approved ERC-20 approve of an owner-specified, bounded amount to the
 * canonical Permit2 contract (or to zero), signed by the local wallet, sent once and observed to its proof.
 */
export class Permit2AllowanceService {
    root;
    ports;
    records;
    state;
    constructor(root, ports) {
        this.root = root;
        this.ports = ports;
        this.records = new Permit2AllowanceRepository(root);
        this.state = new StateStore(root);
    }
    now() { return new Date(Math.floor(this.ports.now().getTime() / 1000) * 1000); }
    async write(id, check, next) {
        return await this.records.withLocks([`operation:${id}`], async () => {
            const current = await this.records.required(id);
            if (!check(current))
                throw new ApnError("APN_OPERATION_BLOCKED", "The Permit2 allowance operation changed meanwhile.");
            return await this.records.persistLocked(transitionPermit2Allowance(current, next(current)));
        });
    }
    async prepare(request) {
        const profile = canonicalProfile(request.profile), key = canonicalIdempotencyKey(request.idempotencyKey), asset = x402Asset(request.chainId, request.token);
        const profileHash = this.state.profileHash(profile);
        const operationId = domainHash("apn.x402-permit2-allowance.operation-id.v1", canonicalJson({ profileHash, key }));
        const requestHash = domainHash("apn.x402-permit2-allowance.request.v1", canonicalJson({ profileHash, ...request, profile, idempotencyKey: key }));
        await this.records.ready();
        const saved = await this.records.find(operationId);
        if (saved !== null)
            return replay(saved, requestHash);
        const wallet = await this.state.loadWallet(profileHash);
        if (wallet === null)
            throw new ApnError("APN_OPERATION_BLOCKED", "The profile has no local EVM wallet.", { reason: "x402_permit2_local_wallet_required" });
        const owner = wallet.address, admission = await this.admission(profile, asset.chainId, asset.token, request);
        const idempotencyHash = sha256(`idempotency\0x402-permit2-allowance.v1\0${profileHash}\0${key}`);
        return await this.records.withLocks([`profile:${profileHash}`, `operation:${operationId}`], async () => {
            const existing = await this.records.find(operationId);
            if (existing !== null)
                return replay(existing, requestHash);
            return await admitOperation(this.records, { family: "permit2_allowance", profileHash, operationId, idempotencyHash, requestHash }, [{ key: conflictDomainKey(evmConflictDomain(asset.chainId, owner)) }], async () => {
                const read = await readPermit2AllowancePrepare(this.ports.rpc, { chainId: asset.chainId, owner, token: asset.token, amountAtomic: request.amountAtomic });
                const gas = BigInt(request.maxGasLimit), maxFee = BigInt(request.maxFeePerGasWei), priority = BigInt(request.maxPriorityFeePerGasWei);
                if (priority > maxFee)
                    refuse("x402_permit2_allowance_fee_order", "The priority fee cap exceeds the fee cap.");
                if (read.gasEstimate > gas)
                    refuse("x402_permit2_allowance_gas_cap", `The approve needs ${read.gasEstimate} gas, above the owner's ${gas}.`);
                if (read.baseFeeWei + priority > maxFee)
                    refuse("x402_permit2_allowance_fee_cap", `The base fee ${read.baseFeeWei} wei plus priority exceeds the owner's fee cap.`);
                if (read.nativeBalanceWei < gas * maxFee)
                    refuse("x402_permit2_allowance_native_balance", "The wallet's native balance cannot cover the owner's gas cap.");
                if (read.allowanceAtomic === request.amountAtomic)
                    refuse("x402_permit2_allowance_unchanged", "The allowance to Permit2 already has this value.");
                const now = this.now();
                return await this.records.persistLocked(newPermit2Allowance({ operationId, profile, profileHash, idempotencyHash, requestHash, terms: {
                        action: request.action, chainId: asset.chainId, proofTag: x402ProofTag(asset.chainId), token: asset.token, owner, spender: PERMIT2_ADDRESS,
                        amountAtomic: request.amountAtomic, priorAllowanceAtomic: read.allowanceAtomic, admission, nonce: read.nonce, gasLimit: gas.toString(),
                        maxFeePerGasWei: maxFee.toString(), maxPriorityFeePerGasWei: priority.toString(), maxNativeDebitWei: (gas * maxFee).toString(), era: read.era,
                        rpcOrigin: this.ports.rpc.origin, preparedAt: now.toISOString(), expiresAt: new Date(now.getTime() + CONSENT_WINDOW_MS).toISOString()
                    } }));
            });
        });
    }
    /** Consent, seal, mark and send once; a replay continues where the record stands and never sends twice. */
    async execute(operationId) {
        let record = await this.records.required(operationId);
        if (record.state === "prepared") {
            if (this.now().getTime() >= Date.parse(record.terms.expiresAt))
                return await this.observe(operationId);
            await this.ports.consent(record);
            const raw = await this.sign(record);
            const transactionHash = await verifyPermit2AllowanceRaw(record.terms, raw);
            record = await this.write(operationId, (current) => current.state === "prepared" && this.now().getTime() < Date.parse(current.terms.expiresAt), () => ({ state: "signed", at: this.now().toISOString(), reason: "owner_approved_and_sealed", signed: { rawTransaction: raw, transactionHash } }));
        }
        if (record.state !== "signed")
            return record;
        record = await this.write(operationId, (current) => current.state === "signed", () => ({ state: "submitted", at: this.now().toISOString(),
            reason: "single_send_started", submittedAt: this.now().toISOString() }));
        const raw = record.signed.rawTransaction;
        try {
            if (await this.ports.rpc.send(raw) !== record.signed.transactionHash)
                throw new ApnError("APN_RPC_AMBIGUOUS", "The RPC returned another transaction hash.");
        }
        catch (error) {
            if (!(error instanceof ApnError))
                throw error;
            // The send may have reached the network: the record stays submitted and only observation decides.
            return record;
        }
        return record;
    }
    /** One bounded observation: a receipt at the proof tag, the chain's never-lands proof, or an expired unsigned preparation. */
    async observe(operationId) {
        const record = await this.records.required(operationId);
        if (record.terminal)
            return record;
        if (record.state === "prepared") {
            if (this.now().getTime() < Date.parse(record.terms.expiresAt))
                return record;
            return await this.write(operationId, (current) => current.state === "prepared", () => ({ state: "failed_before_effect", at: this.now().toISOString(),
                reason: "consent_window_expired_unsigned" }));
        }
        const seen = await observePermit2Allowance(this.ports.rpc, record, this.now());
        if (seen.kind === "pending")
            return record;
        const at = this.now().toISOString(), same = (current) => current.integrityHash === record.integrityHash;
        if (seen.kind === "never_lands")
            return await this.write(operationId, same, () => ({ state: "superseded", at, reason: "finalized_nonce_spent_elsewhere",
                outcome: { kind: "never_lands", finalizedNonce: seen.finalizedNonce, observedAt: at } }));
        if (record.state === "signed")
            throw new ApnError("APN_STATE_CORRUPT", "A sealed approve that was never sent has a receipt.");
        return await this.write(operationId, same, () => ({ state: seen.outcome.status === "success" ? "completed" : "reverted", at,
            reason: seen.outcome.status === "success" ? "receipt_at_proof_tag" : "reverted_at_proof_tag", outcome: seen.outcome }));
    }
    /** The owner admits the chain+token for x402 (profile policy, else the allowlist Permit2 row); the amount stays within its cap. */
    async admission(profile, chainId, token, request) {
        if (request.action === "revoke")
            return { source: "revoke", boundAtomic: null, digest: null };
        const wallet = await this.state.loadWallet(this.state.profileHash(profile));
        const policy = wallet === null ? null : await this.ports.policy.load(networkPolicyBinding(policyBinding(wallet), x402Asset(chainId, token)));
        let bound, source = "profile_x402_policy", digest;
        if (policy !== null) {
            bound = policy.maxBalanceUsdcAtomic;
            digest = policy.integrityHash;
        }
        else {
            const active = await loadActiveAssetPolicyRegistry(this.root, profile, this.now());
            const row = active?.registry.chains.find((chain) => chain.family === "evm" && chain.chain === `eip155:${chainId}`)?.assets
                .find((asset) => asset.kind === "token" && asset.identifier?.toLowerCase() === token.toLowerCase() && asset.rails.x402 &&
                asset.mechanismPins?.x402?.provider === X402_PERMIT2_MECHANISM.provider);
            const caps = row === undefined ? undefined : active.registry.schemaVersion === ASSET_POLICY_REGISTRY_SCHEMA_V2 ? row.railCaps?.x402 : row.caps;
            if (caps !== undefined) {
                bound = caps.dailyLimitAtomic;
                source = "allowlist_permit2_row";
                digest = active.digest;
            }
        }
        if (bound === undefined || digest === undefined) {
            refuse("x402_permit2_allowance_not_admitted", `No owner x402 policy or allowlist Permit2 row admits ${token} on eip155:${chainId}.`);
        }
        if (BigInt(request.amountAtomic) > BigInt(bound)) {
            refuse("x402_permit2_allowance_above_cap", `The allowance ${request.amountAtomic} exceeds the owner's cap ${bound} for this token.`);
        }
        return { source, boundAtomic: bound, digest };
    }
    async sign(record) {
        const wallets = new EncryptedWalletStore(this.state, this.ports.wrapping), wallet = await wallets.describe(record.profile);
        if (wallet === null)
            throw new ApnError("APN_OPERATION_BLOCKED", "The encrypted local wallet is missing.");
        try {
            const account = privateKeyToAccount(wallet.secret.privateKey), t = record.terms;
            if (wallet.identity.profile !== record.profile || account.address !== t.owner)
                throw new ApnError("APN_WALLET_MISMATCH", "The local wallet is not the frozen owner.");
            return await account.signTransaction({ type: "eip1559", chainId: t.chainId, to: t.token, data: permit2ApproveData(t.amountAtomic), value: 0n,
                nonce: Number(t.nonce), gas: BigInt(t.gasLimit), maxFeePerGas: BigInt(t.maxFeePerGasWei), maxPriorityFeePerGas: BigInt(t.maxPriorityFeePerGasWei), accessList: [] });
        }
        finally {
            wallets.clear(wallet.secret);
        }
    }
}
/** The owner's exit (TTY consent by the caller) for a sealed or sent approve no proof decides; it may still land. */
export async function abandonPermit2Allowance(root, operationId, now, approve) {
    const records = new Permit2AllowanceRepository(root), record = await records.required(operationId);
    if (record.terminal)
        return record;
    if (record.state === "prepared")
        throw new ApnError("APN_OPERATION_BLOCKED", "An unsigned approve ends by itself once its window passes.", { reason: "x402_permit2_allowance_unsigned", nextActions: [`apn x402 permit2 allowance observe --operation ${operationId} --rpc-url <https-rpc>`] });
    await approve(record);
    return await records.withLocks([`operation:${operationId}`], async () => {
        const current = await records.required(operationId);
        if (current.integrityHash !== record.integrityHash)
            throw new ApnError("APN_OPERATION_BLOCKED", "The Permit2 allowance operation changed meanwhile.");
        return await records.persistLocked(transitionPermit2Allowance(current, { state: "abandoned_unknown", at: now().toISOString(), reason: "owner_abandoned_unknown" }));
    });
}
function replay(saved, requestHash) {
    if (saved.requestHash !== requestHash)
        throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "The idempotency key names a different Permit2 allowance.");
    return saved;
}
function refuse(reason, message) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=service.js.map