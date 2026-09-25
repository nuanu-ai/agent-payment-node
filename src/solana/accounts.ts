import { address } from "@solana/kit";
import { findAssociatedTokenPda, getMintDecoder, getTokenDecoder, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { SOLANA_USDC } from "../chain-policy.js";
import { ApnError } from "../errors.js";
import { protocolFailure, rpcArray, rpcAtomic, rpcRecord, solanaAddress, type SolanaRpcPort } from "./rpc.js";

export interface SolanaAccountInfo { readonly owner: string; readonly lamports: bigint; readonly data: Buffer; readonly executable: boolean }
export async function associatedUsdc(owner: string): Promise<string> { return await associatedToken(owner, SOLANA_USDC); }
/** The classic SPL associated token account of one owner for one pinned mint. */
export async function associatedToken(owner: string, mint: string): Promise<string> {
  const [ata] = await findAssociatedTokenPda({ owner: address(solanaAddress(owner)), mint: address(solanaAddress(mint)), tokenProgram: TOKEN_PROGRAM_ADDRESS });
  return ata;
}
export async function readAccounts(rpc: SolanaRpcPort, addresses: readonly string[]): Promise<{ readonly slot: bigint; readonly accounts: readonly (SolanaAccountInfo | null)[] }> {
  addresses.forEach(solanaAddress);
  return multipleAccounts(await rpc.call("getMultipleAccounts", [addresses, { encoding: "base64", commitment: "confirmed" }]), addresses.length);
}
export function accountRead(addresses: readonly string[]) {
  addresses.forEach(solanaAddress);
  return { method: "getMultipleAccounts" as const, params: [addresses, { encoding: "base64", commitment: "confirmed" }] as const };
}
/** Decodes one base64 `getMultipleAccounts` result that must carry exactly `count` entries. */
export function multipleAccounts(value: unknown, count: number): { readonly slot: bigint; readonly accounts: readonly (SolanaAccountInfo | null)[] } {
  const response = rpcRecord(value);
  const slot = rpcAtomic(rpcRecord(response.context).slot); const values = rpcArray(response.value, count);
  if (values.length !== count) protocolFailure();
  return { slot, accounts: values.map((entry) => entry === null ? null : decodeAccount(entry)) };
}
export function requireNativeAccount(account: SolanaAccountInfo | null): bigint {
  if (account === null) return 0n;
  if (account.owner !== SYSTEM_PROGRAM_ADDRESS || account.data.length !== 0 || account.executable) protocolFailure();
  return account.lamports;
}
export function requireUsdcMint(account: SolanaAccountInfo | null): void { requireTokenMint(account, 6); }
/** A pinned mint must be an initialized classic SPL mint with exactly the pinned decimals. */
export function requireTokenMint(account: SolanaAccountInfo | null, decimals: number): void {
  if (account === null || account.owner !== TOKEN_PROGRAM_ADDRESS || account.executable || account.data.length !== 82) protocolFailure();
  try {
    const mint = getMintDecoder().decode(account.data);
    if (!mint.isInitialized || mint.decimals !== decimals) protocolFailure();
  } catch { protocolFailure(); }
}
export function usdcAmount(account: SolanaAccountInfo | null, owner: string): bigint {
  return tokenAccountAmount(account, owner, SOLANA_USDC);
}
/** An absent associated token account holds zero; a present one must be an initialized classic SPL account of this owner and mint. */
export function tokenAccountAmount(account: SolanaAccountInfo | null, owner: string, mint: string): bigint {
  if (account === null) return 0n;
  if (account.owner !== TOKEN_PROGRAM_ADDRESS || account.executable || account.data.length !== 165) protocolFailure();
  try {
    const token = getTokenDecoder().decode(account.data);
    if (token.owner !== owner || token.mint !== mint || token.state !== 1 || token.isNative.__option !== "None") protocolFailure();
    return token.amount;
  } catch { return protocolFailure(); }
}
export function requireSolanaFunds(nativeBalance: bigint, tokenBalance: bigint, amount: bigint, feeAndRent: bigint, native: boolean): void {
  if (!native && tokenBalance < amount) throw new ApnError("APN_INSUFFICIENT_ASSET", "The Solana token balance cannot cover the transfer.");
  if (nativeBalance < feeAndRent + (native ? amount : 0n)) throw new ApnError("APN_INSUFFICIENT_GAS", "The SOL balance cannot cover principal and the approved fee/rent reserve.");
}
function decodeAccount(value: unknown): SolanaAccountInfo {
  const record = rpcRecord(value);
  if (Object.keys(record).some((key) => !["data", "executable", "lamports", "owner", "rentEpoch", "space"].includes(key))) protocolFailure();
  if (typeof record.owner !== "string" || typeof record.executable !== "boolean") protocolFailure();
  solanaAddress(record.owner); const data = rpcArray(record.data, 2);
  if (data.length !== 2 || typeof data[0] !== "string" || data[0].length > 2048 || data[1] !== "base64") protocolFailure();
  const bytes = Buffer.from(data[0], "base64");
  if (bytes.toString("base64") !== data[0] || record.space !== undefined && rpcAtomic(record.space) !== BigInt(bytes.length)) protocolFailure();
  rpcAtomic(record.rentEpoch);
  return { owner: record.owner, executable: record.executable, lamports: rpcAtomic(record.lamports), data: bytes };
}
