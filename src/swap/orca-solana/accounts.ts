import { address, getAddressDecoder, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";
import { ApnError } from "../../errors.js";
import { protocolFailure, rpcArray, rpcAtomic, rpcRecord, solanaAddress, type SolanaRpcPort } from "../../solana/rpc.js";

/** One account exactly as getMultipleAccounts returned it; `space` is the full size even when a data slice was read. */
export interface RawSolanaAccount {
  readonly owner: string; readonly lamports: bigint; readonly executable: boolean; readonly space: number; readonly data: Buffer;
}
export interface RawAccountRead { readonly slot: bigint; readonly accounts: readonly (RawSolanaAccount | null)[] }

export interface WhirlpoolState {
  readonly address: string; readonly config: string; readonly tickSpacing: number; readonly feeTierIndexSeed: number;
  readonly feeRate: number; readonly protocolFeeRate: number; readonly liquidity: bigint; readonly sqrtPrice: bigint;
  readonly tickCurrentIndex: number; readonly mintA: string; readonly vaultA: string; readonly mintB: string; readonly vaultB: string;
}
export interface TickState { readonly initialized: boolean; readonly liquidityNet: bigint }
export interface TickArrayState { readonly address: string; readonly startTickIndex: number; readonly whirlpool: string; readonly ticks: readonly TickState[] }

export const WHIRLPOOL_ACCOUNT_BYTES = 653;
export const TICK_ARRAY_ACCOUNT_BYTES = 9_988;
export const TICK_ARRAY_SIZE = 88;
const TICK_BYTES = 113;

/**
 * Bounded base64 `getMultipleAccounts` read. The shared rail decoder caps account data at 2 KiB; pool state, tick
 * arrays and program bytes are larger, so this reader takes an explicit per-account byte cap and still rejects
 * unknown fields, non-canonical base64 and any size disagreement.
 */
export async function readRawAccounts(rpc: SolanaRpcPort, addresses: readonly string[], maximumBytes: number,
  slice?: { readonly offset: number; readonly length: number }): Promise<RawAccountRead> {
  if (addresses.length < 1 || addresses.length > 16 || new Set(addresses).size !== addresses.length) protocolFailure();
  addresses.forEach(solanaAddress);
  const config = { encoding: "base64", commitment: "confirmed", ...(slice === undefined ? {} : { dataSlice: slice }) };
  const response = rpcRecord(await rpc.call("getMultipleAccounts", [addresses, config]));
  const slot = rpcAtomic(rpcRecord(response.context).slot), values = rpcArray(response.value, addresses.length);
  if (values.length !== addresses.length) protocolFailure();
  return { slot, accounts: values.map((entry) => entry === null ? null : rawAccount(entry, maximumBytes, slice)) };
}

export function rawAccount(value: unknown, maximumBytes: number, slice?: { readonly offset: number; readonly length: number }): RawSolanaAccount {
  const record = rpcRecord(value);
  if (Object.keys(record).some((key) => !["data", "executable", "lamports", "owner", "rentEpoch", "space"].includes(key)) ||
      typeof record.owner !== "string" || typeof record.executable !== "boolean") protocolFailure();
  solanaAddress(record.owner); const data = rpcArray(record.data, 2);
  if (data.length !== 2 || typeof data[0] !== "string" || data[1] !== "base64" || data[0].length > Math.ceil(maximumBytes / 3) * 4) protocolFailure();
  const bytes = Buffer.from(data[0], "base64");
  if (record.space === undefined && slice !== undefined) protocolFailure();
  const space = record.space === undefined ? bytes.length : Number(rpcAtomic(record.space));
  if (bytes.toString("base64") !== data[0] || !Number.isSafeInteger(space) || bytes.length > maximumBytes) protocolFailure();
  const expected = slice === undefined ? space : Math.max(0, Math.min(slice.length, space - slice.offset));
  if (bytes.length !== expected) protocolFailure();
  rpcAtomic(record.rentEpoch);
  return { owner: record.owner, lamports: rpcAtomic(record.lamports), executable: record.executable, space, data: bytes };
}

export function decodeWhirlpool(poolAddress: string, account: RawSolanaAccount | null, program: string, discriminator: string): WhirlpoolState {
  if (account === null || account.owner !== program || account.executable || account.data.length !== WHIRLPOOL_ACCOUNT_BYTES ||
      account.data.subarray(0, 8).toString("hex") !== discriminator) blocked("The pinned Whirlpool account is missing or malformed.", "orca_pool_state");
  const data = account.data, key = (offset: number) => getAddressDecoder().decode(data.subarray(offset, offset + 32));
  return { address: poolAddress, config: key(8), tickSpacing: data.readUInt16LE(41), feeTierIndexSeed: data.readUInt16LE(43),
    feeRate: data.readUInt16LE(45), protocolFeeRate: data.readUInt16LE(47), liquidity: u128(data, 49), sqrtPrice: u128(data, 65),
    tickCurrentIndex: data.readInt32LE(81), mintA: key(101), vaultA: key(133), mintB: key(181), vaultB: key(213) };
}

export function decodeTickArray(arrayAddress: string, account: RawSolanaAccount | null, program: string, discriminator: string): TickArrayState {
  if (account === null || account.owner !== program || account.executable || account.data.length !== TICK_ARRAY_ACCOUNT_BYTES ||
      account.data.subarray(0, 8).toString("hex") !== discriminator) {
    blocked("A required Whirlpool tick array is missing or is not a fixed tick array.", "orca_tick_array_state");
  }
  const data = account.data, ticks: TickState[] = [];
  for (let index = 0; index < TICK_ARRAY_SIZE; index += 1) {
    const offset = 12 + index * TICK_BYTES, flag = data[offset];
    if (flag !== 0 && flag !== 1) blocked("A Whirlpool tick flag is malformed.", "orca_tick_array_state");
    ticks.push({ initialized: flag === 1, liquidityNet: i128(data, offset + 1) });
  }
  return { address: arrayAddress, startTickIndex: data.readInt32LE(8),
    whirlpool: getAddressDecoder().decode(data.subarray(9_956, 9_988)), ticks };
}

/** Tick array PDA: ["tick_array", whirlpool, decimal start tick index]. */
export async function whirlpoolTickArrayAddress(program: string, pool: string, startTickIndex: number): Promise<string> {
  if (!Number.isSafeInteger(startTickIndex)) blocked("Tick array start index is invalid.", "orca_tick_array_state");
  const [pda] = await getProgramDerivedAddress({ programAddress: address(program),
    seeds: [Buffer.from("tick_array"), getAddressEncoder().encode(address(pool)), Buffer.from(String(startTickIndex))] });
  return pda;
}
/** Oracle PDA: ["oracle", whirlpool]. Its absence means the pool has no adaptive fee. */
export async function whirlpoolOracleAddress(program: string, pool: string): Promise<string> {
  const [pda] = await getProgramDerivedAddress({ programAddress: address(program),
    seeds: [Buffer.from("oracle"), getAddressEncoder().encode(address(pool))] });
  return pda;
}
export async function associatedTokenAddress(owner: string, mint: string, tokenProgram: string): Promise<string> {
  const [ata] = await findAssociatedTokenPda({ owner: address(solanaAddress(owner)), mint: address(mint), tokenProgram: address(tokenProgram) });
  return ata;
}

function u128(data: Buffer, offset: number): bigint { return data.readBigUInt64LE(offset) + (data.readBigUInt64LE(offset + 8) << 64n); }
function i128(data: Buffer, offset: number): bigint { const value = u128(data, offset); return value >= 1n << 127n ? value - (1n << 128n) : value; }
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
