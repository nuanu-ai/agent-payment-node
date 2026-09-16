/** Offline, read-only Circle V2 receive instruction inspection. Never import into execution. */
import { createHash } from "node:crypto";
import { address, getBase58Encoder, getProgramDerivedAddress } from "@solana/kit";
import { parseSolanaDestinationCandidate } from "./solana-destination-candidate.js";
import { bridgeFailure, bridgeHex, bridgeRecord } from "./validation.js";
import { rpcArray, solanaAddress } from "../solana/rpc.js";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { SOLANA_USDC } from "../chain-policy.js";

// Circle's mainnet V2 deployments and receive_message.rs (used_nonce seeds).
export const CIRCLE_V2_MESSAGE_TRANSMITTER = "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC";
export const CIRCLE_V2_TOKEN_MESSENGER = "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe";
const RECEIVE = createHash("sha256").update("global:receive_message").digest().subarray(0, 8);
const fail = (): never => bridgeFailure("APN_RPC_PROTOCOL", "circle_v2_solana_destination");
const bytes = (value: unknown): Uint8Array => Uint8Array.from(Buffer.from(bridgeHex(value, 16 * 1024).slice(2), "hex"));
const same = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));
const keyBytes = (key: string): Uint8Array => Uint8Array.from(getBase58Encoder().encode(key));

export interface CircleV2SolanaDestinationInput {
  readonly signature: string;
  readonly recipient: string;
  readonly minimumOutputAtomic: string;
  readonly signatureStatuses: unknown;
  readonly transaction: unknown;
  /** Caller-authenticated Circle-attested message; this parser does not verify attester signatures. */
  readonly attestedMessageHex: string;
  readonly nonceHex: string;
}

/** A matched receive instruction and ATA delta are a candidate, not an event-backed mint receipt. */
export async function inspectCircleV2SolanaDestinationOffline(input: CircleV2SolanaDestinationInput) {
  const message = bytes(input.attestedMessageHex);
  const nonce = bytes(input.nonceHex);
  if (message.length < 148 || nonce.length !== 32 || !same(message.subarray(12, 44), nonce)) fail();
  const read32 = (offset: number) => Buffer.from(message).readUInt32BE(offset);
  if (read32(4) !== 6 || read32(8) !== 5 || read32(144) < 2000 ||
      !same(message.subarray(76, 108), keyBytes(CIRCLE_V2_TOKEN_MESSENGER))) fail();
  // Recipient of the burn body is an SPL token account, not a wallet address.
  const candidate = await parseSolanaDestinationCandidate({
    signature: input.signature, recipient: input.recipient, minimumOutputAtomic: input.minimumOutputAtomic,
    providerOutcome: "completed", signatureStatuses: input.signatureStatuses, transaction: input.transaction,
  });
  if (!same(message.subarray(184, 216), keyBytes(candidate.tokenAccount))) fail();
  const body = message.subarray(148);
  if (body.length < 228) fail();
  const u256 = (offset: number) => BigInt(`0x${Buffer.from(body.subarray(offset, offset + 32)).toString("hex")}`);
  const amount = u256(68), fee = u256(164);
  if (amount === 0n || fee >= amount || amount > (1n << 64n) - 1n || fee > (1n << 64n) - 1n ||
      amount - fee !== BigInt(candidate.receivedAtomic)) fail();
  const tx = bridgeRecord(input.transaction);
  const wire = bridgeRecord(bridgeRecord(tx.transaction).message);
  const keys = rpcArray(wire.accountKeys, 256).map(item => {
    const pubkey = bridgeRecord(item).pubkey;
    if (typeof pubkey !== "string") return fail();
    return solanaAddress(pubkey);
  });
  const instructions = rpcArray(wire.instructions, 64);
  if (instructions.length === 0) fail();
  const [usedNonce] = await getProgramDerivedAddress({ programAddress: address(CIRCLE_V2_MESSAGE_TRANSMITTER),
    seeds: [new TextEncoder().encode("used_nonce"), nonce] });
  let matches = 0;
  for (const item of instructions) {
    const ix = bridgeRecord(item);
    if (!Number.isSafeInteger(ix.programIdIndex) || keys[ix.programIdIndex as number] !== CIRCLE_V2_MESSAGE_TRANSMITTER) continue;
    const encoded = ix.data;
    if (typeof encoded !== "string") return fail();
    const accounts = rpcArray(ix.accounts, 64);
    const raw = keyBytes(encoded);
    if (!same(raw.subarray(0, 8), RECEIVE)) continue;
    if (raw.length < 16) fail();
    const size = Buffer.from(raw).readUInt32LE(8);
    if (size !== message.length || raw.length < 12 + size + 4 || !same(raw.subarray(12, 12 + size), message)) continue;
    const attestationSize = Buffer.from(raw).readUInt32LE(12 + size);
    if (attestationSize === 0 || raw.length !== 16 + size + attestationSize ||
        accounts.length < 7 || accounts.some(index => !Number.isSafeInteger(index) || (index as number) < 0 || (index as number) >= keys.length) ||
        keys[accounts[4] as number] !== usedNonce || keys[accounts[5] as number] !== CIRCLE_V2_TOKEN_MESSENGER) fail();
    matches++;
  }
  if (matches !== 1) fail();
  return { ...candidate, proofClass: "circle_v2_solana_receive_candidate" as const,
    nonceHex: `0x${Buffer.from(nonce).toString("hex")}`, usedNoncePda: usedNonce,
    sourceMessageCorrelation: "receive_instruction_matched" as const, executionAdmitted: false as const, bridgeCompletion: false as const,
    blockers: ["MintAndWithdraw and MessageReceived CPI events are not decoded or bound", "caller supplies authenticated finalized RPC and Circle-attested message"] };
}

