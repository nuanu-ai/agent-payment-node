import { getAddress } from "viem";
import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore } from "../../secure-state-store.js";
import type { TokenEffectKind } from "./token-execution.js";
import type { UniswapTokenOperation } from "./token-operation.js";

interface NonceRecord { readonly schemaVersion: "apn.uniswap-token-nonces.v1"; readonly account: string;
  readonly nextNonce: string; readonly reservations: Readonly<Record<string, string>> }

/** Called while the shared account custody lock is held. Gaps are safe; reuse is forbidden. */
export class UniswapTokenNonceStore extends SecureStateStore {
  async allocate(op: UniswapTokenOperation, kind: TokenEffectKind, pending: bigint): Promise<string> {
    await this.initialize(); await this.ensureDirectory("uniswap-token-nonces"); const account = canonical(op.account), path = this.path(account), raw = await this.readJson(path),
      current = raw === null ? { schemaVersion: "apn.uniswap-token-nonces.v1" as const, account, nextNonce: pending.toString(), reservations: {} } : validate(raw, account),
      slot = domainHash("apn.uniswap-token-nonce-slot.v1", canonicalJson({ operationId: op.operationId, kind })), prior = current.reservations[slot];
    if (prior !== undefined) return prior;
    const nonce = (BigInt(current.nextNonce) > pending ? BigInt(current.nextNonce) : pending).toString();
    const next: NonceRecord = { ...current, nextNonce: (BigInt(nonce) + 1n).toString(), reservations: { ...current.reservations, [slot]: nonce } };
    await this.writeJson(path, next, raw === null); return nonce;
  }
  private path(account: string) { return `uniswap-token-nonces/${domainHash("apn.uniswap-token-nonce-account.v1", account)}.json`; }
}
function validate(value: unknown, account: string): NonceRecord { if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "account", "nextNonce", "reservations"]) ||
  value.schemaVersion !== "apn.uniswap-token-nonces.v1" || value.account !== account || !decimal(value.nextNonce) || !isPlainRecord(value.reservations)) corrupt("Uniswap token nonce record is invalid.");
  for (const [slot, nonce] of Object.entries(value.reservations)) if (!/^[a-f0-9]{64}$/u.test(slot) || !decimal(nonce)) corrupt("Uniswap token nonce reservation is invalid.");
  return value as unknown as NonceRecord; }
function decimal(value: unknown): value is string { return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value); }
function canonical(value: string) { try { const address = getAddress(value); if (address !== value) throw new Error(); return address; } catch { return corrupt("Uniswap token nonce account is invalid."); } }
function corrupt(message: string): never { throw new ApnError("APN_STATE_CORRUPT", message); }
