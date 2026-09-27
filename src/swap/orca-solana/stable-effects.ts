import { getBase58Decoder, getBase58Encoder, getCompiledTransactionMessageDecoder } from "@solana/kit";
import { ApnError } from "../../errors.js";
import { rpcArray, rpcRecord } from "../../solana/rpc.js";
import { ORCA_STABLE_POOL, ORCA_STABLE_VAULT_A, ORCA_STABLE_VAULT_B } from "./stable-readonly.js";
import { TOKEN_PROGRAM, WHIRLPOOL_PROGRAM } from "./pins.js";
import type { OrcaStableUnsignedPreview } from "./stable-prepare.js";

/** Source/destination effect proof comes solely from the successful simulation's CPI trace. */
export interface OrcaStableTraceProof {
  readonly sourceDebitedAtomic: string; readonly destinationCreditedAtomic: string;
  readonly swapOuterInstructionIndex: number; readonly tokenTransferCount: 2;
}

/**
 * Decode the same-result classic Tokenkeg Transfer CPIs. Orca's pinned legacy swap uses
 * anchor_spl::token::transfer (Orca a119d79b, util/token.rs); it has no mint CPI accounts.
 * A missing or unfamiliar trace fails closed.
 * The standalone transaction message has no address lookup tables, so compiled CPI account indices
 * resolve against its exact static account table. Only pre-existing destination ATAs are admitted here:
 * the optional ATA creation path needs a separate exact CPI setup whitelist.
 */
export function proveOrcaStableSimulationTransfers(innerValue: unknown, preview: OrcaStableUnsignedPreview,
  owner: string, amountInAtomic: string, minimumOutputAtomic: string): OrcaStableTraceProof {
  if (preview.createUsdtAta) blocked("USDT ATA creation lacks a complete CPI setup whitelist.", "orca_stable_ata_trace_unsupported");
  const message = getCompiledTransactionMessageDecoder().decode(Buffer.from(preview.messageBase64, "base64"));
  if (message.version !== 0 || (message.addressTableLookups ?? []).length !== 0) invalid();
  const keys = message.staticAccounts, outer = message.instructions;
  const swapIndex = outer.length - 1;
  if (swapIndex !== 2 || keys[outer[swapIndex]!.programAddressIndex] !== WHIRLPOOL_PROGRAM ||
      outer.some((ix) => keys[ix.programAddressIndex] === TOKEN_PROGRAM)) invalid();
  if (innerValue === null || innerValue === undefined) blocked("Simulation omitted the inner-instruction trace.", "orca_stable_trace_missing");
  const groups = rpcArray(innerValue, 8);
  if (groups.length !== 1) invalid();
  const group = rpcRecord(groups[0]);
  if (group.index !== swapIndex) invalid();
  const instructions = rpcArray(group.instructions, 32);
  if (instructions.length !== 2) invalid();
  const expected = [
    { accounts: [preview.sourceAta, ORCA_STABLE_VAULT_A, owner], amount: BigInt(amountInAtomic) },
    { accounts: [ORCA_STABLE_VAULT_B, preview.destinationAta, ORCA_STABLE_POOL], amount: null },
  ] as const;
  let output = 0n;
  for (const [index, value] of instructions.entries()) {
    const instruction = rpcRecord(value), program = programAddress(instruction, keys);
    if (program !== TOKEN_PROGRAM) invalid();
    const accounts = accountAddresses(instruction, keys);
    if (JSON.stringify(accounts) !== JSON.stringify(expected[index]!.accounts)) invalid();
    const data = instruction.data;
    if (typeof data !== "string" || data.length > 64) invalid();
    let bytes: Buffer;
    try {
      bytes = Buffer.from(getBase58Encoder().encode(data));
      if (getBase58Decoder().decode(bytes) !== data) invalid();
    } catch { return invalid(); }
    if (bytes.length !== 9 || bytes[0] !== 3) invalid();
    const amount = Buffer.from(bytes).readBigUInt64LE(1);
    if (index === 0 && amount !== expected[0].amount) invalid();
    if (index === 1) output = amount;
  }
  if (output < BigInt(minimumOutputAtomic)) blocked("Simulation output transfer is below the owner minimum.", "orca_stable_simulation_delta");
  return { sourceDebitedAtomic: amountInAtomic, destinationCreditedAtomic: output.toString(),
    swapOuterInstructionIndex: swapIndex, tokenTransferCount: 2 };
}

function programAddress(instruction: Record<string, unknown>, keys: readonly string[]): string {
  if (typeof instruction.programId === "string") return instruction.programId;
  const index = instruction.programIdIndex;
  if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0 || index >= keys.length) invalid();
  return keys[index]!;
}
function accountAddresses(instruction: Record<string, unknown>, keys: readonly string[]): string[] {
  const accounts = rpcArray(instruction.accounts, 32);
  return accounts.map((account) => {
    if (typeof account === "string") return account;
    if (typeof account !== "number" || !Number.isSafeInteger(account) || account < 0 || account >= keys.length) invalid();
    return keys[account]!;
  });
}
function invalid(): never { return blocked("Simulation contains an unexpected or malformed CPI transfer.", "orca_stable_trace_invalid"); }
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
