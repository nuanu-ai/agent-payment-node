import assert from "node:assert/strict";
import test from "node:test";
import { getBase58Decoder } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { SOLANA_USDC } from "../../src/chain-policy.js";
import { parseSolanaDestinationCandidate } from "../../src/lifi/solana-destination-candidate.js";
import { associatedUsdc } from "../../src/solana/accounts.js";

const recipient = "So11111111111111111111111111111111111111112";
const signature = getBase58Decoder().decode(new Uint8Array(64).fill(7));
const other = "11111111111111111111111111111111";

async function fixture() {
  const ata = await associatedUsdc(recipient);
  const balance = (amount: string) => ({ accountIndex: 1n, mint: SOLANA_USDC, owner: recipient, programId: TOKEN_PROGRAM_ADDRESS,
    uiTokenAmount: { amount, decimals: 6n } });
  return {
    signature, recipient, minimumOutputAtomic: "900000", providerOutcome: "completed" as const,
    signatureStatuses: { context: { slot: 321n }, value: [{ slot: 320n, confirmationStatus: "finalized", confirmations: null, err: null }] },
    transaction: { slot: 320n, version: "legacy" as "legacy" | 0,
      meta: { err: null, preTokenBalances: [balance("100000")], postTokenBalances: [balance("1100000")],
        loadedAddresses: { writable: [] as string[], readonly: [] as string[] } },
      transaction: { signatures: [signature], message: { accountKeys: [other, ata],
        addressTableLookups: undefined as undefined | { accountKey: string; writableIndexes: number[]; readonlyIndexes: number[] }[] } } },
  };
}

async function refused(change: (input: Awaited<ReturnType<typeof fixture>>) => void): Promise<void> {
  const input = await fixture(); change(input);
  await assert.rejects(parseSolanaDestinationCandidate(input), { code: "APN_RPC_PROTOCOL" });
}

test("finalized canonical USDC ATA delta remains a candidate until source CCTP message correlation exists", async () => {
  const proof = await parseSolanaDestinationCandidate(await fixture());
  assert.equal(proof.receivedAtomic, "1000000");
  assert.equal(proof.tokenAccount, await associatedUsdc(recipient));
  assert.equal(proof.sourceMessageCorrelation, "unverified");
  assert.equal(proof.bridgeCompletion, false);
});

test("refuses an unfinalized, failed, mismatched, or missing transaction", async () => {
  await refused((i) => { i.signatureStatuses.value[0]!.confirmationStatus = "confirmed"; });
  await refused((i) => { (i.signatureStatuses.value[0]! as { err: unknown }).err = "failed"; });
  await refused((i) => { i.transaction.slot = 319n; });
  await refused((i) => { i.transaction.transaction.signatures[0] = getBase58Decoder().decode(new Uint8Array(64).fill(8)); });
  await refused((i) => { (i.transaction.meta as { err: unknown }).err = "failed"; });
  await refused((i) => { (i as { transaction: unknown }).transaction = null; });
  await refused((i) => { (i.signatureStatuses.value as unknown[])[0] = null; });
});

test("refuses absent, duplicate, wrong mint, owner, ATA, or token program balance rows", async () => {
  await refused((i) => { i.transaction.meta.preTokenBalances = []; });
  await refused((i) => { i.transaction.meta.postTokenBalances.push(i.transaction.meta.postTokenBalances[0]!); });
  await refused((i) => { i.transaction.meta.postTokenBalances[0]!.mint = other; });
  await refused((i) => { i.transaction.meta.postTokenBalances[0]!.owner = other; });
  await refused((i) => { (i.transaction.meta.postTokenBalances[0]! as { programId: string }).programId = other; });
  await refused((i) => { i.transaction.transaction.message.accountKeys[1] = other; });
});

test("resolves v0 writable ALT addresses after static keys and rejects missing loaded addresses", async () => {
  const v = await fixture();
  const ata = v.transaction.transaction.message.accountKeys.pop()!;
  v.transaction.version = 0;
  v.transaction.transaction.message.addressTableLookups = [{ accountKey: other, writableIndexes: [0], readonlyIndexes: [] }];
  v.transaction.meta.loadedAddresses.writable = [ata];
  assert.equal((await parseSolanaDestinationCandidate(v)).tokenAccount, ata);
  v.transaction.meta.loadedAddresses.writable = [];
  await assert.rejects(parseSolanaDestinationCandidate(v), { code: "APN_RPC_PROTOCOL" });
  v.transaction.meta.loadedAddresses.writable = [ata];
  v.transaction.transaction.message.addressTableLookups[0]!.writableIndexes[0] = 256;
  await assert.rejects(parseSolanaDestinationCandidate(v), { code: "APN_RPC_PROTOCOL" });
});

test("refuses no delivery, output below minimum, and every non-completed provider outcome", async () => {
  await refused((i) => { i.transaction.meta.postTokenBalances[0]!.uiTokenAmount.amount = "100000"; });
  await refused((i) => { i.transaction.meta.postTokenBalances[0]!.uiTokenAmount.amount = "999999"; });
  for (const outcome of ["partial", "refunded", "failed", "pending", "unknown", "COMPLETED", "Completed", "", "success"]) {
    await refused((i) => { (i as { providerOutcome: unknown }).providerOutcome = outcome; });
  }
});
