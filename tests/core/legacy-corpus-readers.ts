import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, cp, readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { ApnError } from "../../src/errors.js";
import { OperationService } from "../../src/operation-service.js";
import { StateStore } from "../../src/state.js";
import { RelayRetirementRepository, RelayUnsignedOperationRepository, type RelayUnsignedOperation } from "../../src/relay-unsigned-operation.js";
import { relaySourceTerminal } from "../../src/relay/lifecycle.js";
import { CircleRepository } from "../../src/circle-v2-evm/repository.js";
import { CircleExternalStore } from "../../src/circle-v2-evm/external-store.js";
import { CircleFundingExternalStore } from "../../src/circle-v2-evm/funding-external-store.js";
import { CircleNonceRetirementStore } from "../../src/circle-v2-evm/nonce-retirement-store.js";
import { CircleRetirementAuthorityStore } from "../../src/circle-v2-evm/nonce-retirement-authority.js";
import type { CircleKnownOperation } from "../../src/circle-v2-evm/funding-operation.js";
import { MerchantRepository } from "../../src/x402-merchant/repository.js";
import { GASZIP_DIRECT_ROUTES, gaszipCodec, inspectGaszipDelivery, inspectGaszipFundingQuote, type GaszipCorrelatedDelivery } from "../../src/lifi/gaszip-direct-route.js";
import { GaszipFundingJournal, publicGaszipFunding, sealGaszipFunding, validateGaszipFunding, type GaszipFundingRecord } from "../../src/lifi/gaszip-direct-journal.js";
import { GaszipFundingRpc, assertGaszipFundingFresh, proveGaszipDelivery, proveGaszipSafeTransaction, readGaszipFundingPlan, type GaszipRpcPort } from "../../src/lifi/gaszip-direct-rpc.js";
import { GaszipFundingService } from "../../src/lifi/gaszip-direct-service.js";
const SEI_ROUTE=GASZIP_DIRECT_ROUTES.sei,MEGA_ROUTE=GASZIP_DIRECT_ROUTES.mega,seiCodec=gaszipCodec(SEI_ROUTE),megaCodec=gaszipCodec(MEGA_ROUTE);
import { assertMetaMaskNativeConflictDomainAvailable, metaMaskNativeOperationExists } from "../../src/metamask-native-transfer-owner.js";
import { AssetUsageLedger, validateAssetUsageReservation } from "../../src/asset-usage-ledger.js";

/** The directories of the owner-bound families and the ledger rows that reference them; nothing else is kept in a case. */
export const LEGACY_CORPUS_DIRECTORIES = [
  "relay-unsigned-operations", "relay-retirements", "relay-effect-journals", "relay-native-source-journals",
  "relay-arbitrum-source-effect-journals", "circle-v2-evm", "circle-external-claims", "circle-external-evidence", "circle-v2-nonce-retirements", "merchant-x402", "merchant-retirement", "merchant-effect-claims", "merchant-material", "mega-gaszip", "sei-gaszip",
  "metamask-native-operations", "asset-usage",
] as const;
const LEDGER_BASE_KEYS = new Set(["schemaVersion", "reservationId", "idempotencyHash", "policyDigest", "registryVersion", "account", "chain",
  "asset", "rail", "amountAtomic", "state", "reservedAt", "updatedAt", "effectAt", "outcomeDigest", "reservationDigest"]);

/**
 * Copy one frozen case into a fresh state root with the owner-only modes the secure store requires. Every byte is
 * copied unchanged: a version 1 MetaMask native journal still names the home it was written under, which is never this
 * root, so the corpus also proves that moving the APN home voids no journal.
 */
export async function installLegacyCase(source: string, root: string): Promise<void> {
  await cp(source, root, { recursive: true });
  await ownerOnly(root);
}

/** Hash of every file outside `locks/`; readers may take locks but must not rewrite a stored record. */
export async function legacyCaseDigest(root: string): Promise<ReadonlyMap<string, string>> {
  const result = new Map<string, string>();
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name), name = relative(root, path);
      if (name === "locks") continue;
      if (entry.isDirectory()) await walk(path);
      else result.set(name, createHash("sha256").update(await readFile(path)).digest("hex"));
    }
  };
  await walk(root);
  return result;
}

/**
 * Every reader an owner-bound record meets in normal use: the cross-store enumeration `OperationService` runs on every
 * prepare (idempotency, profile and account conflicts), operation lookup and status, each family's own repository, the
 * Relay lifecycle sidecars, the MetaMask native conflict guard and the shared usage ledger. Returns the record kinds read.
 */
