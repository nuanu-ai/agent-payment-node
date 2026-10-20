import { randomBytes } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { canonicalJson, domainHash, sha256 } from "../canonical.js";
import { EncryptedWalletStore, walletEnvelopeIdentity } from "../encrypted-wallet-store.js";
import { ApnError } from "../errors.js";
import type { WrappingSecretPort } from "../macos-keychain.js";
import type { Address } from "../model.js";
import { conflictDomainKey, evmConflictDomain } from "../operation-conflict-domain.js";
import { admitOperation } from "../operation-index/admission.js";
import { StateStore } from "../state.js";
import { canonicalProfile } from "../wallet-policy.js";
import { x402ProofTag } from "../x402-network.js";
import { observeRevoke, readRevokePrepare, revokeData, sendRefusedBeforeTransport, verifyRevokeRaw, type WalletAllowanceRpc } from "./chain.js";
import { newWalletAllowanceRevoke, SEND_REFUSED_BEFORE_TRANSPORT, transitionWalletAllowanceRevoke, WALLET_ALLOWANCE_REVOKE_FAMILY,
  WALLET_ALLOWANCE_REVOKE_JOURNAL_MAX, walletAllowanceSlot, type WalletAllowanceRevokeRecord } from "./model.js";
import { WalletAllowanceRevokeRepository } from "./repository.js";
import { walletAllowanceResendCommand } from "./view.js";

export interface WalletAllowanceRevokeRequest {
  readonly profile: string; readonly chainId: number; readonly token: Address; readonly spender: Address;
  readonly maxGasLimit: string; readonly maxFeePerGasWei: string; readonly maxPriorityFeePerGasWei: string;
}
export interface WalletAllowanceRevokePorts {
  readonly rpc: WalletAllowanceRpc;
  /** The chain's own `APN_<CHAIN>_RPC_URL` setting the endpoint came from (frozen in the record). */
  readonly rpcSetting: string;
  readonly wrapping: WrappingSecretPort;
  /** The owner's foreground decision on the exact frozen revoke; throws when refused. */
  readonly consent: (record: WalletAllowanceRevokeRecord) => Promise<void>;
  readonly now: () => Date;
}
const CONSENT_WINDOW_MS = 240_000;

/**
 * `wallet allowance revoke`: one owner-approved `approve(spender, 0)` from the profile's local wallet, sent once and
 * observed to its proof. Revoking only removes a permission, so no asset admission applies; the profile, chain, token and
 * spender name one slot, and a repeat of the command continues that slot's open revoke instead of starting another.
 */
export class WalletAllowanceRevokeService {
  readonly records: WalletAllowanceRevokeRepository;
  private readonly state: StateStore;
  constructor(root: string, private readonly ports: WalletAllowanceRevokePorts) {
    this.records = new WalletAllowanceRevokeRepository(root); this.state = new StateStore(root);
  }
  private now(): Date { return new Date(Math.floor(this.ports.now().getTime() / 1000) * 1000); }
  private async write(id: string, check: (current: WalletAllowanceRevokeRecord) => boolean,
    next: (current: WalletAllowanceRevokeRecord) => Parameters<typeof transitionWalletAllowanceRevoke>[1]) {
    return await this.records.withLocks([`operation:${id}`], async () => {
      const current = await this.records.required(id);
      if (!check(current)) throw new ApnError("APN_OPERATION_BLOCKED", "The allowance revoke operation changed meanwhile.");
      return await this.records.persistLocked(transitionWalletAllowanceRevoke(current, next(current)));
    });
  }

