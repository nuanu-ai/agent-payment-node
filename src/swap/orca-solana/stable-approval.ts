import { approvalCode } from "../../approval-code.js";
import { canonicalJson, domainHash } from "../../canonical.js";
import { SOLANA_USDT } from "../../chain-policy.js";
import { ApnError } from "../../errors.js";
import { exactChainConsent, type TtyTransferApprovalOptions } from "../../tty-approval.js";
import { GuardedSwapService } from "../service.js";
import { type SwapOperationRecord } from "../model.js";
import { SavedOrcaStableMaterialStore, type OrcaStableMaterial } from "./stable-material.js";
import { admitOrcaStableOwner, recheckOrcaStableOwner, type OrcaStableAdmissionPorts } from "./stable-admission.js";
import { ORCA_STABLE_GUARDED_MECHANISM_DIGEST } from "./stable-mechanism.js";
import { ORCA_SOLANA_CHAIN, USDC_MINT } from "./pins.js";
import { ORCA_STABLE_POOL } from "./stable-readonly.js";
import { stableReservationAdmissionPorts } from "./stable-reservation-admission.js";

export interface OrcaStableConsentPort {
  confirm(lines: readonly string[], code: string, deadline: string): Promise<void>;
}

export class TtyOrcaStableConsent implements OrcaStableConsentPort {
  constructor(private readonly options: TtyTransferApprovalOptions = {}) {}
  async confirm(lines: readonly string[], code: string, deadline: string): Promise<void> {
    await exactChainConsent(lines, code, deadline, this.options);
  }
}

