import { isPlainRecord } from "../../canonical.js";
import type { ErrorDetail } from "../../errors.js";
import type { MetaMaskGaslessIntent } from "../model.js";
import { mmExact } from "../validation.js";
import { mmFail, type MetaMaskGaslessFailureReason } from "../reasons.js";

/**
 * How the `tx` of a MetaMask job answer compares with the bound request, as closed facts only: no address, number or
 * other provider text leaves. The pinned SDK declares `tx: { from, to, chainId: number, ... }` on every transaction
 * job, but neither the SDK nor `mm` reads `tx` from the relay POST's answer, so APN reports what actually came.
 */
export type JobTxShape = "object" | "absent" | "null" | "other";
/** `owner` is the bound server wallet; any other address (a relayer's, say) is `other_address`. */
export type JobTxFrom = "owner" | "other_address" | "other_string" | "absent" | "other";
export type JobTxChainId = "number" | "decimal_string" | "hex_string" | "caip2_string" | "other_string" | "absent" | "other";
export interface MetaMaskJobTx {
  readonly tx: JobTxShape;
  /** Null unless `tx` is an object. */
  readonly from: JobTxFrom | null;
  readonly chainId: JobTxChainId | null;
  /** Whether a readable chain id names the request's chain; null when there is none. */
  readonly chainIdMatches: boolean | null;
}
const SHAPES: readonly string[] = ["object", "absent", "null", "other"];
const FROMS: readonly string[] = ["owner", "other_address", "other_string", "absent", "other"];
const CHAIN_IDS: readonly string[] = ["number", "decimal_string", "hex_string", "caip2_string", "other_string", "absent", "other"];
const READABLE: readonly string[] = ["number", "decimal_string", "hex_string", "caip2_string"];
const KEYS = ["tx", "from", "chainId", "chainIdMatches"] as const;
const NONE = { from: null, chainId: null, chainIdMatches: null } as const;

export function jobTx(value: unknown, intent: Pick<MetaMaskGaslessIntent, "binding" | "request">): MetaMaskJobTx {
  if (value === undefined) return { tx: "absent", ...NONE };
  if (value === null) return { tx: "null", ...NONE };
  if (!isPlainRecord(value)) return { tx: "other", ...NONE };
  const chain = chainIdForm(value.chainId);
  return { tx: "object", from: fromForm(value.from, intent), chainId: chain.form,
    chainIdMatches: chain.id === undefined ? null : chain.id === intent.request.chainId };
}
function fromForm(value: unknown, intent: Pick<MetaMaskGaslessIntent, "binding">): JobTxFrom {
  if (value === undefined) return "absent";
  if (typeof value !== "string") return "other";
  if (!/^0x[0-9a-fA-F]{40}$/u.test(value)) return "other_string";
  return value.toLowerCase() === intent.binding.address.toLowerCase() ? "owner" : "other_address";
}
function chainIdForm(value: unknown): { readonly form: JobTxChainId; readonly id?: number } {
  if (value === undefined) return { form: "absent" };
  if (typeof value === "number") return Number.isSafeInteger(value) ? { form: "number", id: value } : { form: "other" };
  if (typeof value !== "string") return { form: "other" };
  if (/^[1-9][0-9]{0,14}$/u.test(value)) return { form: "decimal_string", id: Number(value) };
  if (/^0x[0-9a-fA-F]{1,12}$/u.test(value)) return { form: "hex_string", id: Number.parseInt(value.slice(2), 16) };
  const caip = /^eip155:([1-9][0-9]{0,14})$/u.exec(value);
  return caip ? { form: "caip2_string", id: Number(caip[1]) } : { form: "other_string" };
}

export function validateJobTx(value: unknown, reason: MetaMaskGaslessFailureReason): MetaMaskJobTx {
  const d = mmExact(value, [...KEYS], reason);
  const object = d.tx === "object", readable = typeof d.chainId === "string" && READABLE.includes(d.chainId);
  if (typeof d.tx !== "string" || !SHAPES.includes(d.tx) ||
    (object ? typeof d.from !== "string" || !FROMS.includes(d.from) || typeof d.chainId !== "string" || !CHAIN_IDS.includes(d.chainId) ||
      (readable ? typeof d.chainIdMatches !== "boolean" : d.chainIdMatches !== null)
      : d.from !== null || d.chainId !== null || d.chainIdMatches !== null)) mmFail(reason);
  return Object.freeze({ tx: d.tx, from: d.from, chainId: d.chainId, chainIdMatches: d.chainIdMatches }) as MetaMaskJobTx;
}

/** The facts as flat error details under `prefix` (ErrorDetail values only; a null fact is left out). */
export function jobTxDetails(prefix: string, t: MetaMaskJobTx | null): Record<string, ErrorDetail> {
  if (t === null) return {};
  return { [`${prefix}Tx`]: t.tx, ...(t.from === null ? {} : { [`${prefix}TxFrom`]: t.from }),
    ...(t.chainId === null ? {} : { [`${prefix}TxChainId`]: t.chainId }),
    ...(t.chainIdMatches === null ? {} : { [`${prefix}TxChainIdMatches`]: t.chainIdMatches }) };
}
/** The facts back from flat error details, or null when there are none; a malformed set refuses with `reason`. */
export function takeJobTx(prefix: string, x: Readonly<Record<string, unknown>>, reason: MetaMaskGaslessFailureReason): MetaMaskJobTx | null {
  if (x[`${prefix}Tx`] === undefined) return null;
  const value = (key: string) => x[`${prefix}${key}`] ?? null;
  return validateJobTx({ tx: x[`${prefix}Tx`], from: value("TxFrom"), chainId: value("TxChainId"), chainIdMatches: value("TxChainIdMatches") }, reason);
}
/** The facts in the output's own key style. */
export function jobTxOutput(t: MetaMaskJobTx | null) {
  return t === null ? null : { tx: t.tx, from: t.from, chain_id: t.chainId, chain_id_matches: t.chainIdMatches };
}
