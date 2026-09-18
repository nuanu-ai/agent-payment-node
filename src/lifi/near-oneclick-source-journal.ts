import { hashObject } from "../canonical.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { encodeFunctionData, getAddress, keccak256, parseAbi, parseTransaction, recoverTransactionAddress, type Hex } from "viem";
import { LEGACY_ONECLICK_LANE, oneClickLane, oneClickRecipient, type OneClickLane, type OneClickLaneId } from "./near-oneclick-lanes.js";
import { bridgeFailure } from "./validation.js";

export interface OneClickSourceRecord {
  readonly schemaVersion: "apn.oneclick-source.v1" | "apn.oneclick-source.v2" | "apn.oneclick-source.v3";
  /** Present only in v3. v1 and v2 records are the legacy Base USDC to TRON USDT lane. */
  readonly lane?: OneClickLaneId;
  readonly operationId: string;
  readonly profileHash: string;
  readonly payer: string;
  readonly recipient: string;
  readonly refundTo: string;
  readonly depositAddress: string;
  /** v3 native lanes only: the deposit address code class observed at the pinned source block. */
  readonly depositCode?: "eoa" | "contract";
  readonly quoteHash: string;
  readonly quoteRequestDeadline: string;
  readonly quoteDeadline: string;
  readonly effectiveDeadline: string;
  readonly amountInAtomic: string;
  readonly minAmountOutAtomic: string;
  readonly quotedAmountOutAtomic: string;
  readonly sourceBlockHash: string;
  readonly sourceCall: { readonly to: string; readonly data: Hex; readonly value?: string; readonly nonce: string; readonly gas: string;
    readonly maxFeePerGas: string; readonly maxPriorityFeePerGas: string; readonly maxNativeDebitWei: string };
  readonly phase: "prepared" | "signing_started" | "sealed" | "submitting" | "submitted_pending" | "unknown_finality" | "source_observed";
  readonly rawTransaction: Hex | null;
  readonly transactionHash: Hex | null;
  readonly submissionAttempts: 0 | 1;
  readonly sourceReceiptStatus: "success" | "reverted" | null;
  readonly sourceReceiptHash: string | null;
  readonly destinationStatus: null;
  readonly updatedAt: string;
  readonly integrityHash: string;
}
const TRANSFER = parseAbi(["function transfer(address,uint256) returns (bool)"]);
function fail(): never { return bridgeFailure("APN_STATE_CORRUPT", "oneclick_source_record"); }
function blocked(): never { return bridgeFailure("APN_OPERATION_BLOCKED", "oneclick_source_transition"); }
export function oneClickRecordLane(record: Pick<OneClickSourceRecord, "schemaVersion" | "lane">): OneClickLane {
  if (record.schemaVersion !== "apn.oneclick-source.v3") {
    if (record.lane !== undefined) fail();
    return oneClickLane(LEGACY_ONECLICK_LANE);
  }
  try { return oneClickLane(record.lane); } catch { return fail(); }
}
/** The exact source effect for a lane: an ERC20 transfer to the deposit, or exactly amountIn wei to the deposit. */
export function oneClickSourceCall(lane: OneClickLane, depositAddress: string, amountInAtomic: string): { to: string; data: Hex; value: string } {
  const deposit = getAddress(depositAddress), amount = BigInt(amountInAtomic);
  if (lane.origin.kind === "native") return { to: deposit, data: "0x", value: amount.toString() };
  if (lane.origin.token === null) fail();
  return { to: lane.origin.token, data: encodeFunctionData({ abi: TRANSFER, functionName: "transfer", args: [deposit, amount] }), value: "0" };
}
function validate(value: unknown): OneClickSourceRecord {
  if (typeof value !== "object" || value === null) fail();
  const r = value as OneClickSourceRecord;
  const { integrityHash, ...body } = r;
  if ((r.schemaVersion !== "apn.oneclick-source.v1" && r.schemaVersion !== "apn.oneclick-source.v2" && r.schemaVersion !== "apn.oneclick-source.v3") ||
    hashObject(body) !== integrityHash ||
    !/^[a-f0-9]{64}$/u.test(r.operationId) || !/^[a-f0-9]{64}$/u.test(r.profileHash) ||
    !/^0x[a-fA-F0-9]{64}$/u.test(r.sourceBlockHash) || !/^0x[a-fA-F0-9]{40}$/u.test(r.depositAddress) ||
    !/^(?:0|[1-9][0-9]*)$/u.test(r.amountInAtomic) ||
    !Number.isFinite(Date.parse(r.quoteRequestDeadline)) || !Number.isFinite(Date.parse(r.quoteDeadline)) ||
    r.effectiveDeadline !== new Date(Math.min(Date.parse(r.quoteRequestDeadline), Date.parse(r.quoteDeadline))).toISOString() ||
    r.destinationStatus !== null || r.submissionAttempts > 1) fail();
  const lane = oneClickRecordLane(r), expected = oneClickSourceCall(lane, r.depositAddress, r.amountInAtomic);
  const v3 = r.schemaVersion === "apn.oneclick-source.v3";
  if (r.sourceCall.to !== expected.to || r.sourceCall.data !== expected.data ||
    (v3 ? r.sourceCall.value !== expected.value : r.sourceCall.value !== undefined)) fail();
  if (v3) {
    try { oneClickRecipient(lane, r.recipient); } catch { fail(); }
    if (lane.origin.kind === "native" ? r.depositCode !== "eoa" && r.depositCode !== "contract" : r.depositCode !== undefined) fail();
  } else if (r.depositCode !== undefined) fail();
  if (r.phase === "prepared" || r.phase === "signing_started") {
    if (r.rawTransaction !== null || r.transactionHash !== null || r.submissionAttempts !== 0) fail();
  } else {
    if (r.rawTransaction === null || r.transactionHash === null || keccak256(r.rawTransaction) !== r.transactionHash) fail();
    let tx: ReturnType<typeof parseTransaction>;
    try { tx = parseTransaction(r.rawTransaction); } catch { fail(); }
    if (tx.type !== "eip1559" || tx.chainId !== lane.origin.chainId || tx.to?.toLowerCase() !== r.sourceCall.to.toLowerCase() ||
      (tx.data ?? "0x") !== r.sourceCall.data || (tx.value ?? 0n) !== BigInt(expected.value) || tx.nonce?.toString() !== r.sourceCall.nonce ||
      tx.gas?.toString() !== r.sourceCall.gas || tx.maxFeePerGas?.toString() !== r.sourceCall.maxFeePerGas ||
      tx.maxPriorityFeePerGas?.toString() !== r.sourceCall.maxPriorityFeePerGas || (tx.accessList ?? []).length !== 0 ||
      tx.r === undefined || tx.s === undefined) fail();
    if ((r.phase === "sealed") !== (r.submissionAttempts === 0)) fail();
  }
  if ((r.phase === "source_observed") !== (r.sourceReceiptStatus !== null && r.sourceReceiptHash !== null)) fail();
  return r;
}
/** Base keeps its original reservation path; every other origin chain is scoped by its EIP-155 chain ID. */
function nonceReservation(record: OneClickSourceRecord): string {
  const lane = oneClickRecordLane(record), owner = `${record.payer.toLowerCase()}-${record.sourceCall.nonce}.json`;
  return lane.origin.chainId === 8453 ? `oneclick-source-nonces/${record.profileHash}/${owner}`
    : `oneclick-source-nonces/${record.profileHash}/eip155-${lane.origin.chainId}/${owner}`;
}
export class OneClickSourceJournal extends SecureStateStore {
  private path(id: string): string { stateIdentifier(id, "operation ID"); return `oneclick-source/${id}.json`; }
  async load(id: string): Promise<OneClickSourceRecord | null> {
    const value = await this.readJson(this.path(id));
    if (value === null) return null;
    const record = validate(value);
    if (record.operationId !== id) fail();
    return record;
  }
  async stage(body: Omit<OneClickSourceRecord, "schemaVersion" | "phase" | "rawTransaction" | "transactionHash" |
    "submissionAttempts" | "sourceReceiptStatus" | "sourceReceiptHash" | "destinationStatus" | "updatedAt" | "integrityHash"> &
    { readonly lane: OneClickLaneId }): Promise<OneClickSourceRecord> {
    await this.initialize();
    return this.withLocks([`oneclick:${body.operationId}`], async () => {
      const prior = await this.load(body.operationId);
      if (prior !== null) blocked();
      const draft = { ...body, schemaVersion: "apn.oneclick-source.v3" as const, phase: "prepared" as const,
        rawTransaction: null, transactionHash: null, submissionAttempts: 0 as const, sourceReceiptStatus: null,
        sourceReceiptHash: null, destinationStatus: null, updatedAt: new Date().toISOString() };
      const record = validate({ ...draft, integrityHash: hashObject(draft) });
      await this.ensureDirectory("oneclick-source");
      await this.writeJson(this.path(body.operationId), record);
      return record;
    });
  }
  async advance(id: string, expectedHash: string, phase: OneClickSourceRecord["phase"],
    changes: Partial<OneClickSourceRecord> = {}): Promise<OneClickSourceRecord> {
    await this.initialize();
    return this.withLocks([`oneclick:${id}`, `oneclick-nonces`], async () => {
      const prior = await this.load(id); if (prior === null || prior.integrityHash !== expectedHash) blocked();
      const edges: Record<OneClickSourceRecord["phase"], readonly OneClickSourceRecord["phase"][]> = {
        prepared: ["signing_started"], signing_started: ["sealed"], sealed: ["submitting"],
        submitting: ["submitted_pending", "unknown_finality", "source_observed"],
        submitted_pending: ["unknown_finality", "source_observed"],
        unknown_finality: ["source_observed"], source_observed: [] };
      if (!edges[prior.phase].includes(phase)) blocked();
      const { integrityHash: _old, ...body } = prior;
      const next = { ...body, ...changes, phase, updatedAt: new Date().toISOString() };
      // Validate the exact sealed transaction before reserving its nonce, so a rejected seal leaves no reservation.
      let record: OneClickSourceRecord;
      try { record = validate({ ...next, integrityHash: hashObject(next) }); } catch { return blocked(); }
      if (phase === "sealed") {
        if (changes.rawTransaction === undefined || changes.transactionHash === undefined ||
          keccak256(changes.rawTransaction as Hex) !== changes.transactionHash) blocked();
        const sender = await recoverTransactionAddress({ serializedTransaction: changes.rawTransaction as `0x02${string}` });
        if (sender.toLowerCase() !== prior.payer.toLowerCase()) blocked();
        const reservation = nonceReservation(prior);
        const existing = await this.readJson(reservation);
        if (existing !== null) blocked();
        await this.ensureDirectory(reservation.slice(0, reservation.lastIndexOf("/")));
        await this.writeJson(reservation, { operationId: id, transactionHash: changes.transactionHash });
      }
      await this.writeJson(this.path(id), record);
      return record;
    });
  }
}
