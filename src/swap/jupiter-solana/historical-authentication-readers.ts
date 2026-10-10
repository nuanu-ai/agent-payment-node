import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { ChainAccountStore } from "../../chain-account-store.js";
import type { WrappingSecretPort } from "../../macos-keychain.js";
import { ApnError } from "../../errors.js";
import { StateStore } from "../../state.js";
import { isCode, stateIdentifier, validateDirectory } from "../../secure-state-store.js";
import { JupiterV1ExecutionBindingStore, type JupiterV1ExecutionBinding, type JupiterV1SendClaim, type JupiterV1SignedMarker } from "./v1-effects.js";
import { canonicalJson, hashObject, sha256 } from "../../canonical.js";
import type { SwapOperationRecord } from "../model.js";
import { HISTORICAL_JUPITER_IDS, HISTORICAL_JUPITER_EA25_SIGNED_MARKER_SHA256 } from "./historical-pins.js";
import { SavedJupiterV1MaterialStore } from "./v1-material.js";

export function historicalAuthenticationRefused(): never {
  throw new ApnError("APN_OPERATION_BLOCKED", "Historical Jupiter material authentication is unavailable.");
}
export async function existingHistoricalRoot(root: string): Promise<void> {
  try { validateDirectory(await lstat(root), true); if (await realpath(root) !== root) historicalAuthenticationRefused(); }
  catch { historicalAuthenticationRefused(); }
}
const BASE_DIRECTORIES = Object.freeze(["profiles", "wallets", "policies", "provider-authorizations", "operations", "receipts", "x402-operations", "x402-results", "x402-receipts", "rpc-provider-pacing", "locks"]);
const MATERIAL_DIRECTORIES = Object.freeze([...BASE_DIRECTORIES, "jupiter-v1-quotes", "jupiter-v1-quotes/chunks"]);
const BINDING_DIRECTORIES = Object.freeze([...BASE_DIRECTORIES, "jupiter-v1-bindings", "jupiter-v1-claims", "jupiter-v1-prepared", "jupiter-v1-fresh", "jupiter-v1-signatures"]);
const CUSTODY_DIRECTORIES = Object.freeze([...BASE_DIRECTORIES, "chain-accounts", "chain-wallets"]);
/** Pure existing-directory checks. A shared guard pins identities across all finite readers and locks. */
export class HistoricalDirectoryGuard {
  readonly #identities = new Map<string, { readonly dev: number; readonly ino: number }>();
  readonly #signedMarkers = new Map<string, string>();
  constructor(readonly root: string) {}
  async #directory(path: string): Promise<void> {
    const before = await lstat(path); validateDirectory(before, path === this.root);
    if (await realpath(path) !== path) historicalAuthenticationRefused();
    const after = await lstat(path); validateDirectory(after, path === this.root);
    if (before.dev !== after.dev || before.ino !== after.ino) historicalAuthenticationRefused();
    const original = this.#identities.get(path);
    if (original !== undefined && (original.dev !== after.dev || original.ino !== after.ino)) historicalAuthenticationRefused();
    this.#identities.set(path, {dev:after.dev, ino:after.ino});
  }
  /** Read and retain the finite public marker leaf identity across the entire authentication session. */
  async signedMarkerSnapshot(op: Pick<SwapOperationRecord, "operationId" | "ownerProfileHash">, marker: JupiterV1SignedMarker): Promise<string> {
    if (!HISTORICAL_JUPITER_IDS.some(id => id === op.operationId)) historicalAuthenticationRefused();
    stateIdentifier(op.ownerProfileHash, "Jupiter profile");
    const directory = `jupiter-v1-signatures/${op.ownerProfileHash}`, path = resolve(this.root, directory, `${op.operationId}.json`);
    await this.check([directory]);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let snapshotHash: string;
    try {
      const opened = await handle.stat({bigint:true}), before = await lstat(path, {bigint:true});
      const valid = (v: typeof opened) => v.isFile() && !v.isSymbolicLink() && v.uid === BigInt(process.geteuid?.() ?? -1)
        && (v.mode & 0o777n) === 0o600n && v.nlink === 1n && v.size > 0n && v.size <= 1024n;
      const facts = (v: typeof opened) => ({dev:String(v.dev), ino:String(v.ino), uid:String(v.uid), mode:String(v.mode), nlink:String(v.nlink),
        size:String(v.size), mtimeNs:String(v.mtimeNs), ctimeNs:String(v.ctimeNs)});
      if (!valid(opened) || !valid(before) || canonicalJson(facts(opened)) !== canonicalJson(facts(before))) historicalAuthenticationRefused();
      const bytes = await handle.readFile();
      await this.check([directory]);
      const after = await lstat(path, {bigint:true}), canonical = canonicalJson(marker), text = bytes.toString("utf8");
      if (!valid(after) || canonicalJson(facts(opened)) !== canonicalJson(facts(after)) || (text !== canonical && text !== `${canonical}\n`)) historicalAuthenticationRefused();
      snapshotHash = hashObject({root:this.root, path, leaf:facts(after)});
      const original = this.#signedMarkers.get(path);
      if (original !== undefined && original !== snapshotHash) historicalAuthenticationRefused();
      this.#signedMarkers.set(path, snapshotHash);
    } finally {await handle.close();}
    await this.check([directory]);
    return snapshotHash;
  }
  async check(directories: readonly string[] = []): Promise<void> {
    try {
      await this.#directory(this.root);
      for (const relative of directories) {
        const target = resolve(this.root, relative);
        if (!target.startsWith(`${this.root}${sep}`)) historicalAuthenticationRefused();
        let current = this.root;
        for (const part of target.slice(this.root.length + 1).split(sep)) { current = resolve(current, part); await this.#directory(current); }
      }
      await this.#directory(this.root);
    } catch { historicalAuthenticationRefused(); }
  }
}
export class HistoricalReadState extends StateStore {
  readonly #guard: HistoricalDirectoryGuard;
  constructor(root: string, guard = new HistoricalDirectoryGuard(root)) { super(root); if (guard.root !== root) historicalAuthenticationRefused(); this.#guard = guard; }
  directoryGuard(): HistoricalDirectoryGuard { return this.#guard; }
  override async initialize(): Promise<void> { await this.#guard.check(BASE_DIRECTORIES); }
  protected override async ensureDirectory(path: string): Promise<void> { await this.#guard.check([path]); }
  protected override async readJson(path: string): Promise<unknown | null> {
    const parent = dirname(path), dirs = parent === "." ? [] : [parent];
    await this.#guard.check(dirs); const value = await super.readJson(path); await this.#guard.check(dirs); return value;
  }
  protected override async readDirectory(path: string): Promise<readonly import("node:fs").Dirent[]> {
    await this.#guard.check([path]); const value = await super.readDirectory(path); await this.#guard.check([path]); return value;
  }
  protected override async writeJson(): Promise<void> { historicalAuthenticationRefused(); }
  protected override async beforeLockAcquire(): Promise<void> { await this.#guard.check(["locks"]); }
  override async withLocks<T>(keys: readonly string[], action: () => Promise<T>, options: {readonly waitMs?:number} = {}): Promise<T> {
    await this.#guard.check(["locks"]);
    return await super.withLocks(keys, async () => { await this.#guard.check(["locks"]); try { return await action(); } finally { await this.#guard.check(["locks"]); } }, options);
  }
}
export class HistoricalMaterialReader extends SavedJupiterV1MaterialStore {
  readonly #guard: HistoricalDirectoryGuard;
  constructor(root: string, guard = new HistoricalDirectoryGuard(root)) { super(root); if (guard.root !== root) historicalAuthenticationRefused(); this.#guard=guard; }
  override async initialize(): Promise<void> { await this.#guard.check(MATERIAL_DIRECTORIES); }
  protected override async initializeStorage(): Promise<void> { await this.#guard.check(MATERIAL_DIRECTORIES); }
  protected override async ensureDirectory(path: string): Promise<void> { await this.#guard.check([path]); }
  protected override async readJson(path: string): Promise<unknown | null> {
    const parent = dirname(path), dirs = parent === "." ? [] : [parent];
    await this.#guard.check(dirs); const value = await super.readJson(path); await this.#guard.check(dirs); return value;
  }
  protected override async readDirectory(path: string): Promise<readonly import("node:fs").Dirent[]> {
    await this.#guard.check([path]); const value = await super.readDirectory(path); await this.#guard.check([path]); return value;
  }
  protected override async writeJson(): Promise<void> { historicalAuthenticationRefused(); }
  protected override async beforeLockAcquire(): Promise<void> { await this.#guard.check(["locks"]); }
}
export type HistoricalRetainedClaimEvidence =
  | { readonly kind: "retained_send_claim_present"; readonly claimHash: string; readonly signedMarkerSnapshotHash: string }
  | { readonly kind: "retained_send_claim_absent"; readonly observation: "current_observation";
      readonly submissionHistory: "unknown"; readonly transactionMayHaveBeenSubmitted: true; readonly absenceSnapshotHash: string; readonly signedMarkerSnapshotHash: string };
export interface HistoricalRetainedEvidence {
  readonly signedMarker: JupiterV1SignedMarker;
  readonly claim: JupiterV1SendClaim | null;
  readonly evidence: HistoricalRetainedClaimEvidence;
}
export class HistoricalBindingReader extends JupiterV1ExecutionBindingStore {
  readonly #guard: HistoricalDirectoryGuard;
  constructor(root: string, guard = new HistoricalDirectoryGuard(root)) { super(root); if (guard.root !== root) historicalAuthenticationRefused(); this.#guard=guard; }
  /** Only exact ea25 may authenticate retained signed material while observing an absent claim. */
  async retainedEvidence(op: SwapOperationRecord, binding: JupiterV1ExecutionBinding): Promise<HistoricalRetainedEvidence> {
    const signedMarker = await this.loadSignedMarker(op, binding);
    if (signedMarker === null) historicalAuthenticationRefused();
    const signedMarkerSnapshotHash = await this.#guard.signedMarkerSnapshot(op, signedMarker);
    const claim = await this.loadClaim(op);
    if (claim !== null) {
      if (claim.signature !== signedMarker.signature || claim.bindingHash !== binding.bindingHash || claim.rawPayloadHash !== signedMarker.rawPayloadHash) historicalAuthenticationRefused();
      return { signedMarker, claim, evidence: { kind: "retained_send_claim_present", claimHash: claim.claimHash, signedMarkerSnapshotHash } };
    }
    if (op.operationId !== HISTORICAL_JUPITER_IDS[1]) historicalAuthenticationRefused();
    stateIdentifier(op.ownerProfileHash, "Jupiter profile"); stateIdentifier(op.operationId, "Jupiter operation");
    const directory = `jupiter-v1-claims/${op.ownerProfileHash}`, target = resolve(this.root, directory, `${op.operationId}.json`);
    await this.#guard.check([directory]);
    const before = await lstat(resolve(this.root, directory), { bigint: true });
    try { await lstat(target); historicalAuthenticationRefused(); }
    catch (error) { if (!isCode(error, "ENOENT")) throw error; }
    await this.#guard.check([directory]);
    const after = await lstat(resolve(this.root, directory), { bigint: true });
    const facts = (v: typeof before) => ({dev:String(v.dev), ino:String(v.ino), uid:String(v.uid), mode:String(v.mode), mtimeNs:String(v.mtimeNs), ctimeNs:String(v.ctimeNs)});
    if (canonicalJson(facts(before)) !== canonicalJson(facts(after))) historicalAuthenticationRefused();
    // A replacement or even a create/remove changes this current absence observation.
    return { signedMarker, claim: null, evidence: { kind: "retained_send_claim_absent", observation: "current_observation", submissionHistory: "unknown", transactionMayHaveBeenSubmitted: true, signedMarkerSnapshotHash,
      absenceSnapshotHash: hashObject({root:this.root, target, directory:facts(after), observation:"ENOENT"}) } };
  }
  /** Production issuer only: generated wallets cannot replace this original public file anchor. */
  async assertOriginalAbsentSignedMarker(op: SwapOperationRecord, retained: HistoricalRetainedEvidence): Promise<void> {
    if (retained.evidence.kind !== "retained_send_claim_absent") return;
    if (op.operationId !== HISTORICAL_JUPITER_IDS[1]) historicalAuthenticationRefused();
    if (await this.#guard.signedMarkerSnapshot(op, retained.signedMarker) !== retained.evidence.signedMarkerSnapshotHash) historicalAuthenticationRefused();
    stateIdentifier(op.ownerProfileHash,"Jupiter profile");
    const directory=`jupiter-v1-signatures/${op.ownerProfileHash}`, path=resolve(this.root,directory,`${op.operationId}.json`);
    await this.#guard.check([directory]);
    const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try {
      const opened=await handle.stat({bigint:true}), before=await lstat(path,{bigint:true});
      const valid=(v:typeof opened)=>v.isFile()&&!v.isSymbolicLink()&&v.uid===BigInt(process.geteuid?.()??-1)&&(v.mode&0o777n)===0o600n&&v.nlink===1n&&v.size===561n;
      const facts=(v:typeof opened)=>({dev:String(v.dev),ino:String(v.ino),size:String(v.size),mtimeNs:String(v.mtimeNs),ctimeNs:String(v.ctimeNs)});
      if(!valid(opened)||!valid(before)||canonicalJson(facts(opened))!==canonicalJson(facts(before)))historicalAuthenticationRefused();
      const bytes=await handle.readFile();
      await this.#guard.check([directory]);
      const after=await lstat(path,{bigint:true});
      if(!valid(after)||canonicalJson(facts(opened))!==canonicalJson(facts(after))||sha256(bytes)!==HISTORICAL_JUPITER_EA25_SIGNED_MARKER_SHA256||bytes.toString("utf8")!==`${canonicalJson(retained.signedMarker)}\n`)historicalAuthenticationRefused();
    } finally {await handle.close();}
    if (await this.#guard.signedMarkerSnapshot(op, retained.signedMarker) !== retained.evidence.signedMarkerSnapshotHash) historicalAuthenticationRefused();
    await this.#guard.check([directory]);
  }
  override async initialize(): Promise<void> { await this.#guard.check(BINDING_DIRECTORIES); }
  protected override async initializeStorage(): Promise<void> { await this.#guard.check(BINDING_DIRECTORIES); }
  protected override async ensureDirectory(path: string): Promise<void> { await this.#guard.check([path]); }
  protected override async readJson(path: string): Promise<unknown | null> {
    const parent = dirname(path), dirs = parent === "." ? [] : [parent];
    await this.#guard.check(dirs); const value = await super.readJson(path); await this.#guard.check(dirs); return value;
  }
  protected override async readDirectory(path: string): Promise<readonly import("node:fs").Dirent[]> {
    await this.#guard.check([path]); const value = await super.readDirectory(path); await this.#guard.check([path]); return value;
  }
  protected override async writeJson(): Promise<void> { historicalAuthenticationRefused(); }
  protected override async beforeLockAcquire(): Promise<void> { await this.#guard.check(["locks"]); }
}
export class HistoricalCustodyReader extends ChainAccountStore {
  readonly #guard: HistoricalDirectoryGuard;
  constructor(root: string, wrapping: WrappingSecretPort, guard = new HistoricalDirectoryGuard(root)) { super(root, wrapping); if (guard.root !== root) historicalAuthenticationRefused(); this.#guard=guard; }
  override async initialize(): Promise<void> { await this.#guard.check(CUSTODY_DIRECTORIES); }
  protected override async initializeStorage(): Promise<void> { await this.#guard.check(CUSTODY_DIRECTORIES); }
  protected override async ensureDirectory(path: string): Promise<void> { await this.#guard.check([path]); }
  protected override async readJson(path: string): Promise<unknown | null> {
    const parent = dirname(path), dirs = parent === "." ? [] : [parent];
    await this.#guard.check(dirs); const value = await super.readJson(path); await this.#guard.check(dirs); return value;
  }
  protected override async readDirectory(path: string): Promise<readonly import("node:fs").Dirent[]> {
    await this.#guard.check([path]); const value = await super.readDirectory(path); await this.#guard.check([path]); return value;
  }
  protected override async writeJson(): Promise<void> { historicalAuthenticationRefused(); }
  protected override async beforeLockAcquire(): Promise<void> { await this.#guard.check(["locks"]); }
}
