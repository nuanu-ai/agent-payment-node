import { isAddress } from "viem";
import type { CommandOutcome, CommandRequest } from "../commands.js";
import { bridgeConflictDomain, conflictDomainKey, evmConflictDomain, railConflictDomain, SOLANA_BRIDGE_CHAIN_ID,
  type MoneyConflictDomain } from "../operation-conflict-domain.js";
import type { RuntimeContext } from "../runtime.js";
import type { OperationClaim, OperationFamily, WantedClaims } from "./types.js";

/** One record directory: `<directory>/<id>.json`, or `<directory>/<profileHash>/<id>.json` when per profile. */
export interface OperationStore { readonly directory: string; readonly perProfile: boolean }
export const RECORD_NAME = /^[a-f0-9]{64}\.json$/u;
export const STATE_HASH = /^[a-f0-9]{64}$/u;

export interface RecordIdentity {
  readonly profileHash: string;
  readonly operationId: string;
  readonly idempotencyHash: string | null;
  readonly requestHash: string | null;
}
/** What an unreadable record's raw JSON still names, each value only when canonical. */
export interface SalvagedRecord {
  readonly profileHashes: readonly string[];
  readonly idempotencyHash: string | null;
  /** Null when the accounts cannot be read; the index then quarantines the named profiles (or the family). */
  readonly claims: readonly OperationClaim[] | null;
}
export type OperationResumeOptions = Omit<Extract<CommandRequest, { readonly command: "operation.resume" }>, "command" | "operationId">;

export interface OperationFamilyAdapter<R = unknown> {
  readonly family: OperationFamily;
  /** Read by reconcile only (names, never bytes, unless a name has no entry yet). */
  readonly stores: readonly OperationStore[];
  /** The family's own widen-only reader at this exact path; lock-free; null when absent; throws when invalid. */
  load(root: string, recordPath: string): Promise<R | null>;
  identity(record: R): RecordIdentity;
  /** Account, provider and extra profile claims held while non-terminal; null when its accounts cannot be read. */
  claims(record: R): readonly OperationClaim[] | null;
  /**
   * False for a readable record APN can never advance (a frozen read-only schema): it holds only its `claims`, not its
   * profile, because no signature of its own can follow and only its accounts may still have a transaction in flight.
   * Absent means true: every other open record also holds `profile:<profileHash>`.
   */
  holdsProfile?(record: R): boolean;
  terminal(record: R, root: string): boolean | Promise<boolean>;
  /** The record's own state, reported as `blockingState`. */
  state(record: R): string;
  /** True when this held claim does not block that admission (family coexistence, see WantedTag). */
  admits?(record: R, wanted: WantedClaims, held: OperationClaim): boolean;
  salvage(raw: unknown): SalvagedRecord;
  /** Extra claims an unreadable record with unknown accounts holds besides its profile quarantine. */
  readonly unknownClaims?: readonly OperationClaim[];
  /** The public projection `OperationService.status` returns. */
  view(record: R, root: string): Promise<unknown>;
  // Generic `apn operation status|resume|abandon` and `apn receipt get` (phase 4b WP3 fills these in).
  status?(ctx: RuntimeContext, record: R, options?: { readonly refreshAllowance?: boolean }): Promise<CommandOutcome>;
  /** The family stores a residual token allowance its status shows; only it accepts `operation status --refresh-allowance`. */
  readonly refreshesAllowance?: true;
  receipt?(ctx: RuntimeContext, record: R): Promise<CommandOutcome>;
  resume?(ctx: RuntimeContext, record: R, options: OperationResumeOptions): Promise<CommandOutcome>;
  abandon?(ctx: RuntimeContext, record: R): Promise<unknown>;
  readonly commands?: { readonly status: string; readonly resume?: string; readonly exit?: string };
  /**
   * The family's own command whose runtime `status`, `resume` and `receipt` delegate to. The runtime factory builds a
   * family runtime only for the commands that name it, so a generic operation command is built as this command is.
   */
  runtimeCommand?(record: R): Promise<CommandRequest["command"]>;
}

