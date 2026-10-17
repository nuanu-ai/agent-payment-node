import { ApnError } from "../errors.js";
import { Permit2ProductionRepository, type Permit2ProductionRecord } from "./production-repository.js";
import { assertSigningLifecycle } from "./production-signing-owner.js";
import { assertSigningTime } from "./production-signing-facts.js";
import { permit2ApprovalDisplay, type Permit2ApprovalPurpose, type Permit2ForegroundApprovalPort } from "./production-approval.js";

/** How long a foreground approval may be used after the owner completed it. */
export const PERMIT2_APPROVAL_WINDOW_MS = 60_000;

/**
 * What the owner approved at the foreground prompt: a plain value. Only the paid CLI path shows the prompt and then
 * signs, and every later step re-checks the value against the saved record and the clock (assertPermit2ApprovalCurrent).
 */
export interface Permit2ForegroundApproval {
  readonly operationId: string;
  readonly purpose: Permit2ApprovalPurpose;
  readonly materialHash: string;
  readonly displayHash: string;
  readonly fingerprint: string;
  readonly completedAt: number;
}

/** Shows one reserved operation at the foreground prompt; no key, signing or transport is involved. */
export class Permit2ForegroundApprovalAuthority {
  readonly #records: Permit2ProductionRepository;
  readonly #approval: Permit2ForegroundApprovalPort;
  readonly #clock: () => Date;
  constructor(root: string, approval: Permit2ForegroundApprovalPort, clock: () => Date) {
    this.#records = new Permit2ProductionRepository(root); this.#approval = approval; this.#clock = clock;
  }
  async approveOwned(id: string, purpose: Permit2ApprovalPurpose = "sign-only"): Promise<Permit2ForegroundApproval> {
    const record = await this.#records.findOperation(id); if (record === null) blocked();
    assertSigningLifecycle(record, "reserved"); assertSigningTime(record, permit2Now(this.#clock));
    const display = permit2ApprovalDisplay(record, purpose), started = permit2Now(this.#clock).getTime();
    await this.#approval.approve(display);
    const completedAt = permit2Now(this.#clock).getTime(); if (completedAt < started) blocked();
    assertSigningTime(record, new Date(completedAt));
    return Object.freeze({ operationId: id, purpose: display.purpose, materialHash: record.material.materialHash,
      displayHash: display.displayHash, fingerprint: display.fingerprint, completedAt });
  }
}

/** The approval names exactly what `record` displays and is at most 60 s old at `at`; returns `at`. */
export function assertPermit2ApprovalCurrent(approval: Permit2ForegroundApproval, record: Permit2ProductionRecord, at: Date): Date {
  if (approval.operationId !== record.operationId || approval.materialHash !== record.material.materialHash) blocked();
  const display = permit2ApprovalDisplay(record, approval.purpose);
  if (display.displayHash !== approval.displayHash || display.fingerprint !== approval.fingerprint) blocked();
  assertPermit2ApprovalWindow(approval, at); assertSigningTime(record, at); return at;
}
/** The approval is at most 60 s old at `at`, and `at` is not before it. */
export function assertPermit2ApprovalWindow(approval: Permit2ForegroundApproval, at: Date): void {
  const ms = at.getTime();
  if (!Number.isSafeInteger(ms) || ms < approval.completedAt || ms - approval.completedAt > PERMIT2_APPROVAL_WINDOW_MS) blocked();
}

export function permit2Now(clock: () => Date): Date {
  const at = clock(); if (!(at instanceof Date) || !Number.isSafeInteger(at.getTime()) || at.getTime() < 0) blocked();
  return new Date(at.getTime());
}
function blocked(): never { throw new ApnError("APN_OPERATION_BLOCKED", "Permit2 foreground approval is not current or bound to this operation."); }
