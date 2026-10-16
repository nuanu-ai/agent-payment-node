/** Encrypted signed bytes of one Relay native deposit, kept in the operation's own profile envelope. */
import { keccak256, parseTransaction, recoverTransactionAddress } from "viem";
import { canonicalJson, domainHash } from "../canonical.js";
import { walletCustodyLock } from "../encrypted-wallet-store.js";
import { ApnError } from "../errors.js";
import { BASE_RELAY_SIGNED_BYTES } from "./base-source-guard.js";
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
function blocked(reason) { throw new ApnError("APN_OPERATION_BLOCKED", "Relay native source execution is blocked.", { reason }); }
function corrupt(reason) { throw new ApnError("APN_STATE_CORRUPT", `Relay native source state is invalid: ${reason}.`); }
function custodyKey(op) {
    return domainHash("apn.relay-native-deposit-custody.v1", canonicalJson({ operationId: op.operationId }));
}
function custodyBinding(op) {
    return domainHash("apn.relay-native-deposit-envelope.v1", canonicalJson({ operationId: op.operationId,
        integrityHash: op.integrityHash, quoteDigest: op.quoteDigest, deposit: op.nativeQuote.deposit }));
}
/** The signed bytes must be the exact frozen deposit envelope, signed by the operation's own source account. */
export async function verifySignedNativeDeposit(op, raw, expectedNonce) {
    if ((op.sourceChainId === 8453 && (raw.length - 2) / 2 > BASE_RELAY_SIGNED_BYTES) || !/^0x(?:[a-fA-F0-9]{2})+$/u.test(raw))
        corrupt("signed encoding");
    let tx, signer;
    try {
        tx = parseTransaction(raw);
        signer = await recoverTransactionAddress({ serializedTransaction: raw });
    }
    catch {
        corrupt("signed decode");
    }
    const d = op.nativeQuote.deposit;
    if (tx.type !== "eip1559" || tx.chainId !== op.sourceChainId || !same(signer, op.sourceAccount) ||
        !same(tx.to ?? "", d.to) || !same(tx.data ?? "0x", d.data) || (tx.value ?? 0n) !== BigInt(d.value) ||
        tx.gas !== BigInt(d.gas) || tx.maxFeePerGas !== BigInt(d.maxFeePerGas) ||
        tx.maxPriorityFeePerGas !== BigInt(d.maxPriorityFeePerGas) || tx.nonce === undefined ||
        (expectedNonce !== undefined && BigInt(tx.nonce) !== expectedNonce) || (tx.accessList?.length ?? 0) !== 0 ||
        tx.gas * tx.maxFeePerGas > BigInt(op.depositNetworkFeeCeilingWei))
        corrupt("signed envelope drift");
    return keccak256(raw);
}
/** One profile's custody slot for native deposits. `held` is true when the caller already holds its wallet mutation lock. */
export class RelayNativeDepositCustody {
    state;
    wallets;
    profile;
    held;
    constructor(state, wallets, profile, held) {
        this.state = state;
        this.wallets = wallets;
        this.profile = profile;
        this.held = held;
    }
    locked(op, work) {
        if (this.state.profileHash(this.profile) !== op.profileHash)
            blocked("custody_profile_mismatch");
        return this.held(op) ? work() : this.state.withLocks([walletCustodyLock(this.state, this.profile)], work);
    }
    /** Read the sealed bytes, or seal `signed` once. A damaged slot is corrupt, never empty. */
    async slot(op, signed) {
        return this.locked(op, async () => {
            const wallet = await this.wallets.describe(this.profile);
            if (wallet === null)
                blocked("encrypted_wallet_missing");
            try {
                if (!same(wallet.identity.address, op.sourceAccount))
                    blocked("encrypted_wallet_owner");
                const old = wallet.secret.directEffects[custodyKey(op)];
                if (signed !== undefined) {
                    if (old !== undefined)
                        blocked("signed_native_deposit_already_sealed");
                    if (await verifySignedNativeDeposit(op, signed.raw) !== signed.hash)
                        corrupt("signed hash");
                    const entry = { payloadHash: custodyBinding(op), transactionHash: signed.hash,
                        rawTransaction: signed.raw, rawTransactionHash: signed.hash };
                    wallet.secret.directEffects[custodyKey(op)] = entry;
                    await this.wallets.save(wallet.identity, wallet.secret);
                    return signed;
                }
                if (old === undefined)
                    return null;
                if (old.payloadHash !== custodyBinding(op) || old.transactionHash !== old.rawTransactionHash ||
                    keccak256(old.rawTransaction) !== old.transactionHash)
                    corrupt("custody binding");
                await verifySignedNativeDeposit(op, old.rawTransaction);
                return { raw: old.rawTransaction, hash: old.transactionHash };
            }
            finally {
                this.wallets.clear(wallet.secret);
            }
        });
    }
    /** Only after the journal records the sealed bytes as never landing. */
    async discard(op) {
        await this.locked(op, async () => {
            const wallet = await this.wallets.describe(this.profile);
            if (wallet === null)
                return;
            try {
                if (!same(wallet.identity.address, op.sourceAccount))
                    corrupt("encrypted_wallet_owner");
                if (wallet.secret.directEffects[custodyKey(op)] === undefined)
                    return;
                delete wallet.secret.directEffects[custodyKey(op)];
                await this.wallets.save(wallet.identity, wallet.secret);
            }
            finally {
                this.wallets.clear(wallet.secret);
            }
        });
    }
    /** The only closure without a chain result: journal has no hash or send marker,
     * and encrypted custody is proven empty under its mutation lock. */
    async closeUnsignedAttempt(op, j, journals, now) {
        if (this.state.profileHash(this.profile) !== op.profileHash)
            blocked("custody_profile_mismatch");
        return this.state.withLocks([walletCustodyLock(this.state, this.profile)], async () => {
            const wallet = await this.wallets.describe(this.profile);
            if (wallet === null)
                blocked("encrypted_wallet_missing");
            try {
                if (!same(wallet.identity.address, op.sourceAccount))
                    corrupt("encrypted_wallet_owner");
                if (wallet.secret.directEffects[custodyKey(op)] !== undefined)
                    blocked("signed_native_custody_exists");
                if (j.phase !== "signing_started" || j.transactionHash !== null || j.observedAt !== null)
                    blocked("no_effect_closure_requires_unsigned_marker");
                return journals.advance(op, j.integrityHash, "failed_before_effect", null, now);
            }
            finally {
                this.wallets.clear(wallet.secret);
            }
        });
    }
}
//# sourceMappingURL=native-source-custody.js.map