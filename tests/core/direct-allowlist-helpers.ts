import { AllowlistPolicyStore, allowlistDecisionFingerprint, allowlistProfileHash } from "../../src/allowlist-policy.js";
import type { AllowlistPolicyAccounts, AllowlistPolicyFile } from "../../src/allowlist-policy-v2.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { DirectAllowlistGate } from "../../src/direct-allowlist-gate.js";
import type { DirectAssetUsageLease } from "../../src/direct-asset-usage.js";
import { railAllowlistSubject } from "../../src/rail-direct-allowlist.js";
import type { RailOperationRecord } from "../../src/rail-operation-model.js";
import type { Address } from "../../src/model.js";

export const EVM_USDC: Readonly<Record<8453 | 1 | 42161, Address>> = {
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
};
export const TRON_CHAIN = "tron:00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc";
export const SOLANA_CHAIN = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const TRON_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
export const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** Caps wide enough that only the test under inspection decides a refusal. */
export const WIDE_CAPS = { maximumPerTransferAtomic: "1000000000000000000000000", dailyLimitAtomic: "1000000000000000000000000" } as const;
type Admission = AllowlistPolicyFile["admissions"][number];

export function directAdmission(chain: string, identifier: string | null, caps: { readonly maximumPerTransferAtomic: string; readonly dailyLimitAtomic: string } = WIDE_CAPS): Admission {
  return { chain, ...(identifier === null ? { kind: "native" as const } : { kind: "token" as const, identifier }), rail: "direct", ...caps } as Admission;
}

/** Native and USDC on every EVM network the direct EVM rail enables. */
export function evmDirectAdmissions(): Admission[] {
  return ([8453, 1, 42161] as const).flatMap((chainId) => [directAdmission(`eip155:${chainId}`, null), directAdmission(`eip155:${chainId}`, EVM_USDC[chainId])]);
}

/** Stage and activate one owner revision through the same store the foreground command uses (the TTY step is the only omission). */
export async function activateDirectPolicy(root: string, profile: string, input: {
  readonly accounts: AllowlistPolicyAccounts; readonly admissions: readonly Admission[]; readonly now?: Date;
  readonly effectiveAt?: string; readonly expiresAt?: string | null;
}): Promise<{ readonly revision: number; readonly policyDigest: string }> {
  const store = new AllowlistPolicyStore(root), now = input.now ?? new Date();
  const before = await store.read(profile);
  const latest = before.records.at(-1);
  const record = await store.stage({ profile, now, ...(latest === undefined ? {} : { expectedRevision: latest.revision }), policy: {
    schemaVersion: "apn.allowlist-policy-file.v1", overlayVersion: `test.${before.records.length + 1}`, accounts: input.accounts,
    effectiveAt: input.effectiveAt ?? new Date(now.getTime() - 3_600_000).toISOString(),
    ...(input.expiresAt === null ? {} : { expiresAt: input.expiresAt ?? new Date(now.getTime() + 30 * 86_400_000).toISOString() }),
    admissions: [...input.admissions] } });
  await decide(store, profile, "active", record.revision, now);
  return { revision: record.revision, policyDigest: record.registry.policyDigest };
}

export async function revokeDirectPolicy(root: string, profile: string, now = new Date()): Promise<void> {
  const store = new AllowlistPolicyStore(root);
  const head = (await store.read(profile)).entries.at(-1);
  if (head === undefined) throw new Error("nothing to revoke");
  await decide(store, profile, "revoked", head.revision, now);
}

async function decide(store: AllowlistPolicyStore, profile: string, status: "active" | "revoked", revision: number, now: Date): Promise<void> {
  const state = await store.read(profile);
  const record = state.records.find((entry) => entry.revision === revision)!;
  const head = state.entries.at(-1)?.entryDigest ?? null;
  const approvalFingerprint = allowlistDecisionFingerprint({ action: status === "active" ? "activate" : "revoke", profileHash: allowlistProfileHash(profile),
    revision, stagedRecordDigest: record.recordDigest, policyDigest: record.registry.policyDigest, headEntryDigest: head });
  await store.appendDecision(profile, head, { status, revision, stagedRecordDigest: record.recordDigest, policyDigest: record.registry.policyDigest,
    ...(status === "active" ? { registry: record.registry } : {}), approvalFingerprint, decidedAt: now.toISOString() });
}

export async function directUsage(root: string, account: string, chain: string, identifier: string | null, now = new Date()): Promise<string> {
  const asset = identifier === null ? { kind: "native" as const, identifier: null } : { kind: "token" as const, identifier };
  return (await new AssetUsageLedger(root).usage({ account, chain, asset }, now)).amountAtomic;
}

/** The reservation the rail service writes with `signing_started`; tests that script journal states must carry it as well. */
export async function reserveRailLease(root: string, now: Date, operation: RailOperationRecord): Promise<DirectAssetUsageLease> {
  return await new DirectAllowlistGate({ state: { root }, clock: { now: () => new Date(now) } }).reserve(railAllowlistSubject(operation), operation.allowlist);
}
