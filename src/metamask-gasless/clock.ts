import type { ClockPort } from "../ports.js";
import { MM_MIN_REMAINING_MS, MM_OBSERVATION_MAX_AGE_MS } from "./model.js";
import type { MetaMaskGaslessOperationRecord } from "./operation-model.js";
import { mmFail } from "./reasons.js";
import { mmIso } from "./validation.js";

/** Invocation-local monotonicity plus persisted-time checks; never an onchain expiry. */
export class MetaMaskGaslessClock {
  private previous = 0;
  private lastValid = 0;
  constructor(private readonly clock: ClockPort) {}

  check(op?: MetaMaskGaslessOperationRecord, observations: readonly string[] = []): number {
    let now: number;
    try { now = this.clock.now().getTime(); } catch { return mmFail("mm_gasless_clock"); }
    if (!Number.isSafeInteger(now) || now <= 0 || !Number.isFinite(new Date(now).getTime())) mmFail("mm_gasless_clock");
    this.lastValid = now;
    const times = [...observations];
    if (op !== undefined) {
      times.push(op.createdAt, op.updatedAt, op.intent.preparedAt, op.intent.initialSnapshot.observedAt);
      if (op.approval !== null) times.push(op.approval.approvedAt);
      if (op.dispatchStartedAt !== null) times.push(op.dispatchStartedAt);
      if (op.providerObservation !== null) times.push(op.providerObservation.observedAt);
      if (op.observation !== null) times.push(op.observation.observedAt);
      if (op.settlement !== null) times.push(op.settlement.observedAt);
    }
    if (now < this.previous || times.some(at => Date.parse(mmIso(at)) > now)) mmFail("mm_gasless_clock");
    this.previous = now;
    return now;
  }

  fresh(observedAt: string, op?: MetaMaskGaslessOperationRecord): number {
    const now = this.check(op, [observedAt]);
    if (now - Date.parse(observedAt) > MM_OBSERVATION_MAX_AGE_MS) mmFail("mm_gasless_expired");
    return now;
  }

  beforeDispatch(op: MetaMaskGaslessOperationRecord, observedAt: string): number {
    this.fresh(op.intent.initialSnapshot.observedAt, op);
    const now = this.fresh(observedAt, op);
    if (now + MM_MIN_REMAINING_MS > Date.parse(op.intent.expiresAt)) mmFail("mm_gasless_expired");
    return now;
  }

  beforeApproval(op: MetaMaskGaslessOperationRecord): number {
    const now = this.check(op);
    if (now >= Date.parse(op.intent.expiresAt)) mmFail("mm_gasless_expired");
    return now;
  }

  /** Forensic ordering for a pre-effect failure, never a new authorization sample. */
  failureAt(op: MetaMaskGaslessOperationRecord): string {
    return new Date(Math.max(this.lastValid, Date.parse(op.updatedAt))).toISOString();
  }
}
