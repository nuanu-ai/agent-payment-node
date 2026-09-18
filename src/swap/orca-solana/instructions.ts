import {
  AccountRole, address, appendTransactionMessageInstructions, blockhash, compileTransaction, createNoopSigner,
  createTransactionMessage, getBase64EncodedWireTransaction, getCompiledTransactionMessageDecoder,
  setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, type Instruction,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { getCloseAccountInstruction, getCreateAssociatedTokenIdempotentInstruction, getSyncNativeInstruction } from "@solana-program/token";
import { ApnError } from "../../errors.js";
import { solanaAddress } from "../../solana/rpc.js";
import {
  ATA_PROGRAM, COMPUTE_BUDGET_PROGRAM, ORCA_SOL_USDC_POOL, ORCA_SOL_VAULT, ORCA_USDC_VAULT, sha256Hex, SYSTEM_PROGRAM, TOKEN_PROGRAM,
  USDC_MINT, WHIRLPOOL_PROGRAM, WHIRLPOOL_SWAP_DISCRIMINATOR, WSOL_MINT,
} from "./pins.js";

/** Everything the transaction depends on besides its lifetime. The quote hash binds it through the payload hash. */
export interface OrcaSwapPlan {
  readonly owner: string;
  readonly wsolAccount: string;
  readonly usdcAccount: string;
  readonly amountInLamports: string;
  readonly minimumOutputAtomic: string;
  readonly computeUnitLimit: number;
  readonly computeUnitPriceMicroLamports: string;
  readonly tickArrays: readonly string[];
  readonly oracle: string;
}
export interface OrcaSwapLifetime { readonly blockhash: string; readonly lastValidBlockHeight: string }
export interface CompiledOrcaSwap {
  readonly transaction: ReturnType<typeof compileTransaction>;
  readonly unsignedPayload: string;
  readonly messageBase64: string;
  readonly messageHash: string;
}
interface ExpectedAccount { readonly address: string; readonly writable: boolean; readonly signer: boolean }
interface ExpectedInstruction { readonly program: string; readonly accounts: readonly ExpectedAccount[]; readonly data: string }

export const ORCA_ALLOWED_PROGRAMS: readonly string[] = [COMPUTE_BUDGET_PROGRAM, ATA_PROGRAM, SYSTEM_PROGRAM, TOKEN_PROGRAM, WHIRLPOOL_PROGRAM];
const U64_MAX = (1n << 64n) - 1n;
export const ORCA_MAX_COMPUTE_UNITS = 1_400_000;

/**
 * The only instruction list APN signs for this swap: compute budget (owner-capped limit and price), idempotent wSOL
 * and USDC associated accounts, wrap exactly the input, sync, Whirlpool `swap` (exact input, A to B, no price limit,
 * minimum output as `other_amount_threshold`), and close the wSOL account back to the owner.
 */
export function orcaSwapInstructions(planValue: OrcaSwapPlan): readonly Instruction[] {
  const plan = validatePlan(planValue), owner = createNoopSigner(address(plan.owner));
  const wsol = address(plan.wsolAccount), usdc = address(plan.usdcAccount), amount = BigInt(plan.amountInLamports);
  const limit = Buffer.alloc(5); limit[0] = 2; limit.writeUInt32LE(plan.computeUnitLimit, 1);
  const price = Buffer.alloc(9); price[0] = 3; price.writeBigUInt64LE(BigInt(plan.computeUnitPriceMicroLamports), 1);
  const swap = Buffer.alloc(42); Buffer.from(WHIRLPOOL_SWAP_DISCRIMINATOR, "hex").copy(swap, 0);
  swap.writeBigUInt64LE(amount, 8); swap.writeBigUInt64LE(BigInt(plan.minimumOutputAtomic), 16); swap[40] = 1; swap[41] = 1;
  const writable = (value: string) => ({ address: address(value), role: AccountRole.WRITABLE });
  return [
    { programAddress: address(COMPUTE_BUDGET_PROGRAM), accounts: [], data: new Uint8Array(limit) },
    { programAddress: address(COMPUTE_BUDGET_PROGRAM), accounts: [], data: new Uint8Array(price) },
    getCreateAssociatedTokenIdempotentInstruction({ payer: owner, ata: wsol, owner: address(plan.owner), mint: address(WSOL_MINT) }),
    getCreateAssociatedTokenIdempotentInstruction({ payer: owner, ata: usdc, owner: address(plan.owner), mint: address(USDC_MINT) }),
    getTransferSolInstruction({ source: owner, destination: wsol, amount }),
    getSyncNativeInstruction({ account: wsol }),
    { programAddress: address(WHIRLPOOL_PROGRAM), data: new Uint8Array(swap), accounts: [
      { address: address(TOKEN_PROGRAM), role: AccountRole.READONLY },
      { address: address(plan.owner), role: AccountRole.READONLY_SIGNER },
      writable(ORCA_SOL_USDC_POOL), writable(plan.wsolAccount), writable(ORCA_SOL_VAULT), writable(plan.usdcAccount), writable(ORCA_USDC_VAULT),
      writable(plan.tickArrays[0]!), writable(plan.tickArrays[1]!), writable(plan.tickArrays[2]!), writable(plan.oracle)] },
    getCloseAccountInstruction({ account: wsol, destination: address(plan.owner), owner }),
  ];
}

export function compileOrcaSwap(plan: OrcaSwapPlan, lifetime: OrcaSwapLifetime): CompiledOrcaSwap {
  solanaAddress(lifetime.blockhash);
  if (!/^[1-9][0-9]{0,19}$/u.test(lifetime.lastValidBlockHeight)) invalid("Solana lastValidBlockHeight is invalid.");
  const message = appendTransactionMessageInstructions(orcaSwapInstructions(plan), setTransactionMessageLifetimeUsingBlockhash(
    { blockhash: blockhash(lifetime.blockhash), lastValidBlockHeight: BigInt(lifetime.lastValidBlockHeight) },
    setTransactionMessageFeePayerSigner(createNoopSigner(address(plan.owner)), createTransactionMessage({ version: 0 }))));
  const transaction = compileTransaction(message), messageBytes = new Uint8Array(transaction.messageBytes);
  validateOrcaSwapMessage(messageBytes, plan, lifetime.blockhash);
  return { transaction, unsignedPayload: getBase64EncodedWireTransaction(transaction),
    messageBase64: Buffer.from(messageBytes).toString("base64"), messageHash: sha256Hex(messageBytes) };
}

/**
 * Strict decoder-side validation of the compiled bytes: v0 without lookup tables, the owner as the only signer and
 * fee payer, only the five allowed programs, exactly the eight expected instructions with exact accounts, roles and
 * data, and no writable account beyond the owner, its two token accounts, and the pool's swap accounts.
 */
export function validateOrcaSwapMessage(messageBytes: Uint8Array, planValue: OrcaSwapPlan, expectedBlockhash: string): void {
  const plan = validatePlan(planValue);
  let message: ReturnType<ReturnType<typeof getCompiledTransactionMessageDecoder>["decode"]>;
  try { message = getCompiledTransactionMessageDecoder().decode(messageBytes); }
  catch { return refuse("Orca swap message bytes do not decode.", "orca_message_decode"); }
  if (message.version !== 0 || (message.addressTableLookups ?? []).length !== 0) refuse("Orca swap must be a v0 message without lookup tables.", "orca_message_shape");
  if (message.lifetimeToken !== expectedBlockhash) refuse("Orca swap lifetime is not the bound blockhash.", "orca_message_lifetime");
  const { header, staticAccounts } = message, total = staticAccounts.length;
  if (header.numSignerAccounts !== 1 || header.numReadonlySignerAccounts !== 0 || staticAccounts[0] !== plan.owner ||
      new Set(staticAccounts).size !== total || header.numReadonlyNonSignerAccounts >= total) refuse("Orca swap has a signer other than the owner.", "orca_instruction_signer");
  const writableAt = (index: number) => index < header.numSignerAccounts - header.numReadonlySignerAccounts ||
    (index >= header.numSignerAccounts && index < total - header.numReadonlyNonSignerAccounts);
  const allowedWritable = new Set([plan.owner, plan.wsolAccount, plan.usdcAccount, ORCA_SOL_USDC_POOL, ORCA_SOL_VAULT, ORCA_USDC_VAULT,
    ...plan.tickArrays, plan.oracle]);
  staticAccounts.forEach((key, index) => {
    if (writableAt(index) && !allowedWritable.has(key)) refuse("Orca swap marks an unexpected account writable.", "orca_instruction_writable");
  });
  const expected = expectedInstructions(plan);
  if (message.instructions.length !== expected.length) refuse("Orca swap instruction count changed.", "orca_instruction_mismatch");
  message.instructions.forEach((instruction, position) => {
    const program = staticAccounts[instruction.programAddressIndex], want = expected[position]!;
    if (program === undefined || !ORCA_ALLOWED_PROGRAMS.includes(program)) refuse("Orca swap invokes a program outside the allowlist.", "orca_instruction_program");
    const indices = instruction.accountIndices ?? [];
    const accounts = indices.map((index) => {
      const key = staticAccounts[index]; if (key === undefined) refuse("Orca swap account index is out of range.", "orca_message_shape");
      return { address: key, writable: writableAt(index), signer: index < header.numSignerAccounts };
    });
    if (program !== want.program || Buffer.from(instruction.data ?? new Uint8Array()).toString("hex") !== want.data ||
        accounts.length !== want.accounts.length || accounts.some((account, index) => account.address !== want.accounts[index]!.address ||
          account.writable !== want.accounts[index]!.writable || account.signer !== want.accounts[index]!.signer)) {
      refuse(`Orca swap instruction ${position} differs from the exact expected instruction.`, "orca_instruction_mismatch");
    }
  });
}

function expectedInstructions(plan: OrcaSwapPlan): readonly ExpectedInstruction[] {
  return orcaSwapInstructions(plan).map((instruction) => ({ program: instruction.programAddress,
    data: Buffer.from(instruction.data ?? new Uint8Array()).toString("hex"),
    accounts: (instruction.accounts ?? []).map((account) => ({ address: account.address,
      // A key is writable or signing in the compiled message if any instruction marks it so; mirror that merge.
      writable: mergedRole(plan, account.address).writable, signer: account.address === plan.owner })) }));
}
function mergedRole(plan: OrcaSwapPlan, key: string): { readonly writable: boolean } {
  return { writable: [plan.owner, plan.wsolAccount, plan.usdcAccount, ORCA_SOL_USDC_POOL, ORCA_SOL_VAULT, ORCA_USDC_VAULT,
    ...plan.tickArrays, plan.oracle].includes(key) };
}

export function validatePlan(plan: OrcaSwapPlan): OrcaSwapPlan {
  if (typeof plan !== "object" || plan === null || !Array.isArray(plan.tickArrays) || plan.tickArrays.length !== 3) invalid("Orca swap plan is invalid.");
  [plan.owner, plan.wsolAccount, plan.usdcAccount, plan.oracle, ...plan.tickArrays].forEach(solanaAddress);
  const keys = [plan.owner, plan.wsolAccount, plan.usdcAccount, plan.oracle, ...plan.tickArrays, ORCA_SOL_USDC_POOL, ORCA_SOL_VAULT, ORCA_USDC_VAULT];
  if (new Set(keys).size !== keys.length || ORCA_ALLOWED_PROGRAMS.includes(plan.owner)) invalid("Orca swap plan accounts must be distinct.");
  const amount = unsigned(plan.amountInLamports, true), minimum = unsigned(plan.minimumOutputAtomic, true);
  unsigned(plan.computeUnitPriceMicroLamports, false);
  if (amount > U64_MAX || minimum > U64_MAX || !Number.isSafeInteger(plan.computeUnitLimit) || plan.computeUnitLimit < 1 ||
      plan.computeUnitLimit > ORCA_MAX_COMPUTE_UNITS || BigInt(plan.computeUnitPriceMicroLamports) > U64_MAX) invalid("Orca swap plan bounds are invalid.");
  return plan;
}
function unsigned(value: unknown, positive: boolean): bigint {
  if (typeof value !== "string" || !(positive ? /^[1-9][0-9]{0,19}$/u : /^(?:0|[1-9][0-9]{0,19})$/u).test(value)) invalid("Orca swap integer is invalid.");
  return BigInt(value as string);
}
function invalid(message: string): never { throw new ApnError("APN_INVALID_INPUT", message); }
function refuse(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
