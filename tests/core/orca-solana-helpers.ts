import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createKeyPairSignerFromPrivateKeyBytes, getCompiledTransactionMessageDecoder, getSignatureFromTransaction,
  getTransactionDecoder } from "@solana/kit";
import { getTokenEncoder } from "@solana-program/token";
import { compileAllowlistPolicyOverlay, type AllowlistPolicyOverlayInput } from "../../src/allowlist-policy-overlay.js";
import { loadAllowlistInventory } from "../../src/allowlist-inventory.js";
import type { AssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { ChainAccountStore } from "../../src/chain-account-store.js";
import { SOLANA_GENESIS } from "../../src/chain-policy.js";
import type { SolanaMethod, SolanaRpcPort } from "../../src/solana/rpc.js";
import { StateStore } from "../../src/state.js";
import { associatedTokenAddress, whirlpoolOracleAddress } from "../../src/swap/orca-solana/accounts.js";
import {
  ORCA_KEYLESS_MECHANISM_PIN, ORCA_SOL_USDC_POOL, ORCA_SOL_VAULT, ORCA_SOLANA_CHAIN, ORCA_USDC_VAULT, SYSTEM_PROGRAM, TOKEN_PROGRAM,
  USDC_MINT, WHIRLPOOL_PROGRAM, WSOL_MINT,
} from "../../src/swap/orca-solana/pins.js";
import { SolanaWrapping } from "./solana-helpers.js";

export const PROFILE = "orca-keyless";
export const AMOUNT_IN = 10_000_000n;
export const SEED = Buffer.alloc(32, 9);
const FIXTURE_DIRECTORY = join(process.cwd(), "tests", "core", "fixtures");
export interface OrcaFixture {
  readonly capturedAtSlot: number; readonly pool: string;
  readonly tickArrays: readonly { readonly address: string; readonly startTickIndex: number; readonly liquidityNet: readonly (readonly [number, string])[] }[];
  readonly vaults: readonly string[];
}
export const FIXTURE: OrcaFixture = JSON.parse(readFileSync(join(FIXTURE_DIRECTORY, "orca-sol-usdc-slot-447994242.json"), "utf8")) as OrcaFixture;

/** Rebuilds one fixed 9988-byte tick array from the compact fixture: initialized flags and liquidity_net only. */
export function tickArrayBytes(startTickIndex: number, liquidityNet: readonly (readonly [number, string])[]): Buffer {
  const data = Buffer.alloc(9_988); Buffer.from("4561bdbe6e0742bb", "hex").copy(data, 0); data.writeInt32LE(startTickIndex, 8);
  for (const [offset, net] of liquidityNet) {
    const at = 12 + offset * 113, value = BigInt(net), raw = value < 0n ? (1n << 128n) + value : value;
    data[at] = 1; data.writeBigUInt64LE(raw & ((1n << 64n) - 1n), at + 1); data.writeBigUInt64LE(raw >> 64n, at + 9);
  }
  Buffer.from(bs58(ORCA_SOL_USDC_POOL)).copy(data, 9_956);
  return data;
}
export function usdcAccountBytes(owner: string, amount: bigint): Buffer {
  return Buffer.from(getTokenEncoder().encode({ mint: USDC_MINT as never, owner: owner as never, amount, delegate: { __option: "None" },
    state: 1, isNative: { __option: "None" }, delegatedAmount: 0n, closeAuthority: { __option: "None" } }));
}
function bs58(value: string): Uint8Array {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; let number = 0n;
  for (const character of value) number = number * 58n + BigInt(alphabet.indexOf(character));
  const bytes = new Uint8Array(32); for (let index = 31; index >= 0; index -= 1) { bytes[index] = Number(number & 0xffn); number >>= 8n; }
  return bytes;
}

interface FakeAccount { readonly owner: string; readonly lamports: bigint; readonly executable: boolean; readonly data: Buffer }

/** Deterministic mainnet-shaped Solana reader built from the captured pool snapshot. Effects are counted; nothing leaves. */
export class FakeOrcaRpc implements SolanaRpcPort {
  readonly originHash = "f".repeat(64);
  readonly accounts = new Map<string, FakeAccount>();
  calls: string[] = []; sends: string[] = []; simulations: { readonly payload: string; readonly replace: boolean }[] = [];
  slot = 447_994_242n; height = 400_000_000n; fee = 5_200n; rent = 1_488_440n; simulatedOut = 1_054_000n;
  simulationError: unknown = null; blockhashes = ["D3CDPQLoa9jY1LXCkpUqd3JQDWz8DX1LDE1dhmJt9fq4", "dwxR9YF7WwnJJu7bPC4UNcWFpcSsooH6fxbpoa3fTbJ"];
  status: "none" | "processed" | "finalized" | "finalized_error" = "none"; ownerLamports = 48_604_857n; usdcBefore: bigint | null = 489_500n;
  constructor(readonly owner: string, readonly wsol: string, readonly usdc: string, readonly oracle: string) {
    const pool = Buffer.from(FIXTURE.pool, "base64");
    this.accounts.set(ORCA_SOL_USDC_POOL, { owner: WHIRLPOOL_PROGRAM, lamports: 1n, executable: false, data: pool });
    for (const row of FIXTURE.tickArrays) this.accounts.set(row.address, { owner: WHIRLPOOL_PROGRAM, lamports: 1n, executable: false,
      data: tickArrayBytes(row.startTickIndex, row.liquidityNet) });
    this.accounts.set(ORCA_SOL_VAULT, { owner: TOKEN_PROGRAM, lamports: 1n, executable: false, data: Buffer.from(FIXTURE.vaults[0]!, "base64") });
    this.accounts.set(ORCA_USDC_VAULT, { owner: TOKEN_PROGRAM, lamports: 1n, executable: false, data: Buffer.from(FIXTURE.vaults[1]!, "base64") });
  }
  readonly call = async (method: SolanaMethod, params: readonly unknown[]): Promise<unknown> => {
    this.calls.push(method);
    if (method === "getGenesisHash") return SOLANA_GENESIS;
    if (method === "getMultipleAccounts") return { context: { slot: this.slot }, value: (params[0] as string[]).map((key) => this.account(key)) };
    if (method === "getMinimumBalanceForRentExemption") return this.rent;
    if (method === "getLatestBlockhash") return { context: { slot: this.slot }, value: { blockhash: this.blockhashes.shift() ?? "11111111111111111111111111111111",
      lastValidBlockHeight: this.height + 150n } };
    if (method === "getFeeForMessage") return { context: { slot: this.slot }, value: this.fee };
    if (method === "getBlockHeight") return this.height;
    if (method === "simulateTransaction") return this.simulate(params[0] as string, (params[1] as { replaceRecentBlockhash: boolean }).replaceRecentBlockhash);
    if (method === "sendTransaction") { const raw = params[0] as string; this.sends.push(raw); return signatureOf(raw); }
    if (method === "getSignatureStatuses") return this.statuses();
    if (method === "getTransaction") return this.transaction();
    throw new Error(`unexpected ${method}`);
  };
  private account(key: string): unknown {
    if (key === this.owner) return wire({ owner: SYSTEM_PROGRAM, lamports: this.ownerLamports, executable: false, data: Buffer.alloc(0) });
    if (key === this.usdc) return this.usdcBefore === null ? null : wire({ owner: TOKEN_PROGRAM, lamports: this.rent, executable: false,
      data: usdcAccountBytes(this.owner, this.usdcBefore) });
    const stored = this.accounts.get(key); return stored === undefined ? null : wire(stored);
  }
  private simulate(payload: string, replace: boolean): unknown {
    this.simulations.push({ payload, replace });
    if (this.simulationError !== null) return { context: { slot: this.slot + 1n }, value: { err: this.simulationError, logs: [], accounts: null, unitsConsumed: 0 } };
    const rent = this.usdcBefore === null ? this.rent : 0n;
    return { context: { slot: this.slot + 1n }, value: { err: null, logs: [], unitsConsumed: 49_012, accounts: [
      wire({ owner: SYSTEM_PROGRAM, lamports: this.ownerLamports - AMOUNT_IN - this.fee - rent, executable: false, data: Buffer.alloc(0) }), null,
      wire({ owner: TOKEN_PROGRAM, lamports: this.rent, executable: false, data: usdcAccountBytes(this.owner, (this.usdcBefore ?? 0n) + this.simulatedOut) })] } };
  }
  private statuses(): unknown {
    const raw = this.sends[0];
    if (raw === undefined || this.status === "none") return { context: { slot: this.slot }, value: [null] };
    return { context: { slot: this.slot + 40n }, value: [{ slot: this.slot + 5n, confirmations: this.status === "processed" ? 1 : null,
      err: this.status === "finalized_error" ? { InstructionError: [6, { Custom: 6036 }] } : null,
      confirmationStatus: this.status === "processed" ? "processed" : "finalized" }] };
  }
  private transaction(): unknown {
    const raw = this.sends[0]; if (raw === undefined || this.status === "none" || this.status === "processed") return null;
    const message = getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(Buffer.from(raw, "base64")).messageBytes);
    const keys = message.staticAccounts.length, usdcIndex = message.staticAccounts.indexOf(this.usdc as never), failed = this.status === "finalized_error";
    const pre = Array.from({ length: keys }, () => 1_000n), post = [...pre]; pre[0] = this.ownerLamports;
    post[0] = this.ownerLamports - this.fee - (failed ? 0n : AMOUNT_IN + (this.usdcBefore === null ? this.rent : 0n));
    const balance = (amount: bigint) => ({ accountIndex: usdcIndex, mint: USDC_MINT, owner: this.owner, programId: TOKEN_PROGRAM,
      uiTokenAmount: { amount: amount.toString(), decimals: 6, uiAmount: null, uiAmountString: "0" } });
    return { slot: this.slot + 5n, version: 0, blockTime: 1, transaction: [raw, "base64"], meta: { err: failed ? { InstructionError: [6, { Custom: 6036 }] } : null,
      fee: this.fee, preBalances: pre, postBalances: post, loadedAddresses: { writable: [], readonly: [] },
      preTokenBalances: this.usdcBefore === null ? [] : [balance(this.usdcBefore)],
      postTokenBalances: [balance((this.usdcBefore ?? 0n) + (failed ? 0n : this.simulatedOut))] } };
  }
}

