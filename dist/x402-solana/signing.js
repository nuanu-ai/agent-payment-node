import { createKeyPairSignerFromPrivateKeyBytes, getBase64EncodedWireTransaction, partiallySignTransaction } from "@solana/kit";
import { canonicalJson, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { assertPayerSigned, x402SolanaMessage } from "./message.js";
export function x402SolanaMessageTerms(terms) {
    return { payer: terms.payer, feePayer: terms.feePayer, mint: terms.mint, decimals: terms.decimals, sourceTokenAccount: terms.sourceTokenAccount,
        destinationTokenAccount: terms.destinationTokenAccount, amountAtomic: terms.amountAtomic, computeUnitLimit: terms.computeUnitLimit,
        computeUnitPriceMicroLamports: terms.computeUnitPriceMicroLamports };
}
/** The profile's own local Solana account, which must still be the frozen payer. */
export async function x402SolanaAccount(accounts, profile, payer) {
    const account = await accounts.account(profile, "solana");
    if (account === null || account.provider !== "local" || account.custody !== "local_software") {
        throw new ApnError("APN_WALLET_POLICY_REQUIRED", "Solana x402 pays from the profile's local Solana wallet.", { reason: "x402_solana_local_wallet_required", nextActions: [`apn wallet ensure-solana --profile ${profile}`] });
    }
    if (payer !== undefined && account.address !== payer)
        throw new ApnError("APN_WALLET_MISMATCH", "The profile's Solana wallet is not this payment's payer.");
    return account;
}
/**
 * The payer's only signature: the message rebuilt from the frozen terms and the bound lifetime must be byte-equal to the
 * one the send guard simulated, and the result must carry exactly that message, a verified payer signature and an empty
 * fee payer slot. Ed25519 is deterministic, so signing the same message again yields the same bytes.
 */
export async function signX402Solana(accounts, record) {
    const lifetime = record.lifetime;
    if (lifetime === null)
        throw new ApnError("APN_STATE_CORRUPT", "A Solana x402 payment is signed only after its lifetime is bound.");
    const account = await x402SolanaAccount(accounts, record.profile, record.terms.payer);
    const message = x402SolanaMessage(x402SolanaMessageTerms(record.terms), lifetime);
    if (message.messageBase64 !== lifetime.messageBase64 || message.messageHash !== lifetime.messageHash) {
        throw new ApnError("APN_STATE_CORRUPT", "The Solana x402 message differs from the simulated bytes.");
    }
    return await accounts.withSeed(account, async (seed) => {
        const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
        if (signer.address !== record.terms.payer)
            throw new ApnError("APN_WALLET_MISMATCH", "The Solana custody key is not this payment's payer.");
        const rawPayload = getBase64EncodedWireTransaction(await partiallySignTransaction([signer.keyPair], message.transaction));
        const payerSignature = await assertPayerSigned(rawPayload, lifetime.messageBase64, record.terms.payer, record.terms.feePayer);
        const signed = { rawPayload, rawPayloadHash: sha256(rawPayload), payerSignature };
        if (record.signed !== null && canonicalJson(record.signed) !== canonicalJson(signed)) {
            throw new ApnError("APN_STATE_CORRUPT", "Signing the frozen Solana x402 message again gave different bytes.");
        }
        return signed;
    });
}
//# sourceMappingURL=signing.js.map