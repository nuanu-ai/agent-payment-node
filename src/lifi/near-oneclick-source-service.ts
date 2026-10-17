import { createHash } from "node:crypto";
import { keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { approvalCode } from "../approval-code.js";
import { canonicalJson, hashObject } from "../canonical.js";
import { EncryptedWalletStore } from "../encrypted-wallet-store.js";
import type { WrappingSecretPort } from "../macos-keychain.js";
import { SolanaRpc } from "../solana/rpc.js";
import type { StateStore } from "../state.js";
import { TronRpc } from "../tron/rpc.js";
import { exactChainConsent } from "../tty-approval.js";
import { canonicalProfile } from "../wallet-policy.js";
import { BridgeHttps } from "./https.js";
import { oneClickDestinationHashes, proveOneClickDestination, type OneClickDestinationProof } from "./near-oneclick-destination.js";
import { assertOneClickNativePostApproval, assertOneClickPostApproval, OneClickEvmSource, planOneClickNative,
  type OneClickSourcePlan } from "./near-oneclick-evm-source.js";
import { LEGACY_ONECLICK_LANE, oneClickLane, oneClickRecipient, type OneClickLane } from "./near-oneclick-lanes.js";
import { OneClickSourceJournal, oneClickRecordLane, oneClickSourceCall, type OneClickSourceRecord } from "./near-oneclick-source-journal.js";
import { bridgeAddress, bridgeFailure, bridgeRecord, bridgeUint } from "./validation.js";
import { admitOperation } from "../operation-index/admission.js";
import { evmClaim } from "../operation-index/adapters/family-claims.js";
export { assertOneClickPostApproval } from "./near-oneclick-evm-source.js";

const ORIGIN = "https://1click.chaindefuser.com";
/** The quote request deadline is set this far ahead; it also bounds how old an attributable destination credit may be. */
const QUOTE_WINDOW_MS = 180_000;
const ZERO = "0x0000000000000000000000000000000000000000";
function fail(reason: string): never { return bridgeFailure("APN_OPERATION_BLOCKED", `oneclick_source_${reason}`); }
function quoteIdentity(value: unknown): string {
  const response = bridgeRecord(value);
  if (typeof response.timestamp !== "string" || !Number.isFinite(Date.parse(response.timestamp)) ||
    typeof response.signature !== "string" || response.signature.length < 16) fail("quote_identity");
  return hashObject({ timestamp: response.timestamp, signature: response.signature,
    quoteRequest: response.quoteRequest, quote: response.quote });
}
/** Existing v1 records hashed the whole quote envelope, including an ephemeral correlationId.
 * Rebind their provider status to every field that can change the source or destination effect.
 */
export function legacyStatusQuoteMatchesRecord(value: unknown, record: OneClickSourceRecord): boolean {
  const legacy = oneClickLane(LEGACY_ONECLICK_LANE);
  try {
    const outer = bridgeRecord(value), request = bridgeRecord(outer.quoteRequest), quote = bridgeRecord(outer.quote);
    return typeof outer.timestamp === "string" && Number.isFinite(Date.parse(outer.timestamp)) &&
      typeof outer.signature === "string" && outer.signature.length >= 16 &&
      request.dry === false && request.swapType === "EXACT_INPUT" && request.slippageTolerance === 100 &&
      request.originAsset === legacy.origin.oneClickAsset && request.depositType === "ORIGIN_CHAIN" &&
      request.destinationAsset === legacy.destination.oneClickAsset && request.refundType === "ORIGIN_CHAIN" &&
      request.recipientType === "DESTINATION_CHAIN" && request.amount === record.amountInAtomic &&
      bridgeAddress(request.refundTo) === record.refundTo && request.recipient === record.recipient &&
      request.deadline === record.quoteRequestDeadline &&
      bridgeAddress(quote.depositAddress) === record.depositAddress &&
      (quote.depositMemo === null || quote.depositMemo === undefined || quote.depositMemo === "") &&
      bridgeUint(quote.amountIn) === BigInt(record.amountInAtomic) &&
      bridgeUint(quote.minAmountIn) <= BigInt(record.amountInAtomic) &&
      bridgeUint(quote.amountOut) === BigInt(record.quotedAmountOutAtomic) &&
      bridgeUint(quote.minAmountOut) === BigInt(record.minAmountOutAtomic) &&
      Date.parse(String(quote.deadline)) === Date.parse(record.quoteDeadline);
  } catch { return false; }
}
export function oneClickStatusQuoteMatchesRecord(value: unknown, record: OneClickSourceRecord): boolean {
  if (record.schemaVersion === "apn.oneclick-source.v1") return legacyStatusQuoteMatchesRecord(value, record);
  if (record.schemaVersion !== "apn.oneclick-source.v2" && record.schemaVersion !== "apn.oneclick-source.v3") return false;
  try {
    if (quoteIdentity(value) === record.quoteHash) return true;
    const status = bridgeRecord(value), request = bridgeRecord(status.quoteRequest);
    // 1Click's status response omits two neutral quote defaults and adds three null fields.
    // Reconstruct only that observed representation; the signature, quote economics,
    // deposit address, payer, recipient and deadlines still participate in the saved digest.
    if (Object.hasOwn(request, "insured") || Object.hasOwn(request, "quoteWaitingTimeMs")) return false;
    const originalRequest: Record<string, unknown> = { ...request, insured: false, quoteWaitingTimeMs: 0 };
    for (const key of ["referral", "virtualChainRecipient", "virtualChainRefundRecipient"]) {
      if (!Object.hasOwn(originalRequest, key) || originalRequest[key] !== null) return false;
      delete originalRequest[key];
    }
    return quoteIdentity({ ...status, quoteRequest: originalRequest }) === record.quoteHash;
  } catch { return false; }
}
export { assertOneClickNativePostApproval };
export function inspectOneClickSourceQuote(response: unknown, request: Record<string, unknown>, minOutput: bigint, maxLoss: bigint, now: number,
  lane: OneClickLane) {
  const outer = bridgeRecord(response), echo = bridgeRecord(outer.quoteRequest), quote = bridgeRecord(outer.quote);
  if (request.originAsset !== lane.origin.oneClickAsset || request.destinationAsset !== lane.destination.oneClickAsset) fail("quote_lane");
  for (const [key, value] of Object.entries(request)) if (echo[key] !== value) fail(`quote_${key}`);
  const amountIn = bridgeUint(quote.amountIn), amountOut = bridgeUint(quote.amountOut), minimum = bridgeUint(quote.minAmountOut);
  const requestedAmount = bridgeUint(request.amount), deadline = Date.parse(String(request.deadline));
  const loss = lane.loss === "input_at_par" ? (amountIn > minimum ? amountIn - minimum : 0n) : amountOut - minimum;
  if (amountIn !== requestedAmount || amountIn < bridgeUint(quote.minAmountIn) || minimum > amountOut || minimum < minOutput ||
    loss > maxLoss || deadline - now < 45_000 || deadline - now > QUOTE_WINDOW_MS) fail("quote_amount_or_deadline");
  const responseDeadline = Date.parse(String(quote.deadline));
  if (!Number.isFinite(responseDeadline) || responseDeadline <= now) fail("quote_response_deadline");
  const effectiveDeadline = Math.min(deadline, responseDeadline);
  if (effectiveDeadline - now < 45_000) fail("quote_effective_deadline");
  const deposit = bridgeAddress(quote.depositAddress);
  if (quote.depositMemo !== undefined && quote.depositMemo !== null && quote.depositMemo !== "") fail("deposit_memo");
  if (deposit === ZERO || deposit === lane.origin.token || deposit === bridgeAddress(request.refundTo)) fail("deposit_address");
  return { deposit, amountIn, amountOut, minimum, quoteHash: quoteIdentity(response),
    quoteDeadline: new Date(responseDeadline).toISOString(), effectiveDeadline: new Date(effectiveDeadline).toISOString() };
}
/** Legacy lane IDs keep their original derivation, so an old idempotency key still resolves to its existing operation. */
export function oneClickOperationId(lane: OneClickLane, profileHash: string, idempotencyKey: string): string {
  const domain = lane.id === LEGACY_ONECLICK_LANE ? "oneclick-base-tron" : `oneclick-lane\0${lane.id}`;
  return createHash("sha256").update(`${domain}\0${profileHash}\0${idempotencyKey}`).digest("hex");
}
export interface OneClickSubmitRequest {
  readonly lane: string; readonly profile: string; readonly expectedPayer: string; readonly recipient: string; readonly amountAtomic: string;
  readonly minOutputAtomic: string; readonly maxQuotedLossAtomic: string; readonly maxGasLimitAtomic: string;
  readonly maxFeePerGasWei: string; readonly maxPriorityFeePerGasWei: string; readonly maxNativeDebitWei: string;
  readonly idempotencyKey: string;
}
export class OneClickSourceService {
  constructor(private readonly state: StateStore, private readonly wrapping: WrappingSecretPort,
    private readonly environment: Readonly<Record<string, string | undefined>>) {}
  private journal(): OneClickSourceJournal { return new OneClickSourceJournal(this.state.root); }
  private rpcUrl(name: OneClickLane["origin"]["rpcEnvironment"] | OneClickLane["destination"]["rpcEnvironment"], network: string): string {
    const url = this.environment[name]; if (url === undefined) fail(`${network}_rpc_missing`);
    return url;
  }
  async submit(input: OneClickSubmitRequest): Promise<unknown> {
    const https = new BridgeHttps(), now = Date.now, lane = oneClickLane(input.lane);
    const profile = canonicalProfile(input.profile), payer = bridgeAddress(input.expectedPayer), recipient = oneClickRecipient(lane, input.recipient);
    const amount = bridgeUint(input.amountAtomic, true), minOutput = bridgeUint(input.minOutputAtomic, true);
    const maxLoss = bridgeUint(input.maxQuotedLossAtomic), maxGas = bridgeUint(input.maxGasLimitAtomic, true);
    const maxFee = bridgeUint(input.maxFeePerGasWei, true), maxPriority = bridgeUint(input.maxPriorityFeePerGasWei);
    const maxNative = bridgeUint(input.maxNativeDebitWei, true);
    if (amount > lane.origin.maxAmountAtomic || maxPriority > maxFee || input.idempotencyKey.length < 8 ||
      input.idempotencyKey.length > 128) fail("limits");
    const profileHash = this.state.profileHash(profile), operationId = oneClickOperationId(lane, profileHash, input.idempotencyKey);
    const journal = this.journal();
    if (await journal.load(operationId) !== null) fail("existing_operation_use_status");
    const source = new OneClickEvmSource(lane, this.rpcUrl(lane.origin.rpcEnvironment, lane.origin.network), https);
    const walletStore = new EncryptedWalletStore(this.state, this.wrapping);
    await this.state.initialize();
    // The payer's claim is written before the quote, any RPC read or signature; it is held until the source receipt is final.
    return await admitOperation(this.state, { family: "oneclick_source", profileHash, operationId, idempotencyHash: null, requestHash: null },
      [evmClaim(lane.origin.chainId, payer)], async () => {
    const loaded = await walletStore.describe(profile); if (loaded === null) fail("wallet_missing");
    try {
      if (loaded.identity.profile !== profile || loaded.identity.address !== payer ||
        privateKeyToAccount(loaded.secret.privateKey).address !== payer) fail("wallet_binding");
      const quoteRequest = { dry: true, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: lane.origin.oneClickAsset,
        depositType: "ORIGIN_CHAIN", destinationAsset: lane.destination.oneClickAsset, amount: amount.toString(), refundTo: payer,
        refundType: "ORIGIN_CHAIN", recipient, recipientType: "DESTINATION_CHAIN",
        deadline: new Date(now() + QUOTE_WINDOW_MS).toISOString() };
      const getQuote = async (body: typeof quoteRequest) => {
        const response = await https.request(`${ORIGIN}/v0/quote`, "POST", canonicalJson(body), 1024 * 1024, "APN_HTTP_CONFIG");
        if (response.status !== 201) fail("quote_http");
        try { return JSON.parse(response.body) as unknown; } catch { return fail("quote_json"); }
      };
      const dry = bridgeRecord(await getQuote(quoteRequest));
      const dryQuote = bridgeRecord(dry.quote);
      if (bridgeUint(dryQuote.minAmountOut) < minOutput || bridgeUint(dryQuote.amountIn) !== amount ||
        dryQuote.depositAddress !== undefined) fail("dry_quote");
      const actualRequest = { ...quoteRequest, dry: false };
      const q = inspectOneClickSourceQuote(await getQuote(actualRequest), actualRequest, minOutput, maxLoss, now(), lane);
      const call = oneClickSourceCall(lane, q.deposit, q.amountIn.toString()), deadlineMs = Date.parse(q.effectiveDeadline);
      const caps = { maxGas, maxFee, maxPriority, maxNative };
      const read = async (signed?: Readonly<{ gas: bigint; fee: bigint }>): Promise<OneClickSourcePlan> => {
        if (lane.origin.kind === "erc20") return await source.readToken(payer, call.data, amount, caps, deadlineMs, now, signed);
        const plan = planOneClickNative(await source.observeNative(payer, q.deposit, amount), amount, caps);
        if (now() > deadlineMs - 45_000) fail("block_or_quote_expired");
        return plan;
      };
      const initial = await read();
      // A nonce an earlier operation sealed blocks this one before consent, unless that operation can no longer land.
      const releasedReservation = await this.releasableNonce(journal, lane, profileHash, payer, initial.nonce, source, now());
      let record = await journal.stage({ lane: lane.id, operationId, profileHash, payer, recipient, refundTo: payer,
        depositAddress: q.deposit, ...(initial.depositCode === null ? {} : { depositCode: initial.depositCode }),
        quoteHash: q.quoteHash, quoteRequestDeadline: actualRequest.deadline,
        quoteDeadline: q.quoteDeadline, effectiveDeadline: q.effectiveDeadline,
        amountInAtomic: q.amountIn.toString(), minAmountOutAtomic: q.minimum.toString(),
        quotedAmountOutAtomic: q.amountOut.toString(), sourceBlockHash: initial.blockHash,
        sourceCall: { ...call, nonce: initial.nonce.toString(), gas: initial.gas.toString(),
          maxFeePerGas: initial.fee.toString(), maxPriorityFeePerGas: initial.tip.toString(), maxNativeDebitWei: maxNative.toString() } });
      await new TtyOneClickSourceApproval().approve(record, initial);
      if (lane.origin.kind === "erc20") assertOneClickPostApproval(initial, await read(initial), maxNative, deadlineMs, now());
      else assertOneClickNativePostApproval(initial, await source.observeNative(payer, q.deposit, amount), amount, deadlineMs, now());
      if (now() > deadlineMs - 15_000) fail("quote_expired_before_sign");
      record = await journal.advance(operationId, record.integrityHash, "signing_started");
      const fees = { nonce: Number(initial.nonce), gas: initial.gas, maxFeePerGas: initial.fee, maxPriorityFeePerGas: initial.tip, accessList: [] };
      const account = privateKeyToAccount(loaded.secret.privateKey);
      const raw = lane.origin.kind === "erc20"
        ? await account.signTransaction({ type: "eip1559", chainId: lane.origin.chainId, to: call.to as Hex, data: call.data, value: 0n, ...fees })
        : await account.signTransaction({ type: "eip1559", chainId: lane.origin.chainId, to: call.to as Hex, value: amount, ...fees });
      // Every pre-send check ran before signing; the sealed bytes go to the single send without a check that could strand them.
      record = await journal.advance(operationId, record.integrityHash, "sealed", { rawTransaction: raw, transactionHash: keccak256(raw) }, releasedReservation);
      record = await journal.advance(operationId, record.integrityHash, "submitting", { submissionAttempts: 1 });
      try {
        const returned = await source.send(raw);
        if (returned !== record.transactionHash) fail("send_hash");
        record = await journal.advance(operationId, record.integrityHash, "submitted_pending");
      } catch {
        record = await journal.advance(operationId, record.integrityHash, "unknown_finality");
      }
      const common = { operationId, lane: lane.id, sourceTransactionHash: record.transactionHash, sourceState: record.phase,
        submissionAttempts: 1, oneClickDepositAddress: record.depositAddress, sourceReceiptObserved: false };
      return lane.id === LEGACY_ONECLICK_LANE ? { ...common, tronDestinationDelivered: false } : { ...common, destinationDelivered: false };
    } finally { walletStore.clear(loaded.secret); }
    });
  }
  /**
   * An earlier operation's nonce reservation is released only when it can no longer land: its quote deadline passed and the
   * node does not know its hash (pending or mined). Otherwise this submit refuses before staging, consent or signing.
   */
  private async releasableNonce(journal: OneClickSourceJournal, lane: OneClickLane, profileHash: string, payer: string, nonce: bigint,
    source: OneClickEvmSource, nowMs: number): Promise<string | undefined> {
    const holder = await journal.nonceHolder(lane, profileHash, payer, nonce);
    if (holder === null) return undefined;
    const prior = await journal.load(holder.operationId);
    if (prior === null || Date.parse(prior.effectiveDeadline) > nowMs || await source.transactionKnown(holder.transactionHash)) fail("nonce_reserved");
    return holder.operationId;
  }
  async status(operationId: string): Promise<unknown> {
    const journal = this.journal();
    let record = await journal.load(operationId); if (record === null) fail("missing_operation");
    const lane = oneClickRecordLane(record);
    // A finished operation answers from its journal with no RPC: a source proven never to land, a reverted safe source, or a
    // stored finalized destination.
    if (record.phase === "failed_proven_superseded") return statusView(record, lane, null, { status: null, provenance: "not_queried" }, null);
    if (record.phase === "source_observed" && (record.sourceReceiptStatus === "reverted" || record.destinationStatus !== null)) {
      return statusView(record, lane, { safe: true, transactionHash: record.transactionHash, status: record.sourceReceiptStatus,
        receiptHash: record.sourceReceiptHash, provenance: "apn_journal" }, { status: null, provenance: "apn_journal" }, record.destinationStatus);
    }
    const https = new BridgeHttps();
    const source = new OneClickEvmSource(lane, this.rpcUrl(lane.origin.rpcEnvironment, lane.origin.network), https);
    const sourceReceipt = record.transactionHash === null ? null : await source.observe(record);
    const safe = sourceReceipt as { safe?: unknown; status?: unknown; receiptHash?: unknown } | null;
    if (safe?.safe === true && (safe.status === "success" || safe.status === "reverted") && typeof safe.receiptHash === "string" &&
      ["submitting", "submitted_pending", "unknown_finality"].includes(record.phase)) {
      record = await journal.advance(operationId, record.integrityHash, "source_observed", { sourceReceiptStatus: safe.status, sourceReceiptHash: safe.receiptHash });
    }
    // No receipt at all: once another transaction took the source nonce at finality and the node knows neither this
    // transaction nor a receipt, the deposit can never land and the operation ends. Until then it stays open; a deposit
    // that does land, even after the quote deadline, is observed here as `source_observed`: the deposit address is
    // 1Click's, and its status (a late deposit is refunded to the payer, the refund address) is reported as provider
    // data, while no destination proof is claimed.
    if (sourceReceipt === null && ["sealed", "submitting", "submitted_pending", "unknown_finality"].includes(record.phase)) {
      const finalizedNonceAtomic = await source.unlanded(record);
      if (finalizedNonceAtomic !== null) {
        record = await journal.advance(operationId, record.integrityHash, "failed_proven_superseded", { finalizedNonceAtomic });
        return statusView(record, lane, null, { status: null, provenance: "not_queried" }, null);
      }
    }
    if (record.sourceReceiptStatus === "reverted") return statusView(record, lane, sourceReceipt, { status: null, provenance: "not_queried" }, null);
    // Destination status is obtained from a separate provider read and is never inferred from the source receipt.
    const endpoint = new URL(`${ORIGIN}/v0/status`); endpoint.searchParams.set("depositAddress", record.depositAddress);
    const response = await https.request(endpoint.toString(), "GET", null, 1024 * 1024, "APN_HTTP_CONFIG");
    let providerStatus: unknown = null, body: Record<string, unknown> | null = null;
    if (response.status === 200) {
      try {
        body = bridgeRecord(JSON.parse(response.body));
        if (!oneClickStatusQuoteMatchesRecord(body.quoteResponse, record) || typeof body.status !== "string") fail("status_quote_binding");
        providerStatus = body.status;
      } catch { fail("status_json_or_binding"); }
    }
    // Every lane, the original Base USDC to TRON USDT one included, proves delivery on the destination chain.
    const hashes = body === null ? [] : oneClickDestinationHashes(lane, body);
    const destinationProof = await proveOneClickDestination({ lane, recipient: record.recipient, minimumOutputAtomic: record.minAmountOutAtomic,
      notBeforeMs: Date.parse(record.quoteRequestDeadline) - QUOTE_WINDOW_MS, hashes,
      tron: () => new TronRpc(this.rpcUrl(lane.destination.rpcEnvironment, lane.destination.network)),
      solana: () => new SolanaRpc(this.rpcUrl(lane.destination.rpcEnvironment, lane.destination.network)) });
    if (destinationProof.status === "finalized" && record.phase === "source_observed" && record.sourceReceiptStatus === "success") {
      record = await journal.recordDestination(operationId, record.integrityHash, destinationProof);
    }
    return statusView(record, lane, sourceReceipt, { status: providerStatus, provenance: "oneclick_https_untrusted" }, destinationProof, hashes);
  }
}
/** One status shape for live and journal answers. The legacy lane keeps its original TRON field names as aliases. */
function statusView(record: OneClickSourceRecord, lane: OneClickLane, sourceReceipt: unknown,
  provider: Readonly<{ status: unknown; provenance: "oneclick_https_untrusted" | "apn_journal" | "not_queried" }>,
  destinationProof: OneClickDestinationProof | null, hashes: readonly string[] = destinationProof?.transactions.map((row) => row.id) ?? []) {
  const destinationClaimed = provider.status === "SUCCESS", destinationFinalized = destinationProof?.status === "finalized";
  return { operationId: record.operationId, lane: lane.id, sourceTransactionHash: record.transactionHash, sourceState: record.phase,
    sourceReceipt, sourceNeverLands: record.finalizedNonceAtomic === undefined ? null
      : { proof: "finalized_nonce_past_without_transaction_or_receipt", sourceNonce: record.sourceCall.nonce, finalizedNonceAtomic: record.finalizedNonceAtomic },
    oneClickProviderStatus: provider.status, providerStatusProvenance: provider.provenance,
    destinationClaimed, providerDestinationTransactions: hashes, destinationProof, destinationFinalized,
    ...(lane.id === LEGACY_ONECLICK_LANE ? { tronDestinationClaimed: destinationClaimed, tronDestinationFinalized: destinationFinalized } : {}) };
}
/** Foreground-only consent with a six-character code bound to the exact staged record. */
export class TtyOneClickSourceApproval {
  async approve(record: OneClickSourceRecord, plan: OneClickSourcePlan): Promise<void> {
    const lane = oneClickRecordLane(record), o = lane.origin, d = lane.destination;
    await exactChainConsent([
      `Agent Payment Node 1Click lane ${lane.id}`,
      `${o.network} ${o.asset} (${o.decimals} decimals) to ${d.network} ${d.asset} (${d.decimals} decimals)`,
      `Operation: ${record.operationId}`,
      `Payer and refund address: ${record.payer}`,
      `Recipient: ${record.recipient}`,
      `Deposit address: ${record.depositAddress}${record.depositCode === undefined ? "" : ` (${record.depositCode})`}`,
      `Amount: ${record.amountInAtomic} atomic ${o.asset}`,
      `Quoted output: ${record.quotedAmountOutAtomic} atomic ${d.asset}; minimum output: ${record.minAmountOutAtomic} atomic ${d.asset}`,
      `Nonce: ${record.sourceCall.nonce}; gas limit: ${record.sourceCall.gas}`,
      `Max fee per gas: ${record.sourceCall.maxFeePerGas} wei; max priority fee per gas: ${record.sourceCall.maxPriorityFeePerGas} wei`,
      `Planned ${o.network} debit (${o.kind === "native" ? "value plus gas times max fee" : "gas times max fee plus L1 and operator bounds"}): ${plan.nativeDebit} wei`,
      `Owner maximum ${o.network} debit: ${record.sourceCall.maxNativeDebitWei} wei`,
      `Quote hash: ${record.quoteHash}`,
      `Effective deposit deadline: ${record.effectiveDeadline}`,
      "Exactly one signed source transaction may be sent. An unknown result is never resent.",
      "Source success does not prove destination delivery; status verifies the destination chain separately.",
    ], approvalCode("bridge", record.operationId, record.integrityHash),
    new Date(Date.parse(record.effectiveDeadline) - 30_000).toISOString(), {});
  }
}
