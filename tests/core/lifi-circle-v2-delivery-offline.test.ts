import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { address, getBase58Decoder, getBase58Encoder, getProgramDerivedAddress } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { encodeAbiParameters, encodeEventTopics, getAddress, parseAbi, type Hex } from "viem";
import { SOLANA_USDC } from "../../src/chain-policy.js";
import { associatedUsdc } from "../../src/solana/accounts.js";
import { inspectCircleV2BaseSolanaDeliveryOffline } from "../../src/lifi/circle-v2-delivery-offline.js";
import { BASE_CCTP_V2_MESSAGE_TRANSMITTER as baseMt, BASE_CCTP_V2_TOKEN_MESSENGER as baseTm,
  BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES as baseFees } from "../../src/lifi/circle-v2-source-receipt.js";
import { CIRCLE_V2_MESSAGE_TRANSMITTER as solMt, CIRCLE_V2_TOKEN_MESSENGER as solTm } from "../../src/lifi/circle-v2-solana-destination-offline.js";

const decode = (v: string) => getBase58Encoder().encode(v);
const encode = (v: Uint8Array) => getBase58Decoder().decode(v);
const n = (value: bigint | number, bytes: number) => BigInt(value).toString(16).padStart(bytes * 2, "0");
const w = (v: string) => `0x${"0".repeat(24)}${v.slice(2).toLowerCase()}`;
const hex = (v: Buffer): Hex => `0x${v.toString("hex")}`;
const disc = (v: string) => createHash("sha256").update(v).digest().subarray(0, 8);
const le32 = (v: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const le64 = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; };
const eventTag = Buffer.from("e445a52e51cb9a1d", "hex");
const wallet = "So11111111111111111111111111111111111111112";
const other = "11111111111111111111111111111111";
const sourceHash = `0x${"12".repeat(32)}` as Hex;
const sourceFrom = getAddress("0x000000000000000000000000000000000000dEaD");
const usdc = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const solTmWord = "0xa65fc81d0fefa8860cb3b83f089b0224be8a6687b7ae49f594c0b9b4d7e93893";
const zero = `0x${"00".repeat(32)}`;
const burnAbi = parseAbi(["event DepositForBurn(address indexed burnToken,uint256 amount,address indexed depositor,bytes32 mintRecipient,uint32 destinationDomain,bytes32 destinationTokenMessenger,bytes32 destinationCaller,uint256 maxFee,uint32 indexed minFinalityThreshold,bytes hookData)"]);
const sentAbi = parseAbi(["event MessageSent(bytes message)"]);