export async function readEveryLegacyRecord(root: string, at: Date): Promise<ReadonlySet<string>> {
  const kinds = new Set<string>(), profiles = new Set<string>();
  const service = new OperationService(new StateStore(root));
  assert.equal(await service.findIdempotency("0".repeat(64)), null);
  const visit = async (kind: string, operationId: string, ...profileHashes: readonly string[]): Promise<void> => {
    kinds.add(kind);
    assert.equal((await service.required(operationId)).record.operationId, operationId);
    assert.notEqual(await service.status(operationId), undefined);
    for (const profileHash of profileHashes) profiles.add(profileHash);
  };
  for (const op of await new RelayUnsignedOperationRepository(root).listAllOperations()) {
    await visit(relayKind(op), op.operationId, op.profileHash);
    const retired = await new RelayRetirementRepository(root).load(op) !== null;
    kinds.add(`relay-lifecycle:${retired ? "retired" : (await relaySourceTerminal(root, op))?.state ?? "active"}`);
  }
  for (const op of await new CircleRepository(root).listAllAny()) {
    await visit(`circle:${op.schemaVersion}:${op.destinationChain}:${op.state}`, op.operationId, op.profileHash, op.destinationProfileHash);
    for (const kind of await readCircleSidecars(root, op)) kinds.add(kind);
  }
  for (const op of await new MerchantRepository(root).listAllOperations()) await visit(`merchant:${op.state}`, op.operationId, op.profileHash);
  for (const op of await new GaszipFundingJournal(root,MEGA_ROUTE).listAllOperations()) await visit(`mega-gaszip:${op.state}`, op.operationId, op.profileHash);
  for (const op of await new GaszipFundingJournal(root,SEI_ROUTE).listAllOperations()) await visit(`sei-gaszip:${op.state}`, op.operationId, op.profileHash);
  for (const name of await jsonNames(root, "metamask-native-operations")) {
    assert.equal(await metaMaskNativeOperationExists(root, name.slice(0, -5)), true);
    const op = JSON.parse(await readFile(join(root, "metamask-native-operations", name), "utf8")) as
      { readonly state: string; readonly context: { readonly quote: { readonly chainId: number; readonly sender: string } } };
    kinds.add(`metamask-native:${op.state}`);
    await allowedOrBlocked(assertMetaMaskNativeConflictDomainAvailable(root, op.context.quote.chainId, op.context.quote.sender));
  }
  for (const profileHash of profiles) await allowedOrBlocked(service.assertProfileAvailable(profileHash));
  const ledger = new AssetUsageLedger(root);
  for (const bucket of await directoryNames(root, "asset-usage")) {
    for (const name of await jsonNames(root, `asset-usage/${bucket}`)) {
      const record = validateAssetUsageReservation(JSON.parse(await readFile(join(root, "asset-usage", bucket, name), "utf8")));
      const identity = { account: record.account, chain: record.chain, asset: record.asset };
      assert.deepEqual(await ledger.load(identity, record.reservationId), record);
      await ledger.usage(identity, at);
      const extra = Object.keys(record).filter((key) => !LEDGER_BASE_KEYS.has(key)).sort().join("+");
      kinds.add(`ledger:${record.rail}:${extra === "" ? "plain" : extra}:${record.state}`);
    }
  }
  return kinds;
}

/** External fulfilment claims and evidence, and nonce-retirement intent, authority and claims, through their own stores. */
async function readCircleSidecars(root: string, op: CircleKnownOperation): Promise<readonly string[]> {
  const kinds: string[] = [];
  if (op.schemaVersion === "apn.circle-v2-evm-operation.v2") {
    const external = new CircleFundingExternalStore(root);
    if (await external.readClaim(op) !== null) kinds.push("circle-sidecar:v2:external-claim");
    if (op.externalFulfillment !== undefined && await hasEvidence(root, op.externalFulfillment.evidenceHash)) {
      await external.evidence(op.externalFulfillment); kinds.push("circle-sidecar:v2:external-evidence");
    }
    return kinds;
  }
  const external = new CircleExternalStore(root);
  if (await external.readClaim(op) !== null) kinds.push("circle-sidecar:v1:external-claim");
  if (op.externalFulfillment !== undefined && await hasEvidence(root, op.externalFulfillment.evidenceHash)) {
    await external.evidence(op.externalFulfillment); kinds.push("circle-sidecar:v1:external-evidence");
  }
  const retirements = new CircleNonceRetirementStore(root), intent = await retirements.intent(op);
  if (intent !== null) kinds.push(`circle-sidecar:v1:retirement-intent:${intent.version}`);
  if ((await jsonNames(root, "circle-v2-nonce-retirements", `${op.operationId}-authority.json`)).length > 0) {
    assert.notEqual(await new CircleRetirementAuthorityStore(root).load(op), null);
    kinds.push("circle-sidecar:v1:retirement-authority");
    for (const boundary of ["sign", "send"] as const) if (await retirements.hasClaim(op, boundary)) kinds.push(`circle-sidecar:v1:retirement-claim:${boundary}`);
  }
  return kinds;
}

/** A corpus case may omit a very large RPC-trace evidence file; the reader then skips only that evidence read. */
async function hasEvidence(root: string, evidenceHash: string): Promise<boolean> {
  return (await jsonNames(root, "circle-external-evidence", `${evidenceHash}.json`)).length === 1;
}

function relayKind(op: RelayUnsignedOperation): string {
  const lane = op.arbitrumDraft !== undefined ? "arbitrum-draft"
    : op.nativeQuote !== undefined ? `native:${op.nativeQuote.routeReference}`
      : op.quote !== undefined ? `erc20:${op.quote.routeReference ?? "ethereum-usdc-bnb-native-v1"}` : `quote-less:${op.destinationChainId}`;
  return `relay:${lane}${op.policyDigest === undefined ? ":policy-unbound" : ""}`;
}

/** A conflict guard may refuse a new operation while one of these is unresolved; it must never find a record corrupt. */
async function allowedOrBlocked(check: Promise<unknown>): Promise<void> {
  try { await check; }
  catch (error) { if (!(error instanceof ApnError) || error.code !== "APN_OPERATION_BLOCKED") throw error; }
}

async function ownerOnly(path: string): Promise<void> {
  await chmod(path, 0o700);
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory()) await ownerOnly(join(path, entry.name));
    else await chmod(join(path, entry.name), 0o600);
  }
}

async function directoryNames(root: string, directory: string): Promise<readonly string[]> {
  try { return (await readdir(join(root, directory), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

async function jsonNames(root: string, directory: string, exact?: string): Promise<readonly string[]> {
  try { return (await readdir(join(root, directory))).filter((name) => exact === undefined ? /^[a-f0-9]{64}\.json$/u.test(name) : name === exact).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
