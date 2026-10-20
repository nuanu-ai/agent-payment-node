import { address, getAddressEncoder, getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";
import { getTokenEncoder } from "@solana-program/token";
import { compileAllowlistPolicyOverlay, type AllowlistPolicyOverlayInput } from "../../src/allowlist-policy-overlay.js";
import { loadAllowlistInventory } from "../../src/allowlist-inventory.js";
import type { AssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { SOLANA_GENESIS, SOLANA_USDT } from "../../src/chain-policy.js";
import type { SolanaMethod, SolanaRpcPort } from "../../src/solana/rpc.js";
import type { SwapAdmissionMechanism } from "../../src/swap/route-admission.js";
import { associatedTokenAddress, whirlpoolTickArrayAddress } from "../../src/swap/orca-solana/accounts.js";
import { ORCA_SOLANA_CHAIN, SYSTEM_PROGRAM, TOKEN_PROGRAM, USDC_MINT, WHIRLPOOL_PROGRAM, WHIRLPOOLS_CONFIG } from "../../src/swap/orca-solana/pins.js";
import { ORCA_POOLS } from "../../src/swap/orca-solana/pools.js";
import { PROFILE, signatureOf } from "./orca-solana-helpers.js";

export const POOL = ORCA_POOLS["usdc-usdt"];
export const USDC_IN = 1_000_000n;
interface FakeAccount { readonly owner: string; readonly lamports: bigint; readonly executable: boolean; readonly data: Buffer }

/** A classic SPL token account (165 bytes) of `owner` for `mint`. */
export function tokenAccountBytes(mint: string, owner: string, amount: bigint): Buffer {
  return Buffer.from(getTokenEncoder().encode({ mint: mint as never, owner: owner as never, amount, delegate: { __option: "None" }, state: 1,
    isNative: { __option: "None" }, delegatedAmount: 0n, closeAuthority: { __option: "None" } }));
}
/** The USDC/USDT Whirlpool at tick 0 (tick spacing 1, fee rate 100 = 0.01%), deep in-range liquidity, no initialized ticks. */
function poolBytes(): Buffer {
  const encode = (key: string) => Buffer.from(getAddressEncoder().encode(address(key))), data = Buffer.alloc(653);
  Buffer.from("3f95d10ce1806309", "hex").copy(data); encode(WHIRLPOOLS_CONFIG).copy(data, 8);
  data.writeUInt16LE(1, 41); data.writeUInt16LE(1, 43); data.writeUInt16LE(100, 45);
  data.writeBigUInt64LE(4_587_626_145_939_386n, 49); data.writeBigUInt64LE(1_000_000_000_000n, 65); data.writeBigUInt64LE(1n, 73);
  encode(USDC_MINT).copy(data, 101); encode(POOL.vaultA).copy(data, 133); encode(SOLANA_USDT).copy(data, 181); encode(POOL.vaultB).copy(data, 213);
  return data;
}
function tickArrayBytes(start: number): Buffer {
  const data = Buffer.alloc(9_988); Buffer.from("4561bdbe6e0742bb", "hex").copy(data); data.writeInt32LE(start, 8);
  Buffer.from(getAddressEncoder().encode(address(POOL.pool))).copy(data, 9_956);
  return data;
}

/**
 * Deterministic mainnet-shaped reader for the USDC/USDT pool. The simulation honours the swap instruction it is given:
 * it debits exactly the encoded input and credits the encoded minimum plus `outputAboveMinimum`. Nothing leaves.
 */
export class FakeOrcaTokenRpc implements SolanaRpcPort {
  readonly originHash = "e".repeat(64);
  readonly accounts = new Map<string, FakeAccount>();
  calls: string[] = []; sends: string[] = []; simulations: { readonly payload: string; readonly replace: boolean }[] = [];
  slot = 450_687_913n; height = 400_000_000n; fee = 5_000n; rent = 2_039_280n; ownerLamports = 20_000_000n;
  sourceBefore: bigint | null = 2_000_000n; destinationBefore: bigint | null = 0n; outputAboveMinimum = 0n; debitAdjustment = 0n;
  simulationError: unknown = null; status: "none" | "finalized" | "finalized_error" = "none";
  blockhashes = ["D3CDPQLoa9jY1LXCkpUqd3JQDWz8DX1LDE1dhmJt9fq4", "dwxR9YF7WwnJJu7bPC4UNcWFpcSsooH6fxbpoa3fTbJ"];
  private constructor(readonly owner: string, readonly source: string, readonly destination: string) {}

  static async create(owner: string): Promise<FakeOrcaTokenRpc> {
    const rpc = new FakeOrcaTokenRpc(owner, await associatedTokenAddress(owner, USDC_MINT, TOKEN_PROGRAM),
      await associatedTokenAddress(owner, SOLANA_USDT, TOKEN_PROGRAM));
    rpc.accounts.set(POOL.pool, { owner: WHIRLPOOL_PROGRAM, lamports: 1n, executable: false, data: poolBytes() });
    for (const start of [0, -88, -176]) rpc.accounts.set(await whirlpoolTickArrayAddress(WHIRLPOOL_PROGRAM, POOL.pool, start),
      { owner: WHIRLPOOL_PROGRAM, lamports: 1n, executable: false, data: tickArrayBytes(start) });
    rpc.accounts.set(POOL.vaultA, { owner: TOKEN_PROGRAM, lamports: 1n, executable: false, data: tokenAccountBytes(USDC_MINT, POOL.pool, 339_542_399_990n) });
    rpc.accounts.set(POOL.vaultB, { owner: TOKEN_PROGRAM, lamports: 1n, executable: false, data: tokenAccountBytes(SOLANA_USDT, POOL.pool, 379_676_358_729n) });
    return rpc;
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
    if (key === this.source) return this.sourceBefore === null ? null : wire(this.token(USDC_MINT, this.sourceBefore));
    if (key === this.destination) return this.destinationBefore === null ? null : wire(this.token(SOLANA_USDT, this.destinationBefore));
    const stored = this.accounts.get(key); return stored === undefined ? null : wire(stored);
  }
  private token(mint: string, amount: bigint): FakeAccount {
    return { owner: TOKEN_PROGRAM, lamports: this.rent, executable: false, data: tokenAccountBytes(mint, this.owner, amount) };
  }
  /** Exact input and minimum output as the swap instruction (the last one) encodes them. */
  private swapAmounts(payload: string): { readonly input: bigint; readonly minimum: bigint } {
    const message = getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(Buffer.from(payload, "base64")).messageBytes);
    if (message.version !== 0) throw new Error("expected a v0 message");
    const data = Buffer.from(message.instructions.at(-1)!.data!);
    return { input: data.readBigUInt64LE(8), minimum: data.readBigUInt64LE(16) };
  }
  private outcome(payload: string) {
    const { input, minimum } = this.swapAmounts(payload), rent = this.destinationBefore === null ? this.rent : 0n;
    return { input, output: minimum + this.outputAboveMinimum, rent };
  }
  private simulate(payload: string, replace: boolean): unknown {
    this.simulations.push({ payload, replace });
    if (this.simulationError !== null) return { context: { slot: this.slot + 1n }, value: { err: this.simulationError, logs: [], accounts: null, unitsConsumed: 0 } };
    const { input, output, rent } = this.outcome(payload);
    return { context: { slot: this.slot + 1n }, value: { err: null, logs: [], unitsConsumed: 61_234, accounts: [
      wire({ owner: SYSTEM_PROGRAM, lamports: this.ownerLamports - this.fee - rent, executable: false, data: Buffer.alloc(0) }),
      wire(this.token(USDC_MINT, (this.sourceBefore ?? 0n) - input - this.debitAdjustment)),
      wire(this.token(SOLANA_USDT, (this.destinationBefore ?? 0n) + output))] } };
  }
  private statuses(): unknown {
    if (this.sends[0] === undefined || this.status === "none") return { context: { slot: this.slot }, value: [null] };
    return { context: { slot: this.slot + 40n }, value: [{ slot: this.slot + 5n, confirmations: null,
      err: this.status === "finalized_error" ? { InstructionError: [3, { Custom: 6036 }] } : null, confirmationStatus: "finalized" }] };
  }
  private transaction(): unknown {
    const raw = this.sends[0]; if (raw === undefined || this.status === "none") return null;
    const keys = getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(Buffer.from(raw, "base64")).messageBytes).staticAccounts;
    const failed = this.status === "finalized_error", { input, output, rent } = this.outcome(raw);
    const pre = keys.map(() => 1_000n), post = [...pre]; pre[0] = this.ownerLamports; post[0] = this.ownerLamports - this.fee - (failed ? 0n : rent);
    if (!failed) post[keys.indexOf(this.destination as never)]! += rent; // a new destination account holds the rent the owner paid
    const balance = (key: string, mint: string, amount: bigint) => ({ accountIndex: keys.indexOf(key as never), mint, owner: this.owner,
      programId: TOKEN_PROGRAM, uiTokenAmount: { amount: amount.toString(), decimals: 6, uiAmount: null, uiAmountString: "0" } });
    const source = this.sourceBefore ?? 0n, destination = this.destinationBefore ?? 0n;
    return { slot: this.slot + 5n, version: 0n, blockTime: 1n, transaction: [raw, "base64"], meta: {
      err: failed ? { InstructionError: [3, { Custom: 6036 }] } : null, fee: this.fee, preBalances: pre, postBalances: post,
      loadedAddresses: { writable: [], readonly: [] },
      preTokenBalances: [balance(this.source, USDC_MINT, source), ...(this.destinationBefore === null ? [] : [balance(this.destination, SOLANA_USDT, destination)])],
      postTokenBalances: [balance(this.source, USDC_MINT, failed ? source : source - input),
        ...(failed && this.destinationBefore === null ? [] : [balance(this.destination, SOLANA_USDT, failed ? destination : destination + output)])] } };
  }
}

