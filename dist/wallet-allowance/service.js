import { randomBytes } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, domainHash, sha256 } from "../canonical.js";
import { EncryptedWalletStore, walletEnvelopeIdentity } from "../encrypted-wallet-store.js";
import { ApnError } from "../errors.js";
import { conflictDomainKey, evmConflictDomain } from "../operation-conflict-domain.js";
import { admitOperation } from "../operation-index/admission.js";
import { StateStore } from "../state.js";
import { canonicalProfile } from "../wallet-policy.js";
import { x402ProofTag } from "../x402-network.js";
import { observeRevoke, readRevokePrepare, revokeData, verifyRevokeRaw } from "./chain.js";
import { newWalletAllowanceRevoke, transitionWalletAllowanceRevoke, WALLET_ALLOWANCE_REVOKE_FAMILY, walletAllowanceSlot } from "./model.js";
import { WalletAllowanceRevokeRepository } from "./repository.js";
const CONSENT_WINDOW_MS = 240_000;
/**
 * `wallet allowance revoke`: one owner-approved `approve(spender, 0)` from the profile's local wallet, sent once and
 * observed to its proof. Revoking only removes a permission, so no asset admission applies; the profile, chain, token and
 * spender name one slot, and a repeat of the command continues that slot's open revoke instead of starting another.
 */