/** Foreground owner consent reserves only the USDC principal. This path has no signer or sender. */
export async function approveOrcaStableReservation(service: GuardedSwapService, materialStore: SavedOrcaStableMaterialStore,
  ports: OrcaStableAdmissionPorts, operationId: string, consent: OrcaStableConsentPort, clock: () => Date) {
  const operation = await service.operations.loadAny(operationId);
  if (operation === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Stable Orca operation was not found.");
  if (operation.mechanismDigest !== ORCA_STABLE_GUARDED_MECHANISM_DIGEST)
    blocked("This operation is outside the guarded stable route.", "orca_stable_mechanism_mismatch");
  if (operation.state !== "awaiting_approval") blocked("Stable operation is not awaiting approval.", "orca_stable_already_approved");
  const material = await materialStore.load(operationId, operation);
  if (material === null) throw new ApnError("APN_STATE_CORRUPT", "Stable Orca prepared material is missing.");
  const before = checkedNow(clock);
  assertWindow(operation, before);
  const admissionPorts = stableReservationAdmissionPorts(ports, service.usage, operation);
  const admission = await admitOrcaStableOwner(admissionPorts, { profile: operation.quote.profile,
    owner: operation.quote.account, policyRevision: material.policyRevision,
    amountInAtomic: operation.quote.inputAmountAtomic, minimumOutputAtomic: operation.quote.minimumOutputAtomic,
    now: before }, ORCA_STABLE_GUARDED_MECHANISM_DIGEST);
  assertBinding(operation, material, admission.policyDigest, admission.activationDigest);
  const active = await ports.activePolicy(operation.quote.profile);
  if (active === null || active.digest !== admission.policyDigest || active.revision !== admission.policyRevision ||
      active.activationDigest !== admission.activationDigest) blocked("Stable owner policy changed before consent.", "orca_stable_policy_drift");
  const deadline = new Date(Math.min(Date.parse(operation.quote.expiresAt), before.getTime() + 60_000)).toISOString();
  const lines = stableApprovalScreen(operation, material, deadline);
  const code = approvalCode("swap", operation.operationId,
    domainHash("apn.orca-stable-approval-screen.v1", canonicalJson(lines)));
  await consent.confirm(lines, code, deadline);
  const after = checkedNow(clock);
  if (after.getTime() < before.getTime() || after.toISOString() >= deadline) blocked("Stable approval window expired.", "orca_stable_approval_expired");
  assertWindow(operation, after);
  await recheckOrcaStableOwner(admissionPorts, admission, after);
  const current = await ports.activePolicy(operation.quote.profile);
  if (current === null || current.digest !== admission.policyDigest || current.revision !== admission.policyRevision ||
      current.activationDigest !== admission.activationDigest) blocked("Stable owner policy changed after consent.", "orca_stable_policy_drift");
  const latest = await service.operations.loadAny(operationId);
  if (latest === null || latest.integrityHash !== operation.integrityHash || latest.state !== "awaiting_approval")
    blocked("Stable operation changed during consent.", "orca_stable_operation_drift");
  const reserved = await service.reserve(latest, current.registry, after);
  return { schemaVersion: "apn.orca-stable-reservation.v1" as const, operation: reserved,
    quoteHash: reserved.quote.quoteHash, materialDigest: material.materialDigest,
    signable: false as const, executable: false as const, signed: false as const, broadcast: false as const };
}

export function stableApprovalScreen(operation: SwapOperationRecord, material: OrcaStableMaterial, deadline: string): readonly string[] {
  const quote = operation.quote, preview = material.preview;
  return ["Agent Payment Node Orca USDC to USDT stable reservation", `Operation: ${operation.operationId}`,
    `Profile: ${quote.profile}`, `Chain: ${ORCA_SOLANA_CHAIN}`, `Owner and fee payer: ${quote.account}`,
    `Source: ${USDC_MINT}; exact principal: ${quote.inputAmountAtomic} USDC atomic`,
    `Destination: ${SOLANA_USDT}; owner ATA: ${preview.destinationAta}`,
    `Expected output: ${quote.expectedOutputAtomic} USDT atomic; minimum output: ${quote.minimumOutputAtomic} USDT atomic`,
    `Pool: ${ORCA_STABLE_POOL}; quote slot: ${preview.marketSlot}; slippage: ${quote.slippageBps} bps`,
    `Create USDT ATA: ${preview.createUsdtAta}; ATA rent: ${preview.ataRentLamports} lamports`,
    `Prepared fee plus rent: ${preview.totalFeeAndRentLamports} lamports; maximum total fee and rent: ${preview.maximumTotalFeeLamports} lamports`,
    `Blockhash height limit: ${preview.lastValidBlockHeight}`, `Quote: ${quote.quoteHash}`,
    `Policy revision: ${material.policyRevision}; policy digest: ${material.policyDigest}`,
    `Activation: ${material.activationDigest}; mechanism: ${operation.mechanismDigest}`,
    `Approval deadline: ${deadline}; quote expiry: ${quote.expiresAt}`,
    "This approval reserves the USDC principal only. It does not sign or send a transaction."];
}

function assertBinding(operation: SwapOperationRecord, material: OrcaStableMaterial, policyDigest: string, activationDigest: string): void {
  if (operation.policyDigest !== policyDigest || material.policyDigest !== policyDigest ||
      material.activationDigest !== activationDigest || material.quote.quoteHash !== operation.quote.quoteHash ||
      material.preview.amountInAtomic !== operation.quote.inputAmountAtomic ||
      material.preview.minimumOutputAtomic !== operation.quote.minimumOutputAtomic)
    blocked("Stable approval material or activation changed.", "orca_stable_policy_drift");
}
function assertWindow(operation: SwapOperationRecord, now: Date): void {
  if (now.toISOString() < operation.quote.effectiveAt || now.toISOString() >= operation.quote.expiresAt)
    throw new ApnError("APN_REPREPARE_REQUIRED", "Stable Orca quote expired before approval.");
}
function checkedNow(clock: () => Date): Date {
  const now = clock();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new ApnError("APN_INVALID_INPUT", "Stable approval clock is invalid.");
  return now;
}
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