function wire(account: FakeAccount): unknown {
  return { data: [account.data.toString("base64"), "base64"], executable: account.executable, lamports: account.lamports,
    owner: account.owner, rentEpoch: 18_446_744_073_709_551_615n, space: account.data.length };
}

/** The owner's sealed policy admitting USDC and USDT for swaps with the given mechanism (a route or a full pin). */
export function usdcUsdtPolicy(account: string, now: Date, mechanism: SwapAdmissionMechanism): AssetPolicyRegistry {
  const inventory = loadAllowlistInventory(), overlay: AllowlistPolicyOverlayInput = { overlayVersion: "orca-usdc-usdt.1", profile: PROFILE, account,
    datasetVersion: inventory.dataset.version, datasetSha256: inventory.dataset.sha256, inventorySha256: inventory.inventorySha256,
    effectiveAt: new Date(now.getTime() - 60_000).toISOString(), expiresAt: new Date(now.getTime() + 7_200_000).toISOString(),
    admissions: [USDC_MINT, SOLANA_USDT].map((identifier) => ({ chain: ORCA_SOLANA_CHAIN, kind: "token" as const, identifier, rail: "swap" as const,
      maximumPerTransferAtomic: "5000000", dailyLimitAtomic: "5000000", mechanism })) } as AllowlistPolicyOverlayInput;
  return compileAllowlistPolicyOverlay(overlay).registry;
}
