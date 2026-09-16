import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { SOLANA_USDC } from "../chain-policy.js";
import { atomic } from "../chain-policy.js";
import { associatedUsdc } from "../solana/accounts.js";
import { protocolFailure, rpcArray, rpcAtomic, rpcRecord, solanaAddress, solanaSignature } from "../solana/rpc.js";
/** Parse untrusted finalized RPC responses without admitting or completing a bridge operation. */
export async function parseSolanaDestinationCandidate(input) {
    const signature = solanaSignature(input.signature);
    const recipient = solanaAddress(input.recipient);
    const minimum = atomic(input.minimumOutputAtomic);
    if (minimum <= 0n || input.providerOutcome !== "completed")
        protocolFailure();
    const statuses = rpcRecord(input.signatureStatuses);
    const contextSlot = rpcAtomic(rpcRecord(statuses.context).slot);
    const values = rpcArray(statuses.value, 1);
    if (values.length !== 1 || values[0] === null)
        protocolFailure();
    const status = rpcRecord(values[0]);
    const slot = rpcAtomic(status.slot);
    if (status.confirmationStatus !== "finalized" || status.confirmations !== null || status.err !== null || contextSlot < slot)
        protocolFailure();
    const result = rpcRecord(input.transaction);
    if (rpcAtomic(result.slot) !== slot)
        protocolFailure();
    const meta = rpcRecord(result.meta);
    if (meta.err !== null)
        protocolFailure();
    const transaction = rpcRecord(result.transaction);
    const signatures = rpcArray(transaction.signatures, 8);
    if (signatures.length === 0 || signatures[0] !== signature)
        protocolFailure();
    signatures.forEach(solanaSignature);
    const message = rpcRecord(transaction.message);
    const keys = rpcArray(message.accountKeys, 256).map((raw) => {
        const key = rpcRecord(raw);
        if (typeof key.pubkey !== "string")
            protocolFailure();
        return solanaAddress(key.pubkey);
    });
    if (new Set(keys).size !== keys.length)
        protocolFailure();
    const tokenAccount = await associatedUsdc(recipient);
    const before = tokenAmount(meta.preTokenBalances, keys, tokenAccount, recipient);
    const after = tokenAmount(meta.postTokenBalances, keys, tokenAccount, recipient);
    if (after <= before || after - before < minimum)
        protocolFailure();
    return {
        proofClass: "solana_finalized_usdc_destination_candidate", signature, slotAtomic: slot.toString(), recipient,
        tokenAccount, mint: SOLANA_USDC, receivedAtomic: (after - before).toString(), minimumOutputAtomic: minimum.toString(),
        sourceMessageCorrelation: "unverified", bridgeCompletion: false,
    };
}
function tokenAmount(value, keys, tokenAccount, recipient) {
    let found;
    for (const raw of rpcArray(value, 256)) {
        const balance = rpcRecord(raw);
        const index = rpcAtomic(balance.accountIndex);
        if (index >= BigInt(keys.length))
            protocolFailure();
        const key = keys[Number(index)];
        if (balance.mint === SOLANA_USDC && balance.owner === recipient && key !== tokenAccount)
            protocolFailure();
        if (key !== tokenAccount)
            continue;
        if (found !== undefined || balance.mint !== SOLANA_USDC || balance.owner !== recipient || balance.programId !== TOKEN_PROGRAM_ADDRESS)
            protocolFailure();
        const token = rpcRecord(balance.uiTokenAmount);
        if (rpcAtomic(token.decimals) !== 6n || typeof token.amount !== "string")
            protocolFailure();
        found = atomic(token.amount);
    }
    if (found === undefined)
        protocolFailure();
    return found;
}
//# sourceMappingURL=solana-destination-candidate.js.map