async function fixture() {
  const ata = await associatedUsdc(wallet);
  const ataWord = hex(Buffer.from(decode(ata))) as Hex;
  const nonce = Buffer.alloc(32, 3), attestation = Buffer.alloc(65, 9);
  const [used] = await getProgramDerivedAddress({ programAddress: address(solMt), seeds: [new TextEncoder().encode("used_nonce"), nonce] });
  const sourceMessage = Buffer.from(`${n(1,4)}${n(6,4)}${n(5,4)}${zero.slice(2)}${w(baseTm).slice(2)}${solTmWord.slice(2)}${zero.slice(2)}${n(1000,4)}${n(0,4)}${n(1,4)}${w(usdc).slice(2)}${ataWord.slice(2)}${n(1_000_000,32)}${w(baseFees).slice(2)}${n(1000,32)}${n(0,32)}${n(0,32)}`, "hex");
  const message = Buffer.from(sourceMessage);
  nonce.copy(message, 12); message.writeUInt32BE(2000, 144); message.writeBigUInt64BE(100n, 336); message.writeBigUInt64BE(99999999n, 368);
  const body = hex(message.subarray(148));
  const irisResponse = { sourceTxHash: sourceHash, messages: [{ message: hex(message), eventNonce: "42", attestation: hex(attestation),
    cctpVersion: 2, status: "complete", decodedMessage: { sourceDomain: "6", destinationDomain: "5", nonce: BigInt(hex(nonce)).toString(),
      sender: w(baseTm), recipient: solTmWord, destinationCaller: zero, messageBody: body,
      decodedMessageBody: { burnToken: w(usdc), mintRecipient: ataWord, amount: "1000000", messageSender: w(baseFees),
        maxFee: "1000", feeExecuted: "100", expirationBlock: "99999999", hookData: "0x" } } }] };
  const sourceTransaction = { chainId: 8453, hash: sourceHash, from: sourceFrom, to: baseFees };
  const sourceReceipt = { chainId: 8453, transactionHash: sourceHash, status: "0x1", blockHash: `0x${"34".repeat(32)}`,
    blockNumberAtomic: "123", logs: [
      { address: baseMt, topics: encodeEventTopics({ abi: sentAbi, eventName: "MessageSent" }), data: encodeAbiParameters([{ type: "bytes" }], [hex(sourceMessage)]) },
      { address: baseTm, topics: encodeEventTopics({ abi: burnAbi, eventName: "DepositForBurn", args: { burnToken: usdc, depositor: baseFees, minFinalityThreshold: 1000 } }),
        data: encodeAbiParameters(burnAbi[0].inputs.filter(i => !("indexed" in i)), [1_000_000n, ataWord, 5, solTmWord, zero, 1000n, "0x"]) },
    ] };
  const receive = Buffer.concat([disc("global:receive_message"), le32(message.length), message, le32(attestation.length), attestation]);
  const signature = encode(Buffer.alloc(64, 7));
  const balance = (amount: string) => ({ accountIndex: 1, mint: SOLANA_USDC, owner: wallet, programId: TOKEN_PROGRAM_ADDRESS,
    uiTokenAmount: { amount, decimals: 6 } });
  const keys = [other, ata, solMt, solTm, used, wallet, SOLANA_USDC, TOKEN_PROGRAM_ADDRESS];
  const handler = Buffer.concat([disc("global:handle_receive_finalized_message"), le32(6), message.subarray(44, 76), le32(2000), le32(body.length / 2 - 1), message.subarray(148), Buffer.from([1])]);
  const mint = Buffer.concat([eventTag, disc("event:MintAndWithdraw"), Buffer.from(decode(ata)), le64(999_900n), Buffer.from(decode(SOLANA_USDC)), le64(100n)]);
  const received = Buffer.concat([eventTag, disc("event:MessageReceived"), Buffer.from(decode(wallet)), le32(6), nonce,
    message.subarray(44, 76), le32(2000), le32(message.length - 148), message.subarray(148)]);
  const transfer = Buffer.concat([Buffer.from([3]), le64(999_900n)]);
  const destination = { signature, recipient: wallet, minimumOutputAtomic: "900000",
    signatureStatuses: { context: { slot: 321 }, value: [{ slot: 320, confirmationStatus: "finalized", confirmations: null, err: null }] },
    transaction: { slot: 320, version: "legacy" as "legacy" | 0,
      meta: { err: null, preTokenBalances: [balance("100000")], postTokenBalances: [balance("1099900")],
        loadedAddresses: { writable: [] as string[], readonly: [] as string[] },
        innerInstructions: [{ index: 0, instructions: [
          { programIdIndex: 3, accounts: [0,0,0,0,0,0,0,1,0,7], data: encode(handler) },
          { programIdIndex: 7, accounts: [0,1,0], data: encode(transfer) },
          { programIdIndex: 3, accounts: [] as number[], data: encode(mint) },
          { programIdIndex: 2, accounts: [] as number[], data: encode(received) },
        ] }] },
      transaction: { signatures: [signature], message: { accountKeys: keys, addressTableLookups: undefined as undefined | { accountKey: string; writableIndexes: number[]; readonlyIndexes: number[] }[],
        instructions: [{ programIdIndex: 2, accounts: [0,5,6,2,4,3,0], data: encode(receive) }] } } } };
  return { intent: { sourceTransactionHash: sourceHash, sourceFrom, amountAtomic: "1000000", solanaAtaBytes32: ataWord,
      maxFeeAtomic: "1000", minFinalityThreshold: 1000, hookData: "0x" as Hex }, sourceTransaction, sourceReceipt, irisResponse, destination };
}

