import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { address, getBase58Decoder, getBase58Encoder, getProgramDerivedAddress } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { SOLANA_USDC } from "../../src/chain-policy.js";
import { associatedUsdc } from "../../src/solana/accounts.js";
import { CIRCLE_V2_MESSAGE_TRANSMITTER as mt, CIRCLE_V2_TOKEN_MESSENGER as tm,
  inspectCircleV2SolanaDestinationOffline, inspectCircleV2SolanaMintEventOffline } from "../../src/lifi/circle-v2-solana-destination-offline.js";

const wallet = "So11111111111111111111111111111111111111112";
const other = "11111111111111111111111111111111";
const signature = getBase58Decoder().decode(new Uint8Array(64).fill(7));
const encode = (v: Uint8Array) => getBase58Decoder().decode(v);
const decode = (v: string) => getBase58Encoder().encode(v);
async function fixture() {
  const ata = await associatedUsdc(wallet), nonce = new Uint8Array(32).fill(3);
  const [used] = await getProgramDerivedAddress({ programAddress: address(mt), seeds: [new TextEncoder().encode("used_nonce"), nonce] });
  const message = Buffer.alloc(376);
  message.writeUInt32BE(1, 0); message.writeUInt32BE(6, 4); message.writeUInt32BE(5, 8);
  message.set(nonce, 12); message.set(decode(tm), 76); message.writeUInt32BE(2000, 144);
  message.set(decode(ata), 184); message.writeBigUInt64BE(1_000_000n, 148 + 92);
  const data = Buffer.concat([createHash("sha256").update("global:receive_message").digest().subarray(0, 8),
    Buffer.from(Uint8Array.of(120, 1, 0, 0)), message, Buffer.from(Uint8Array.of(65, 0, 0, 0)), Buffer.alloc(65, 9)]);
  const balance = (amount: string) => ({ accountIndex: 1, mint: SOLANA_USDC, owner: wallet,
    programId: TOKEN_PROGRAM_ADDRESS, uiTokenAmount: { amount, decimals: 6 } });
  return { signature, recipient: wallet, minimumOutputAtomic: "900000", attestedMessageHex: `0x${message.toString("hex")}`,
    nonceHex: `0x${Buffer.from(nonce).toString("hex")}`,
    signatureStatuses: { context: { slot: 321 }, value: [{ slot: 320, confirmationStatus: "finalized", confirmations: null, err: null }] },
    transaction: { slot: 320, meta: { err: null, preTokenBalances: [balance("100000")], postTokenBalances: [balance("1100000")],
      innerInstructions: [] as { index: number; instructions: { programIdIndex: number; accounts: number[]; data: string }[] }[] },
      transaction: { signatures: [signature], message: { accountKeys: [other, ata, mt, tm, used, wallet, SOLANA_USDC]
        .map(pubkey => ({ pubkey })), instructions: [{ programIdIndex: 2, accounts: [0, 5, 6, 2, 4, 3, 0], data: encode(data) }] } } } };
}
test("matches exact attested V2 receive bytes, nonce PDA and USDC delta but does not prove mint completion", async () => {
  const input = await fixture(); const result = await inspectCircleV2SolanaDestinationOffline(input);
  assert.equal(result.sourceMessageCorrelation, "receive_instruction_matched");
  assert.equal(result.receivedAtomic, "1000000"); assert.equal(result.bridgeCompletion, false);
});
test("rejects different nonce, message body, nonce PDA, program, or amount", async () => {
  const changes = [
    (v: Awaited<ReturnType<typeof fixture>>) => { v.nonceHex = `0x${"00".repeat(32)}`; },
    (v: Awaited<ReturnType<typeof fixture>>) => { v.attestedMessageHex = `${v.attestedMessageHex.slice(0, -2)}01`; },
    (v: Awaited<ReturnType<typeof fixture>>) => { v.transaction.transaction.message.instructions[0]!.accounts[4] = 0; },
    (v: Awaited<ReturnType<typeof fixture>>) => { v.transaction.transaction.message.instructions[0]!.programIdIndex = 3; },
    (v: Awaited<ReturnType<typeof fixture>>) => { v.transaction.meta.postTokenBalances[0]!.uiTokenAmount.amount = "1200000"; },
    (v: Awaited<ReturnType<typeof fixture>>) => { v.signatureStatuses.value[0]!.confirmationStatus = "confirmed"; },
    (v: Awaited<ReturnType<typeof fixture>>) => { v.transaction.transaction.message.instructions.push({ ...v.transaction.transaction.message.instructions[0]! }); },
    (v: Awaited<ReturnType<typeof fixture>>) => { const b = Buffer.from(v.attestedMessageHex.slice(2), "hex"); b.writeUInt32BE(7, 4); v.attestedMessageHex = `0x${b.toString("hex")}`; },
  ];
  for (const change of changes) { const input = await fixture(); change(input); await assert.rejects(inspectCircleV2SolanaDestinationOffline(input)); }
});

