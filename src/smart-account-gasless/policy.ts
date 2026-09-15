import { approvalCode } from "../approval-code.js";
import { ApnError } from "../errors.js";
import type { ClockPort } from "../ports.js";
import { exactChainConsent, type TtyTransferApprovalOptions } from "../tty-approval.js";
import { SA_MIN_REMAINING_MS, SA_TTL_MS, type SmartAccountGaslessBinding, type SmartAccountGaslessSnapshot } from "./model.js";
import type { SmartAccountGaslessOperationRecord, SmartAccountGaslessPublicOperation } from "./operation-model.js";
import type { SmartAccountGaslessApprovalPort, SmartAccountGaslessRpcPort } from "./ports.js";
import { publicSmartAccountGaslessOperation } from "./receipt.js";
import { saError, saFail } from "./reasons.js";
import { saBlockOrder, saIso, saSnapshot } from "./schema.js";

/** Fresh finite wall time, monotonic within this invocation and no earlier than any saved observation. */
export class SmartAccountGaslessClock {
  private previous = 0;
  constructor(private readonly clock: ClockPort) {}
  check(op?: SmartAccountGaslessOperationRecord, observations: readonly string[] = []): number {
    let now: number;
    try { now = this.clock.now().getTime(); } catch { return saFail("sa_gasless_clock"); }
    if (!Number.isSafeInteger(now) || now <= 0 || now > 253402300799999) saFail("sa_gasless_clock");
    const times = [...observations];
    if (op !== undefined) {
      times.push(op.createdAt, op.updatedAt, op.intent.initialSnapshot.observedAt, op.intent.provider.observedAt);
      for (const value of [op.approval?.approvedAt, op.material?.sealedAt, op.exposureStartedAt, op.dispatchStartedAt,
        op.verification?.observedAt, op.providerSettlement?.observedAt, op.observation?.observedAt,
        op.settlement?.observedAt, op.unusedProof?.observedAt]) if (value !== undefined && value !== null) times.push(value);
    }
    if (now < this.previous || times.some(value => Date.parse(saIso(value, "sa_gasless_clock")) > now)) saFail("sa_gasless_clock");
    this.previous = now;
    return now;
  }
  live(op: SmartAccountGaslessOperationRecord, minimumRemaining = 0): number {
    const now = this.check(op), expiry = Date.parse(op.intent.expiresAt);
    if (now >= expiry || now + minimumRemaining > expiry) saFail("sa_gasless_expired");
    return now;
  }
  fresh(observedAt: string, op?: SmartAccountGaslessOperationRecord): number {
    const now = this.check(op, [observedAt]);
    if (now - Date.parse(observedAt) > SA_TTL_MS) saFail("sa_gasless_expired");
    return now;
  }
  signing(op: SmartAccountGaslessOperationRecord): number { return this.live(op, SA_MIN_REMAINING_MS); }
  /** Forensic timestamp for refusal, never a new sample granting an effect. */
  failureAt(op: SmartAccountGaslessOperationRecord): string { return new Date(Math.max(this.previous, Date.parse(op.updatedAt))).toISOString(); }
}
export function smartAccountGaslessSnapshot(value: unknown, binding: SmartAccountGaslessBinding,
  rpc: SmartAccountGaslessRpcPort, op?: SmartAccountGaslessOperationRecord): SmartAccountGaslessSnapshot {
  let snapshot: SmartAccountGaslessSnapshot;
  try { snapshot = saSnapshot(value, binding); } catch { return saFail("sa_gasless_evidence"); }
  if (rpc.chainId !== 8453 || snapshot.chainId !== rpc.chainId || snapshot.endpointHash !== rpc.endpointHash ||
    snapshot.endpointOrigin !== rpc.endpointOrigin) saFail("sa_gasless_rpc_binding");
  if (op !== undefined) {
    if (rpc.endpointHash !== op.intent.initialSnapshot.endpointHash || rpc.endpointOrigin !== op.intent.initialSnapshot.endpointOrigin)
      saFail("sa_gasless_rpc_binding");
    try {
      saBlockOrder(op.intent.initialSnapshot.preparationBlock, snapshot.preparationBlock);
      saBlockOrder(op.intent.initialSnapshot.safeBlock, snapshot.safeBlock);
    } catch { return saFail("sa_gasless_evidence"); }
    if (BigInt(snapshot.safeState.usdcBalanceAtomic) < BigInt(op.intent.request.grossAtomic)) saFail("sa_gasless_balance");
    if (BigInt(snapshot.safeState.availableAtomic) < BigInt(op.intent.request.grossAtomic)) saFail("sa_gasless_allowance");
  }
  return snapshot;
}
export function smartAccountGaslessApprovalPhrase(op: SmartAccountGaslessOperationRecord): string {
  return approvalCode("gasless", op.operationId, op.fingerprint);
}
export function smartAccountGaslessApprovalSummary(op: SmartAccountGaslessOperationRecord, now: number): Readonly<Record<string, unknown>> {
  return { ...publicSmartAccountGaslessOperation(op), remaining_ms: Math.max(0, Date.parse(op.intent.expiresAt) - now),
    authorization: "Approve one exact USDC transfer using the existing MetaMask owner, session and permission.",
    outer_gas_payer: "The approved public MetaMask facilitator pays native gas; owner and session native debit is zero.",
    permission_warning: "Verification discloses a signed child permission that the facilitator can use until its onchain expiry. After disclosure APN only observes this operation on recovery; timeouts and rejection do not prove no payment.",
  };
}
export class TtySmartAccountGaslessApproval implements SmartAccountGaslessApprovalPort {
  constructor(private readonly options: TtyTransferApprovalOptions = {}) {}
  async confirm(input: Parameters<SmartAccountGaslessApprovalPort["confirm"]>[0]): Promise<boolean> {
    const s = input.summary as unknown as SmartAccountGaslessPublicOperation, t = s.transfer;
    const amount = (value: string) => `${BigInt(value) / 1000000n}.${(BigInt(value) % 1000000n).toString().padStart(6, "0")} USDC (${value} atomic)`;
    const lines = ["Agent Payment Node: MetaMask Smart Account gasless approval",
      `Profile: ${s.profile}; provider: metamask-smart-account`, `Chain: eip155:${t.chain_id}; canonical USDC: ${t.token}; decimals: 6`,
      `Owner: ${s.permission.owner}`, `Session: ${s.permission.session}`, `Recipient: ${t.recipient}`,
      `Total owner debit: ${amount(t.gross_atomic)}`, `Recipient receives: ${amount(t.frozen_net_atomic)}`,
      `Exact fee: ${amount(t.frozen_fee_atomic)}`, `Your fee ceiling: ${amount(t.user_max_fee_atomic)}`,
      `Your minimum received: ${amount(t.minimum_received_atomic)}`, String(input.summary.authorization),
      String(input.summary.outer_gas_payer), String(input.summary.permission_warning),
      `Root delegation: ${s.permission.root_delegation_hash}`, `RPC: ${s.endpoint_origin}`,
      `Operation: ${s.operation_id}`, `Fingerprint: ${s.fingerprint}`, `Expires: ${s.expires_at}`];
    try { await exactChainConsent(lines, input.exactPhrase, s.expires_at, this.options, 256); return true; }
    catch (error) {
      if (error instanceof ApnError && error.code === "APN_NATIVE_REJECTED") {
        if (error.details?.nativeCode === "APN_APPROVAL_REFUSED") return false;
        if (error.details?.nativeCode === "APN_APPROVAL_EXPIRED") throw saError("sa_gasless_expired");
      }
      throw saError("sa_gasless_approval");
    }
  }
}
