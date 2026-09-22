import { randomBytes } from "node:crypto";
import { exactKeys, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import type { RpcReadTelemetry } from "../../lifi/rpc.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";

export interface TokenRpcBudgetRow { readonly reservation: string; readonly command: string; readonly cap: number;
  readonly requestSessionCap?: number; readonly budgetClass?: "quote" | "prepare" | "approval_effect" | "swap_effect" | "recovery";
  readonly physicalRequests: number | null; readonly attempts: number | null; readonly logicalItems: number | null;
  readonly methodClasses: Readonly<Record<string, number>> | null; readonly batchSizes: Readonly<Record<string, number>> | null;
  readonly budgetRejects: number | null }
interface BudgetRecord { readonly schemaVersion: "apn.uniswap-token-rpc-budget.v1"; readonly binding: string;
  readonly quoteBinding: string | null; readonly rows: readonly TokenRpcBudgetRow[] }
export const TOKEN_OPERATION_RPC_CAP = 64;

export class UniswapTokenRpcBudgetJournal extends SecureStateStore {
  async reserve(binding: string, command: string, cap: number, requestSessionCap = cap,
    budgetClass: NonNullable<TokenRpcBudgetRow["budgetClass"]> = cap === 0 ? "recovery" : "approval_effect"): Promise<string> {
    stateIdentifier(binding, "Uniswap token RPC binding"); const reservation = randomBytes(16).toString("hex");
    await this.initialize(); await this.ensureDirectory("uniswap-token-rpc-budgets");
    return await this.withLocks([`uniswap-token-rpc-budget:${binding}`], async () => { const current = await this.load(binding), used = usage(current?.rows ?? []);
      if (used + cap > TOKEN_OPERATION_RPC_CAP) throw new ApnError("APN_RPC_BUDGET_EXCEEDED", "Uniswap token operation RPC budget is exhausted.", {
        reason: "operation_physical_requests", physicalRequests: used.toString(), remainingPhysicalRequests: Math.max(0, TOKEN_OPERATION_RPC_CAP - used).toString(),
      });
      const row: TokenRpcBudgetRow = { reservation, command, cap, requestSessionCap, budgetClass, physicalRequests: null, attempts: null, logicalItems: null,
        methodClasses: null, batchSizes: null, budgetRejects: null };
      await this.writeJson(this.path(binding), { schemaVersion: "apn.uniswap-token-rpc-budget.v1", binding,
        quoteBinding: current?.quoteBinding ?? null, rows: [...(current?.rows ?? []), row] }); return reservation;
    });
  }
  async settle(binding: string, reservation: string, telemetry: RpcReadTelemetry | null, effects: number): Promise<void> {
    stateIdentifier(binding, "Uniswap token RPC binding");
    await this.withLocks([`uniswap-token-rpc-budget:${binding}`], async () => { const current = await this.load(binding);
      if (current === null) corrupt(); let found = false;
      const rows = current.rows.map((row) => row.reservation !== reservation ? row : (found = true, {
        ...row, physicalRequests: (telemetry?.httpAttempts ?? 0) + effects, attempts: telemetry?.httpAttempts ?? 0,
        logicalItems: telemetry?.logicalItems ?? 0, methodClasses: telemetry?.attemptsByMethodClass ?? {},
        batchSizes: telemetry?.attemptsByBatchSize ?? {}, budgetRejects: telemetry?.budgetRejectedBeforeTransport ?? 0,
      }));
      if (!found) corrupt();
      await this.writeJson(this.path(binding), { ...current, rows });
    });
  }
  async linkQuote(from: string, to: string): Promise<void> {
    stateIdentifier(from, "Uniswap token quote"); stateIdentifier(to, "Uniswap token operation");
    await this.initialize(); await this.ensureDirectory("uniswap-token-rpc-budgets");
    await this.withLocks([`uniswap-token-rpc-budget:${from}`, `uniswap-token-rpc-budget:${to}`], async () => {
      const source = await this.load(from), target = await this.load(to);
      if (target !== null && target.quoteBinding !== null && target.quoteBinding !== from) corrupt();
      const rows = mergeRows(target?.rows ?? [], source?.rows ?? []);
      await this.writeJson(this.path(to), { schemaVersion: "apn.uniswap-token-rpc-budget.v1", binding: to, quoteBinding: from, rows });
    });
  }
  async reconcile(binding: string): Promise<void> { stateIdentifier(binding, "Uniswap token operation");
    const target = await this.load(binding); if (target?.quoteBinding !== null && target?.quoteBinding !== undefined)
      await this.linkQuote(target.quoteBinding, binding); }
  async load(binding: string): Promise<BudgetRecord | null> { stateIdentifier(binding, "Uniswap token RPC binding"); await this.initialize();
    const value = await this.readJson(this.path(binding)); if (value === null) return null;
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "binding", "quoteBinding", "rows"]) || value.schemaVersion !== "apn.uniswap-token-rpc-budget.v1" || value.binding !== binding ||
      value.quoteBinding !== null && (typeof value.quoteBinding !== "string" || !/^[a-f0-9]{64}$/u.test(value.quoteBinding)) || !Array.isArray(value.rows)) corrupt();
    for (const row of value.rows) if (!validRow(row)) corrupt(); return value as unknown as BudgetRecord; }
  private path(binding: string) { return `uniswap-token-rpc-budgets/${binding}.json`; }
}
function mergeRows(target: readonly TokenRpcBudgetRow[], source: readonly TokenRpcBudgetRow[]) { const rows = [...target], seen = new Set(rows.map((row) => row.reservation));
  for (const row of source) if (!seen.has(row.reservation)) { rows.push(row); seen.add(row.reservation); } return rows; }
function usage(rows: readonly TokenRpcBudgetRow[]) { return rows.reduce((sum, row) => sum + (row.cap === 0 ? 0 : row.physicalRequests ?? row.cap), 0); }
function validRow(value: unknown): value is TokenRpcBudgetRow { if (!isPlainRecord(value)) return false;
  const legacy = ["reservation", "command", "cap", "physicalRequests", "attempts", "logicalItems", "methodClasses", "batchSizes", "budgetRejects"], extended = [...legacy, "requestSessionCap", "budgetClass"];
  if (!exactKeys(value, value.requestSessionCap === undefined ? legacy : extended)) return false;
  const number = (v: unknown) => v === null || typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  return /^[a-f0-9]{32}$/u.test(value.reservation as string) && typeof value.command === "string" && number(value.cap) && number(value.physicalRequests) && number(value.attempts) && number(value.logicalItems) && number(value.budgetRejects) &&
    (value.requestSessionCap === undefined || typeof value.requestSessionCap === "number" && Number.isSafeInteger(value.requestSessionCap) && value.requestSessionCap >= 0 &&
      ["quote", "prepare", "approval_effect", "swap_effect", "recovery"].includes(value.budgetClass as string)) &&
    (value.methodClasses === null || isPlainRecord(value.methodClasses)) && (value.batchSizes === null || isPlainRecord(value.batchSizes)); }
function corrupt(): never { throw new ApnError("APN_STATE_CORRUPT", "Uniswap token RPC budget record is invalid."); }
