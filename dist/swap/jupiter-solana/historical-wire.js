import { getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";
import { SYSTEM_PROGRAM } from "./catalog.js";
import { historicalAuthenticationRefused as refuse } from "./historical-authentication-readers.js";
/** Pure refusal predicate, not an issuer or signature/expiry authority. */
export function assertHistoricalOrdinaryRecentBlockhash(raw, instructions) {
    if (typeof raw !== "string" || raw.length > 32_768 || Buffer.from(raw, "base64").toString("base64") !== raw)
        refuse();
    const tx = getTransactionDecoder().decode(Buffer.from(raw, "base64"));
    const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
    if (message.version !== 0 && message.version !== "legacy")
        refuse();
    const wireNonce = message.instructions.some(ix => message.staticAccounts[ix.programAddressIndex] === SYSTEM_PROGRAM && ix.data !== undefined && ix.data.length >= 4 && Buffer.from(ix.data).readUInt32LE(0) === 4);
    const materialNonce = instructions.some(ix => ix.programId === SYSTEM_PROGRAM && Buffer.from(ix.data, "base64").length >= 4 && Buffer.from(ix.data, "base64").readUInt32LE(0) === 4);
    if (!message.lifetimeToken || wireNonce || materialNonce)
        refuse();
}
//# sourceMappingURL=historical-wire.js.map