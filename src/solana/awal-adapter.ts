import { NodeAwalProcessRunner, type AwalProcessRunnerPort } from "../awal-process-adapter.js";
import { canonicalJson, exactKeys, isPlainRecord } from "../canonical.js";
import { atomic, chainAsset, chainDisplay, SOLANA_GENESIS } from "../chain-policy.js";
import type { ChainAccount, ChainAsset, ChainAssetAlias, ChainBalance, ChainWalletStoragePort, DirectRailPort, RailEffectBinding, RailInspection, RailPreparedTransfer, RailSignedEffect } from "../direct-rail-ports.js";
import { ApnError } from "../errors.js";
import { validateRailPrepared } from "../rail-operation-model.js";
import { inspectSolana } from "./evidence.js";
import { readSolanaBalance } from "./local-adapter.js";
import { assertSolanaNetwork, solanaAddress, solanaSignature, type SolanaRpcPort } from "./rpc.js";

/** No production implementation exists for this pinned provider guarantee. */
export interface AwalSolanaFeeContract {
  prepare(input: Parameters<DirectRailPort["prepare"]>[0]): Promise<RailPreparedTransfer>;
  revalidate(account: ChainAccount, prepared: RailPreparedTransfer): Promise<void>;
}
export class SolanaAwalAdapter implements DirectRailPort {
  readonly rail = "solana" as const;
  readonly provider = "coinbase-awal" as const;
  readonly execution = "provider_atomic" as const;
  constructor(private readonly storage: ChainWalletStoragePort, private readonly rpc: SolanaRpcPort,
    private readonly runner: AwalProcessRunnerPort = new NodeAwalProcessRunner(), private readonly fees?: AwalSolanaFeeContract,
    private readonly now: () => Date = () => new Date()) {}
  asset(alias: ChainAssetAlias): ChainAsset { return chainAsset("solana", alias); }
  canonicalAddress(input: string): string { return solanaAddress(input); }
  async assertNetwork(): Promise<string> { return await assertSolanaNetwork(this.rpc); }
  async account(profile: string): Promise<ChainAccount | null> {
    const account = await this.storage.account(profile, "solana");
    if (account !== null && account.provider !== this.provider) mismatch();
    return account;
  }
  async ensureAccount(profile: string): Promise<ChainAccount> {
    const address = await this.providerAddress();
    return await this.storage.ensureProvider({ profile, rail: "solana", provider: this.provider, address });
  }
  async balance(account: ChainAccount, asset: ChainAsset): Promise<ChainBalance> {
    await this.currentAccount(account); await this.assertNetwork();
    const result = await this.run(["balance", "--chain", "solana", "--asset", asset.alias, "--json"]);
    // Preserve only the pinned fields. Provider display strings never become amounts.
    if (result.chain !== "solana" && result.chain !== "Solana") providerProtocol();
    if (!isPlainRecord(result.balances)) providerProtocol();
    const selected = result.balances[asset.symbol];
    if (!isPlainRecord(selected) || typeof selected.raw !== "string" || selected.decimals !== asset.decimals) providerProtocol();
    atomic(selected.raw);
    const evidence = await readSolanaBalance(this.rpc, account, asset, this.now());
    await this.currentAccount(account);
    return evidence;
  }
  async prepare(input: Parameters<DirectRailPort["prepare"]>[0]): Promise<RailPreparedTransfer> {
    const fees = this.feeContract();
    await this.currentAccount(input.account); await this.assertNetwork();
    awalAmount(input.asset, input.amountAtomic);
    const prepared = validateRailPrepared(await fees.prepare(input), input.account);
    if (prepared.networkIdentity !== SOLANA_GENESIS || prepared.unsignedPayload !== null) providerProtocol();
    return prepared;
  }
  async revalidate(account: ChainAccount, prepared: RailPreparedTransfer): Promise<void> {
    const fees = this.feeContract();
    await this.currentAccount(account); await this.assertNetwork(); validateRailPrepared(prepared, account);
    if (this.now().getTime() >= Date.parse(prepared.expiresAt)) throw new ApnError("APN_REPREPARE_REQUIRED", "The provider Solana approval expired.");
    awalAmount(prepared.asset, prepared.amountAtomic); await fees.revalidate(account, prepared);
  }
  async sign(_binding: RailEffectBinding): Promise<RailSignedEffect> { return unavailable(); }
  async recoverEffect(_binding: RailEffectBinding): Promise<RailSignedEffect | null> { return null; }
  async submit(binding: RailEffectBinding, effect: RailSignedEffect | null): Promise<{ readonly transactionId: string }> {
    if (effect !== null) providerProtocol();
    await this.revalidate(binding.account, binding.prepared);
    const prepared = binding.prepared;
    const result = await this.run(["send", awalAmount(prepared.asset, prepared.amountAtomic), prepared.recipient,
      "--chain", "solana", "--asset", prepared.asset.symbol, "--json"]);
    if (result.chain !== "solana" && result.chain !== "Solana" || result.error !== undefined) providerProtocol();
    return { transactionId: solanaSignature(result.transactionHash) };
  }
  async inspect(account: ChainAccount, prepared: RailPreparedTransfer, transactionId: string): Promise<RailInspection> {
    // Observation of an existing effect never re-launches send or needs another fee quote.
    const stored = await this.account(account.profile);
    if (stored === null || canonicalJson(stored) !== canonicalJson(account)) mismatch();
    validateRailPrepared(prepared, account);
    return await inspectSolana(this.rpc, account, prepared, transactionId, this.now());
  }
  private async currentAccount(account: ChainAccount): Promise<void> {
    const stored = await this.account(account.profile);
    if (stored === null || canonicalJson(stored) !== canonicalJson(account) || await this.providerAddress() !== account.address) mismatch();
  }
  private async providerAddress(): Promise<string> {
    const result = await this.run(["address", "--chain", "solana", "--json"]);
    if (!exactKeys(result, ["address", "chain"]) || result.chain !== "solana" || typeof result.address !== "string") providerProtocol();
    return solanaAddress(result.address);
  }
  private async run(argv: readonly string[]): Promise<Record<string, unknown>> {
    const result = await this.runner.run(argv, true);
    try {
      if (result.exitCode !== 0 || result.optionalFailure !== undefined || result.stdout.length > 65_536) providerProtocol();
      const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(result.stdout)) as unknown;
      if (!isPlainRecord(value)) providerProtocol();
      return value;
    } catch { return providerProtocol(); }
    finally { result.stdout.fill(0); }
  }
  private feeContract(): AwalSolanaFeeContract { return this.fees ?? unavailable(); }
}
export function awalAmount(asset: ChainAsset, amountAtomic: string): string {
  const amount = atomic(amountAtomic, true);
  if (asset.alias === "sol") return chainDisplay(amountAtomic, 9);
  if (asset.alias !== "usdc" || amount > BigInt(Number.MAX_SAFE_INTEGER)) return unavailable();
  // awal 2.12.1 interprets integers >100 as atomic, other numbers as decimal USDC.
  const argument = amount > 100n ? amountAtomic : chainDisplay(amountAtomic, 6);
  const parsed = Number.parseFloat(argument);
  const observed = Number.isInteger(parsed) && parsed > 100 ? Math.floor(parsed) : Math.floor(parsed * 1_000_000);
  if (!Number.isSafeInteger(observed) || BigInt(observed) !== amount) return unavailable();
  return argument;
}
function unavailable(): never { throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "The pinned awal Solana contract does not guarantee the exact fee/rent payer and native debit cap; provider invocation is blocked."); }
function mismatch(): never { throw new ApnError("APN_PROFILE_DRIFT", "The authenticated Solana provider account differs from this profile."); }
function providerProtocol(): never { throw new ApnError("APN_PROVIDER_PROTOCOL", "The pinned awal Solana output does not attest the required public fields."); }
