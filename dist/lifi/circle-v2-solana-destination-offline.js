/** Offline, read-only Circle V2 receive instruction inspection. Never import into execution. */
import { createHash } from "node:crypto";
import { address, getBase58Encoder, getProgramDerivedAddress } from "@solana/kit";
import { parseSolanaDestinationCandidate, solanaJsonAccountKeys } from "./solana-destination-candidate.js";
import { bridgeFailure, bridgeHex, bridgeRecord } from "./validation.js";
import { rpcArray } from "../solana/rpc.js";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { SOLANA_USDC } from "../chain-policy.js";
// Circle's mainnet V2 deployments and receive_message.rs (used_nonce seeds).
export const CIRCLE_V2_MESSAGE_TRANSMITTER = "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC";
export const CIRCLE_V2_TOKEN_MESSENGER = "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe";
const RECEIVE = createHash("sha256").update("global:receive_message").digest().subarray(0, 8);
const fail = () => bridgeFailure("APN_RPC_PROTOCOL", "circle_v2_solana_destination");
const bytes = (value) => Uint8Array.from(Buffer.from(bridgeHex(value, 16 * 1024).slice(2), "hex"));
const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));
const keyBytes = (key) => Uint8Array.from(getBase58Encoder().encode(key));
const indexedKey = (keys, raw) => {
    if (!Number.isSafeInteger(raw) || raw < 0 || raw >= keys.length)
        fail();
    return keys[raw];
};
/** A matched receive instruction and ATA delta are a candidate, not an event-backed mint receipt. */
export async function inspectCircleV2SolanaDestinationOffline(input) {
    const message = bytes(input.attestedMessageHex);
    const nonce = bytes(input.nonceHex);
    const attestation = input.expectedAttestationHex === undefined ? undefined : bytes(input.expectedAttestationHex);
    if (message.length < 148 || nonce.length !== 32 || !same(message.subarray(12, 44), nonce))
        fail();
    const read32 = (offset) => Buffer.from(message).readUInt32BE(offset);
    if (read32(4) !== 6 || read32(8) !== 5 || read32(144) < 2000 ||
        !same(message.subarray(76, 108), keyBytes(CIRCLE_V2_TOKEN_MESSENGER)))
        fail();
    // Recipient of the burn body is an SPL token account, not a wallet address.
    const candidate = await parseSolanaDestinationCandidate({
        signature: input.signature, recipient: input.recipient, minimumOutputAtomic: input.minimumOutputAtomic,
        providerOutcome: "completed", signatureStatuses: input.signatureStatuses, transaction: input.transaction,
    });
    if (!same(message.subarray(184, 216), keyBytes(candidate.tokenAccount)))
        fail();
    const body = message.subarray(148);
    if (body.length < 228)
        fail();
    const u256 = (offset) => BigInt(`0x${Buffer.from(body.subarray(offset, offset + 32)).toString("hex")}`);
    const amount = u256(68), fee = u256(164);
    if (amount === 0n || fee >= amount || amount > (1n << 64n) - 1n || fee > (1n << 64n) - 1n ||
        amount - fee !== BigInt(candidate.receivedAtomic))
        fail();
    const tx = bridgeRecord(input.transaction);
    const wire = bridgeRecord(bridgeRecord(tx.transaction).message);
    const keys = solanaJsonAccountKeys(tx);
    const instructions = rpcArray(wire.instructions, 64);
    if (instructions.length === 0)
        fail();
    const [usedNonce] = await getProgramDerivedAddress({ programAddress: address(CIRCLE_V2_MESSAGE_TRANSMITTER),
        seeds: [new TextEncoder().encode("used_nonce"), nonce] });
    let matches = 0;
    for (const item of instructions) {
        const ix = bridgeRecord(item);
        const program = indexedKey(keys, ix.programIdIndex);
        const accounts = rpcArray(ix.accounts, 64).map(index => indexedKey(keys, index));
        if (program !== CIRCLE_V2_MESSAGE_TRANSMITTER)
            continue;
        const encoded = ix.data;
        if (typeof encoded !== "string")
            return fail();
        const raw = keyBytes(encoded);
        if (!same(raw.subarray(0, 8), RECEIVE))
            continue;
        if (raw.length < 16)
            fail();
        const size = Buffer.from(raw).readUInt32LE(8);
        if (size !== message.length || raw.length < 12 + size + 4 || !same(raw.subarray(12, 12 + size), message))
            continue;
        const attestationSize = Buffer.from(raw).readUInt32LE(12 + size);
        if (attestationSize === 0 || raw.length !== 16 + size + attestationSize ||
            (attestation !== undefined && !same(raw.subarray(16 + size), attestation)) ||
            accounts.length < 7 || accounts[4] !== usedNonce || accounts[5] !== CIRCLE_V2_TOKEN_MESSENGER)
            fail();
        matches++;
    }
    if (matches !== 1)
        fail();
    return { ...candidate, proofClass: "circle_v2_solana_receive_candidate",
        nonceHex: `0x${Buffer.from(nonce).toString("hex")}`, usedNoncePda: usedNonce,
        sourceMessageCorrelation: "receive_instruction_matched", executionAdmitted: false, bridgeCompletion: false,
        blockers: ["MintAndWithdraw and MessageReceived CPI events are not decoded or bound", "caller supplies authenticated finalized RPC and Circle-attested message"] };
}
const EVENT_CPI = Buffer.from("e445a52e51cb9a1d", "hex"); // Anchor 0.31 EVENT_IX_TAG_LE.
const discriminator = (name) => createHash("sha256").update(name).digest().subarray(0, 8);
/** Require the deployed Circle V2 handler, both CPI events, and its SPL transfer in one receive invocation. */
export async function inspectCircleV2SolanaMintEventOffline(input) {
    const candidate = await inspectCircleV2SolanaDestinationOffline(input);
    const message = bytes(input.attestedMessageHex), body = message.subarray(148);
    const tx = bridgeRecord(input.transaction), meta = bridgeRecord(tx.meta);
    const wire = bridgeRecord(bridgeRecord(tx.transaction).message);
    const keys = solanaJsonAccountKeys(tx);
    const outer = rpcArray(wire.instructions, 64);
    const groups = rpcArray(meta.innerInstructions, 64);
    const receiveIndexes = outer.flatMap((item, index) => {
        const ix = bridgeRecord(item);
        const program = indexedKey(keys, ix.programIdIndex);
        rpcArray(ix.accounts, 64).forEach(account => indexedKey(keys, account));
        if (program !== CIRCLE_V2_MESSAGE_TRANSMITTER || typeof ix.data !== "string")
            return [];
        const raw = keyBytes(ix.data);
        return same(raw.subarray(0, 8), RECEIVE) && raw.length >= 12 + message.length &&
            same(raw.subarray(12, 12 + message.length), message) ? [index] : [];
    });
    if (receiveIndexes.length !== 1)
        fail();
    const matching = groups.filter(item => bridgeRecord(item).index === receiveIndexes[0]);
    if (matching.length !== 1)
        fail();
    const inner = rpcArray(bridgeRecord(matching[0]).instructions, 128);
    const parsed = inner.map(item => {
        const ix = bridgeRecord(item);
        if (typeof ix.data !== "string")
            fail();
        const accounts = rpcArray(ix.accounts, 64).map(index => indexedKey(keys, index));
        return { program: indexedKey(keys, ix.programIdIndex), accounts, data: keyBytes(ix.data) };
    });
    const handler = discriminator("global:handle_receive_finalized_message");
    const mint = discriminator("event:MintAndWithdraw");
    const received = discriminator("event:MessageReceived");
    const amount = BigInt(candidate.receivedAtomic);
    const fee = BigInt(`0x${Buffer.from(body.subarray(164, 196)).toString("hex")}`);
    const u64 = (value) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(value); return b; };
    const handlerData = Buffer.concat([handler, Buffer.from(Uint8Array.of(6, 0, 0, 0)),
        Buffer.from(message.subarray(44, 76)), Buffer.from(Uint8Array.of(...Buffer.from(message.subarray(144, 148)).reverse())),
        Buffer.from(Uint8Array.of(body.length & 255, (body.length >> 8) & 255, (body.length >> 16) & 255, (body.length >> 24) & 255)),
        Buffer.from(body)]);
    const mintData = Buffer.concat([EVENT_CPI, mint, Buffer.from(keyBytes(candidate.tokenAccount)), u64(amount),
        Buffer.from(keyBytes(SOLANA_USDC)), u64(fee)]);
    const receivedData = Buffer.concat([EVENT_CPI, received,
        Buffer.from(keyBytes((() => {
            const ix = bridgeRecord(outer[receiveIndexes[0]]);
            return indexedKey(keys, rpcArray(ix.accounts, 64)[1]);
        })())),
        Buffer.from(Uint8Array.of(6, 0, 0, 0)), Buffer.from(message.subarray(12, 44)),
        Buffer.from(message.subarray(44, 76)), Buffer.from(Uint8Array.of(...Buffer.from(message.subarray(144, 148)).reverse())),
        Buffer.from(Uint8Array.of(body.length & 255, (body.length >> 8) & 255, (body.length >> 16) & 255, (body.length >> 24) & 255)), Buffer.from(body)]);
    const handlerMatches = [], mintMatches = [], receivedMatches = [], transfers = [];
    parsed.forEach((ix, index) => {
        if (ix.program === CIRCLE_V2_TOKEN_MESSENGER && ix.accounts[7] === candidate.tokenAccount &&
            ix.accounts[9] === TOKEN_PROGRAM_ADDRESS && ix.data.length === handlerData.length + 1 &&
            same(ix.data.subarray(0, -1), handlerData))
            handlerMatches.push(index);
        if (ix.program === CIRCLE_V2_TOKEN_MESSENGER && same(ix.data, mintData))
            mintMatches.push(index);
        if (ix.program === CIRCLE_V2_MESSAGE_TRANSMITTER && same(ix.data, receivedData))
            receivedMatches.push(index);
        if (ix.program === TOKEN_PROGRAM_ADDRESS &&
            ((ix.data.length === 9 && ix.data[0] === 3 && ix.accounts[1] === candidate.tokenAccount &&
                Buffer.from(ix.data).readBigUInt64LE(1) === amount) ||
                (ix.data.length === 10 && ix.data[0] === 12 && ix.accounts[1] === SOLANA_USDC &&
                    ix.accounts[2] === candidate.tokenAccount && Buffer.from(ix.data).readBigUInt64LE(1) === amount &&
                    ix.data[9] === 6)))
            transfers.push(index);
    });
    if (handlerMatches.length !== 1 || mintMatches.length !== 1 || receivedMatches.length !== 1 || transfers.length !== 1 ||
        !(handlerMatches[0] < transfers[0] && transfers[0] < mintMatches[0] && mintMatches[0] < receivedMatches[0]) ||
        parsed[transfers[0]].accounts[0] !== parsed[handlerMatches[0]].accounts[8])
        fail();
    return { ...candidate, proofClass: "circle_v2_solana_mint_event_candidate",
        sourceMessageCorrelation: "receive_cpi_mint_transfer_events_matched",
        executionAdmitted: false, bridgeCompletion: false,
        blockers: ["caller supplies authenticated finalized RPC and Circle-attested message; attester signatures are not independently verified"] };
}
//# sourceMappingURL=circle-v2-solana-destination-offline.js.map