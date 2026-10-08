import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../vendor/metamask-smart-account/", import.meta.url);
const MANIFEST_SHA256 = "ff253d54bfb8082ebb7e753d4125303aa84a421566dc11490936ece27448ddc3";
const MAX_BYTES = 4 * 1024 * 1024;
const entries = new Set(["smart-utils", "smart-root", "smart-actions", "smart-contracts", "permission-types", "smart-experimental", "x402-client", "delegation-core"]);
let verified = false;
function reject(): never { throw new Error("APN Smart Account vendor integrity rejected"); }
function read(name: string, maximum: number): Buffer {
  const path = fileURLToPath(new URL(name, root)), stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) reject();
  return readFileSync(path);
}
function digest(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function verify(): void {
  if (verified) return;
  const stat = lstatSync(fileURLToPath(root).replace(/\/$/u, "")); if (!stat.isDirectory() || stat.isSymbolicLink()) reject();
  const bytes = read("manifest.json", 65536); if (digest(bytes) !== MANIFEST_SHA256) reject();
  const manifest = JSON.parse(bytes.toString("utf8")) as { files: Record<string, { bytes: number; sha256: string }> };
  let total = 0;
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (!/^[A-Za-z0-9_-]+\.mjs(?:\.LEGAL\.txt)?$/u.test(name)) reject();
    total += expected.bytes; if (total > MAX_BYTES) reject();
    const content = read(name, expected.bytes);
    if (content.length !== expected.bytes || digest(content) !== expected.sha256) reject();
  }
  verified = true;
}
async function load<T>(name: string): Promise<T> {
  if (!entries.has(name)) reject(); verify();
  return await import(new URL(`${name}.mjs`, root).href) as T;
}
export const verifySmartAccountVendor = verify;
export const { SIGNABLE_DELEGATION_TYPED_DATA, decodeDelegations, encodeDelegations, toDelegationStruct }: Pick<typeof import("@metamask/smart-accounts-kit/utils"), "SIGNABLE_DELEGATION_TYPED_DATA" | "decodeDelegations" | "encodeDelegations" | "toDelegationStruct"> = await load("smart-utils");
export const { ExecutionMode, ROOT_AUTHORITY, createExecution, getSmartAccountsEnvironment }: Pick<typeof import("@metamask/smart-accounts-kit"), "ExecutionMode" | "ROOT_AUTHORITY" | "createExecution" | "getSmartAccountsEnvironment"> = await load("smart-root");
export const { getErc20PeriodTransferEnforcerAvailableAmount, redelegatePermissionContextAction }: Pick<typeof import("@metamask/smart-accounts-kit/actions"), "getErc20PeriodTransferEnforcerAvailableAmount" | "redelegatePermissionContextAction"> = await load("smart-actions");
export const { DelegationManager }: Pick<typeof import("@metamask/smart-accounts-kit/contracts"), "DelegationManager"> = await load("smart-contracts");
export const { ALL_METAMASK_FACILITATOR_ADDRESSES, METAMASK_FACILITATOR_ADDRESSES, makePermissionDecoderConfigs, createErc20TokenAllowanceCaveats }: Pick<typeof import("@metamask/7715-permission-types"), "ALL_METAMASK_FACILITATOR_ADDRESSES" | "METAMASK_FACILITATOR_ADDRESSES" | "makePermissionDecoderConfigs" | "createErc20TokenAllowanceCaveats"> = await load("permission-types");
export const { createx402DelegationProvider }: Pick<typeof import("@metamask/smart-accounts-kit/experimental"), "createx402DelegationProvider"> = await load("smart-experimental");
export const { x402Erc7710Client }: Pick<typeof import("@metamask/x402"), "x402Erc7710Client"> = await load("x402-client");
export type { PermissionContext } from "@metamask/smart-accounts-kit";
export type { EnforcerAddressesByName } from "@metamask/7715-permission-types";
export const { ANY_BENEFICIARY, decodeAllowedCalldataTerms, decodeERC20TransferAmountTerms, decodeRedeemerTerms, decodeTimestampTerms, decodeValueLteTerms, hashDelegation }: Pick<typeof import("@metamask/delegation-core"), "ANY_BENEFICIARY" | "decodeAllowedCalldataTerms" | "decodeERC20TransferAmountTerms" | "decodeRedeemerTerms" | "decodeTimestampTerms" | "decodeValueLteTerms" | "hashDelegation"> = await load("delegation-core");
