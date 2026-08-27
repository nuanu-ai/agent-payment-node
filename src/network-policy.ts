import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ApnError, type ErrorCode } from "./errors.js";

export interface PinnedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

type NetworkConfigCode = "APN_RPC_CONFIG" | "APN_HTTP_CONFIG";

export function parsePublicHttpsUrl(value: string, code: NetworkConfigCode, label: string, maxUrlBytes?: number): URL {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new ApnError(code as ErrorCode, `${label} must be an explicit public HTTPS URL.`); }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") {
    throw new ApnError(code as ErrorCode, `${label} must be credential-free HTTPS.`);
  }
  if (parsed.hash !== "") throw new ApnError(code as ErrorCode, `${label} must not contain a fragment.`);
  if (maxUrlBytes !== undefined && Buffer.byteLength(parsed.toString(), "utf8") > maxUrlBytes) {
    throw new ApnError(code as ErrorCode, `${label} exceeds the URL size limit.`);
  }
  const host = unbracket(parsed.hostname);
  if (host.length === 0) throw new ApnError(code as ErrorCode, `${label} host is missing.`);
  if (isIP(host) !== 0 && !isPublicIp(host)) throw new ApnError(code as ErrorCode, `${label} must use a public network target.`);
  return parsed;
}

export async function resolvePublicAddresses(endpoint: URL, code: NetworkConfigCode, label: string): Promise<readonly PinnedAddress[]> {
  const host = unbracket(endpoint.hostname);
  const literal = isIP(host);
  const rows = literal === 0 ? await lookup(host, { all: true, verbatim: true }).catch(() => {
    throw new ApnError(code as ErrorCode, `${label} host could not be resolved safely.`);
  }) : [{ address: host, family: literal }];
  if (rows.length === 0 || rows.some((row) => (row.family !== 4 && row.family !== 6) || !isPublicIp(row.address))) {
    throw new ApnError(code as ErrorCode, `${label} DNS resolution includes a non-public address.`);
  }
  return rows.map((row) => ({ address: row.address, family: row.family as 4 | 6 }));
}

export function isPublicIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4ToUint(address);
    if (value === ipv4ToUint("192.0.0.9") || value === ipv4ToUint("192.0.0.10")) return true;
    return !IPV4_NON_PUBLIC.some(([network, prefix]) => inIpv4Cidr(value, ipv4ToUint(network), prefix));
  }
  if (family === 6) {
    const value = ipv6ToBigInt(address);
    if (value === null || !inIpv6Cidr(value, ipv6ToBigIntRequired("2000::"), 3)) return false;
    if (inIpv6Cidr(value, ipv6ToBigIntRequired("2001::"), 23)) {
      if (["2001:1::1", "2001:1::2", "2001:1::3"].some((item) => value === ipv6ToBigIntRequired(item))) return true;
      return [
        ["2001:3::", 32],
        ["2001:4:112::", 48],
        ["2001:30::", 28],
      ].some(([network, prefix]) => inIpv6Cidr(value, ipv6ToBigIntRequired(network as string), prefix as number));
    }
    return !IPV6_NON_PUBLIC.some(([network, prefix]) => inIpv6Cidr(value, ipv6ToBigIntRequired(network), prefix));
  }
  return false;
}

export function sameIpAddress(left: string, right: string): boolean {
  const leftFamily = isIP(left);
  if (leftFamily === 0 || leftFamily !== isIP(right)) return false;
  return leftFamily === 4
    ? ipv4ToUint(left) === ipv4ToUint(right)
    : ipv6ToBigInt(left) === ipv6ToBigInt(right);
}

export function unbracket(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

const IPV4_NON_PUBLIC: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

const IPV6_NON_PUBLIC: ReadonlyArray<readonly [string, number]> = [
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
];

function ipv4ToUint(address: string): number {
  return address.split(".").map(Number).reduce((value, octet) => ((value << 8) | octet) >>> 0, 0);
}

function inIpv4Cidr(value: number, network: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffff_ffff << (32 - prefix)) >>> 0;
  return (value & mask) >>> 0 === (network & mask) >>> 0;
}

function ipv6ToBigIntRequired(address: string): bigint {
  const value = ipv6ToBigInt(address);
  if (value === null) throw new Error("Invalid internal IPv6 policy constant.");
  return value;
}

function ipv6ToBigInt(address: string): bigint | null {
  if (isIP(address) !== 6) return null;
  let normalized = address.toLowerCase();
  const dottedOffset = normalized.lastIndexOf(":");
  if (normalized.includes(".") && dottedOffset >= 0) {
    const embedded = normalized.slice(dottedOffset + 1);
    if (isIP(embedded) !== 4) return null;
    const value = ipv4ToUint(embedded);
    normalized = `${normalized.slice(0, dottedOffset)}:${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] === "" ? [] : halves[0]?.split(":") ?? [];
  const tail = halves.length === 1 || halves[1] === "" ? [] : halves[1]?.split(":") ?? [];
  const missing = 8 - head.length - tail.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...head, ...Array.from({ length: missing }, () => "0"), ...tail];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/u.test(group))) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

function inIpv6Cidr(value: bigint, network: bigint, prefix: number): boolean {
  const shift = BigInt(128 - prefix);
  return value >> shift === network >> shift;
}