const EVENT_CPI = Buffer.from("e445a52e51cb9a1d", "hex"); // Anchor 0.31 EVENT_IX_TAG_LE.
const discriminator = (name: string) => createHash("sha256").update(name).digest().subarray(0, 8);

/** Require the deployed Circle V2 handler, both CPI events, and its SPL transfer in one receive invocation. */
export async function inspectCircleV2SolanaMintEventOffline(input: CircleV2SolanaDestinationInput) {
  const candidate = await inspectCircleV2SolanaDestinationOffline(input);
  const message = bytes(input.attestedMessageHex), body = message.subarray(148);
  const tx = bridgeRecord(input.transaction), meta = bridgeRecord(tx.meta);
  const wire = bridgeRecord(bridgeRecord(tx.transaction).message);
  const keys = rpcArray(wire.accountKeys, 256).map(item => solanaAddress(bridgeRecord(item).pubkey as string));
  const outer = rpcArray(wire.instructions, 64);
  const groups = rpcArray(meta.innerInstructions, 64);
  const receiveIndexes = outer.flatMap((item, index) => {
    const ix = bridgeRecord(item);
    if (keys[ix.programIdIndex as number] !== CIRCLE_V2_MESSAGE_TRANSMITTER || typeof ix.data !== "string") return [];
    const raw = keyBytes(ix.data);
    return same(raw.subarray(0, 8), RECEIVE) && raw.length >= 12 + message.length &&
      same(raw.subarray(12, 12 + message.length), message) ? [index] : [];
  });
  if (receiveIndexes.length !== 1) fail();
  const matching = groups.filter(item => bridgeRecord(item).index === receiveIndexes[0]);
  if (matching.length !== 1) fail();
  const inner = rpcArray(bridgeRecord(matching[0]).instructions, 128);
  const parsed = inner.map(item => {
    const ix = bridgeRecord(item);
    if (!Number.isSafeInteger(ix.programIdIndex) || (ix.programIdIndex as number) < 0 || (ix.programIdIndex as number) >= keys.length ||
        typeof ix.data !== "string") fail();
    const accounts = rpcArray(ix.accounts, 64).map(index => {
      if (!Number.isSafeInteger(index) || (index as number) < 0 || (index as number) >= keys.length) fail();
      return keys[index as number]!;
    });
    return { program: keys[ix.programIdIndex as number]!, accounts, data: keyBytes(ix.data as string) };
  });
  const handler = discriminator("global:handle_receive_finalized_message");
  const mint = discriminator("event:MintAndWithdraw");
  const received = discriminator("event:MessageReceived");
  const amount = BigInt(candidate.receivedAtomic);
  const fee = BigInt(`0x${Buffer.from(body.subarray(164, 196)).toString("hex")}`);
  const u64 = (value: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(value); return b; };
  const handlerData = Buffer.concat([handler, Buffer.from(Uint8Array.of(6, 0, 0, 0)),
    Buffer.from(message.subarray(44, 76)), Buffer.from(Uint8Array.of(...Buffer.from(message.subarray(144, 148)).reverse())),
    Buffer.from(Uint8Array.of(body.length & 255, (body.length >> 8) & 255, (body.length >> 16) & 255, (body.length >> 24) & 255)),
    Buffer.from(body)]);
  const mintData = Buffer.concat([EVENT_CPI, mint, Buffer.from(keyBytes(candidate.tokenAccount)), u64(amount),
    Buffer.from(keyBytes(SOLANA_USDC)), u64(fee)]);
  const receivedData = Buffer.concat([EVENT_CPI, received,
    Buffer.from(keyBytes((() => { const ix = bridgeRecord(outer[receiveIndexes[0]!]!);
      return keys[rpcArray(ix.accounts, 64)[1] as number]!; })())),
    Buffer.from(Uint8Array.of(6, 0, 0, 0)), Buffer.from(message.subarray(12, 44)),
    Buffer.from(message.subarray(44, 76)), Buffer.from(Uint8Array.of(...Buffer.from(message.subarray(144, 148)).reverse())),
    Buffer.from(Uint8Array.of(body.length & 255, (body.length >> 8) & 255, (body.length >> 16) & 255, (body.length >> 24) & 255)), Buffer.from(body)]);
  const handlerMatches: number[] = [], mintMatches: number[] = [], receivedMatches: number[] = [], transfers: number[] = [];
  parsed.forEach((ix, index) => {
    if (ix.program === CIRCLE_V2_TOKEN_MESSENGER && ix.accounts[7] === candidate.tokenAccount &&
        ix.accounts[9] === TOKEN_PROGRAM_ADDRESS && ix.data.length === handlerData.length + 1 &&
        same(ix.data.subarray(0, -1), handlerData)) handlerMatches.push(index);
    if (ix.program === CIRCLE_V2_TOKEN_MESSENGER && same(ix.data, mintData)) mintMatches.push(index);
    if (ix.program === CIRCLE_V2_MESSAGE_TRANSMITTER && same(ix.data, receivedData)) receivedMatches.push(index);
    if (ix.program === TOKEN_PROGRAM_ADDRESS &&
        ((ix.data.length === 9 && ix.data[0] === 3 && ix.accounts[1] === candidate.tokenAccount &&
          Buffer.from(ix.data).readBigUInt64LE(1) === amount) ||
         (ix.data.length === 10 && ix.data[0] === 12 && ix.accounts[1] === SOLANA_USDC &&
          ix.accounts[2] === candidate.tokenAccount && Buffer.from(ix.data).readBigUInt64LE(1) === amount &&
          ix.data[9] === 6))) transfers.push(index);
  });
  if (handlerMatches.length !== 1 || mintMatches.length !== 1 || receivedMatches.length !== 1 || transfers.length !== 1 ||
      !(handlerMatches[0]! < transfers[0]! && transfers[0]! < mintMatches[0]! && mintMatches[0]! < receivedMatches[0]!) ||
      parsed[transfers[0]!]!.accounts[0] !== parsed[handlerMatches[0]!]!.accounts[8]) fail();
  return { ...candidate, proofClass: "circle_v2_solana_mint_event_candidate" as const,
    sourceMessageCorrelation: "receive_cpi_mint_transfer_events_matched" as const,
    executionAdmitted: false as const, bridgeCompletion: false as const,
    blockers: ["caller supplies authenticated finalized RPC and Circle-attested message; attester signatures are not independently verified"] };
}
