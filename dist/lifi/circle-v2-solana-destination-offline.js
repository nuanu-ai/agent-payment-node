/** Offline, read-only Circle V2 receive instruction inspection. Never import into execution. */
import { createHash } from "node:crypto";
import { address, getBase58Encoder, getProgramDerivedAddress } from "@solana/kit";
import { parseSolanaDestinationCandidate } from "./solana-destination-candidate.js";
import { bridgeFailure, bridgeHex, bridgeRecord } from "./validation.js";
import { rpcArray, solanaAddress } from "../solana/rpc.js";
// Circle's mainnet V2 deployments and receive_message.rs (used_nonce seeds).
export const CIRCLE_V2_MESSAGE_TRANSMITTER = "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC";
export const CIRCLE_V2_TOKEN_MESSENGER = "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe";
const RECEIVE = createHash("sha256").update("global:receive_message").digest().subarray(0, 8);
const fail = () => bridgeFailure("APN_RPC_PROTOCOL", "circle_v2_solana_destination");
const bytes = (value) => Uint8Array.from(Buffer.from(bridgeHex(value, 16 * 1024).slice(2), "hex"));
const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));
const keyBytes = (key) => Uint8Array.from(getBase58Encoder().encode(key));
/** A matched receive instruction and ATA delta are a candidate, not an event-backed mint receipt. */
export async function inspectCircleV2SolanaDestinationOffline(input) {
    const message = bytes(input.attestedMessageHex);
    const nonce = bytes(input.nonceHex);
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
    const keys = rpcArray(wire.accountKeys, 256).map(item => {
        const pubkey = bridgeRecord(item).pubkey;
        if (typeof pubkey !== "string")
            return fail();
        return solanaAddress(pubkey);
    });
    const instructions = rpcArray(wire.instructions, 64);
    if (instructions.length === 0)
        fail();
    const [usedNonce] = await getProgramDerivedAddress({ programAddress: address(CIRCLE_V2_MESSAGE_TRANSMITTER),
        seeds: [new TextEncoder().encode("used_nonce"), nonce] });
    let matches = 0;
    for (const item of instructions) {
        const ix = bridgeRecord(item);
        if (!Number.isSafeInteger(ix.programIdIndex) || keys[ix.programIdIndex] !== CIRCLE_V2_MESSAGE_TRANSMITTER)
            continue;
        const encoded = ix.data;
        if (typeof encoded !== "string")
            return fail();
        const accounts = rpcArray(ix.accounts, 64);
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
            accounts.length < 7 || accounts.some(index => !Number.isSafeInteger(index) || index < 0 || index >= keys.length) ||
            keys[accounts[4]] !== usedNonce || keys[accounts[5]] !== CIRCLE_V2_TOKEN_MESSENGER)
            fail();
        matches++;
    }
    if (matches !== 1)
        fail();
    return { ...candidate, proofClass: "circle_v2_solana_receive_candidate",
        nonceHex: `0x${Buffer.from(nonce).toString("hex")}`, usedNoncePda: usedNonce,
        sourceMessageCorrelation: "receive_instruction_matched", bridgeCompletion: false,
        blockers: ["MintAndWithdraw and MessageReceived CPI events are not decoded or bound", "caller supplies authenticated finalized RPC and Circle-attested message"] };
}
//# sourceMappingURL=circle-v2-solana-destination-offline.js.map