export class WalletAllowanceRevokeService {
    ports;
    records;
    state;
    constructor(root, ports) {
        this.ports = ports;
        this.records = new WalletAllowanceRevokeRepository(root);
        this.state = new StateStore(root);
    }
    now() { return new Date(Math.floor(this.ports.now().getTime() / 1000) * 1000); }
    async write(id, check, next) {
        return await this.records.withLocks([`operation:${id}`], async () => {
            const current = await this.records.required(id);
            if (!check(current))
                throw new ApnError("APN_OPERATION_BLOCKED", "The allowance revoke operation changed meanwhile.");
            return await this.records.persistLocked(transitionWalletAllowanceRevoke(current, next(current)));
        });
    }
    /** The slot's open revoke, or a new frozen one after the allowance read (refused when it is already zero); nothing is signed. */
    async prepare(request) {
        const profile = canonicalProfile(request.profile), profileHash = this.state.profileHash(profile);
        const owner = await localWalletAddress(this.state, profile), slot = walletAllowanceSlot({ profileHash, terms: { chainId: request.chainId, token: request.token, spender: request.spender } });
        const requestHash = domainHash("apn.wallet-allowance-revoke.request.v1", canonicalJson({ profileHash, chainId: request.chainId, token: request.token,
            spender: request.spender, maxGasLimit: request.maxGasLimit, maxFeePerGasWei: request.maxFeePerGasWei, maxPriorityFeePerGasWei: request.maxPriorityFeePerGasWei }));
        await this.records.ready();
        const open = await this.openRevoke(slot, requestHash);
        // Each revoke of a slot is a new operation (a later one follows a terminal one); the slot, not the ID, finds an open one.
        const preparedAt = this.now(), operationId = domainHash("apn.wallet-allowance-revoke.operation-id.v1", canonicalJson({ slot,
            preparedAt: preparedAt.toISOString(), unique: randomBytes(16).toString("hex") }));
        const idempotencyHash = sha256(`idempotency\0wallet-allowance-revoke.v1\0${operationId}`);
        return open ?? await this.records.withLocks([`profile:${profileHash}`, `operation:${operationId}`], async () => {
            const raced = await this.openRevoke(slot, requestHash);
            if (raced !== null)
                return raced;
            return await admitOperation(this.records, { family: WALLET_ALLOWANCE_REVOKE_FAMILY, profileHash, operationId, idempotencyHash, requestHash }, [{ key: conflictDomainKey(evmConflictDomain(request.chainId, owner)) }], async () => {
                const read = await readRevokePrepare(this.ports.rpc, { chainId: request.chainId, owner, token: request.token, spender: request.spender });
                if (read.allowanceAtomic === "0")
                    refuse("wallet_allowance_nothing_to_revoke", `The allowance of ${request.token} to ${request.spender} is already zero; nothing to revoke.`);
                const gas = BigInt(request.maxGasLimit), maxFee = BigInt(request.maxFeePerGasWei), priority = BigInt(request.maxPriorityFeePerGasWei);
                if (priority > maxFee)
                    refuse("wallet_allowance_fee_order", "The priority fee cap exceeds the fee cap.");
                if (read.gasEstimate > gas)
                    refuse("wallet_allowance_gas_cap", `The revoke needs ${read.gasEstimate} gas, above the owner's ${gas}.`);
                if (read.baseFeeWei + priority > maxFee)
                    refuse("wallet_allowance_fee_cap", `The base fee ${read.baseFeeWei} wei plus priority exceeds the owner's fee cap.`);
                if (read.nativeBalanceWei < gas * maxFee)
                    refuse("wallet_allowance_native_balance", "The wallet's native balance cannot cover the owner's gas cap.");
                return await this.records.persistLocked(newWalletAllowanceRevoke({ operationId, profile, profileHash, idempotencyHash, requestHash,
                    terms: { chainId: request.chainId, proofTag: x402ProofTag(request.chainId), rpcSetting: this.ports.rpcSetting, token: request.token, owner,
                        spender: request.spender, priorAllowanceAtomic: read.allowanceAtomic, nonce: read.nonce, gasLimit: gas.toString(), maxFeePerGasWei: maxFee.toString(),
                        maxPriorityFeePerGasWei: priority.toString(), maxNativeDebitWei: (gas * maxFee).toString(), era: read.era, preparedAt: preparedAt.toISOString(),
                        expiresAt: new Date(preparedAt.getTime() + CONSENT_WINDOW_MS).toISOString() } }));
            });
        });
    }
    /** Consent, seal, mark and send once; a repeat continues where the record stands and never sends twice. */
    async execute(start) {
        let record = start;
        if (record.state === "prepared") {
            await this.ports.consent(record);
            const raw = await this.sign(record), transactionHash = await verifyRevokeRaw(record.terms, raw);
            record = await this.write(record.operationId, (current) => current.state === "prepared" && this.now().getTime() < Date.parse(current.terms.expiresAt), () => ({ state: "signed", at: this.now().toISOString(), reason: "owner_approved_and_sealed", signed: { rawTransaction: raw, transactionHash } }));
        }
        if (record.state === "submitted")
            return await this.observe(record.operationId);
        if (record.state !== "signed")
            return record;
        record = await this.write(record.operationId, (current) => current.state === "signed", () => ({ state: "submitted", at: this.now().toISOString(),
            reason: "single_send_started", submittedAt: this.now().toISOString() }));
        try {
            if (await this.ports.rpc.send(record.signed.rawTransaction) !== record.signed.transactionHash) {
                throw new ApnError("APN_RPC_AMBIGUOUS", "The RPC returned another transaction hash.");
            }
        }
        catch (error) {
            // The send may have reached the network: the record stays submitted and only observation decides.
            if (!(error instanceof ApnError))
                throw error;
        }
        return record;
    }
    /** One bounded observation: a receipt at the proof tag, the chain's never-lands proof, or an expired unsigned preparation. */
    async observe(operationId) {
        const record = await this.records.required(operationId);
        return await observeWalletAllowanceRevoke(this.records, this.ports.rpc, record, () => this.now());
    }
    /** The slot's open revoke: an unsigned one past its window closes first; one with other gas caps is refused. */
    async openRevoke(slot, requestHash) {
        let open = await this.records.open(slot);
        if (open?.state === "prepared" && this.now().getTime() >= Date.parse(open.terms.expiresAt)) {
            open = await this.observe(open.operationId);
            if (open.terminal)
                return null;
        }
        if (open !== null && open.requestHash !== requestHash) {
            throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "An open revoke of this allowance carries other gas caps; finish it first.", { reason: "wallet_allowance_revoke_open", operationId: open.operationId, nextActions: [`apn operation status --operation ${open.operationId}`] });
        }
        return open;
    }
    async sign(record) {
        const wallets = new EncryptedWalletStore(this.state, this.ports.wrapping), wallet = await wallets.describe(record.profile);
        if (wallet === null)
            throw new ApnError("APN_OPERATION_BLOCKED", "The encrypted local wallet is missing.", { reason: "wallet_allowance_local_wallet_required" });
        try {
            const account = privateKeyToAccount(wallet.secret.privateKey), t = record.terms;
            if (wallet.identity.profile !== record.profile || account.address !== t.owner)
                throw new ApnError("APN_WALLET_MISMATCH", "The local wallet is not the frozen owner.");
            return await account.signTransaction({ type: "eip1559", chainId: t.chainId, to: t.token, data: revokeData(t.spender), value: 0n,
                nonce: Number(t.nonce), gas: BigInt(t.gasLimit), maxFeePerGas: BigInt(t.maxFeePerGasWei), maxPriorityFeePerGas: BigInt(t.maxPriorityFeePerGasWei), accessList: [] });
        }
        finally {
            wallets.clear(wallet.secret);
        }
    }
}
/** The observation shared by the command and `apn operation status`; it never signs or sends. */
export async function observeWalletAllowanceRevoke(records, rpc, record, now) {
    if (record.terminal)
        return record;
    const write = async (next) => await records.withLocks([`operation:${record.operationId}`], async () => {
        const current = await records.required(record.operationId);
        if (current.integrityHash !== record.integrityHash)
            throw new ApnError("APN_OPERATION_BLOCKED", "The allowance revoke operation changed meanwhile.");
        return await records.persistLocked(transitionWalletAllowanceRevoke(current, next));
    });
    const at = now().toISOString();
    if (record.state === "prepared") {
        if (now().getTime() < Date.parse(record.terms.expiresAt))
            return record;
        return await write({ state: "failed_before_effect", at, reason: "consent_window_expired_unsigned" });
    }
    const seen = await observeRevoke(rpc, record, now());
    if (seen.kind === "pending")
        return record;
    if (seen.kind === "never_lands")
        return await write({ state: "superseded", at, reason: "finalized_nonce_spent_elsewhere",
            outcome: { kind: "never_lands", finalizedNonce: seen.finalizedNonce, observedAt: at } });
    if (record.state === "signed")
        throw new ApnError("APN_STATE_CORRUPT", "A sealed revoke that was never sent has a receipt.");
    return await write({ state: seen.outcome.status === "success" ? "completed" : "reverted", at,
        reason: seen.outcome.status === "success" ? "receipt_at_proof_tag" : "reverted_at_proof_tag", outcome: seen.outcome });
}
/** The owner's exit (TTY consent by the caller) for a sealed or sent revoke no proof decides; it may still land. */
export async function abandonWalletAllowanceRevoke(root, operationId, now, approve) {
    const records = new WalletAllowanceRevokeRepository(root), record = await records.required(operationId);
    if (record.terminal)
        return record;
    if (record.state === "prepared")
        throw new ApnError("APN_OPERATION_BLOCKED", "An unsigned revoke ends by itself once its window passes.", { reason: "wallet_allowance_revoke_unsigned", nextActions: [`apn operation status --operation ${operationId}`] });
    await approve(record);
    return await records.withLocks([`operation:${operationId}`], async () => {
        const current = await records.required(operationId);
        if (current.integrityHash !== record.integrityHash)
            throw new ApnError("APN_OPERATION_BLOCKED", "The allowance revoke operation changed meanwhile.");
        return await records.persistLocked(transitionWalletAllowanceRevoke(current, { state: "abandoned_unknown", at: now().toISOString(), reason: "owner_abandoned_unknown" }));
    });
}
/** The public address of the profile's encrypted local wallet (the key that signs), read without decrypting it. */
export async function localWalletAddress(state, profile) {
    const envelope = await state.loadEncryptedWalletEnvelope(profile);
    if (envelope === null)
        throw new ApnError("APN_OPERATION_BLOCKED", "The profile has no local EVM wallet.", { reason: "wallet_allowance_local_wallet_required" });
    return walletEnvelopeIdentity(envelope, profile).address;
}
function refuse(reason, message) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=service.js.map