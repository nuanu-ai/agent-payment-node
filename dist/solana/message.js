import { address, appendTransactionMessageInstructions, blockhash, compileTransaction, createNoopSigner, createTransactionMessage, getBase64EncodedWireTransaction, getSignatureFromTransaction, getTransactionDecoder, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, getPublicKeyFromAddress, verifySignature, } from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { getCreateAssociatedTokenIdempotentInstruction, getTransferCheckedInstruction } from "@solana-program/token";
import { sha256 } from "../canonical.js";
import { SOLANA_USDC } from "../chain-policy.js";
import { ApnError } from "../errors.js";
import { associatedUsdc } from "./accounts.js";
import { solanaAddress, solanaSignature } from "./rpc.js";
export async function solanaMessage(input) {
    const sender = createNoopSigner(address(solanaAddress(input.sender)));
    const instructions = await solanaTransferInstructions(input);
    if (input.lastValidBlockHeight === null)
        invalid();
    const message = appendTransactionMessageInstructions(instructions, setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(input.blockReference), lastValidBlockHeight: BigInt(input.lastValidBlockHeight) }, setTransactionMessageFeePayerSigner(sender, createTransactionMessage({ version: 0 }))));
    const transaction = compileTransaction(message);
    return { transaction, unsignedPayload: getBase64EncodedWireTransaction(transaction), messageBase64: Buffer.from(transaction.messageBytes).toString("base64") };
}
export async function solanaTransferInstructions(input, rentPayer = input.sender) {
    const sender = createNoopSigner(address(solanaAddress(input.sender)));
    const recipient = address(solanaAddress(input.recipient));
    const instructions = [];
    if (input.asset.alias === "sol") {
        instructions.push(getTransferSolInstruction({ source: sender, destination: recipient, amount: BigInt(input.amountAtomic) }));
    }
    else if (input.asset.alias === "usdc") {
        const source = await associatedUsdc(input.sender);
        const destination = await associatedUsdc(input.recipient);
        if (source !== input.sourceTokenAccount || destination !== input.destinationTokenAccount)
            invalid();
        if (input.createsRecipientAccount)
            instructions.push(getCreateAssociatedTokenIdempotentInstruction({
                payer: createNoopSigner(address(solanaAddress(rentPayer))), ata: address(destination), owner: recipient, mint: address(SOLANA_USDC),
            }));
        instructions.push(getTransferCheckedInstruction({ source: address(source), mint: address(SOLANA_USDC),
            destination: address(destination), authority: sender, amount: BigInt(input.amountAtomic), decimals: 6 }));
    }
    else
        invalid();
    return instructions;
}
export async function validateSolanaMessage(prepared) {
    const expected = await solanaMessage(prepared);
    if (expected.unsignedPayload !== prepared.unsignedPayload)
        invalid();
    return expected;
}
export async function validateSolanaEffect(prepared, effect) {
    const expected = await validateSolanaMessage(prepared);
    if (sha256(effect.rawPayload) !== effect.rawPayloadHash || effect.rawPayload.length > 2048)
        invalid();
    const bytes = Buffer.from(effect.rawPayload, "base64");
    if (bytes.toString("base64") !== effect.rawPayload)
        invalid();
    const transaction = getTransactionDecoder().decode(bytes);
    if (Buffer.from(transaction.messageBytes).toString("base64") !== expected.messageBase64 || getSignatureFromTransaction(transaction) !== solanaSignature(effect.transactionId) ||
        Object.keys(transaction.signatures).length !== 1 || transaction.signatures[address(prepared.sender)] === null ||
        getBase64EncodedWireTransaction(transaction) !== effect.rawPayload)
        invalid();
    const signature = transaction.signatures[address(prepared.sender)];
    if (signature === undefined || signature === null || !await verifySignature(await getPublicKeyFromAddress(address(prepared.sender)), signature, transaction.messageBytes))
        invalid();
}
function invalid() { throw new ApnError("APN_STATE_CORRUPT", "The Solana transaction bytes do not match the frozen direct transfer."); }
//# sourceMappingURL=message.js.map