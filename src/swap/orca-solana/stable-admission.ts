import type { ActiveAssetPolicy } from "../../allowlist-active-policy.js";
import { evaluateAssetPolicy } from "../../asset-policy-registry.js";
import { SOLANA_USDT } from "../../chain-policy.js";
import type { ChainAccount } from "../../direct-rail-ports.js";
import { ApnError } from "../../errors.js";
import { swapMechanismDigest } from "../pin.js";
import { requireSwapProtocol } from "../protocol-registry.js";
import { ORCA_SOLANA_CHAIN, USDC_MINT, WHIRLPOOL_PROGRAM } from "./pins.js";
import { ORCA_STABLE_POOL } from "./stable-readonly.js";
import { ORCA_PROTOCOL_REGISTRY, ORCA_STABLE_MECHANISM_DIGEST } from "./stable-mechanism.js";

export interface OrcaStableOwnerAdmission {
  readonly profile: string; readonly owner: string; readonly policyDigest: string; readonly policyRevision: number;
  readonly activationDigest: string; readonly mechanismDigest: string; readonly pool: string; readonly program: string;
  readonly sourceMint: string; readonly destinationMint: string; readonly amountInAtomic: string;
  readonly minimumOutputAtomic: string;
  /** This only proves local policy admission; it is not a quote, simulation, or signable operation. */
  readonly signable: false; readonly executable: false;
}

export interface OrcaStableAdmissionPorts {
  readonly activePolicy: (profile: string) => Promise<ActiveAssetPolicy | null>;
  readonly localAccount: (profile: string) => Promise<ChainAccount | null>;
  readonly dailyUsage: (owner: string, mint: string, now: Date) => Promise<string>;
}

/** Run before RPC. The revision is supplied by the caller's intended policy, then verified against active sealed state. */
export async function admitOrcaStableOwner(ports: OrcaStableAdmissionPorts, request: {
  readonly profile: string; readonly owner: string; readonly policyRevision: number;
  readonly amountInAtomic: string; readonly minimumOutputAtomic: string; readonly now: Date;
}, expectedMechanismDigest: string = ORCA_STABLE_MECHANISM_DIGEST): Promise<OrcaStableOwnerAdmission> {
  if (!Number.isSafeInteger(request.policyRevision) || request.policyRevision < 1 ||
      !/^[1-9][0-9]*$/u.test(request.amountInAtomic) || !/^[1-9][0-9]*$/u.test(request.minimumOutputAtomic) ||
      BigInt(request.amountInAtomic) > (1n << 64n) - 1n || BigInt(request.minimumOutputAtomic) > (1n << 64n) - 1n ||
      !(request.now instanceof Date) || !Number.isFinite(request.now.getTime())) {
    throw new ApnError("APN_INVALID_INPUT", "Stable Orca admission input is invalid.");
  }
  const active = await ports.activePolicy(request.profile);
  if (active === null || active.profile !== request.profile || active.revision !== request.policyRevision ||
      active.digest !== active.registry.policyDigest || active.accounts.solana !== request.owner) {
    blocked("The exact active owner policy and Solana account are required.", "orca_stable_policy_drift");
  }
  const account = await ports.localAccount(request.profile);
  if (account === null || account.provider !== "local" || account.custody !== "local_software" ||
      account.address !== request.owner) blocked("The local wallet does not own this Solana account.", "orca_stable_owner_account");
  const at = request.now.toISOString();
  for (const [mint, amount] of [[USDC_MINT, request.amountInAtomic], [SOLANA_USDT, request.minimumOutputAtomic]] as const) {
    const admitted = evaluateAssetPolicy(active.registry, { chain: ORCA_SOLANA_CHAIN,
      asset: { kind: "token", identifier: mint }, rail: "swap", amountAtomic: amount,
      dailyUsageAtomic: await ports.dailyUsage(request.owner, mint, request.now), asOfDate: at.slice(0, 10), asOf: at });
    if (admitted.asset.mechanismPins?.swap === undefined ||
        swapMechanismDigest(admitted.asset.mechanismPins.swap) !== expectedMechanismDigest) {
      blocked("Both stable assets require the exact USDC to USDT mechanism pin.", "orca_stable_mechanism_mismatch");
    }
  }
  requireSwapProtocol(ORCA_PROTOCOL_REGISTRY, expectedMechanismDigest);
  return { profile: request.profile, owner: request.owner, policyDigest: active.digest,
    policyRevision: active.revision, activationDigest: active.activationDigest,
    mechanismDigest: expectedMechanismDigest, pool: ORCA_STABLE_POOL, program: WHIRLPOOL_PROGRAM,
    sourceMint: USDC_MINT, destinationMint: SOLANA_USDT, amountInAtomic: request.amountInAtomic,
    minimumOutputAtomic: request.minimumOutputAtomic, signable: false, executable: false };
}

/** Bind a later observed quote to the prechecked admission; caller must recheck active revision before any operation. */
export function assertOrcaStableQuoteAdmission(admission: OrcaStableOwnerAdmission, quote: {
  readonly chain: string; readonly pool: string; readonly program: string; readonly sourceMint: string;
  readonly destinationMint: string; readonly amountInAtomic: string; readonly minimumOutputAtomic: string;
}): void {
  if (quote.chain !== ORCA_SOLANA_CHAIN || quote.pool !== admission.pool || quote.program !== admission.program ||
      quote.sourceMint !== admission.sourceMint || quote.destinationMint !== admission.destinationMint ||
      quote.amountInAtomic !== admission.amountInAtomic || quote.minimumOutputAtomic !== admission.minimumOutputAtomic) {
    blocked("The observed stable quote differs from the owner admission.", "orca_stable_quote_drift");
  }
}

/** Recheck immediately after a snapshot; a changed activation or depleted daily cap refuses. */
export async function recheckOrcaStableOwner(ports: OrcaStableAdmissionPorts, admission: OrcaStableOwnerAdmission,
  now: Date): Promise<void> {
  const current = await admitOrcaStableOwner(ports, { profile: admission.profile, owner: admission.owner,
    policyRevision: admission.policyRevision, amountInAtomic: admission.amountInAtomic,
    minimumOutputAtomic: admission.minimumOutputAtomic, now }, admission.mechanismDigest);
  if (current.policyDigest !== admission.policyDigest || current.activationDigest !== admission.activationDigest ||
      current.mechanismDigest !== admission.mechanismDigest) {
    blocked("The active stable owner policy changed after the snapshot.", "orca_stable_policy_drift");
  }
}

function blocked(message: string, reason: string): never {
  throw new ApnError("APN_OPERATION_BLOCKED", message, { reason });
}
