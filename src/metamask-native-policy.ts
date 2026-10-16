import { ApnError } from "./errors.js";

/**
 * The MetaMask Agent Wallet Guard policy, read for its meaning (owner decision OD-4), never compared byte for byte with
 * one owner's template. Before a native transfer the vendor policy must (1) name the paying wallet, (2) allowlist the
 * operation's recipient for the operation's chain and (3) carry an outflow limit. Other sections (protocol lists, other
 * chains, labels) do not matter here; the vendor enforces them itself.
 *
 * The policy is YAML. This reader takes only the block subset the vendor writes (mappings, sequences, plain, quoted and
 * numeric scalars, comments) and refuses anything else (anchors, tags, multi-line scalars, flow collections other than
 * `[]`/`{}`), so a policy it cannot read exactly is refused, never guessed.
 */
export interface MetaMaskGuardPolicyAdmission {
  /** Each outflow limit as the vendor policy states it, in USD, e.g. `{ rolling_24h: "0.5" }`. */
  readonly outflowLimitsUsd: Readonly<Record<string, string>>;
}

class YamlNumber { constructor(readonly text: string) {} }
type YamlValue = string | boolean | null | YamlNumber | readonly YamlValue[] | ReadonlyMap<string, YamlValue>;
interface Row { readonly indent: number; readonly text: string }
const MAX_POLICY_BYTES = 64 * 1024;
const ENTRY = /^([A-Za-z0-9_][A-Za-z0-9_.-]*):(?: (.*))?$/u;

/** Refuses, with a reason the owner can act on, unless the policy admits this exact payer, chain and recipient. */
export function metaMaskGuardPolicyAdmits(policy: string, expected: { readonly payer: string; readonly chainId: number; readonly recipient: string }):
  MetaMaskGuardPolicyAdmission {
  const top = asMap(parseGuardPolicy(policy));
  const version = top.get("schema_version");
  if (!(version instanceof YamlNumber) || version.text !== "1") refuse("metamask_guard_policy_schema_unsupported", "The MetaMask Guard policy schema version is not 1.");
  if (!sameAddress(top.get("wallet_address"), expected.payer)) refuse("metamask_guard_policy_wallet_mismatch", "The MetaMask Guard policy names a different wallet than the paying profile.");
  const addresses = optionalMap(top.get("addresses"));
  const allowed = optionalList(addresses.get("allowlist")).some((entry) => entry instanceof Map &&
    sameAddress(entry.get("address"), expected.recipient) && integer(entry.get("chain_id")) === expected.chainId);
  if (!allowed) refuse("metamask_guard_recipient_not_allowlisted", "The MetaMask Guard policy does not allowlist this recipient on this chain.");
  for (const entry of optionalList(addresses.get("blocklist"))) {
    const address = entry instanceof Map ? entry.get("address") : entry;
    if (typeof address !== "string") unreadable();
    const chain = entry instanceof Map ? entry.get("chain_id") : undefined;
    if (address.toLowerCase() === expected.recipient.toLowerCase() && (chain === undefined || integer(chain) === expected.chainId)) {
      refuse("metamask_guard_recipient_blocklisted", "The MetaMask Guard policy blocklists this recipient.");
    }
  }
  const evm = optionalMap(top.get("evm"));
  const chains = evm.get("allowed_chains");
  if (chains !== undefined && !optionalList(chains).some((chain) => integer(chain) === expected.chainId)) {
    refuse("metamask_guard_chain_not_allowed", "The MetaMask Guard policy does not allow this chain.");
  }
  const outflowLimitsUsd: Record<string, string> = {};
  for (const [name, value] of optionalMap(evm.get("outflow_limits_usd"))) {
    if (!(value instanceof YamlNumber) || !/^[0-9]+(?:\.[0-9]+)?$/u.test(value.text)) unreadable();
    if (/[1-9]/u.test(value.text)) outflowLimitsUsd[name] = value.text;
  }
  if (Object.keys(outflowLimitsUsd).length === 0) refuse("metamask_guard_outflow_limit_missing", "The MetaMask Guard policy has no positive outflow limit.");
  return Object.freeze({ outflowLimitsUsd: Object.freeze(outflowLimitsUsd) });
}

/** The policy document as nested maps, lists and scalars; refuses every construct outside the supported block subset. */
function parseGuardPolicy(text: string): YamlValue {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_POLICY_BYTES || /[\t\r\0]/u.test(text)) unreadable();
  const rows: Row[] = [];
  for (const raw of text.split("\n")) {
    const line = withoutComment(raw).trimEnd();
    if (line.trim() === "") continue;
    rows.push({ indent: line.length - line.trimStart().length, text: line.trim() });
  }
  if (rows.length === 0 || rows[0]!.indent !== 0) unreadable();
  const parser = new BlockParser(rows), value = parser.block(0);
  if (!parser.done()) unreadable();
  return value;
}