function wire(account: FakeAccount): unknown {
  return { data: [account.data.toString("base64"), "base64"], executable: account.executable, lamports: account.lamports,
    owner: account.owner, rentEpoch: 18_446_744_073_709_551_615n, space: account.data.length };
}
export function signatureOf(raw: string): string { return getSignatureFromTransaction(getTransactionDecoder().decode(Buffer.from(raw, "base64"))); }

export async function orcaOwner(root: string): Promise<{ readonly state: StateStore; readonly accounts: ChainAccountStore; readonly address: string;
  readonly wsol: string; readonly usdc: string; readonly oracle: string }> {
  const state = new StateStore(root); await state.initialize();
  const accounts = new ChainAccountStore(root, new SolanaWrapping());
  const address = (await createKeyPairSignerFromPrivateKeyBytes(Buffer.from(SEED))).address;
  await accounts.ensureLocal({ profile: PROFILE, rail: "solana", create: async () => ({ seed: Buffer.from(SEED), address }) });
  return { state, accounts, address, wsol: await associatedTokenAddress(address, WSOL_MINT, TOKEN_PROGRAM),
    usdc: await associatedTokenAddress(address, USDC_MINT, TOKEN_PROGRAM), oracle: await whirlpoolOracleAddress(WHIRLPOOL_PROGRAM, ORCA_SOL_USDC_POOL) };
}

export function orcaPolicy(account: string, now: Date, perTransferLamports = "30000000"): AssetPolicyRegistry {
  const inventory = loadAllowlistInventory(), overlay: AllowlistPolicyOverlayInput = { overlayVersion: "orca-keyless.1", profile: PROFILE, account,
    datasetVersion: inventory.dataset.version, datasetSha256: inventory.dataset.sha256, inventorySha256: inventory.inventorySha256,
    effectiveAt: new Date(now.getTime() - 60_000).toISOString(), expiresAt: new Date(now.getTime() + 7_200_000).toISOString(), admissions: [
      { chain: ORCA_SOLANA_CHAIN, kind: "native", rail: "swap", maximumPerTransferAtomic: perTransferLamports, dailyLimitAtomic: "30000000",
        mechanism: ORCA_KEYLESS_MECHANISM_PIN },
      { chain: ORCA_SOLANA_CHAIN, kind: "token", identifier: USDC_MINT, rail: "swap", maximumPerTransferAtomic: "10000000", dailyLimitAtomic: "10000000",
        mechanism: ORCA_KEYLESS_MECHANISM_PIN },
    ] };
  return compileAllowlistPolicyOverlay(overlay).registry;
}
