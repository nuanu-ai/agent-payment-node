import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { SOLANA_USDC } from "../chain-policy.js";
import { atomic } from "../chain-policy.js";
import { associatedUsdc } from "../solana/accounts.js";
import { protocolFailure, rpcArray, rpcAtomic, rpcRecord, solanaAddress, solanaSignature } from "../solana/rpc.js";

/** A destination observation is never a bridge receipt. Source CCTP message correlation is not implemented. */
export interface SolanaDestinationCandidate {
  readonly proofClass: "solana_finalized_usdc_destination_candidate";
  readonly signature: string;
  readonly slotAtomic: string;
  readonly recipient: string;
  readonly tokenAccount: string;
  readonly mint: typeof SOLANA_USDC;
  readonly receivedAtomic: string;
  readonly minimumOutputAtomic: string;
  readonly sourceMessageCorrelation: "unverified";
  readonly bridgeCompletion: false;
}

export interface SolanaDestinationCandidateInput {
  readonly signature: string;
  readonly recipient: string;
  readonly minimumOutputAtomic: string;
  /** LI.FI terminal exceptions are never canonical USDC delivery evidence. */
  readonly providerOutcome: "pending" | "completed" | "partial" | "refunded" | "failed" | "unknown";
  readonly signatureStatuses: unknown;
  readonly transaction: unknown;
}

/** Parse untrusted finalized RPC responses without admitting or completing a bridge operation. */
export async function parseSolanaDestinationCandidate(input: SolanaDestinationCandidateInput): Promise<SolanaDestinationCandidate> {
  const signature = solanaSignature(input.signature);
  const recipient = solanaAddress(input.recipient);
  const minimum = atomic(input.minimumOutputAtomic);
  if (minimum <= 0n || input.providerOutcome !== "completed") protocolFailure();

  const statuses = rpcRecord(input.signatureStatuses);
  const contextSlot = rpcAtomic(rpcRecord(statuses.context).slot);
  const values = rpcArray(statuses.value, 1);
  if (values.length !== 1 || values[0] === null) protocolFailure();
  const status = rpcRecord(values[0]);
  const slot = rpcAtomic(status.slot);
  if (status.confirmationStatus !== "finalized" || status.confirmations !== null || status.err !== null || contextSlot < slot) protocolFailure();

  const result = rpcRecord(input.transaction);
  if (rpcAtomic(result.slot) !== slot) protocolFailure();
  const meta = rpcRecord(result.meta);
  if (meta.err !== null) protocolFailure();
  const transaction = rpcRecord(result.transaction);
  const signatures = rpcArray(transaction.signatures, 8);
  if (signatures.length === 0 || signatures[0] !== signature) protocolFailure();
  signatures.forEach(solanaSignature);
  const message = rpcRecord(transaction.message);
  const keys = solanaJsonAccountKeys(result);

  const tokenAccount = await associatedUsdc(recipient);
  const before = tokenAmount(meta.preTokenBalances, keys, tokenAccount, recipient);
  const after = tokenAmount(meta.postTokenBalances, keys, tokenAccount, recipient);
  if (after <= before || after - before < minimum) protocolFailure();
  return {
    proofClass: "solana_finalized_usdc_destination_candidate", signature, slotAtomic: slot.toString(), recipient,
    tokenAccount, mint: SOLANA_USDC, receivedAtomic: (after - before).toString(), minimumOutputAtomic: minimum.toString(),
    sourceMessageCorrelation: "unverified", bridgeCompletion: false,
  };
}

/** Resolve compiled instruction indexes for getTransaction encoding:"json" (static, loaded writable, loaded readonly). */
export function solanaJsonAccountKeys(resultValue: unknown): readonly string[] {
  const result = rpcRecord(resultValue);
  const wire = rpcRecord(rpcRecord(result.transaction).message);
  const meta = rpcRecord(result.meta);
  const staticKeys = rpcArray(wire.accountKeys, 256).map(raw => {
    if (typeof raw !== "string") protocolFailure();
    return solanaAddress(raw);
  });
  if (staticKeys.length === 0) protocolFailure();
  const version = result.version;
  if (version !== undefined && version !== "legacy" && version !== 0) protocolFailure();
  const loaded = meta.loadedAddresses;
  let writable: readonly string[] = [], readonly: readonly string[] = [];
  if (loaded !== undefined) {
    const addresses = rpcRecord(loaded);
    writable = rpcArray(addresses.writable, 256).map(raw => {
      if (typeof raw !== "string") protocolFailure();
      return solanaAddress(raw);
    });
    readonly = rpcArray(addresses.readonly, 256).map(raw => {
      if (typeof raw !== "string") protocolFailure();
      return solanaAddress(raw);
    });
  }
  if (version === 0) {
    if (loaded === undefined) protocolFailure();
    let writableCount = 0, readonlyCount = 0;
    for (const item of rpcArray(wire.addressTableLookups, 64)) {
      const lookup = rpcRecord(item);
      if (typeof lookup.accountKey !== "string") protocolFailure();
      solanaAddress(lookup.accountKey);
      const writableIndexes = rpcArray(lookup.writableIndexes, 256);
      const readonlyIndexes = rpcArray(lookup.readonlyIndexes, 256);
      for (const index of [...writableIndexes, ...readonlyIndexes]) {
        if (!Number.isSafeInteger(index) || (index as number) < 0 || (index as number) > 255) protocolFailure();
      }
      if (new Set([...writableIndexes, ...readonlyIndexes]).size !== writableIndexes.length + readonlyIndexes.length) protocolFailure();
      writableCount += writableIndexes.length;
      readonlyCount += readonlyIndexes.length;
    }
    if (writableCount !== writable.length || readonlyCount !== readonly.length) protocolFailure();
  } else if (writable.length !== 0 || readonly.length !== 0 || wire.addressTableLookups !== undefined) protocolFailure();
  const keys = [...staticKeys, ...writable, ...readonly];
  if (keys.length > 256 || new Set(keys).size !== keys.length) protocolFailure();
  return keys;
}

function tokenAmount(value: unknown, keys: readonly string[], tokenAccount: string, recipient: string): bigint {
  let found: bigint | undefined;
  for (const raw of rpcArray(value, 256)) {
    const balance = rpcRecord(raw);
    const index = rpcAtomic(balance.accountIndex);
    if (index >= BigInt(keys.length)) protocolFailure();
    const key = keys[Number(index)];
    if (balance.mint === SOLANA_USDC && balance.owner === recipient && key !== tokenAccount) protocolFailure();
    if (key !== tokenAccount) continue;
    if (found !== undefined || balance.mint !== SOLANA_USDC || balance.owner !== recipient || balance.programId !== TOKEN_PROGRAM_ADDRESS) protocolFailure();
    const token = rpcRecord(balance.uiTokenAmount);
    if (rpcAtomic(token.decimals) !== 6n || typeof token.amount !== "string") protocolFailure();
    found = atomic(token.amount);
  }
  if (found === undefined) protocolFailure();
  return found;
}