/** `<directory>[/<profileHash>]/<operationId>.json`, split back into its parts; null for any other shape. */
export function parseRecordPath(recordPath: string): { readonly directory: string; readonly profileHash: string | null; readonly operationId: string } | null {
  const parts = recordPath.split("/");
  const name = parts.at(-1) ?? "";
  if (!RECORD_NAME.test(name) || parts.length < 2 || parts.length > 3) return null;
  const profileHash = parts.length === 3 ? parts[1]! : null;
  if (profileHash !== null && !STATE_HASH.test(profileHash)) return null;
  return { directory: parts[0]!, profileHash, operationId: name.slice(0, -".json".length) };
}
export function requiredRecordPath(recordPath: string, store: OperationStore) {
  const parsed = parseRecordPath(recordPath);
  if (parsed === null || parsed.directory !== store.directory || (parsed.profileHash !== null) !== store.perProfile) {
    throw new Error("Operation record path does not name this store.");
  }
  return parsed;
}

export function domainClaims(domains: readonly MoneyConflictDomain[]): readonly OperationClaim[] {
  return domains.map(domain => domain.shared === true ? { key: conflictDomainKey(domain), shared: true } : { key: conflictDomainKey(domain) });
}
/** Unreadable account fields yield null, exactly as `storedOperationDomains` reported them. */
export function readableClaims(claims: () => readonly OperationClaim[]): readonly OperationClaim[] | null {
  try { return claims(); } catch { return null; }
}

export function field(value: unknown, ...path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== "object" || Array.isArray(current) || !Object.hasOwn(current, key)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
function doubtful(): never { throw new Error("Salvaged field is not canonical."); }
const canonicalChain = (chainId: unknown): number | string =>
  (typeof chainId === "number" && Number.isSafeInteger(chainId) && chainId > 0) ||
  (typeof chainId === "string" && /^[1-9][0-9]{0,15}$/u.test(chainId)) ? chainId as number | string : doubtful();
/** Salvage accepts only a lowercase or correctly checksummed EVM address. */
export function salvageEvm(chainId: unknown, account: unknown, shared = false): OperationClaim {
  if (typeof account !== "string" || !isAddress(account, { strict: true })) doubtful();
  const key = conflictDomainKey(evmConflictDomain(canonicalChain(chainId), account));
  return shared ? { key, shared: true } : { key };
}
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u, TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/u;
export function salvageRail(rail: unknown, account: unknown): OperationClaim {
  const pattern = rail === "solana" ? SOLANA_ADDRESS : rail === "tron" ? TRON_ADDRESS : null;
  if (pattern === null || typeof account !== "string" || !pattern.test(account)) doubtful();
  return { key: conflictDomainKey(railConflictDomain(rail as "solana" | "tron", account)) };
}
export function salvageBridge(chainId: unknown, account: unknown): OperationClaim {
  if (String(chainId) !== SOLANA_BRIDGE_CHAIN_ID) return salvageEvm(chainId, account);
  if (typeof account !== "string" || !SOLANA_ADDRESS.test(account)) doubtful();
  return { key: conflictDomainKey(bridgeConflictDomain(SOLANA_BRIDGE_CHAIN_ID, account)) };
}
export function salvageHash(value: unknown): string {
  return typeof value === "string" && STATE_HASH.test(value) ? value : doubtful();
}

/** Identity fields plus the family's account extraction; any doubtful account field makes the claims unknown. */
export function salvageRecord(raw: unknown, extract: (raw: unknown) => readonly OperationClaim[],
  profileFields: readonly string[] = ["profileHash"]): SalvagedRecord {
  const profileHashes = [...new Set(profileFields.map(name => field(raw, name))
    .filter((value): value is string => typeof value === "string" && STATE_HASH.test(value)))];
  const idempotency = field(raw, "idempotencyHash");
  let claims: readonly OperationClaim[] | null = null;
  try { claims = extract(raw); } catch { claims = null; }
  return { profileHashes, idempotencyHash: typeof idempotency === "string" && STATE_HASH.test(idempotency) ? idempotency : null, claims };
}

/** Every covered record carries these identity fields under the same names. */
export function standardIdentity(record: { readonly profileHash: string; readonly operationId: string;
  readonly idempotencyHash: string; readonly requestHash: string }): RecordIdentity {
  return { profileHash: record.profileHash, operationId: record.operationId, idempotencyHash: record.idempotencyHash, requestHash: record.requestHash };
}
