import { hashObject } from "../canonical.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { encodeFunctionData, getAddress, keccak256, parseAbi, parseTransaction, recoverTransactionAddress, type Hex } from "viem";
import { bridgeFailure } from "./validation.js";

export interface OneClickSourceRecord {
  readonly schemaVersion: "apn.oneclick-source.v1";
  readonly operationId: string;
  readonly profileHash: string;
  readonly payer: string;
  readonly recipient: string;
  readonly refundTo: string;
  readonly depositAddress: string;
  readonly quoteHash: string;
  readonly quoteRequestDeadline: string;
  readonly amountInAtomic: string;
  readonly minAmountOutAtomic: string;
  readonly quotedAmountOutAtomic: string;
  readonly sourceBlockHash: string;
  readonly sourceCall: { readonly to: string; readonly data: Hex; readonly nonce: string; readonly gas: string;
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
const USDC = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const TRANSFER = parseAbi(["function transfer(address,uint256) returns (bool)"]);
function fail(): never { return bridgeFailure("APN_STATE_CORRUPT", "oneclick_source_record"); }
function blocked(): never { return bridgeFailure("APN_OPERATION_BLOCKED", "oneclick_source_transition"); }
function validate(value: unknown): OneClickSourceRecord {
  if (typeof value !== "object" || value === null) fail();
  const r = value as OneClickSourceRecord;
  const { integrityHash, ...body } = r;
  if (r.schemaVersion !== "apn.oneclick-source.v1" || hashObject(body) !== integrityHash ||
    !/^[a-f0-9]{64}$/u.test(r.operationId) || !/^[a-f0-9]{64}$/u.test(r.profileHash) ||
    !/^0x[a-fA-F0-9]{64}$/u.test(r.sourceBlockHash) ||
    !/^0x[a-fA-F0-9]{40}$/u.test(r.depositAddress) || r.sourceCall.to !== USDC ||
    r.sourceCall.data !== encodeFunctionData({ abi: TRANSFER, functionName: "transfer",
      args: [getAddress(r.depositAddress), BigInt(r.amountInAtomic)] }) ||
    r.destinationStatus !== null || r.submissionAttempts > 1) fail();
  if (r.phase === "prepared" || r.phase === "signing_started") {
    if (r.rawTransaction !== null || r.transactionHash !== null || r.submissionAttempts !== 0) fail();
  } else {
    if (r.rawTransaction === null || r.transactionHash === null || keccak256(r.rawTransaction) !== r.transactionHash) fail();
    let tx: ReturnType<typeof parseTransaction>;
    try { tx = parseTransaction(r.rawTransaction); } catch { fail(); }
    if (tx.type !== "eip1559" || tx.chainId !== 8453 || tx.to?.toLowerCase() !== r.sourceCall.to.toLowerCase() ||
      tx.data !== r.sourceCall.data || (tx.value ?? 0n) !== 0n || tx.nonce?.toString() !== r.sourceCall.nonce ||
      tx.gas?.toString() !== r.sourceCall.gas || tx.maxFeePerGas?.toString() !== r.sourceCall.maxFeePerGas ||
      tx.maxPriorityFeePerGas?.toString() !== r.sourceCall.maxPriorityFeePerGas || (tx.accessList ?? []).length !== 0 ||
      tx.r === undefined || tx.s === undefined) fail();
    if ((r.phase === "sealed") !== (r.submissionAttempts === 0)) fail();
  }
  if ((r.phase === "source_observed") !== (r.sourceReceiptStatus !== null && r.sourceReceiptHash !== null)) fail();
  return r;
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
    "submissionAttempts" | "sourceReceiptStatus" | "sourceReceiptHash" | "destinationStatus" | "updatedAt" | "integrityHash">): Promise<OneClickSourceRecord> {
    await this.initialize();
    return this.withLocks([`oneclick:${body.operationId}`], async () => {
      const prior = await this.load(body.operationId);
      if (prior !== null) blocked();
      const draft = { ...body, schemaVersion: "apn.oneclick-source.v1" as const, phase: "prepared" as const,
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
      if (phase === "sealed") {
        if (changes.rawTransaction === undefined || changes.transactionHash === undefined ||
          keccak256(changes.rawTransaction as Hex) !== changes.transactionHash) blocked();
        const sender = await recoverTransactionAddress({ serializedTransaction: changes.rawTransaction as `0x02${string}` });
        if (sender.toLowerCase() !== prior.payer.toLowerCase()) blocked();
        const reservation = `oneclick-source-nonces/${prior.profileHash}/${prior.payer.toLowerCase()}-${prior.sourceCall.nonce}.json`;
        const existing = await this.readJson(reservation);
        if (existing !== null) blocked();
        await this.ensureDirectory(`oneclick-source-nonces/${prior.profileHash}`);
        await this.writeJson(reservation, { operationId: id, transactionHash: changes.transactionHash });
      }
      const { integrityHash: _old, ...body } = prior;
      const next = { ...body, ...changes, phase, updatedAt: new Date().toISOString() };
      const record = validate({ ...next, integrityHash: hashObject(next) });
      await this.writeJson(this.path(id), record);
      return record;
    });
  }
}