const disc = (name: string) => createHash("sha256").update(name).digest().subarray(0, 8);
const le32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const le64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };
const eventTag = Buffer.from("e445a52e51cb9a1d", "hex");
async function eventFixture() {
  const v = await fixture();
  const message = Buffer.from(v.attestedMessageHex.slice(2), "hex"), body = message.subarray(148);
  const ata = v.transaction.transaction.message.accountKeys[1]!.pubkey;
  const keys = v.transaction.transaction.message.accountKeys;
  keys.push({ pubkey: TOKEN_PROGRAM_ADDRESS });
  const tokenIndex = keys.length - 1;
  const handler = Buffer.concat([disc("global:handle_receive_finalized_message"), le32(6), message.subarray(44, 76), le32(2000), le32(body.length), body, Buffer.from([1])]);
  const mint = Buffer.concat([eventTag, disc("event:MintAndWithdraw"), Buffer.from(decode(ata)), le64(1_000_000n), Buffer.from(decode(SOLANA_USDC)), le64(0n)]);
  const received = Buffer.concat([eventTag, disc("event:MessageReceived"), Buffer.from(decode(wallet)), le32(6), message.subarray(12, 44),
    message.subarray(44, 76), le32(2000), le32(body.length), body]);
  const transfer = Buffer.concat([Buffer.from([3]), le64(1_000_000n)]);
  v.transaction.meta.innerInstructions = [{ index: 0, instructions: [
    { programIdIndex: 3, accounts: [0, 0, 0, 0, 0, 0, 0, 1, 0, tokenIndex], data: encode(handler) },
    { programIdIndex: tokenIndex, accounts: [0, 1, 0], data: encode(transfer) },
    { programIdIndex: 3, accounts: [], data: encode(mint) },
    { programIdIndex: 2, accounts: [], data: encode(received) },
  ] }];
  return v;
}
test("binds receive, Circle handler, mint event, token transfer, and message event", async () => {
  const result = await inspectCircleV2SolanaMintEventOffline(await eventFixture());
  assert.equal(result.sourceMessageCorrelation, "receive_cpi_mint_transfer_events_matched");
  assert.equal(result.executionAdmitted, false); assert.equal(result.bridgeCompletion, false);
});
test("rejects absent or altered mint provenance", async () => {
  const changes = [
    (v: Awaited<ReturnType<typeof eventFixture>>) => { v.transaction.meta.innerInstructions = []; },
    (v: Awaited<ReturnType<typeof eventFixture>>) => { v.transaction.meta.innerInstructions[0]!.index = 1; },
    (v: Awaited<ReturnType<typeof eventFixture>>) => { v.transaction.meta.innerInstructions[0]!.instructions[0]!.programIdIndex = 2; },
    (v: Awaited<ReturnType<typeof eventFixture>>) => { v.transaction.meta.innerInstructions[0]!.instructions[1]!.accounts[1] = 0; },
    (v: Awaited<ReturnType<typeof eventFixture>>) => { v.transaction.meta.innerInstructions[0]!.instructions[2]!.programIdIndex = 2; },
    (v: Awaited<ReturnType<typeof eventFixture>>) => { v.transaction.meta.innerInstructions[0]!.instructions[3]!.data = encode(new Uint8Array(32)); },
    (v: Awaited<ReturnType<typeof eventFixture>>) => { v.transaction.meta.innerInstructions[0]!.instructions.reverse(); },
    (v: Awaited<ReturnType<typeof eventFixture>>) => { v.transaction.meta.innerInstructions[0]!.instructions.splice(3, 0,
      { ...v.transaction.meta.innerInstructions[0]!.instructions[2]! }); },
    (v: Awaited<ReturnType<typeof eventFixture>>) => { const ix = v.transaction.meta.innerInstructions[0]!.instructions[2]!;
      const raw = Buffer.from(decode(ix.data)); raw[48] = 1; ix.data = encode(raw); },
  ];
  for (const change of changes) { const v = await eventFixture(); change(v); await assert.rejects(inspectCircleV2SolanaMintEventOffline(v)); }
});
