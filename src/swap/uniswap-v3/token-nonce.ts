import { getAddress } from "viem";
import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore } from "../../secure-state-store.js";
import type { TokenEffectKind } from "./token-execution.js";
import type { UniswapTokenOperation } from "./token-operation.js";

interface Reservation { readonly operationId: string; readonly kind: TokenEffectKind; readonly nonce: string; readonly state: "reserved" | "committed" }
interface LegacyReservation { readonly nonce: string; readonly state: "committed" }
interface NonceRecord { readonly schemaVersion: "apn.uniswap-token-nonces.v2"; readonly account: string;
  readonly reservations: Readonly<Record<string, Reservation | LegacyReservation>> }
export type TokenNonceEvidence = "reserved" | "committed" | null;
type Evidence = (operationId: string, kind: TokenEffectKind, nonce: string) => Promise<TokenNonceEvidence>;

/** Called while the shared account custody lock is held. Only reservations without a durable signed-effect marker may be reclaimed. */
export class UniswapTokenNonceStore extends SecureStateStore {
  async occupied(accountValue: string): Promise<readonly bigint[]> {
    await this.initialize(); await this.ensureDirectory("uniswap-token-nonces"); const account = canonical(accountValue), path = this.path(account), raw = await this.readJson(path);
    if (raw === null) return []; const current = validate(raw, account);
    return Object.values(current.reservations).map((reservation) => BigInt(reservation.nonce));
  }
  async reconcile(accountValue: string, evidence: Evidence): Promise<void> {
    await this.initialize(); await this.ensureDirectory("uniswap-token-nonces"); const account = canonical(accountValue), path = this.path(account), raw = await this.readJson(path);
    if (raw === null) return; const current = validate(raw, account), reservations: Record<string, Reservation | LegacyReservation> = { ...current.reservations };
    let changed = false; for (const [key, reservation] of Object.entries(reservations)) {
      if (reservation.state !== "reserved") continue; const state = await evidence(reservation.operationId, reservation.kind, reservation.nonce);
      if (state === "committed") { reservations[key] = { ...reservation, state }; changed = true; }
      else if (state === null) { delete reservations[key]; changed = true; }
    }
    if (changed) await this.writeJson(path, { ...current, reservations });
  }
  async allocate(op: UniswapTokenOperation, kind: TokenEffectKind, pending: bigint, occupied: readonly bigint[] = []): Promise<string> {
    await this.initialize(); await this.ensureDirectory("uniswap-token-nonces"); const account = canonical(op.account), path = this.path(account), raw = await this.readJson(path),
      current = raw === null ? empty(account) : validate(raw, account), slot = nonceSlot(op.operationId, kind), prior = current.reservations[slot];
    if (prior !== undefined) return prior.nonce;
    const reservations: Record<string, Reservation | LegacyReservation> = { ...current.reservations };
    const unavailable = new Set([...Object.values(reservations).map((reservation) => reservation.nonce), ...occupied.map(String)]); let nonce = pending;
    while (unavailable.has(nonce.toString())) nonce += 1n;
    reservations[slot] = { operationId: op.operationId, kind, nonce: nonce.toString(), state: "reserved" };
    await this.writeJson(path, { schemaVersion: "apn.uniswap-token-nonces.v2", account, reservations } satisfies NonceRecord, raw === null);
    return nonce.toString();
  }
  async release(op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<boolean> {
    const account = canonical(op.account), path = this.path(account), raw = await this.readJson(path); if (raw === null) corrupt("Uniswap token nonce record is missing.");
    const current = validate(raw, account), slot = nonceSlot(op.operationId, kind), reservation = current.reservations[slot];
    if (reservation === undefined) return false;
    exact(reservation, op, kind, nonce); if (reservation.state === "committed") return false;
    const reservations = { ...current.reservations }; delete reservations[slot]; await this.writeJson(path, { ...current, reservations }); return true;
  }
  async commit(op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<void> {
    const account = canonical(op.account), path = this.path(account), raw = await this.readJson(path); if (raw === null) corrupt("Uniswap token nonce record is missing.");
    const current = validate(raw, account), slot = nonceSlot(op.operationId, kind), reservation = current.reservations[slot];
    if (reservation === undefined) corrupt("Uniswap token nonce reservation is missing."); exact(reservation, op, kind, nonce);
    if (reservation.state === "committed") return;
    await this.writeJson(path, { ...current, reservations: { ...current.reservations, [slot]: { ...reservation, state: "committed" } } });
  }
  private path(account: string) { return `uniswap-token-nonces/${domainHash("apn.uniswap-token-nonce-account.v1", account)}.json`; }
}
function empty(account: string): NonceRecord { return { schemaVersion: "apn.uniswap-token-nonces.v2", account, reservations: {} }; }
function nonceSlot(operationId: string, kind: TokenEffectKind) { return domainHash("apn.uniswap-token-nonce-slot.v1", canonicalJson({ operationId, kind })); }
function validate(value: unknown, account: string): NonceRecord {
  if (!isPlainRecord(value) || value.account !== account || !isPlainRecord(value.reservations)) corrupt("Uniswap token nonce record is invalid.");
  if (value.schemaVersion === "apn.uniswap-token-nonces.v1" && exactKeys(value, ["schemaVersion", "account", "nextNonce", "reservations"])) {
    if (!decimal(value.nextNonce)) corrupt("Uniswap token nonce record is invalid."); const reservations: Record<string, LegacyReservation> = {};
    for (const [slot, nonce] of Object.entries(value.reservations)) { if (!slotHash(slot) || !decimal(nonce)) corrupt("Uniswap token nonce reservation is invalid."); reservations[slot] = { nonce, state: "committed" }; }
    return { schemaVersion: "apn.uniswap-token-nonces.v2", account, reservations };
  }
  if (value.schemaVersion !== "apn.uniswap-token-nonces.v2" || !exactKeys(value, ["schemaVersion", "account", "reservations"])) corrupt("Uniswap token nonce record is invalid.");
  for (const [slot, reservation] of Object.entries(value.reservations)) {
    if (!slotHash(slot) || !isPlainRecord(reservation) || !decimal(reservation.nonce) || !["reserved", "committed"].includes(reservation.state as string)) corrupt("Uniswap token nonce reservation is invalid.");
    if (exactKeys(reservation, ["nonce", "state"])) { if (reservation.state !== "committed") corrupt("Uniswap token legacy nonce reservation is invalid."); continue; }
    if (!exactKeys(reservation, ["operationId", "kind", "nonce", "state"]) || !/^[a-f0-9]{64}$/u.test(reservation.operationId as string) ||
      !["approval", "swap", "cleanup"].includes(reservation.kind as string)) corrupt("Uniswap token nonce binding is invalid.");
  }
  return value as unknown as NonceRecord;
}
function exact(value: Reservation | LegacyReservation, op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): asserts value is Reservation {
  if (!("operationId" in value) || value.operationId !== op.operationId || value.kind !== kind || value.nonce !== nonce) corrupt("Uniswap token nonce binding changed.");
}
function decimal(value: unknown): value is string { return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value); }
function slotHash(value: string) { return /^[a-f0-9]{64}$/u.test(value); }
function canonical(value: string) { try { const address = getAddress(value); if (address !== value) throw new Error(); return address; } catch { return corrupt("Uniswap token nonce account is invalid."); } }
function corrupt(message: string): never { throw new ApnError("APN_STATE_CORRUPT", message); }
