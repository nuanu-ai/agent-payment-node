import { canonicalJson, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { StateStore } from "../state.js";
import { Permit2ProductionRepository } from "./production-repository.js";
import { permit2ProductionOperationDigest } from "./production-signed.js";
import { Permit2ObserverRpc, type Permit2ObservationMetrics } from "./production-observer-rpc.js";
import { assertObserverChain, observerBlock } from "./production-observer-facts.js";
import { signingCalls, assertSigningReads, assertSigningTime } from "./production-signing-facts.js";
import { permit2SavedIdentity, signingOwnerFence, type Permit2MetadataMode, type Permit2SavedIdentity, type Permit2SigningMode } from "./production-signing-owner.js";
import { Permit2MetadataLockOwner, type Permit2MetadataLockScope } from "./production-signing-scope.js";
export type { Permit2MetadataLockScope } from "./production-signing-scope.js";
export type { Permit2SigningMode } from "./production-signing-owner.js";

export interface Permit2SigningProjection {
  readonly operationId: string; readonly mode: Permit2SigningMode;
  readonly outcome: "checked" | "hold";
  readonly operationDigest: string | null; readonly recordHash: string | null;
  readonly materialHash: string | null; readonly walletHash: string | null;
  readonly requestHash: string | null; readonly challengeHash: string | null;
  readonly originalLeaseDigest: string | null; readonly currentLeaseDigest: string | null;
  readonly capturedAt: string | null; readonly blockNumber: string | null; readonly blockHash: string | null;
  readonly rpc: Permit2ObservationMetrics;
}
/** A checked observation: what the chain and the saved operation held at `capturedAt`. A plain value; consuming it
 * re-reads the saved record, lease and wallet binding and requires them unchanged and the observation under 5 s old. */
export type Permit2SigningFact = Permit2SigningProjection & { readonly outcome: "checked"; readonly recordHash: string;
  readonly currentLeaseDigest: string; readonly walletHash: string; readonly capturedAt: string };
export const PERMIT2_SIGNING_FACT_MAX_AGE_MS = 5_000;
type OwnedSigningContext = Awaited<ReturnType<typeof signingOwnerFence>>;
/** Actual read-only observation only. Never human approval, custody permission, or transport authority. */
export class Permit2ProductionSigningFence {
  readonly #state: StateStore;
  readonly #records: Permit2ProductionRepository;
  readonly #scopes: Permit2MetadataLockOwner;
  readonly #endpoint: string;
  readonly #clock: () => Date;
  constructor(root: string, endpoint: string, clock: () => Date = () => new Date()) {
    if (typeof root !== "string" || typeof endpoint !== "string") invalid();
    this.#endpoint = endpoint; this.#clock = clock;
    this.#state = new StateStore(root); this.#records = new Permit2ProductionRepository(root);
    this.#scopes = new Permit2MetadataLockOwner(this.#state, this.#records);
  }
  get root(): string { return this.#state.root; }
  #now = (): Date => {
    const now = this.#clock(); if (!(now instanceof Date) || !Number.isSafeInteger(now.getTime()) || now.getTime() < 0) invalid();
    return new Date(now.getTime());
  };
  async check(operationId: string, mode: Permit2SigningMode): Promise<{ readonly projection: Permit2SigningProjection; readonly fact: Permit2SigningFact | null }> {
    return this.#runCheck(operationId, mode);
  }
  /** Holds the operation's metadata locks around `action`; the scope grants no key, signing or transport. */
  async withScope<T>(operationId: string, mode: Permit2MetadataMode, action: (scope: Permit2MetadataLockScope) => Promise<T>): Promise<T> {
    const id = operationId, selected = mode; identity(id, selected, true);
    return this.#scopes.within(id, selected, this.#now, action);
  }
  async checkScoped(scope: Permit2MetadataLockScope, operationId: string, mode: Permit2SigningMode) {
    const id = operationId, selected = mode; identity(id, selected); this.#scopes.assert(scope, id, selected);
    return this.#runCheck(id, selected, scope);
  }
  /** The saved operation and lease, re-read under the held scope, optionally required to equal `expected`. */
  async scopeOwner(scope: Permit2MetadataLockScope, operationId: string, mode: Permit2MetadataMode, expected?: Permit2SavedIdentity) {
    const id = operationId, selected = mode; identity(id, selected, true);
    const owned = await this.#scopes.owner(scope, id, selected, this.#now, expected);
    this.#scopes.assert(scope, id, selected); freeze(owned); return owned;
  }
  /** Owner identity, policy, caps and the signing window at `at`, against what the held scope last read. */
  assertScopeTime(scope: Permit2MetadataLockScope, operationId: string, mode: Permit2MetadataMode, at: Date): void {
    identity(operationId, mode, true); this.#scopes.assertTime(scope, operationId, mode, at);
  }
  async #runCheck(operationId: string, mode: Permit2SigningMode, scope?: Permit2MetadataLockScope): Promise<{ readonly projection: Permit2SigningProjection; readonly fact: Permit2SigningFact | null }> {
    const id = operationId, selected = mode; identity(id, selected);
    const rpc = new Permit2ObserverRpc(this.#endpoint, this.#state);
    const unbind = scope === undefined ? () => {} : this.#scopes.onExit(scope, id, selected, () => rpc.close());
    let onAbort: (() => void) | undefined;
    try {
      const pipeline = (async () => {
        const context = await this.#owner(id, selected, scope);
        open(rpc.signal); freeze(context);
        // Two POSTs: chain id with the finalized header, then one batch pinned by EIP-1898 to that canonical block, so no
        // header recheck follows it (was four POSTs with a chain/header recheck and re-downloaded immutable code).
        const first = await rpc.batch([{ method: "eth_chainId", params: [] }, { method: "eth_getBlockByNumber", params: ["finalized", false] }]);
        assertObserverChain(first[0]); const block = observerBlock(first[1], "finalized");
        assertSigningTime(context.record, this.#now(), block);
        assertSigningReads(context.record, await rpc.batch(signingCalls(context.record, block)));
        await this.#owner(id, selected, scope, permit2SavedIdentity(context.record, context.lease));
        open(rpc.signal); const captured = this.#now(); assertSigningTime(context.record, captured, block);
        return { context, block, captured };
      })();
      const checked = await Promise.race([pipeline, new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new ApnError("APN_RPC_AMBIGUOUS", "Permit2 signing fence reached its shared deadline."));
        rpc.signal.addEventListener("abort", onAbort, { once: true }); if (rpc.signal.aborted) onAbort();
      })]);
      open(rpc.signal); if (scope !== undefined) this.#scopes.assert(scope, id, selected);
      const { record, lease } = checked.context;
      const projection: Permit2SigningProjection = Object.freeze({ operationId: id, mode: selected, outcome: "checked",
        operationDigest: permit2ProductionOperationDigest(record), recordHash: record.integrityHash, materialHash: record.material.materialHash,
        walletHash: sha256(canonicalJson(record.material.wallet)), requestHash: record.material.checked.requestHash,
        challengeHash: record.material.checked.challengeHash, originalLeaseDigest: record.usageReservationDigest,
        currentLeaseDigest: lease.reservationDigest, capturedAt: checked.captured.toISOString(), blockNumber: checked.block.number,
        blockHash: checked.block.hash, rpc: rpc.metrics() });
      return Object.freeze({ projection, fact: projection as Permit2SigningFact });
    } catch {
      return Object.freeze({ projection: Object.freeze({ operationId: id, mode: selected, outcome: "hold", operationDigest: null,
        recordHash: null, materialHash: null, walletHash: null, requestHash: null, challengeHash: null, originalLeaseDigest: null,
        currentLeaseDigest: null, capturedAt: null, blockNumber: null, blockHash: null, rpc: rpc.metrics() }), fact: null });
    } finally { if (onAbort !== undefined) rpc.signal.removeEventListener("abort", onAbort); unbind(); rpc.close(); }
  }
  /** Re-checks a fact: the saved record, lease and wallet binding are unchanged and the observation is under 5 s old. */
  async consume(fact: Permit2SigningFact, operationId: string, mode: Permit2SigningMode): Promise<Permit2SigningFact> {
    return this.#confirm(fact, operationId, mode);
  }
  async consumeScoped(scope: Permit2MetadataLockScope, fact: Permit2SigningFact, operationId: string, mode: Permit2SigningMode): Promise<Permit2SigningFact> {
    const id = operationId, selected = mode; identity(id, selected); this.#scopes.assert(scope, id, selected);
    return this.#confirm(fact, id, selected, scope);
  }
  async #confirm(fact: Permit2SigningFact, operationId: string, mode: Permit2SigningMode, scope?: Permit2MetadataLockScope): Promise<Permit2SigningFact> {
    const id = operationId, selected = mode; identity(id, selected);
    if (!isFact(fact) || fact.operationId !== id || fact.mode !== selected) invalid();
    const assertAge = () => {
      const now = this.#now().getTime(), at = Date.parse(fact.capturedAt);
      if (!Number.isSafeInteger(at) || now < at || now - at > PERMIT2_SIGNING_FACT_MAX_AGE_MS) invalid();
    };
    assertAge();
    const owned = await this.#owner(id, selected, scope, { recordHash: fact.recordHash, leaseDigest: fact.currentLeaseDigest, walletHash: fact.walletHash });
    if (scope !== undefined) this.#scopes.assert(scope, id, selected);
    assertAge(); assertSigningTime(owned.record, this.#now()); return fact;
  }
  async #owner(id: string, mode: Permit2SigningMode, scope?: Permit2MetadataLockScope, expected?: Permit2SavedIdentity): Promise<OwnedSigningContext> {
    return scope === undefined ? signingOwnerFence(this.#state, this.#records, id, mode, this.#now, expected) :
      this.#scopes.owner(scope, id, mode, this.#now, expected);
  }
}
function isFact(value: unknown): value is Permit2SigningFact {
  const fact = value as Partial<Permit2SigningFact> | null;
  return typeof fact === "object" && fact !== null && fact.outcome === "checked" && typeof fact.capturedAt === "string" &&
    typeof fact.recordHash === "string" && typeof fact.currentLeaseDigest === "string" && typeof fact.walletHash === "string";
}
function identity(id: string, mode: Permit2MetadataMode, dispatch = false): void {
  if (typeof id !== "string" || !/^[a-f0-9]{64}$/u.test(id) || !(["reserved", "exposed", ...(dispatch ? ["dispatch"] : [])]).includes(mode)) invalid();
}
function open(signal: AbortSignal): void { if (signal.aborted) invalid(); }
function freeze(value: unknown): void { if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } }
function invalid(): never { throw new ApnError("APN_OPERATION_BLOCKED", "Permit2 signing fact is not current or bound to the owned operation."); }
