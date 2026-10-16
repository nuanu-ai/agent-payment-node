import { keccak256 } from "viem";
import { hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import type { BridgeOperationRecord } from "./operation-model.js";
import type { BridgeSealedMaterial } from "./ports.js";
import type { Hex } from "../model.js";

export type BridgeAuthorityCheck = () => Promise<void>;
const signGrants = new WeakMap<BridgeAuthorityCheck, { binding: string; immediate: () => void }>();
const physicalGrants = new WeakMap<BridgeAuthorityCheck, Hex>();
const fail = (): never => { throw new ApnError("APN_OPERATION_BLOCKED", "Fresh bridge effect authority is unavailable or expired."); };
export function guardedWbtc(op: Pick<BridgeOperationRecord, "intent">): boolean {
  const m = op.intent.materialization, r = m.request;
  return m.tool === "across" && ((r.fromChainId === 1 && r.toChainId === 42161 &&
    r.fromToken === "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" && r.toToken === "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f") ||
    (r.fromChainId === 42161 && r.toChainId === 1 && r.fromToken === "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f" &&
      r.toToken === "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599"));
}
export function bridgeEffectBinding(op: BridgeOperationRecord, role: "approval" | "bridge"): string {
  return hashObject({ profileHash: op.profileHash, operationId: op.operationId, fingerprint: op.fingerprint,
    intent: op.intent, role, envelope: op.effects.find(e => e.role === role)!.envelope });
}
export function assertBridgeSignGrant(check: BridgeAuthorityCheck | undefined, op: BridgeOperationRecord, role: "approval" | "bridge"): asserts check is BridgeAuthorityCheck {
  if (check === undefined || signGrants.get(check)?.binding !== bridgeEffectBinding(op, role)) fail();
}
export function assertBridgeSignImmediate(check: BridgeAuthorityCheck): void {
  const grant = signGrants.get(check); if (grant === undefined) return fail(); grant.immediate();
}
export function assertBridgePhysicalGrant(check: BridgeAuthorityCheck | undefined, raw: unknown): asserts check is BridgeAuthorityCheck {
  if (check === undefined || physicalGrants.get(check) !== raw) fail();
}
export interface BridgeEffectAuthority {
  check(op: BridgeOperationRecord): Promise<void>;
  sign(op: BridgeOperationRecord, role: "approval" | "bridge"): BridgeAuthorityCheck;
  send(op: BridgeOperationRecord, material: BridgeSealedMaterial): BridgeAuthorityCheck;
}
/** The approval completion instant and controller are invocation-private, never reconstructed from a journal. */
export async function withBridgeEffectAuthority<T>(op: BridgeOperationRecord, now: () => number, foregroundConfirm: () => Promise<boolean>, rejected: () => Promise<T>,
  confirmPolicy: (op: BridgeOperationRecord) => Promise<string | undefined>, work: (authority: BridgeEffectAuthority, approvedAt: number) => Promise<T>): Promise<T> {
  if (!await foregroundConfirm()) return await rejected();
  const approvedAt = now();
  let live = true, deadline = Math.min(approvedAt + 60_000, Date.parse(op.intent.expiresAt));
  const binding = hashObject({ operationId: op.operationId, fingerprint: op.fingerprint, intent: op.intent });
  const issued: BridgeAuthorityCheck[] = [];
  const immediate = (): void => { if (!live || !Number.isFinite(deadline) || now() >= deadline) fail(); };
  const check = async (current: BridgeOperationRecord): Promise<void> => {
    if (!live || !Number.isFinite(deadline) || now() >= deadline ||
      hashObject({ operationId: current.operationId, fingerprint: current.fingerprint, intent: current.intent }) !== binding ||
      current.intent.allowlist?.activationDigest === undefined) fail();
    const policyExpiry = await confirmPolicy(current);
    if (policyExpiry !== undefined) deadline = Math.min(deadline, Date.parse(policyExpiry));
    if (!live || !Number.isFinite(deadline) || now() >= deadline) fail();
  };
  const authority: BridgeEffectAuthority = {
    check,
    sign: (current, role) => {
      const expected = bridgeEffectBinding(current, role);
      const callback = async () => { if (bridgeEffectBinding(current, role) !== expected) fail(); await check(current); };
      signGrants.set(callback, { binding: expected, immediate }); issued.push(callback); return callback;
    },
    send: (current, material) => {
      const expected = bridgeEffectBinding(current, material.role), exactMaterial = hashObject(material);
      let checks = 0;
      const callback = async () => {
        if (++checks > 3 || hashObject(material) !== exactMaterial || bridgeEffectBinding(current, material.role) !== expected ||
          material.operationId !== current.operationId || material.fingerprint !== current.fingerprint ||
          material.envelopeHash !== current.effects.find(e => e.role === material.role)!.envelope.envelopeHash ||
          keccak256(material.rawTransaction) !== material.transactionHash) fail();
        await check(current);
      };
      physicalGrants.set(callback, material.rawTransaction); issued.push(callback); return callback;
    },
  };
  try { return await work(authority, approvedAt); }
  finally { live = false; for (const callback of issued) { signGrants.delete(callback); physicalGrants.delete(callback); } }
}
/**
 * Permanent create-only SIGN and SEND barriers for every LI.FI route. They live outside the rollbackable operation and usage
 * journals: SIGN binds the effect before custody signs, SEND binds its exact sealed bytes before the one broadcast. The same
 * claim again is the same effect (a no-op); a different claim for that boundary is refused. A lost result never permits a
 * second, different effect, and a SEND claim the journal has not recorded means "observe, never send again".
 */
export class BridgeEffectClaims extends SecureStateStore {
  /** Releasing unsent effects to a terminal state is refused while any of them holds a SEND claim: a broadcast may exist. */
  async assertNoUnrecordedSend(op: BridgeOperationRecord): Promise<void> {
    for (const effect of op.effects) if (effect.submissionAttempts === 0 && await this.sendClaim(op, effect.role) !== null) {
      throw new ApnError("APN_OPERATION_BLOCKED", "An unsent bridge effect has a permanent send claim.", { reason: "bridge_expired_effect_claim_present" });
    }
  }
  /** The exact sealed bytes this effect's SEND claim bound, or null when no send was ever claimed. */
  async sendClaim(op: BridgeOperationRecord, role: "approval" | "bridge"): Promise<{ materialHash: string; transactionHash: Hex } | null> {
    // Presence is read from the directory, so even a malformed or empty SEND claim counts as a claim and blocks.
    const name = `${op.operationId}-${role}-send.json`;
    if (!(await this.readDirectory(`bridge-effect-claims/${op.profileHash}`)).some(entry => entry.name === name)) return null;
    const value = await this.readJson(this.path(op, role, "send"));
    const claim = (value ?? {}) as Record<string, unknown>;
    if (claim.schemaVersion !== "apn.bridge-effect-claim.v1" || claim.boundary !== "send" || claim.effectBinding !== bridgeEffectBinding(op, role) ||
      typeof claim.materialHash !== "string" || typeof claim.transactionHash !== "string") conflict();
    return { materialHash: claim.materialHash as string, transactionHash: claim.transactionHash as Hex };
  }
  async claim(op: BridgeOperationRecord, role: "approval" | "bridge", boundary: "sign" | "send", material?: BridgeSealedMaterial): Promise<void> {
    const path = this.path(op, role, boundary), body = { schemaVersion: "apn.bridge-effect-claim.v1", boundary, effectBinding: bridgeEffectBinding(op, role),
      ...(material === undefined ? {} : { materialHash: material.materialHash, transactionHash: material.transactionHash }) };
    const existing = await this.readJson(path);
    if (existing !== null) { if (hashObject(existing) !== hashObject(body)) conflict(); return; }
    await this.initialize(); await this.ensureDirectory(`bridge-effect-claims/${op.profileHash}`);
    await this.writeJson(path, body, true);
  }
  private path(op: BridgeOperationRecord, role: "approval" | "bridge", boundary: "sign" | "send"): string {
    stateIdentifier(op.profileHash, "bridge claim profile"); stateIdentifier(op.operationId, "bridge claim operation");
    return `bridge-effect-claims/${op.profileHash}/${op.operationId}-${role}-${boundary}.json`;
  }
}
function conflict(): never {
  throw new ApnError("APN_OPERATION_BLOCKED", "A different permanent effect claim already exists for this bridge effect.", { reason: "bridge_effect_claim_conflict" });
}
