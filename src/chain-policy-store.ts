import { canonicalJson } from "./canonical.js";
import type { ChainAccount, ChainAsset } from "./direct-rail-ports.js";
import { ApnError } from "./errors.js";
import { validateChainPolicy, type ChainPolicy } from "./chain-policy.js";
import { SecureStateStore } from "./secure-state-store.js";

export class ChainPolicyStore extends SecureStateStore {
  private initialized: Promise<void> | undefined;
  private async ready(): Promise<void> {
    this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("chain-policies"); })();
    await this.initialized;
  }
  async load(account: ChainAccount, asset: ChainAsset): Promise<ChainPolicy | null> {
    await this.ready();
    const value = await this.readJson(this.path(account, asset));
    if (value === null) return null;
    const policy = validateChainPolicy(value);
    if (canonicalJson(policy.account) !== canonicalJson(account) || canonicalJson(policy.asset) !== canonicalJson(asset)) {
      throw new ApnError("APN_STATE_CORRUPT", "The chain policy account or asset binding is invalid.");
    }
    return policy;
  }
  /** The caller holds the common profile lock and has obtained foreground approval. */
  async write(policy: ChainPolicy): Promise<void> {
    validateChainPolicy(policy); await this.ready();
    await this.ensureDirectory(`chain-policies/${policy.account.rail}`);
    await this.writeJson(this.path(policy.account, policy.asset), policy);
  }
  private path(account: ChainAccount, asset: ChainAsset): string {
    if (account.rail !== asset.rail || !/^[a-f0-9]{64}$/u.test(account.profileHash) || !["sol", "usdc", "trx", "usdt"].includes(asset.alias)) {
      throw new ApnError("APN_STATE_CORRUPT", "The chain policy path binding is invalid.");
    }
    return `chain-policies/${account.rail}/${account.profileHash}-${asset.alias}.json`;
  }
}
