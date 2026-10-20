import { getMintDecoder, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { ApnError } from "../errors.js";
import { accountRead, associatedToken, multipleAccounts, tokenAccountAmount } from "../solana/accounts.js";
import { assertSolanaNetworkValue, protocolFailure, rpcAtomic, rpcRecord, solanaAddress, solanaBlockHeightValue, solanaReadBatch } from "../solana/rpc.js";
import { simulateSolanaSend } from "../solana/simulation.js";
import { X402_SOLANA_NETWORK } from "./constants.js";
import { x402SolanaMessage } from "./message.js";
/** The payer's and payee's classic associated token accounts for this mint. */
export async function x402SolanaTokenAccounts(payer, payee, mint) {
    return { sourceTokenAccount: await associatedToken(payer, mint), destinationTokenAccount: await associatedToken(payee, mint) };
}
/**
 * The mint, both token accounts and the genesis in one request: the mint must be an initialized classic SPL mint with the
 * owner's row decimals (a Token-2022 mint is refused by name), the payer's account must hold the price, and the payee's
 * account must already exist (APN never creates it; the facilitator would refuse a payment that pays rent).
 */
export async function readX402SolanaAccounts(rpc, input) {
    const accounts = await x402SolanaTokenAccounts(input.payer, input.payee, input.mint);
    const [genesis, value] = await solanaReadBatch(rpc, [{ method: "getGenesisHash", params: [] },
        accountRead([input.mint, accounts.sourceTokenAccount, accounts.destinationTokenAccount])]);
    assertSolanaNetworkValue(genesis);
    return checkAccounts(multipleAccounts(value, 3).accounts, input, accounts);
}
function checkAccounts(values, input, accounts) {
    const [mint, source, destination] = values;
    if (mint === null || mint === undefined || mint.owner !== TOKEN_PROGRAM_ADDRESS || mint.executable || mint.data.length !== 82) {
        throw new ApnError("APN_X402_UNSUPPORTED_OFFER", `The mint ${input.mint} is not a classic SPL Token mint; APN pays Solana x402 only through it.`, { reason: "x402_solana_token_program_unsupported", chain: X402_SOLANA_NETWORK, asset: input.mint });
    }
    let decimals;
    try {
        const decoded = getMintDecoder().decode(mint.data);
        if (!decoded.isInitialized)
            protocolFailure();
        decimals = decoded.decimals;
    }
    catch {
        return protocolFailure();
    }
    if (decimals !== input.decimals) {
        throw new ApnError("APN_X402_UNSUPPORTED_OFFER", `The mint reports ${decimals} decimals; the owner's allowlist row says ${input.decimals}.`, { reason: "x402_token_decimals_mismatch", chain: X402_SOLANA_NETWORK, asset: input.mint });
    }
    const balance = tokenAccountAmount(source ?? null, input.payer, input.mint);
    if (balance < BigInt(input.amountAtomic))
        throw new ApnError("APN_INSUFFICIENT_ASSET", "The payer's token account cannot cover the Solana x402 price.");
    if (destination === null || destination === undefined) {
        throw new ApnError("APN_X402_UNSUPPORTED_OFFER", "The payee has no token account for this mint; APN does not create one for a seller.", { reason: "x402_solana_payee_account_missing", chain: X402_SOLANA_NETWORK, asset: input.mint });
    }
    tokenAccountAmount(destination, input.payee, input.mint);
    return { ...accounts, balanceAtomic: balance.toString() };
}
/**
 * The send guard, after the owner's decision and before anything is signed: a fresh blockhash with its height (checked
 * against each other), the accounts again, the exact message, and a simulation of exactly those bytes.
 */
export async function bindX402SolanaLifetime(rpc, terms) {
    const [genesis, latest, height, value] = await solanaReadBatch(rpc, [{ method: "getGenesisHash", params: [] },
        { method: "getLatestBlockhash", params: [{ commitment: "confirmed" }] }, { method: "getBlockHeight", params: [{ commitment: "confirmed" }] },
        accountRead([terms.mint, terms.sourceTokenAccount, terms.destinationTokenAccount])]);
    assertSolanaNetworkValue(genesis);
    const observed = solanaBlockHeightValue(height, latest);
    const response = rpcRecord(latest), block = rpcRecord(response.value);
    if (typeof block.blockhash !== "string")
        protocolFailure();
    solanaAddress(block.blockhash);
    const lastValidBlockHeight = rpcAtomic(block.lastValidBlockHeight), floorSlot = rpcAtomic(rpcRecord(response.context).slot);
    checkAccounts(multipleAccounts(value, 3).accounts, { ...terms, payer: terms.payer }, { sourceTokenAccount: terms.sourceTokenAccount, destinationTokenAccount: terms.destinationTokenAccount });
    const message = x402SolanaMessage(terms, { blockhash: block.blockhash, lastValidBlockHeight: lastValidBlockHeight.toString() });
    const simulation = await simulateSolanaSend(rpc, message.unsignedPayload);
    return { blockhash: block.blockhash, lastValidBlockHeight: lastValidBlockHeight.toString(), floorSlot: floorSlot.toString(),
        observedBlockHeight: observed.toString(), messageBase64: message.messageBase64, messageHash: message.messageHash,
        unsignedPayload: message.unsignedPayload, simulationSlot: simulation.slotAtomic, unitsConsumed: simulation.unitsConsumedAtomic };
}
//# sourceMappingURL=chain.js.map