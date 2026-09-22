import { sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { parsePublicHttpsUrl } from "../../network-policy.js";
import { rpcEndpointIdentity, rpcProviderFamily } from "../../lifi/rpc-session.js";

export const TOKEN_PRIMARY_POOL_ENV = "APN_UNISWAP_TOKEN_PRIMARY_RPC_URLS";
export const TOKEN_PRIMARY_POOL_MAX = 3;

export interface TokenPrimaryCandidate {
  readonly url: URL;
  readonly id: string;
  readonly familyHash: string;
}

export type TokenPrimaryFailureReason = "cooldown" | "deadline" | "rate_limited" | "http_5xx" |
  "authentication" | "malformed" | "wrong_chain" | "capability";

export interface TokenPrimaryAttemptTelemetry {
  readonly providerId: string;
  readonly outcome: "selected" | "failed" | "cooldown_skipped";
  readonly reason: TokenPrimaryFailureReason | null;
}

export interface TokenPrimaryPoolTelemetry {
  readonly schemaVersion: "apn.uniswap-token-primary-pool-telemetry.v1";
  readonly configuredCandidates: number;
  readonly selectedProviderId: string | null;
  readonly attempts: readonly TokenPrimaryAttemptTelemetry[];
}

export function tokenPrimaryCandidates(environment: Readonly<Record<string, string | undefined>>): readonly TokenPrimaryCandidate[] {
  const configured = environment[TOKEN_PRIMARY_POOL_ENV];
  const values = configured === undefined || configured === "" ? scalar(environment) : array(configured);
  const endpoints = values.map((value) => endpoint(value));
  const identities = new Set<string>(), families = new Set<string>();
  for (const candidate of endpoints) {
    const identity = rpcEndpointIdentity(candidate.toString()), family = rpcProviderFamily(candidate.toString());
    if (identities.has(identity) || families.has(family)) invalid("duplicate_primary_provider");
    identities.add(identity); families.add(family);
  }
  const archiveValue = environment.APN_ETHEREUM_ARCHIVE_RPC_URL;
  if (archiveValue !== undefined && archiveValue !== "") {
    const archive = endpoint(archiveValue);
    if (endpoints.some((candidate) => candidate.origin === archive.origin)) invalid("archive_primary_not_distinct");
  }
  return endpoints.map((url) => ({ url, id: sha256(`apn.uniswap-token-primary-provider.v1\0${url.toString()}`),
    familyHash: sha256(`rpc-provider-family\0${rpcProviderFamily(url.toString())}`) }));
}

function scalar(environment: Readonly<Record<string, string | undefined>>): readonly string[] {
  const value = environment.APN_ETHEREUM_RPC_URL;
  if (value === undefined || value === "") throw new ApnError("APN_RPC_CONFIG", "Uniswap token RPC requires an Ethereum primary endpoint.",
    { reason: "missing_APN_ETHEREUM_RPC_URL" });
  return [value];
}

function array(raw: string): readonly string[] {
  if (Buffer.byteLength(raw, "utf8") > 8_192) invalid("primary_pool_size");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return invalid("primary_pool_json"); }
  if (!Array.isArray(value) || value.length < 1 || value.length > TOKEN_PRIMARY_POOL_MAX ||
      value.some((item) => typeof item !== "string" || item.length === 0)) invalid("primary_pool_shape");
  return value as readonly string[];
}

function endpoint(value: string): URL {
  const parsed = parsePublicHttpsUrl(value, "APN_RPC_CONFIG", "Uniswap token primary RPC endpoint", 2_048);
  if (parsed.search !== "" || parsed.hash !== "") invalid("primary_RPC_query_forbidden");
  return parsed;
}

function invalid(reason: string): never {
  throw new ApnError("APN_RPC_CONFIG", "Uniswap token primary RPC pool configuration is invalid.", { reason });
}
