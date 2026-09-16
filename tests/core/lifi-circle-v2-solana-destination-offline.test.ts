import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { address, getBase58Decoder, getBase58Encoder, getProgramDerivedAddress } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { SOLANA_USDC } from "../../src/chain-policy.js";
import { associatedUsdc } from "../../src/solana/accounts.js";
import { CIRCLE_V2_MESSAGE_TRANSMITTER as mt, CIRCLE_V2_TOKEN_MESSENGER as tm,
  inspectCircleV2SolanaDestinationOffline } from "../../src/lifi/circle-v2-solana-destination-offline.js";

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
    transaction: { slot: 320, meta: { err: null, preTokenBalances: [balance("100000")], postTokenBalances: [balance("1100000")] },
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