class BlockParser {
  private index = 0;
  private readonly rows: Row[];
  constructor(rows: readonly Row[]) { this.rows = [...rows]; }
  done(): boolean { return this.index === this.rows.length; }
  block(indent: number): YamlValue {
    return item(this.rows[this.index]!.text) ? this.sequence(indent) : this.mapping(indent);
  }
  private mapping(indent: number): ReadonlyMap<string, YamlValue> {
    const out = new Map<string, YamlValue>();
    while (this.index < this.rows.length && this.rows[this.index]!.indent === indent && !item(this.rows[this.index]!.text)) {
      const match = ENTRY.exec(this.rows[this.index]!.text);
      if (match === null || out.has(match[1]!)) unreadable();
      this.index += 1;
      out.set(match[1]!, match[2] === undefined || match[2] === "" ? this.nested(indent, true) : scalar(match[2]));
    }
    if (this.index < this.rows.length && this.rows[this.index]!.indent > indent) unreadable();
    return out;
  }
  private sequence(indent: number): readonly YamlValue[] {
    const out: YamlValue[] = [];
    while (this.index < this.rows.length && this.rows[this.index]!.indent === indent && item(this.rows[this.index]!.text)) {
      const row = this.rows[this.index]!, rest = row.text.slice(1).trimStart();
      if (rest === "") { this.index += 1; out.push(this.nested(indent, false)); }
      else if (ENTRY.test(rest)) {
        // `- key: value` opens a mapping whose keys sit in the column of its first key.
        const column = indent + row.text.length - rest.length;
        this.rows[this.index] = { indent: column, text: rest };
        out.push(this.mapping(column));
      } else { this.index += 1; out.push(scalar(rest)); }
    }
    if (this.index < this.rows.length && this.rows[this.index]!.indent > indent) unreadable();
    return out;
  }
  /** The block under a key or a bare dash: deeper rows, or a sequence at the key's own column; otherwise null. */
  private nested(indent: number, sameColumnSequence: boolean): YamlValue {
    const next = this.rows[this.index];
    if (next !== undefined && (next.indent > indent || sameColumnSequence && next.indent === indent && item(next.text))) return this.block(next.indent);
    return null;
  }
}

function item(text: string): boolean { return text === "-" || text.startsWith("- "); }

function scalar(text: string): YamlValue {
  if (text.startsWith("\"")) {
    let value: unknown;
    try { value = JSON.parse(text); } catch { unreadable(); }
    if (typeof value !== "string") unreadable();
    return value;
  }
  if (text.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/u.test(text)) unreadable();
    return text.slice(1, -1).replaceAll("''", "'");
  }
  if (text === "[]") return [];
  if (text === "{}") return new Map();
  // Every YAML number form stays a number, so an unquoted `0x…` can never pass as an address string.
  if (/^[-+]?(?:[0-9][0-9_]*(?:\.[0-9_]*)?|\.[0-9]+)(?:[eE][-+]?[0-9]+)?$|^0[xob][0-9a-fA-F_]+$|^[-+]?\.(?:inf|Inf|INF|nan|NaN|NAN)$/u.test(text)) {
    return new YamlNumber(text);
  }
  if (/^[-?:,[\]{}#&*!|>%@`]/u.test(text) || text.includes(": ") || text.includes(" #")) unreadable();
  if (/^(?:null|Null|NULL|~)$/u.test(text)) return null;
  if (/^(?:true|True|TRUE)$/u.test(text)) return true;
  if (/^(?:false|False|FALSE)$/u.test(text)) return false;
  return text;
}

function withoutComment(line: string): string {
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (quote === "\"") { if (character === "\\") index += 1; else if (character === "\"") quote = null; }
    else if (quote === "'") { if (character === "'") quote = null; }
    else if (character === "\"" || character === "'") quote = character;
    else if (character === "#" && (index === 0 || line[index - 1] === " ")) return line.slice(0, index);
  }
  return line;
}

function asMap(value: YamlValue | undefined): ReadonlyMap<string, YamlValue> {
  if (!(value instanceof Map)) unreadable();
  return value;
}
/** An absent or empty section reads as empty; a section of the wrong shape is refused. */
function optionalMap(value: YamlValue | undefined): ReadonlyMap<string, YamlValue> {
  return value === undefined || value === null ? new Map() : asMap(value);
}
function optionalList(value: YamlValue | undefined): readonly YamlValue[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) unreadable();
  return value;
}
function integer(value: YamlValue | undefined): number | null {
  return value instanceof YamlNumber && /^[1-9][0-9]{0,15}$/u.test(value.text) ? Number(value.text) : null;
}
function sameAddress(value: YamlValue | undefined, expected: string): boolean {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/u.test(value) && value.toLowerCase() === expected.toLowerCase();
}
function unreadable(): never {
  refuse("metamask_guard_policy_unreadable", "The MetaMask Guard policy is not in the supported YAML form.");
}
function refuse(reason: string, message: string): never {
  throw new ApnError("APN_OPERATION_BLOCKED", message, { reason, nextActions: ["mm wallet policy get"] });
}
