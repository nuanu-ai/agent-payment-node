/** Internal Ethereum Relay source deposit. All money and observation ports are injected. */
import { randomBytes } from "node:crypto";
import { decodeFunctionData, encodeFunctionData, keccak256, parseAbi, parseTransaction, recoverTransactionAddress } from "viem";
import { canonicalJson, domainHash } from "../canonical.js";
import { EncryptedWalletStore, walletCustodyLock } from "../encrypted-wallet-store.js";
import { ApnError } from "../errors.js";
import { RelayRetirementRepository, RelayUnsignedOperationRepository, validateRelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { evaluateAssetPolicy } from "../asset-policy-registry.js";
import { RelayEffectJournalRepository } from "./effect-journal.js";
import { ETHEREUM_DEPOSITORY, ETHEREUM_USDC, relayStatusLocator } from "./quote.js";
import { relayExecutionRoute } from "./execution-route.js";
import { verifyApprovalObservation } from "./approval-effect.js";
const DEPOSIT_ABI = parseAbi(["function depositErc20(address depositor, address token, uint256 amount, bytes32 id)"]);
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
function blocked(reason) { throw new ApnError("APN_OPERATION_BLOCKED", "Relay deposit effect is blocked.", { reason }); }
function corrupt(reason) { throw new ApnError("APN_STATE_CORRUPT", `Relay deposit effect is invalid: ${reason}.`); }
function depositBinding(op) {
    return domainHash("apn.relay-deposit-envelope.v1", canonicalJson({ operationId: op.operationId,
        quoteDigest: op.quoteDigest, deposit: op.quote.deposit }));
}
function depositKey(op) {
    return domainHash("apn.relay-deposit-custody.v1", canonicalJson({ operationId: op.operationId }));
}
/** Encrypted, hash-bound signed material for the one permitted deposit attempt. */
export class RelayEncryptedDepositCustody {
    state;
    wallets;
    constructor(state, wrapping) {
        this.state = state;
        this.wallets = new EncryptedWalletStore(state, wrapping);
    }
    async load(op) {
        return this.state.withLocks([walletCustodyLock(this.state, "default")], async () => {
            const wallet = await this.wallets.describe("default");
            if (wallet === null)
                return null;
            try {
                if (!same(wallet.identity.address, op.sourceAccount))
                    corrupt("deposit custody owner");
                const stored = wallet.secret.directEffects[depositKey(op)];
                if (stored === undefined)
                    return null;
                if (stored.payloadHash !== depositBinding(op) || stored.transactionHash !== stored.rawTransactionHash ||
                    keccak256(stored.rawTransaction) !== stored.transactionHash)
                    corrupt("deposit custody binding");
                return { rawTransaction: stored.rawTransaction, transactionHash: stored.transactionHash };
            }
            finally {
                this.wallets.clear(wallet.secret);
            }
        });
    }
    async seal(op, signed) {
        await this.state.withLocks([walletCustodyLock(this.state, "default")], async () => {
            const wallet = await this.wallets.describe("default");
            if (wallet === null)
                blocked("encrypted_custody_missing");
            try {
                if (!same(wallet.identity.address, op.sourceAccount))
                    corrupt("deposit custody owner");
                if (wallet.secret.directEffects[depositKey(op)] !== undefined)
                    blocked("signed_deposit_already_sealed");
                const verified = await verifySignedEnvelope(op, signed.rawTransaction, signed.transactionHash);
                const entry = { payloadHash: depositBinding(op), transactionHash: verified.transactionHash,
                    rawTransaction: verified.rawTransaction, rawTransactionHash: verified.transactionHash };
                wallet.secret.directEffects[depositKey(op)] = entry;
                await this.wallets.save(wallet.identity, wallet.secret);
            }
            finally {
                this.wallets.clear(wallet.secret);
            }
        });
    }
}
function verifyRawHash(raw, claimedHash) {
    if (!/^0x(?:[a-fA-F0-9]{2})+$/u.test(raw))
        corrupt("signed raw encoding");
    const hash = keccak256(raw);
    if (claimedHash !== undefined && !same(hash, claimedHash))
        corrupt("signed hash");
    return { rawTransaction: raw, transactionHash: hash };
}
async function verifySignedEnvelope(op, raw, claimedHash, expectedNonce) {
    const signed = verifyRawHash(raw, claimedHash);
    let tx, signer;
    try {
        tx = parseTransaction(raw);
        signer = await recoverTransactionAddress({ serializedTransaction: raw });
    }
    catch {
        corrupt("signed transaction decode");
    }
    const expected = op.quote.deposit;
    if (tx.type !== "eip1559" || tx.chainId !== 1 || !same(signer, op.sourceAccount) ||
        !same(tx.to ?? "", expected.to) || !same(tx.data ?? "0x", expected.data) || (tx.value ?? 0n) !== 0n ||
        tx.gas !== BigInt(expected.gas) || tx.maxFeePerGas !== BigInt(expected.maxFeePerGas) ||
        tx.maxPriorityFeePerGas !== BigInt(expected.maxPriorityFeePerGas) || tx.nonce === undefined ||
        (expectedNonce !== undefined && BigInt(tx.nonce) !== expectedNonce) ||
        (tx.accessList?.length ?? 0) !== 0 || tx.gas * tx.maxFeePerGas > BigInt(op.depositNetworkFeeCeilingWei))
        corrupt("signed envelope drift");
    return signed;
}
export function verifyDepositObservation(op, hash, value) {
    const { transaction: tx, receipt, canonicalBlockHash } = value;
    if (!same(tx.hash, hash) || !same(receipt.transactionHash, hash) || tx.chainId !== 1 ||
        !same(tx.from, op.sourceAccount) || !same(tx.to ?? "", ETHEREUM_DEPOSITORY) ||
        !same(tx.input, op.quote.deposit.data) || tx.value !== 0n || receipt.blockNumber < 0n ||
        !/^0x[0-9a-fA-F]{64}$/u.test(canonicalBlockHash) || !same(receipt.blockHash, canonicalBlockHash)) {
        corrupt("transaction or canonical inclusion");
    }
    // Decode again at the proof boundary so a saved order ID, token, or depositor mismatch cannot pass.
    try {
        const decoded = decodeFunctionData({ abi: DEPOSIT_ABI, data: tx.input });
        if (decoded.functionName !== "depositErc20" || !same(decoded.args[0], op.sourceAccount) ||
            !same(decoded.args[1], ETHEREUM_USDC) || decoded.args[2] !== BigInt(op.amountAtomic) ||
            !same(decoded.args[3], op.quote.orderId) ||
            !same(encodeFunctionData({ abi: DEPOSIT_ABI, functionName: "depositErc20", args: [...decoded.args] }), tx.input))
            corrupt("deposit order binding");
    }
    catch {
        corrupt("deposit order binding");
    }
    return receipt.status === "success" ? "confirmed" : "failed";
}
export class RelayDepositEffectService {
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
        return this.state.withLocks([`relay-deposit:${profileHash}:${operationId}`], async () => {
            const op = await this.operations.loadOperation(profileHash, operationId);
            if (op === null)
                blocked("prepared_operation_missing");
            if (await new RelayRetirementRepository(this.state.root).load(op) !== null)
                blocked("operation_retired");
            this.assertEnvelope(op);
            let journal = await this.effects.load(profileHash, operationId);
            if (journal === null || journal.effects[0].phase !== "confirmed" ||
                journal.effects[0].attempt?.transactionHash === null)
                blocked("canonical_approval_effect_required");
            const approvalHash = journal.effects[0].attempt.transactionHash;
            let effect = journal.effects[1];
            if (effect.phase === "confirmed" || effect.phase === "failed")
                return journal;
            if (effect.phase === "pending") {
                const nonce = await this.revalidate(op, approvalHash);
                journal = await this.effects.transition(profileHash, operationId, journal.integrityHash, { kind: "mark_signing", role: "deposit", marker: randomBytes(32).toString("hex"), at: this.ports.now().toISOString() });
                const raw = await this.ports.sign(op);
                const signed = await verifySignedEnvelope(op, raw, undefined, nonce);
                await this.ports.custody.seal(op, signed);
                effect = journal.effects[1];
            }
            if (effect.phase === "signing_started") {
                const signed = await this.ports.custody.load(op);
                if (signed === null)
                    return journal; // A signer may have run before a crash. No second signature.
                await verifySignedEnvelope(op, signed.rawTransaction, signed.transactionHash);
                journal = await this.effects.transition(profileHash, operationId, journal.integrityHash, { kind: "seal_signed", role: "deposit", transactionHash: signed.transactionHash });
                effect = journal.effects[1];
            }
            if (effect.phase === "sealed") {
                const nonce = await this.revalidate(op, approvalHash);
                const signed = await this.ports.custody.load(op);
                if (signed === null || !same(signed.transactionHash, effect.attempt.transactionHash))
                    corrupt("sealed custody missing");
                await verifySignedEnvelope(op, signed.rawTransaction, signed.transactionHash, nonce);
                journal = await this.effects.transition(profileHash, operationId, journal.integrityHash, { kind: "mark_submitting", role: "deposit", at: this.ports.now().toISOString() });
                try {
                    await this.ports.send(signed.rawTransaction);
                }
                catch { /* Ambiguous send; observe saved hash only. */ }
                effect = journal.effects[1];
            }
            if (effect.phase === "submitting") {
                const hash = effect.attempt.transactionHash;
                let observation;
                try {
                    observation = await this.ports.observe(hash);
                }
                catch {
                    return journal;
                }
                if (observation === null)
                    return journal;
                const outcome = verifyDepositObservation(op, hash, observation);
                return this.effects.transition(profileHash, operationId, journal.integrityHash, { kind: "observe", role: "deposit", outcome, at: this.ports.now().toISOString() });
            }
            return journal;
        });
    }
    assertEnvelope(op) {
        validateRelayUnsignedOperation(op);
        relayExecutionRoute(op);
        const quote = op.quote, deposit = quote?.deposit;
        if (!quote || !deposit || !op.policyDigest || !op.policyRevision || !op.depositNetworkFeeCeilingWei ||
            op.sourceChainId !== 1 || quote.quoteDigest !== op.quoteDigest ||
            !quote.statusLocator || !op.statusLocator ||
            relayStatusLocator(quote.statusLocator.requestId, quote.statusLocator.endpoint).requestId !== op.statusLocator.requestId ||
            !same(deposit.from, op.sourceAccount) || !same(deposit.to, ETHEREUM_DEPOSITORY) || deposit.chainId !== 1 ||
            !same(quote.paymentDetails.depository, ETHEREUM_DEPOSITORY) || deposit.value !== "0" ||
            BigInt(deposit.gas) * BigInt(deposit.maxFeePerGas) > BigInt(op.depositNetworkFeeCeilingWei) ||
            BigInt(deposit.maxPriorityFeePerGas) > BigInt(deposit.maxFeePerGas))
            blocked("saved_deposit_envelope");
        try {
            const decoded = decodeFunctionData({ abi: DEPOSIT_ABI, data: deposit.data });
            if (decoded.functionName !== "depositErc20" || !same(decoded.args[0], op.sourceAccount) ||
                !same(decoded.args[1], ETHEREUM_USDC) || decoded.args[2] !== BigInt(op.amountAtomic) ||
                !same(decoded.args[3], quote.orderId) ||
                !same(encodeFunctionData({ abi: DEPOSIT_ABI, functionName: "depositErc20", args: [...decoded.args] }), deposit.data))
                blocked("saved_deposit_order_binding");
        }
        catch {
            blocked("saved_deposit_order_binding");
        }
    }
    async revalidate(op, approvalHash) {
        this.assertEnvelope(op);
        const now = this.ports.now();
        if (!Number.isFinite(now.getTime()) || now.getTime() + 60_000 >= Date.parse(op.deadline))
            blocked("quote_deadline");
        const approval = await this.ports.observeApproval(approvalHash);
        if (approval === null || verifyApprovalObservation(op, approvalHash, approval) !== "confirmed")
            blocked("canonical_approval_effect_required");
        const active = await this.ports.activePolicy("default");
        if (active === null || active.profile !== "default" || active.digest !== op.policyDigest ||
            active.revision !== op.policyRevision || !same(active.accounts.evm ?? "", op.sourceAccount) ||
            (active.registry.expiresAt !== undefined && now.toISOString() >= active.registry.expiresAt))
            blocked("active_policy_or_owner");
        if (!same(await this.ports.publicAccount("default") ?? "", op.sourceAccount))
            blocked("public_owner");
        const admission = evaluateAssetPolicy(active.registry, { chain: "eip155:1",
            asset: { kind: "token", identifier: ETHEREUM_USDC }, rail: "bridge", amountAtomic: op.amountAtomic,
            dailyUsageAtomic: await this.ports.dailyUsage(op.sourceAccount, now),
            asOfDate: now.toISOString().slice(0, 10), asOf: now.toISOString() });
        const pin = admission.asset.mechanismPins?.bridge;
        if (pin?.provider !== "relay" || pin.reference !== relayExecutionRoute(op))
            blocked("route_pin");
        const execution = await this.ports.executionAdmission(op);
        if (execution === null || execution.requestId !== op.statusLocator.requestId ||
            execution.operationIntegrityHash !== op.integrityHash || execution.quoteDigest !== op.quoteDigest)
            blocked("saved_request_id_execution_admission_required");
        const funding = await this.ports.funding(op);
        if (funding.chainId !== 1 || funding.nativeBalanceWei < BigInt(op.depositNetworkFeeCeilingWei) ||
            funding.tokenBalanceAtomic < BigInt(op.amountAtomic) || funding.allowanceAtomic < BigInt(op.amountAtomic) ||
            funding.currentMaxFeePerGasWei < 0n || funding.currentMaxFeePerGasWei > BigInt(op.quote.deposit.maxFeePerGas) ||
            funding.nextNonce < 0n)
            blocked("source_funding_or_fee");
        const after = this.ports.now();
        if (!Number.isFinite(after.getTime()) || after.getTime() + 60_000 >= Date.parse(op.deadline) ||
            (active.registry.expiresAt !== undefined && after.toISOString() >= active.registry.expiresAt))
            blocked("deadline_during_revalidation");
        return funding.nextNonce;
    }
}
//# sourceMappingURL=deposit-effect.js.map