test("correlates source, Iris, and finalized receive/mint with separate hashes and untrusted provenance", async () => {
  const v = await fixture(); const proof = await inspectCircleV2BaseSolanaDeliveryOffline(v);
  assert.notEqual(proof.sourceMessageHash, proof.attestedMessageHash);
  assert.equal(proof.receivedAtomic, "999900");
  assert.equal(proof.provenance, "synthetic_untrusted_caller_supplied_offline_observations");
  assert.equal(proof.attestationAuthenticated, false); assert.equal(proof.chainAuthenticityVerified, false);
  assert.equal(proof.executionAdmitted, false); assert.equal(proof.bridgeCompletion, false);
});

test("rejects source/attested message mutation outside Circle populated fields", async () => {
  for (const offset of [0, 44, 76, 140, 148, 184, 216, 248, 280, 376]) {
    const v = await fixture(); const raw = Buffer.from(v.irisResponse.messages[0]!.message.slice(2), "hex");
    const index = offset === 376 ? 375 : offset;
    raw[index] = raw[index]! ^ 1;
    v.irisResponse.messages[0]!.message = hex(raw);
    await assert.rejects(inspectCircleV2BaseSolanaDeliveryOffline(v));
  }
});

test("rejects inconsistent source transaction and Iris burn fields", async () => {
  const changes = [
    (v: Awaited<ReturnType<typeof fixture>>) => { v.irisResponse.sourceTxHash = `0x${"ff".repeat(32)}` as Hex; },
    (v: Awaited<ReturnType<typeof fixture>>) => { v.irisResponse.messages[0]!.decodedMessage.decodedMessageBody.amount = "999999"; },
    (v: Awaited<ReturnType<typeof fixture>>) => { v.irisResponse.messages[0]!.decodedMessage.decodedMessageBody.mintRecipient = zero as Hex; },
    (v: Awaited<ReturnType<typeof fixture>>) => { v.irisResponse.messages[0]!.decodedMessage.decodedMessageBody.maxFee = "999"; },
    (v: Awaited<ReturnType<typeof fixture>>) => { v.irisResponse.messages[0]!.decodedMessage.decodedMessageBody.hookData = "0xab"; },
    (v: Awaited<ReturnType<typeof fixture>>) => { v.sourceTransaction.hash = `0x${"ff".repeat(32)}` as Hex; },
    (v: Awaited<ReturnType<typeof fixture>>) => { v.intent.minFinalityThreshold = 2000; },
  ];
  for (const change of changes) { const v = await fixture(); change(v); await assert.rejects(inspectCircleV2BaseSolanaDeliveryOffline(v)); }
});

test("rejects attestation, CPI, finality, error, and ALT mismatches", async () => {
  const changes = [
    (v: Awaited<ReturnType<typeof fixture>>) => { v.irisResponse.messages[0]!.attestation = `0x${"aa".repeat(65)}`; },
    (v: Awaited<ReturnType<typeof fixture>>) => { v.destination.transaction.meta.innerInstructions = []; },
    (v: Awaited<ReturnType<typeof fixture>>) => { v.destination.transaction.transaction.message.instructions.push({ ...v.destination.transaction.transaction.message.instructions[0]! }); },
    (v: Awaited<ReturnType<typeof fixture>>) => { v.destination.transaction.meta.innerInstructions[0]!.instructions.push({ ...v.destination.transaction.meta.innerInstructions[0]!.instructions[2]! }); },
    (v: Awaited<ReturnType<typeof fixture>>) => { v.destination.signatureStatuses.value[0]!.confirmationStatus = "confirmed"; },
    (v: Awaited<ReturnType<typeof fixture>>) => { v.destination.signatureStatuses.value[0]!.err = { failure: true } as never; },
    (v: Awaited<ReturnType<typeof fixture>>) => { v.destination.transaction.version = 0; v.destination.transaction.transaction.message.addressTableLookups = [{ accountKey: other, writableIndexes: [], readonlyIndexes: [0] }]; },
  ];
  for (const change of changes) { const v = await fixture(); change(v); await assert.rejects(inspectCircleV2BaseSolanaDeliveryOffline(v)); }
});
