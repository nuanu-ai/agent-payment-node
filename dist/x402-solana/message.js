import { address, appendTransactionMessageInstructions, blockhash, compileTransaction, createNoopSigner, createTransactionMessage, getBase64EncodedWireTransaction, getCompiledTransactionMessageDecoder, getPublicKeyFromAddress, getTransactionDecoder, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash, verifySignature, } from "@solana/kit";
import { getTransferCheckedInstruction, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { COMPUTE_BUDGET_PROGRAM } from "./constants.js";
function u32(value) { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes; }
function u64(value) { const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(value); return bytes; }
function instructions(terms) {
    const program = address(COMPUTE_BUDGET_PROGRAM);
    return [
        { programAddress: program, data: Uint8Array.from([2, ...u32(terms.computeUnitLimit)]) },
        { programAddress: program, data: Uint8Array.from([3, ...u64(BigInt(terms.computeUnitPriceMicroLamports))]) },
        getTransferCheckedInstruction({ source: address(terms.sourceTokenAccount), mint: address(terms.mint),
            destination: address(terms.destinationTokenAccount), authority: createNoopSigner(address(terms.payer)),
            amount: BigInt(terms.amountAtomic), decimals: terms.decimals }),
    ];
}
/** The one v0 message this payment may sign: the facilitator pays the fee, the payer only authorizes the transfer. */
export function x402SolanaMessage(terms, lifetime) {
    const message = appendTransactionMessageInstructions(instructions(terms), setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(lifetime.blockhash), lastValidBlockHeight: BigInt(lifetime.lastValidBlockHeight) }, setTransactionMessageFeePayer(address(terms.feePayer), createTransactionMessage({ version: 0 }))));
    const transaction = compileTransaction(message);
    assertExactMessage(transaction.messageBytes, terms, lifetime);
    const messageBase64 = Buffer.from(transaction.messageBytes).toString("base64");
    return { transaction, messageBase64, messageHash: sha256(messageBase64), unsignedPayload: getBase64EncodedWireTransaction(transaction) };
}
/**
 * Checked before anything is signed, independently of how the bytes were built: a v0 message without lookup tables, the
 * fee payer first and the payer second as the only signers, exactly SetComputeUnitLimit, SetComputeUnitPrice and one
 * classic SPL TransferChecked of the frozen amount and decimals from the payer's account to the payee's, and the fee
 * payer in no instruction at all.
 */
export function assertExactMessage(messageBytes, terms, lifetime) {
    let compiled;
    try {
        compiled = getCompiledTransactionMessageDecoder().decode(messageBytes);
    }
    catch {
        return invalid();
    }
    const keys = compiled.staticAccounts.map(String), header = compiled.header;
    if (compiled.version !== 0 || (compiled.addressTableLookups?.length ?? 0) !== 0 || compiled.lifetimeToken !== lifetime.blockhash ||
        header.numSignerAccounts !== 2 || header.numReadonlySignerAccounts !== 1 || keys[0] !== terms.feePayer || keys[1] !== terms.payer ||
        new Set(keys).size !== keys.length || keys.length !== 7 ||
        [terms.sourceTokenAccount, terms.destinationTokenAccount, terms.mint, TOKEN_PROGRAM_ADDRESS, COMPUTE_BUDGET_PROGRAM].some((key) => !keys.includes(key)))
        invalid();
    const expected = instructions(terms);
    if (compiled.instructions.length !== expected.length)
        invalid();
    compiled.instructions.forEach((instruction, position) => {
        const want = expected[position], accounts = instruction.accountIndices ?? [];
        if (keys[instruction.programAddressIndex] !== want.programAddress || !Buffer.from(instruction.data ?? []).equals(Buffer.from(want.data ?? [])) ||
            accounts.length !== (want.accounts?.length ?? 0) || accounts.some((index, at) => keys[index] !== want.accounts?.[at]?.address || index === 0))
            invalid();
    });
}
/** The partially signed wire bytes: this message, the payer's verified signature, and an empty fee payer slot. */
export async function assertPayerSigned(rawPayload, messageBase64, payer, feePayer) {
    const bytes = Buffer.from(rawPayload, "base64");
    if (bytes.toString("base64") !== rawPayload || bytes.length > 1232)
        invalid();
    let transaction;
    try {
        transaction = getTransactionDecoder().decode(bytes);
    }
    catch {
        return invalid();
    }
    const signatures = transaction.signatures;
    if (Buffer.from(transaction.messageBytes).toString("base64") !== messageBase64 || getBase64EncodedWireTransaction(transaction) !== rawPayload ||
        Object.keys(signatures).length !== 2 || signatures[feePayer] !== null)
        invalid();
    const signature = signatures[payer];
    if (signature === undefined || signature === null || !await verifySignature(await getPublicKeyFromAddress(address(payer)), signature, transaction.messageBytes))
        invalid();
    return Buffer.from(signature).toString("base64");
}
function invalid() {
    throw new ApnError("APN_STATE_CORRUPT", "The Solana x402 transaction is not exactly the frozen compute budget and transfer.");
}
//# sourceMappingURL=message.js.map