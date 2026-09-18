import { address, getBase58Decoder, getBase64EncodedWireTransaction, getCompiledTransactionMessageDecoder, getPublicKeyFromAddress, getSignatureFromTransaction, getTransactionDecoder, verifySignature } from "@solana/kit";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { atomic } from "../chain-policy.js";
import type { ChainAccount, RailFinalEvidence, RailInspection, RailPreparedTransfer, RailSendBinding } from "../direct-rail-ports.js";
import { railSendLifetime } from "../rail-send-binding.js";
import { associatedToken } from "./accounts.js";
import { solanaTransferInstructions, validateSolanaMessage } from "./message.js";
import { assertSolanaNetwork, protocolFailure, rpcArray, rpcAtomic, rpcRecord, solanaAddress, solanaSignature, type SolanaRpcPort } from "./rpc.js";

const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
export async function inspectSolana(rpc: SolanaRpcPort, account: ChainAccount, prepared: RailPreparedTransfer, transactionId: string, now: Date, send: RailSendBinding | null = null): Promise<RailInspection> {
  await assertSolanaNetwork(rpc); solanaSignature(transactionId);
  const response = rpcRecord(await rpc.call("getSignatureStatuses", [[transactionId], { searchTransactionHistory: true }]));
  const statuses = rpcArray(response.value, 1);
  if (statuses.length !== 1) protocolFailure();
  if (statuses[0] === null) return { status: "unproven", reason: "signature_history_unavailable" };
  const status = rpcRecord(statuses[0]);
  if (status.confirmationStatus !== "finalized" || status.confirmations !== null) return { status: "pending", reason: "not_finalized" };
  const result = await rpc.call("getTransaction", [transactionId, { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 }]);
  if (result === null) return { status: "unproven", reason: "finalized_transaction_unavailable" };
  const tx = rpcRecord(result); const meta = rpcRecord(tx.meta); const transaction = rpcRecord(tx.transaction); const message = rpcRecord(transaction.message);
  const slot = rpcAtomic(tx.slot);
  if (slot !== rpcAtomic(status.slot) || rpcAtomic(rpcRecord(response.context).slot) < slot || stringify(meta.err) !== stringify(status.err)) protocolFailure();
  const success = meta.err === null;
  if (!success) validateError(meta.err);
  const signatures = rpcArray(transaction.signatures, 8);
  if (signatures[0] !== transactionId || signatures.length === 0) protocolFailure();
  signatures.forEach(solanaSignature);
  const entries = rpcArray(message.accountKeys, 32).map(rpcRecord);
  const keys = entries.map((entry) => {
    if (typeof entry.pubkey !== "string" || typeof entry.signer !== "boolean" || typeof entry.writable !== "boolean") protocolFailure();
    return solanaAddress(entry.pubkey);
  });
  if (new Set(keys).size !== keys.length || keys[0] !== prepared.economics.networkFeePayer || entries[0]?.signer !== true || entries[keys.indexOf(prepared.sender)]?.signer !== true) protocolFailure();
  if (message.recentBlockhash !== railSendLifetime(prepared, send).blockReference && account.provider === "local") protocolFailure();
  await verifyWire(rpc, transactionId, slot, account, prepared, signatures, message, entries, send);
  await verifyInstructions(message.instructions, prepared);
  const pre = rpcArray(meta.preBalances, keys.length).map(rpcAtomic); const post = rpcArray(meta.postBalances, keys.length).map(rpcAtomic);
  if (pre.length !== keys.length || post.length !== keys.length) protocolFailure();
  const delta = (key: string): bigint => {
    const index = keys.indexOf(key);
    if (index < 0 || entries[index]?.writable !== true) protocolFailure();
    return post[index]! - pre[index]!;
  };
  const fee = rpcAtomic(meta.fee); if (fee > atomic(prepared.economics.networkFeeMaximumAtomic)) protocolFailure();
  let rent = 0n;
  if (success && prepared.asset.kind === "token") {
    const source = await associatedToken(prepared.sender, prepared.asset.identifier); const destination = await associatedToken(prepared.recipient, prepared.asset.identifier);
    if (source !== prepared.sourceTokenAccount || destination !== prepared.destinationTokenAccount) protocolFailure();
    const before = tokenAmounts(meta.preTokenBalances, keys, prepared, prepared.createsRecipientAccount);
    const after = tokenAmounts(meta.postTokenBalances, keys, prepared, false);
    if (after.source - before.source !== -atomic(prepared.amountAtomic) || after.destination - before.destination !== atomic(prepared.amountAtomic)) protocolFailure();
    rent = delta(destination);
    if (rent < 0n || rent > atomic(prepared.economics.recipientRentAtomic) || !prepared.createsRecipientAccount && rent !== 0n) protocolFailure();
  }
  const expected = new Map<string, bigint>();
  const add = (key: string, amount: bigint): void => { expected.set(key, (expected.get(key) ?? 0n) + amount); };
  add(prepared.economics.networkFeePayer, -fee);
  if (success && prepared.asset.alias === "sol") { add(prepared.sender, -atomic(prepared.amountAtomic)); add(prepared.recipient, atomic(prepared.amountAtomic)); }
  if (success && rent > 0n) {
    if (prepared.economics.rentPayer === null || prepared.destinationTokenAccount === null) protocolFailure();
    add(prepared.economics.rentPayer, -rent); add(prepared.destinationTokenAccount, rent);
  }
  for (const [index, key] of keys.entries()) if (post[index]! - pre[index]! !== (expected.get(key) ?? 0n)) protocolFailure();
  for (const key of expected.keys()) if (delta(key) !== expected.get(key)) protocolFailure();
  if (!success) verifyFailedTokenBalances(meta.preTokenBalances, meta.postTokenBalances);
  const block = rpcRecord(await rpc.call("getBlock", [safeSlot(slot), { transactionDetails: "none", rewards: false, commitment: "finalized", maxSupportedTransactionVersion: 0 }]));
  if (typeof block.blockhash !== "string") protocolFailure(); solanaAddress(block.blockhash);
  const evidence: RailFinalEvidence = {
    networkIdentity: prepared.networkIdentity, transactionId, blockNumberAtomic: slot.toString(), blockId: block.blockhash,
    finality: "finalized", sender: prepared.sender, recipient: prepared.recipient, assetIdentifier: prepared.asset.identifier,
    amountAtomic: prepared.amountAtomic, actualNetworkFeeAtomic: fee.toString(), actualRecipientRentAtomic: rent.toString(),
    networkFeePayer: prepared.economics.networkFeePayer, senderEffectVerified: success, recipientEffectVerified: success,
    transactionVerified: true, observedAt: now.toISOString(), rpcOriginHash: rpc.originHash,
  };
  return { status: success ? "completed" : "failed_confirmed_revert", reason: success ? "exact_finalized_effect" : "exact_finalized_error", proofClass: "solana_finalized_transaction_effect", evidence };
}