  /** The slot's open revoke, or a new frozen one after the allowance read (refused when it is already zero); nothing is signed. */
  async prepare(request: WalletAllowanceRevokeRequest): Promise<WalletAllowanceRevokeRecord> {
    const profile = canonicalProfile(request.profile), profileHash = this.state.profileHash(profile);
    const owner = await localWalletAddress(this.state, profile), slot = walletAllowanceSlot({ profileHash, terms: { chainId: request.chainId, token: request.token, spender: request.spender } });
    const requestHash = domainHash("apn.wallet-allowance-revoke.request.v1", canonicalJson({ profileHash, chainId: request.chainId, token: request.token,
      spender: request.spender, maxGasLimit: request.maxGasLimit, maxFeePerGasWei: request.maxFeePerGasWei, maxPriorityFeePerGasWei: request.maxPriorityFeePerGasWei }));
    await this.records.ready();
    const open = await this.openRevoke(slot, requestHash);
    // Each revoke of a slot is a new operation (a later one follows a terminal one); the slot, not the ID, finds an open one.
    const preparedAt = this.now(), operationId = domainHash("apn.wallet-allowance-revoke.operation-id.v1", canonicalJson({ slot,
      preparedAt: preparedAt.toISOString(), unique: randomBytes(16).toString("hex") }));
    const idempotencyHash = sha256(`idempotency\0wallet-allowance-revoke.v1\0${operationId}`);
    return open ?? await this.records.withLocks([`profile:${profileHash}`, `operation:${operationId}`], async () => {
      const raced = await this.openRevoke(slot, requestHash);
      if (raced !== null) return raced;
      return await admitOperation(this.records, { family: WALLET_ALLOWANCE_REVOKE_FAMILY, profileHash, operationId, idempotencyHash, requestHash },
        [{ key: conflictDomainKey(evmConflictDomain(request.chainId, owner)) }], async () => {
          const read = await readRevokePrepare(this.ports.rpc, { chainId: request.chainId, owner, token: request.token, spender: request.spender });
          if (read.allowanceAtomic === "0") refuse("wallet_allowance_nothing_to_revoke", `The allowance of ${request.token} to ${request.spender} is already zero; nothing to revoke.`);
          const gas = BigInt(request.maxGasLimit), maxFee = BigInt(request.maxFeePerGasWei), priority = BigInt(request.maxPriorityFeePerGasWei);
          if (priority > maxFee) refuse("wallet_allowance_fee_order", "The priority fee cap exceeds the fee cap.");
          if (read.gasEstimate > gas) refuse("wallet_allowance_gas_cap", `The revoke needs ${read.gasEstimate} gas, above the owner's ${gas}.`);
          if (read.baseFeeWei + priority > maxFee) refuse("wallet_allowance_fee_cap", `The base fee ${read.baseFeeWei} wei plus priority exceeds the owner's fee cap.`);
          if (read.nativeBalanceWei < gas * maxFee) refuse("wallet_allowance_native_balance", "The wallet's native balance cannot cover the owner's gas cap.");
          return await this.records.persistLocked(newWalletAllowanceRevoke({ operationId, profile, profileHash, idempotencyHash, requestHash,
            terms: { chainId: request.chainId, proofTag: x402ProofTag(request.chainId), rpcSetting: this.ports.rpcSetting, token: request.token, owner,
              spender: request.spender, priorAllowanceAtomic: read.allowanceAtomic, nonce: read.nonce, gasLimit: gas.toString(), maxFeePerGasWei: maxFee.toString(),
              maxPriorityFeePerGasWei: priority.toString(), maxNativeDebitWei: (gas * maxFee).toString(), era: read.era, preparedAt: preparedAt.toISOString(),
              expiresAt: new Date(preparedAt.getTime() + CONSENT_WINDOW_MS).toISOString() } }));
        });
    });
  }

