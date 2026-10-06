import { ApnError } from "../errors.js";
import { LocalWalletNative } from "../local-wallet-native.js";
import type { NativePort } from "../ports.js";
import type { Permit2LocalCapability } from "./production-native-capability.js";
import { Permit2ProductionRepository, type Permit2ProductionRecord } from "./production-repository.js";
import type { Permit2ProductionJournal } from "./production-journal.js";
import { assertSigningLifecycle } from "./production-signing-owner.js";
import { assertSigningTime } from "./production-signing-facts.js";
import { permit2ApprovalDisplay, type Permit2ForegroundApprovalPort } from "./production-approval.js";
export interface Permit2ForegroundApprovalProof { readonly kind: "permit2-foreground-approval-proof" }
interface Issued {
  readonly journal: Permit2ProductionJournal; readonly controller: object; readonly native: NativePort;
  readonly capability: Permit2LocalCapability; readonly nativeState: object; readonly root: string;
  readonly operationId: string; readonly materialHash: string; readonly displayHash: string; readonly fingerprint: string;
  readonly completedAt: number; readonly clock: () => Date; claimed: boolean;
}
export type Permit2ApprovalBinding = Readonly<Omit<Issued, "claimed">>;
const proofs = new WeakMap<Permit2ForegroundApprovalProof, Issued>();
/** Trusted wiring; the only UI-proof issuer performs actual owned disclosure and foreground approval. */
export class Permit2ForegroundApprovalAuthority {
  readonly #records: Permit2ProductionRepository;
  readonly #approval: Permit2ForegroundApprovalPort;
  readonly #clock: () => Date;
  readonly #binding: { readonly journal: Permit2ProductionJournal; readonly controller: object; readonly native: NativePort;
    readonly capability: Permit2LocalCapability; readonly nativeState: object; readonly root: string };
  constructor(journal: Permit2ProductionJournal, controller: object, native: NativePort, capability: Permit2LocalCapability,
    approval: Permit2ForegroundApprovalPort, clock: () => Date) {
    const nativeState = LocalWalletNative.assertPermit2LocalCapability(capability, native, journal.root);
    this.#approval = approval; this.#clock = clock;
    this.#records = new Permit2ProductionRepository(journal.root);
    this.#binding = Object.freeze({ journal, controller, native, capability, nativeState, root: journal.root });
  }
  async approveOwned(id: string): Promise<Permit2ForegroundApprovalProof> {
    const record = await this.#records.findOperation(id); if (record === null) blocked();
    assertSigningLifecycle(record, "reserved"); assertSigningTime(record, now(this.#clock));
    const display = permit2ApprovalDisplay(record), started = now(this.#clock).getTime();
    await this.#approval.approve(display);
    const completedAt = now(this.#clock).getTime(); if (completedAt < started) blocked();
    assertSigningTime(record, new Date(completedAt));
    const proof = Object.freeze({ kind: "permit2-foreground-approval-proof" as const });
    proofs.set(proof, { ...this.#binding, operationId: id, materialHash: record.material.materialHash,
      displayHash: display.displayHash, fingerprint: display.fingerprint, completedAt, clock: this.#clock, claimed: false });
    return proof;
  }
}
function checked(proof: Permit2ForegroundApprovalProof, journal: Permit2ProductionJournal, record: Permit2ProductionRecord): Issued {
  const entry = proofs.get(proof); if (entry === undefined || entry.journal !== journal || entry.root !== journal.root ||
    entry.operationId !== record.operationId || entry.materialHash !== record.material.materialHash) blocked();
  const display = permit2ApprovalDisplay(record);
  if (display.displayHash !== entry.displayHash || display.fingerprint !== entry.fingerprint ||
    LocalWalletNative.assertPermit2LocalCapability(entry.capability, entry.native, entry.root) !== entry.nativeState) blocked();
  const at = now(entry.clock); if (at.getTime() < entry.completedAt || at.getTime() - entry.completedAt > 60_000) blocked();
  assertSigningTime(record, at); return entry;
}
/** Read-only recognition before fresh RPC. Atomic claiming still occurs only under the journal's first-write locks. */
export function assertCurrentPermit2ForegroundApproval(proof: Permit2ForegroundApprovalProof, journal: Permit2ProductionJournal,
  record: Permit2ProductionRecord): void { if (checked(proof, journal, record).claimed) blocked(); }
/** Recognizes only an actual privately issued UI proof; there is no caller-authoritative time. */
export function claimPermit2ForegroundApproval(proof: Permit2ForegroundApprovalProof, journal: Permit2ProductionJournal,
  record: Permit2ProductionRecord): Permit2ApprovalBinding {
  const entry = checked(proof, journal, record); if (entry.claimed) blocked(); entry.claimed = true;
  const { claimed: _claimed, ...binding } = entry; return Object.freeze(binding);
}
export function assertClaimedPermit2ForegroundApproval(proof: Permit2ForegroundApprovalProof, journal: Permit2ProductionJournal,
  record: Permit2ProductionRecord): void { if (!checked(proof, journal, record).claimed) blocked(); }
export function revokePermit2ForegroundApproval(proof: Permit2ForegroundApprovalProof): void { proofs.delete(proof); }
function now(clock: () => Date): Date { const at = clock(); if (!(at instanceof Date) || !Number.isSafeInteger(at.getTime()) || at.getTime() < 0) blocked(); return new Date(at); }
function blocked(): never { throw new ApnError("APN_OPERATION_BLOCKED", "Permit2 foreground approval is not privately owned, current or bound."); }