async function verifyWire(rpc: SolanaRpcPort, transactionId: string, slot: bigint, account: ChainAccount, prepared: RailPreparedTransfer, signatures: readonly unknown[], parsed: Record<string, unknown>, entries: readonly Record<string, unknown>[], send: RailSendBinding | null): Promise<void> {
  const response = rpcRecord(await rpc.call("getTransaction", [transactionId, { encoding: "base64", commitment: "finalized", maxSupportedTransactionVersion: 0 }]));
  if (rpcAtomic(response.slot) !== slot) protocolFailure();
  const encoded = rpcArray(response.transaction, 2);
  if (encoded.length !== 2 || encoded[1] !== "base64" || typeof encoded[0] !== "string" || encoded[0].length > 2048) protocolFailure();
  const bytes = Buffer.from(encoded[0], "base64"); if (bytes.toString("base64") !== encoded[0]) protocolFailure();
  const tx = getTransactionDecoder().decode(bytes);
  if (getSignatureFromTransaction(tx) !== transactionId || Object.keys(tx.signatures).length !== signatures.length || getBase64EncodedWireTransaction(tx) !== encoded[0]) protocolFailure();
  if (account.provider === "local") {
    const expected = await validateSolanaMessage(prepared, send);
    if (Buffer.from(tx.messageBytes).toString("base64") !== expected.messageBase64 || signatures.length !== 1) protocolFailure();
  }
  let signatureIndex = 0;
  for (const [key, signature] of Object.entries(tx.signatures)) {
    if (signature === null || getBase58Decoder().decode(signature) !== signatures[signatureIndex++] || !await verifySignature(await getPublicKeyFromAddress(address(key)), signature, tx.messageBytes)) protocolFailure();
  }
  const compiled = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  if (compiled.version !== "legacy" && compiled.version !== 0 || compiled.version === 0 && (compiled.addressTableLookups?.length ?? 0) !== 0) protocolFailure();
  const keys = compiled.staticAccounts; const header = compiled.header;
  if (keys.length !== entries.length || compiled.lifetimeToken !== parsed.recentBlockhash || header.numSignerAccounts !== signatures.length) protocolFailure();
  for (const [index, key] of keys.entries()) {
    const signer = index < header.numSignerAccounts;
    const writable = signer ? index < header.numSignerAccounts - header.numReadonlySignerAccounts : index < keys.length - header.numReadonlyNonSignerAccounts;
    if (entries[index]?.pubkey !== key || entries[index]?.signer !== signer || entries[index]?.writable !== writable) protocolFailure();
  }
  const expected = await solanaTransferInstructions(prepared, prepared.economics.rentPayer ?? prepared.sender);
  const parsedInstructions = rpcArray(parsed.instructions, 6).map(rpcRecord);
  if (compiled.instructions.length !== parsedInstructions.length) protocolFailure();
  const computeKinds = new Set<number>(); let transferIndex = 0;
  for (const [index, instruction] of compiled.instructions.entries()) {
    const program = keys[instruction.programAddressIndex]; const data = Buffer.from(instruction.data ?? []);
    const accounts = instruction.accountIndices ?? [];
    if (program === COMPUTE_BUDGET) {
      if (account.provider !== "coinbase-awal" || transferIndex !== 0 || accounts.length !== 0 || computeKinds.has(data[0] ?? -1) ||
        !(data.length === 5 && data[0] === 2 && data.readUInt32LE(1) > 0 && data.readUInt32LE(1) <= 1_400_000 || data.length === 9 && data[0] === 3)) protocolFailure();
      computeKinds.add(data[0]!);
      if (parsedInstructions[index]?.programId !== program || parsedInstructions[index]?.data !== getBase58Decoder().decode(data) || rpcArray(parsedInstructions[index]?.accounts, 0).length !== 0) protocolFailure();
      continue;
    }
    const exact = expected[transferIndex++];
    if (exact === undefined || program !== exact.programAddress || !data.equals(Buffer.from(exact.data ?? [])) || accounts.length !== (exact.accounts?.length ?? 0)) protocolFailure();
    for (const [position, accountIndex] of accounts.entries()) if (keys[accountIndex] !== exact.accounts?.[position]?.address) protocolFailure();
  }
  if (transferIndex !== expected.length) protocolFailure();
}
async function verifyInstructions(value: unknown, prepared: RailPreparedTransfer): Promise<void> {
  const instructions = rpcArray(value, 6).map(rpcRecord);
  let transfers = 0; let creates = 0;
  for (const instruction of instructions) {
    if (instruction.programId === COMPUTE_BUDGET && prepared.unsignedPayload === null) continue;
    const parsed = rpcRecord(instruction.parsed); const info = rpcRecord(parsed.info);
    if (prepared.asset.alias === "sol" && instruction.programId === SYSTEM_PROGRAM_ADDRESS && parsed.type === "transfer") {
      if (info.source !== prepared.sender || info.destination !== prepared.recipient || rpcAtomic(info.lamports) !== atomic(prepared.amountAtomic)) protocolFailure();
      transfers += 1;
    } else if (prepared.asset.kind === "token" && instruction.programId === TOKEN_PROGRAM_ADDRESS && parsed.type === "transferChecked") {
      const amount = rpcRecord(info.tokenAmount);
      if (info.source !== prepared.sourceTokenAccount || info.destination !== prepared.destinationTokenAccount || info.authority !== prepared.sender || info.mint !== prepared.asset.identifier || amount.amount !== prepared.amountAtomic || rpcAtomic(amount.decimals) !== BigInt(prepared.asset.decimals)) protocolFailure();
      transfers += 1;
    } else if (prepared.asset.kind === "token" && instruction.programId === ASSOCIATED_TOKEN_PROGRAM_ADDRESS && parsed.type === "createIdempotent") {
      if (!prepared.createsRecipientAccount || info.source !== prepared.economics.rentPayer || info.account !== prepared.destinationTokenAccount || info.wallet !== prepared.recipient || info.mint !== prepared.asset.identifier || info.systemProgram !== SYSTEM_PROGRAM_ADDRESS || info.tokenProgram !== TOKEN_PROGRAM_ADDRESS) protocolFailure();
      creates += 1;
    } else protocolFailure();
  }
  if (transfers !== 1 || creates !== (prepared.createsRecipientAccount ? 1 : 0)) protocolFailure();
}
function tokenAmounts(value: unknown, keys: readonly string[], prepared: RailPreparedTransfer, allowMissingRecipient: boolean) {
  let source: bigint | undefined; let destination: bigint | undefined;
  for (const raw of rpcArray(value, 2)) {
    const record = rpcRecord(raw); const index = rpcAtomic(record.accountIndex);
    const amount = rpcRecord(record.uiTokenAmount); const key = keys[Number(index)];
    if (record.mint !== prepared.asset.identifier || record.programId !== TOKEN_PROGRAM_ADDRESS || rpcAtomic(amount.decimals) !== BigInt(prepared.asset.decimals)) protocolFailure();
    if (key === prepared.sourceTokenAccount && record.owner === prepared.sender && source === undefined) source = atomic(amount.amount);
    else if (key === prepared.destinationTokenAccount && record.owner === prepared.recipient && destination === undefined) destination = atomic(amount.amount);
    else protocolFailure();
  }
  if (source === undefined || destination === undefined && !allowMissingRecipient) protocolFailure();
  return { source, destination: destination ?? 0n };
}
function verifyFailedTokenBalances(before: unknown, after: unknown): void {
  // Rollback can still charge a fee, but cannot attest delivered principal or rent.
  if (stringify(rpcArray(before ?? [])) !== stringify(rpcArray(after ?? []))) protocolFailure();
}
function validateError(value: unknown): void {
  if (typeof value === "string" && /^[A-Za-z][A-Za-z0-9]{0,95}$/u.test(value)) return;
  const record = rpcRecord(value); const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== "InstructionError") protocolFailure();
  const error = rpcArray(record.InstructionError, 2);
  if (error.length !== 2 || rpcAtomic(error[0]) > 5n) protocolFailure();
  if (typeof error[1] === "string" && /^[A-Za-z][A-Za-z0-9]{0,95}$/u.test(error[1])) return;
  const custom = rpcRecord(error[1]); if (Object.keys(custom).length !== 1 || custom.Custom === undefined || rpcAtomic(custom.Custom) > 4_294_967_295n) protocolFailure();
}
function stringify(value: unknown): string { return JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item); }
function safeSlot(value: bigint): number { if (value > BigInt(Number.MAX_SAFE_INTEGER)) protocolFailure(); return Number(value); }