  /** Consent, seal, mark and send once; a repeat continues where the record stands and never sends twice. */
  async execute(start: WalletAllowanceRevokeRecord): Promise<WalletAllowanceRevokeRecord> {
    let record = start;
    if (record.state === "prepared") {
      await this.ports.consent(record);
      const raw = await this.sign(record), transactionHash = await verifyRevokeRaw(record.terms, raw);
      record = await this.write(record.operationId, (current) => current.state === "prepared" && this.now().getTime() < Date.parse(current.terms.expiresAt),
        () => ({ state: "signed", at: this.now().toISOString(), reason: "owner_approved_and_sealed", signed: { rawTransaction: raw, transactionHash } }));
    }
    if (record.state === "submitted") return await this.observe(record.operationId);
    if (record.state !== "signed") return record;
    // A refusal met before transport (this command's POST cap, the provider's cooldown) is read first: the record stays signed.
    try { await this.ports.rpc.checkSend(); } catch (error) { throw error instanceof ApnError ? resendLater(error, record) : error; }
    // A send started again after a refused one keeps the first start's submittedAt (written once).
    record = await this.write(record.operationId, (current) => current.state === "signed", (current) => ({ state: "submitted",
      at: this.now().toISOString(), reason: "single_send_started", ...(current.submittedAt === null ? { submittedAt: this.now().toISOString() } : {}) }));
    const submitted = record;
    try {
      if (await this.ports.rpc.send(record.signed!.rawTransaction as Hex) !== record.signed!.transactionHash) {
        throw new ApnError("APN_RPC_AMBIGUOUS", "The RPC returned another transaction hash.");
      }
    } catch (error) {
      if (!(error instanceof ApnError)) throw error;
      // Refused before the bytes reached the node: back to signed while a restart and an exit still fit the journal, and the
      // same command sends these same bytes later. Anything else may have reached the network: it stays submitted.
      if (sendRefusedBeforeTransport(error) && submitted.journal.length + 3 <= WALLET_ALLOWANCE_REVOKE_JOURNAL_MAX) {
        const back = await this.write(record.operationId, (current) => current.integrityHash === submitted.integrityHash,
          () => ({ state: "signed", at: this.now().toISOString(), reason: SEND_REFUSED_BEFORE_TRANSPORT }));
        throw resendLater(error, back);
      }
    }
    return record;
  }

  /** One bounded observation: a receipt at the proof tag, the chain's never-lands proof, or an expired unsigned preparation. */
  async observe(operationId: string): Promise<WalletAllowanceRevokeRecord> {
    const record = await this.records.required(operationId);
    return await observeWalletAllowanceRevoke(this.records, this.ports.rpc, record, () => this.now());
  }

  /** The slot's open revoke: an unsigned one past its window closes first; one with other gas caps is refused. */
  private async openRevoke(slot: string, requestHash: string): Promise<WalletAllowanceRevokeRecord | null> {
    let open = await this.records.open(slot);
    if (open?.state === "prepared" && this.now().getTime() >= Date.parse(open.terms.expiresAt)) {
      open = await this.observe(open.operationId);
      if (open.terminal) return null;
    }
    if (open !== null && open.requestHash !== requestHash) {
      throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "An open revoke of this allowance carries other gas caps; finish it first.",
        { reason: "wallet_allowance_revoke_open", operationId: open.operationId, nextActions: [`apn operation status --operation ${open.operationId}`] });
    }
    return open;
  }

  private async sign(record: WalletAllowanceRevokeRecord): Promise<Hex> {
    const wallets = new EncryptedWalletStore(this.state, this.ports.wrapping), wallet = await wallets.describe(record.profile);
    if (wallet === null) throw new ApnError("APN_OPERATION_BLOCKED", "The encrypted local wallet is missing.", { reason: "wallet_allowance_local_wallet_required" });
    try {
      const account = privateKeyToAccount(wallet.secret.privateKey), t = record.terms;
      if (wallet.identity.profile !== record.profile || account.address !== t.owner) throw new ApnError("APN_WALLET_MISMATCH", "The local wallet is not the frozen owner.");
      return await account.signTransaction({ type: "eip1559", chainId: t.chainId, to: t.token as Address, data: revokeData(t.spender as Address), value: 0n,
        nonce: Number(t.nonce), gas: BigInt(t.gasLimit), maxFeePerGas: BigInt(t.maxFeePerGasWei), maxPriorityFeePerGas: BigInt(t.maxPriorityFeePerGasWei), accessList: [] });
    } finally { wallets.clear(wallet.secret); }
  }
}

