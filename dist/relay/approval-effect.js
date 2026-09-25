/** Internal, single-attempt approval leg. No signer, network, or command is wired here. */
import { randomBytes } from "node:crypto";
import { keccak256, parseTransaction, recoverTransactionAddress, toBytes } from "viem";
import { hashObject, domainHash, canonicalJson } from "../canonical.js";
import { EncryptedWalletStore, walletCustodyLock } from "../encrypted-wallet-store.js";
import { ApnError } from "../errors.js";
import { RelayRetirementRepository, RelayUnsignedOperationRepository, validateRelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { bridgeMechanismAdmitted, evaluateAssetPolicy } from "../asset-policy-registry.js";
import { RelayEffectJournalRepository } from "./effect-journal.js";
import { ETHEREUM_DEPOSITORY, ETHEREUM_USDC } from "./quote.js";
import { relayExecutionRoute } from "./execution-route.js";
const TX = /^0x[0-9a-fA-F]+$/u;
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const topic = keccak256(toBytes("Approval(address,address,uint256)"));
function blocked(reason) { throw new ApnError("APN_OPERATION_BLOCKED", "Relay approval effect is blocked.", { reason }); }
function corrupt(reason) { throw new ApnError("APN_STATE_CORRUPT", `Relay approval effect is invalid: ${reason}.`); }
function binding(op) {
    return domainHash("apn.relay-approval-envelope.v1", canonicalJson({ operationId: op.operationId,
        quoteDigest: op.quoteDigest, approval: op.quote.approval }));
}
function key(op) {
    return domainHash("apn.relay-approval-custody.v1", canonicalJson({ operationId: op.operationId }));
}
function depositKey(op) {
    return domainHash("apn.relay-deposit-custody.v1", canonicalJson({ operationId: op.operationId }));
}
function nativeDepositKey(op) {
    return domainHash("apn.relay-native-deposit-custody.v1", canonicalJson({ operationId: op.operationId }));
}
/** Reuses the existing AES-GCM encrypted wallet secret and hash-bound direct-effect slot. */
export class RelayEncryptedApprovalCustody {
    state;
    wallets;
    constructor(state, wrapping) {
        this.state = state;
        this.wallets = new EncryptedWalletStore(state, wrapping);
    }
    /** Hold the wallet mutation lock through a local retirement transition. A
     * damaged or unreadable envelope must not be treated as empty custody. */
    async withNoMaterial(op, action, profile = "default") {
        return this.state.withLocks([walletCustodyLock(this.state, profile)], async () => {
            if (await this.state.loadEncryptedWalletEnvelope(profile) !== null) {
                const wallet = await this.wallets.describe(profile);
                if (wallet === null)
                    corrupt("custody envelope disappeared");
                try {
                    if (wallet.secret.directEffects[key(op)] !== undefined ||
                        wallet.secret.directEffects[depositKey(op)] !== undefined ||
                        (op.nativeQuote !== undefined && wallet.secret.directEffects[nativeDepositKey(op)] !== undefined))
                        blocked("signed_effect_custody_exists");
                }
                finally {
                    this.wallets.clear(wallet.secret);
                }
            }
            return action();
        });
    }
    async load(op) {
        return this.state.withLocks([walletCustodyLock(this.state, "default")], async () => this.loadLocked(op));
    }
    async loadLocked(op) {
        const wallet = await this.wallets.describe("default");
        if (wallet === null)
            return null;
        try {
            if (!same(wallet.identity.address, op.sourceAccount))
                corrupt("custody owner");
            const stored = wallet.secret.directEffects[key(op)];
            if (stored === undefined)
                return null;
            if (stored.payloadHash !== binding(op) || stored.transactionHash !== stored.rawTransactionHash ||
                keccak256(stored.rawTransaction) !== stored.transactionHash)
                corrupt("custody binding");
            return { rawTransaction: stored.rawTransaction, transactionHash: stored.transactionHash };
        }
        finally {
            this.wallets.clear(wallet.secret);
        }
    }
    async seal(op, signed) {
        await this.state.withLocks([walletCustodyLock(this.state, "default")], async () => this.sealLocked(op, signed));
    }
    async sealLocked(op, signed) {
        const wallet = await this.wallets.describe("default");
        if (wallet === null)
            blocked("encrypted_custody_missing");
        try {
            if (!same(wallet.identity.address, op.sourceAccount))
                corrupt("custody owner");
            if (wallet.secret.directEffects[key(op)] !== undefined)
                blocked("signed_effect_already_sealed");
            const verified = await verifySigned(op, signed.rawTransaction, signed.transactionHash);
            const entry = { payloadHash: binding(op), transactionHash: verified.transactionHash,
                rawTransaction: verified.rawTransaction, rawTransactionHash: verified.transactionHash };
            wallet.secret.directEffects[key(op)] = entry;
            await this.wallets.save(wallet.identity, wallet.secret);
        }
        finally {
            this.wallets.clear(wallet.secret);
        }
    }
}
/** A resumed call never signs again and never sends after `submitting` is durable. */
export class RelayApprovalEffectService {
    state;
    ports;
    operations;
    effects;
    constructor(state, ports) {
        this.state = state;
        this.ports = ports;
        this.operations = new RelayUnsignedOperationRepository(state.root);
        this.effects = new RelayEffectJournalRepository(state.root);
    }
    async run(operationId) {
        if (!/^[a-f0-9]{64}$/u.test(operationId))
            blocked("operation_id");
        const profileHash = this.state.profileHash("default");
        return this.state.withLocks([`relay-approval:${profileHash}:${operationId}`], async () => {
            const op = await this.operations.loadOperation(profileHash, operationId);
            if (op === null)
                blocked("prepared_operation_missing");
            if (await new RelayRetirementRepository(this.state.root).load(op) !== null)
                blocked("operation_retired");
            this.assertEnvelope(op);
            let journal = await this.effects.load(profileHash, operationId);
            // Refusals that occur before any effect intent must not strand a pending journal.
            // The runtime can then prove that its cap reservation is safe to release.
            const firstNonce = journal === null ? await this.revalidate(op) : null;
            if (journal === null)
                journal = await this.effects.create(profileHash, operationId, this.ports.now().toISOString());
            let effect = journal.effects[0];
            if (effect.phase === "confirmed" || effect.phase === "failed")
                return journal;
            if (effect.phase === "pending") {
                const nonce = firstNonce ?? await this.revalidate(op);
                journal = await this.effects.transition(profileHash, operationId, journal.integrityHash, { kind: "mark_signing", role: "approval", marker: randomBytes(32).toString("hex"), at: this.ports.now().toISOString() });
                const raw = await this.ports.sign(op);
                const signed = await verifySigned(op, raw, undefined, nonce);
                await this.ports.custody.seal(op, signed);
                effect = journal.effects[0];
            }
            if (effect.phase === "signing_started") {
                const signed = await this.ports.custody.load(op);
                if (signed === null)
                    return journal; // Signer may have run before a crash. Never call it again.
                await verifySigned(op, signed.rawTransaction, signed.transactionHash);
                journal = await this.effects.transition(profileHash, operationId, journal.integrityHash, { kind: "seal_signed", role: "approval", transactionHash: signed.transactionHash });
                effect = journal.effects[0];
            }
            if (effect.phase === "sealed") {
                const nonce = await this.revalidate(op);
                const signed = await this.ports.custody.load(op);
                if (signed === null || !same(signed.transactionHash, effect.attempt.transactionHash))
                    corrupt("sealed custody missing");
                await verifySigned(op, signed.rawTransaction, signed.transactionHash, nonce);
                journal = await this.effects.transition(profileHash, operationId, journal.integrityHash, { kind: "mark_submitting", role: "approval", at: this.ports.now().toISOString() });
                try {
                    await this.ports.send(signed.rawTransaction);
                }
                catch { /* Ambiguous send: observe saved hash only. */ }
                effect = journal.effects[0];
            }
            if (effect.phase === "submitting") {
                const hash = effect.attempt.transactionHash;
                let observed;
                try {
                    observed = await this.ports.observe(hash);
                }
                catch {
                    return journal;
                }
                if (observed === null)
                    return journal;
                const verdict = verifyApprovalObservation(op, hash, observed);
                if (verdict === "pending")
                    return journal;
                return this.effects.transition(profileHash, operationId, journal.integrityHash, { kind: "observe", role: "approval", outcome: verdict, at: this.ports.now().toISOString() });
            }
            return journal;
        });
    }
    assertEnvelope(op) {
        validateRelayUnsignedOperation(op);
        relayExecutionRoute(op);
        const quote = op.quote, approval = quote?.approval;
        if (!quote || !approval || !op.policyDigest || !op.policyRevision || !op.approvalNetworkFeeCeilingWei ||
            !op.depositNetworkFeeCeilingWei || !op.statusLocator || !quote.statusLocator ||
            op.statusLocator.requestId !== quote.statusLocator.requestId ||
            quote.quoteDigest !== op.quoteDigest || op.sourceChainId !== 1 || approval.chainId !== 1 ||
            !same(approval.from, op.sourceAccount) || !same(approval.to, ETHEREUM_USDC) ||
            !same(quote.paymentDetails.depository, ETHEREUM_DEPOSITORY) || approval.value !== "0" ||
            approval.data !== `0x095ea7b3${ETHEREUM_DEPOSITORY.slice(2).padStart(64, "0")}${BigInt(op.amountAtomic).toString(16).padStart(64, "0")}` ||
            BigInt(approval.gas) * BigInt(approval.maxFeePerGas) > BigInt(op.approvalNetworkFeeCeilingWei) ||
            BigInt(approval.maxPriorityFeePerGas) > BigInt(approval.maxFeePerGas))
            blocked("saved_approval_envelope");
    }
    async revalidate(op) {
        this.assertEnvelope(op);
        const now = this.ports.now();
        if (!Number.isFinite(now.getTime()) || now.getTime() + 60_000 >= Date.parse(op.deadline))
            blocked("quote_deadline");
        const active = await this.ports.activePolicy("default");
        if (active === null || active.profile !== "default" || active.digest !== op.policyDigest ||
            active.revision !== op.policyRevision || !same(active.accounts.evm ?? "", op.sourceAccount) ||
            (active.registry.expiresAt !== undefined && now.toISOString() >= active.registry.expiresAt))
            blocked("active_policy_or_owner");
        if (!same(await this.ports.publicAccount("default") ?? "", op.sourceAccount))
            blocked("public_owner");
        const usage = await this.ports.dailyUsage(op.sourceAccount, now);
        const admission = evaluateAssetPolicy(active.registry, { chain: "eip155:1",
            asset: { kind: "token", identifier: ETHEREUM_USDC }, rail: "bridge", amountAtomic: op.amountAtomic,
            dailyUsageAtomic: usage, asOfDate: now.toISOString().slice(0, 10), asOf: now.toISOString(),
            mechanism: { provider: "relay", reference: relayExecutionRoute(op) } });
        if (!bridgeMechanismAdmitted(admission, { provider: "relay", reference: relayExecutionRoute(op) }))
            blocked("route_pin");
        const execution = await this.ports.executionAdmission(op);
        if (execution === null || execution.requestId !== op.statusLocator?.requestId ||
            execution.operationIntegrityHash !== op.integrityHash || execution.quoteDigest !== op.quoteDigest) {
            blocked("relay_request_id_execution_admission_required");
        }
        const funding = await this.ports.funding(op);
        if (funding.chainId !== 1 || funding.nativeBalanceWei < BigInt(op.approvalNetworkFeeCeilingWei) + BigInt(op.depositNetworkFeeCeilingWei) ||
            funding.tokenBalanceAtomic < BigInt(op.amountAtomic) || funding.allowanceAtomic < 0n ||
            funding.currentMaxFeePerGasWei < 0n || funding.currentMaxFeePerGasWei > BigInt(op.quote.approval.maxFeePerGas) ||
            funding.nextNonce < 0n)
            blocked("source_funding_or_fee");
        const after = this.ports.now();
        if (!Number.isFinite(after.getTime()) || after.getTime() + 60_000 >= Date.parse(op.deadline) ||
            (active.registry.expiresAt !== undefined && after.toISOString() >= active.registry.expiresAt))
            blocked("deadline_during_revalidation");
        return funding.nextNonce;
    }
}
export async function verifySigned(op, raw, claimedHash, expectedNonce) {
    if (!TX.test(raw))
        corrupt("signed raw encoding");
    const hash = keccak256(raw);
    if (claimedHash !== undefined && !same(claimedHash, hash))
        corrupt("signed hash");
    let tx, signer;
    try {
        tx = parseTransaction(raw);
        signer = await recoverTransactionAddress({ serializedTransaction: raw });
    }
    catch {
        corrupt("signed transaction decode");
    }
    const expected = op.quote.approval;
    if (tx.type !== "eip1559" || tx.chainId !== 1 || !same(signer, op.sourceAccount) ||
        !same(tx.to ?? "", expected.to) || !same(tx.data ?? "0x", expected.data) || (tx.value ?? 0n) !== 0n ||
        tx.gas !== BigInt(expected.gas) || tx.maxFeePerGas !== BigInt(expected.maxFeePerGas) ||
        tx.maxPriorityFeePerGas !== BigInt(expected.maxPriorityFeePerGas) ||
        (tx.accessList?.length ?? 0) !== 0 || tx.nonce === undefined ||
        (expectedNonce !== undefined && BigInt(tx.nonce) !== expectedNonce) ||
        tx.gas * tx.maxFeePerGas > BigInt(op.approvalNetworkFeeCeilingWei))
        corrupt("signed envelope drift");
    return { rawTransaction: raw, transactionHash: hash };
}
export function verifyApprovalObservation(op, hash, value) {
    const { transaction: tx, receipt, canonicalBlockHash } = value;
    if (!same(tx.hash, hash) || !same(receipt.transactionHash, hash) || tx.chainId !== 1 ||
        !same(tx.from, op.sourceAccount) || !same(tx.to ?? "", ETHEREUM_USDC) ||
        !same(tx.input, op.quote.approval.data) || receipt.blockNumber < 0n ||
        !same(receipt.blockHash, canonicalBlockHash) || !/^0x[0-9a-fA-F]{64}$/u.test(canonicalBlockHash))
        corrupt("transaction or canonical inclusion");
    if (receipt.status === "reverted")
        return "failed";
    const owner = `0x${op.sourceAccount.slice(2).padStart(64, "0")}`;
    const spender = `0x${ETHEREUM_DEPOSITORY.slice(2).padStart(64, "0")}`;
    const amount = `0x${BigInt(op.amountAtomic).toString(16).padStart(64, "0")}`;
    const matches = receipt.logs.filter(log => same(log.address, ETHEREUM_USDC) &&
        same(log.transactionHash, hash) && same(log.blockHash, receipt.blockHash) &&
        log.topics.length === 3 && same(log.topics[0], topic) && same(log.topics[1], owner) &&
        same(log.topics[2], spender) && same(log.data, amount));
    if (matches.length !== 1)
        corrupt("exact Approval event");
    return "confirmed";
}
//# sourceMappingURL=approval-effect.js.map