/** The observation shared by the command and `apn operation status`; it never signs or sends. */
export async function observeWalletAllowanceRevoke(records: WalletAllowanceRevokeRepository, rpc: Pick<WalletAllowanceRpc, "batch">,
  record: WalletAllowanceRevokeRecord, now: () => Date): Promise<WalletAllowanceRevokeRecord> {
  if (record.terminal) return record;
  const write = async (next: Parameters<typeof transitionWalletAllowanceRevoke>[1]) => await records.withLocks([`operation:${record.operationId}`], async () => {
    const current = await records.required(record.operationId);
    if (current.integrityHash !== record.integrityHash) throw new ApnError("APN_OPERATION_BLOCKED", "The allowance revoke operation changed meanwhile.");
    return await records.persistLocked(transitionWalletAllowanceRevoke(current, next));
  });
  const at = now().toISOString();
  if (record.state === "prepared") {
    if (now().getTime() < Date.parse(record.terms.expiresAt)) return record;
    return await write({ state: "failed_before_effect", at, reason: "consent_window_expired_unsigned" });
  }
  const seen = await observeRevoke(rpc, record, now());
  if (seen.kind === "pending") return record;
  if (seen.kind === "never_lands") return await write({ state: "superseded", at, reason: "finalized_nonce_spent_elsewhere",
    outcome: { kind: "never_lands", finalizedNonce: seen.finalizedNonce, observedAt: at } });
  // A send the RPC refused before transport (back to signed) could only have landed if the provider forwarded it anyway.
  if (record.state === "signed" && record.submittedAt === null) throw new ApnError("APN_STATE_CORRUPT", "A sealed revoke that was never sent has a receipt.");
  return await write({ state: seen.outcome.status === "success" ? "completed" : "reverted", at,
    reason: seen.outcome.status === "success" ? "receipt_at_proof_tag" : "reverted_at_proof_tag", outcome: seen.outcome });
}

/** The owner's exit (TTY consent by the caller) for a sealed or sent revoke no proof decides; it may still land. */
export async function abandonWalletAllowanceRevoke(root: string, operationId: string, now: () => Date,
  approve: (record: WalletAllowanceRevokeRecord) => Promise<void>): Promise<WalletAllowanceRevokeRecord> {
  const records = new WalletAllowanceRevokeRepository(root), record = await records.required(operationId);
  if (record.terminal) return record;
  if (record.state === "prepared") throw new ApnError("APN_OPERATION_BLOCKED", "An unsigned revoke ends by itself once its window passes.",
    { reason: "wallet_allowance_revoke_unsigned", nextActions: [`apn operation status --operation ${operationId}`] });
  await approve(record);
  return await records.withLocks([`operation:${operationId}`], async () => {
    const current = await records.required(operationId);
    if (current.integrityHash !== record.integrityHash) throw new ApnError("APN_OPERATION_BLOCKED", "The allowance revoke operation changed meanwhile.");
    return await records.persistLocked(transitionWalletAllowanceRevoke(current, { state: "abandoned_unknown", at: now().toISOString(), reason: "owner_abandoned_unknown" }));
  });
}

/** The public address of the profile's encrypted local wallet (the key that signs), read without decrypting it. */
export async function localWalletAddress(state: StateStore, profile: string): Promise<Address> {
  const envelope = await state.loadEncryptedWalletEnvelope(profile);
  if (envelope === null) throw new ApnError("APN_OPERATION_BLOCKED", "The profile has no local EVM wallet.", { reason: "wallet_allowance_local_wallet_required" });
  return walletEnvelopeIdentity(envelope, profile).address;
}
function refuse(reason: string, message: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
/** A send refused before transport, naming the same revoke command that sends the same sealed bytes once it clears. */
function resendLater(error: ApnError, record: WalletAllowanceRevokeRecord): ApnError {
  return new ApnError(error.code, error.message, { ...error.details, operationId: record.operationId, state: record.state,
    nextActions: [walletAllowanceResendCommand(record)] });
}
