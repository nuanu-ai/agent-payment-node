import { randomBytes } from "node:crypto";
import { constants, type Dirent, type Stats } from "node:fs";
import {
  type FileHandle,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, parse, relative, resolve, sep } from "node:path";
import { canonicalJson, isPlainRecord, sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import { MacosAdvisoryLock, type AdvisoryLockPort } from "./macos-advisory-lock.js";
import { validateProviderProfile, type ProviderProfileRecord } from "./provider-profile.js";
import { assertDirectTerminalReceiptAuthority } from "./direct-terminal-receipt.js";
import { validateEvmOperationWrite } from "./evm-operation-write.js";
import type {
  OperationRecord,
  ReceiptRecord,
  WalletRecord,
} from "./model.js";
import { validateOperation, validateReceipt, validateWallet } from "./state-integrity.js";
import {
  isCode,
  SecureStateStore,
  stateCorrupt,
  stateIdentifier,
  stateSecurity,
  validateDirectory,
} from "./secure-state-store.js";
import { validateX402AppendOnly, validateX402ScanContinuity } from "./x402-state-continuity.js";
import {
  x402TransactionHintSourceBindingHash,
  validateX402Operation,
  validateX402Receipt,
  validateX402Result,
  type X402OperationRecord,
  type X402ReceiptRecord,
  type X402ResultRecord,
} from "./x402-state-integrity.js";
import { validateX402RecoveryReceiptAuthority, validateX402TerminalGraph } from "./state-x402-graph.js";

export { appendTransition, sealOperation, sealReceipt, sealWallet } from "./state-integrity.js";
const PROVIDER_X402_OPERATION_SCHEMAS = new Set<unknown>(["apn.provider-x402.state.v1", "apn.provider-x402.state.v2"]);
const PROVIDER_X402_RECEIPT_SCHEMA = "apn.provider-x402.receipt.v1";

export class StateStore extends SecureStateStore {
  async loadRpcProviderPacing(familyHash: string): Promise<number | null> {
    stateIdentifier(familyHash, "RPC provider family hash");
    return (await this.rpcProviderPacingRecord(familyHash))?.lastStartMs ?? null;
  }

  async writeRpcProviderPacing(familyHash: string, lastStartMs: number): Promise<void> {
    stateIdentifier(familyHash, "RPC provider family hash");
    if (!Number.isSafeInteger(lastStartMs) || lastStartMs < 0) stateCorrupt("RPC provider pacing timestamp is invalid.");
    const current = await this.rpcProviderPacingRecord(familyHash);
    await this.ensureDirectory("rpc-provider-pacing");
    await this.writeJson(join("rpc-provider-pacing", `${familyHash}.json`),
      { schemaVersion: "apn.rpc-provider-pacing.v2", familyHash, lastStartMs, cooldownUntilMs: current?.cooldownUntilMs ?? null });
  }

  async loadRpcProviderCooldown(familyHash: string): Promise<number | null> {
    stateIdentifier(familyHash, "RPC provider family hash");
    return (await this.rpcProviderPacingRecord(familyHash))?.cooldownUntilMs ?? null;
  }

  async writeRpcProviderCooldown(familyHash: string, cooldownUntilMs: number): Promise<void> {
    stateIdentifier(familyHash, "RPC provider family hash");
    if (!Number.isSafeInteger(cooldownUntilMs) || cooldownUntilMs < 0) stateCorrupt("RPC provider cooldown timestamp is invalid.");
    const current = await this.rpcProviderPacingRecord(familyHash);
    await this.ensureDirectory("rpc-provider-pacing");
    await this.writeJson(join("rpc-provider-pacing", `${familyHash}.json`),
      { schemaVersion: "apn.rpc-provider-pacing.v2", familyHash, lastStartMs: current?.lastStartMs ?? null, cooldownUntilMs });
  }

  private async rpcProviderPacingRecord(familyHash: string): Promise<{ readonly lastStartMs: number | null; readonly cooldownUntilMs: number | null } | null> {
    const value = await this.readJson(join("rpc-provider-pacing", `${familyHash}.json`));
    if (value === null) return null;
    const v1 = isPlainRecord(value) && value.schemaVersion === "apn.rpc-provider-pacing.v1" && value.familyHash === familyHash &&
      typeof value.lastStartMs === "number" && Number.isSafeInteger(value.lastStartMs) && value.lastStartMs >= 0 &&
      !Object.keys(value).some((key) => !["schemaVersion", "familyHash", "lastStartMs"].includes(key));
    if (v1) return { lastStartMs: value.lastStartMs as number, cooldownUntilMs: null };
    const validTimestamp = (candidate: unknown) => candidate === null || typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate >= 0;
    if (!isPlainRecord(value) || value.schemaVersion !== "apn.rpc-provider-pacing.v2" || value.familyHash !== familyHash ||
      !validTimestamp(value.lastStartMs) || !validTimestamp(value.cooldownUntilMs) ||
      Object.keys(value).some((key) => !["schemaVersion", "familyHash", "lastStartMs", "cooldownUntilMs"].includes(key))) {
      stateCorrupt("RPC provider pacing record is invalid.");
    }
    return { lastStartMs: value.lastStartMs as number | null, cooldownUntilMs: value.cooldownUntilMs as number | null };
  }

  async loadWallet(profileHash: string): Promise<WalletRecord | null> {
    const value = await this.readJson(join("wallets", profileHash, "wallet.json"));
    return value === null ? null : validateWallet(value);
  }

  async loadWalletArtifacts(
    profile: string,
    profileHash: string,
  ): Promise<{ readonly stored: WalletRecord | null; readonly encrypted: unknown | null }> {
    stateIdentifier(profileHash, "profile hash");
    await this.assertNoSymlinkAncestors(this.root);
    let rootStats: Stats;
    try {
      rootStats = await lstat(this.root);
    } catch (error) {
      if (isCode(error, "ENOENT")) return { stored: null, encrypted: null };
      throw error;
    }
    validateDirectory(rootStats, true);
    if (await realpath(this.root) !== this.root) stateSecurity("State root resolves through an alias or symbolic link.");
    const [stored, encrypted] = await Promise.all([
      this.loadWallet(profileHash),
      this.loadEncryptedWalletEnvelope(profile),
    ]);
    return { stored, encrypted };
  }

  async writeWallet(wallet: WalletRecord): Promise<void> {
    await this.ensureDirectory(join("wallets", wallet.profileHash));
    await this.writeJson(join("wallets", wallet.profileHash, "wallet.json"), wallet);
  }
  async writeNewWallet(wallet: WalletRecord): Promise<void> { await this.ensureDirectory(join("wallets", wallet.profileHash)); await this.writeJson(join("wallets", wallet.profileHash, "wallet.json"), wallet, true); }
  async walletImportEntries(): Promise<readonly Dirent[]> { return await this.readDirectory("wallets"); }
  async loadProviderProfile(profileHash: string): Promise<ProviderProfileRecord | null> {
    stateIdentifier(profileHash, "profile hash");
    const value = await this.readJson(join("profiles", profileHash, "profile.json"));
    if (value === null) return null;
    const profile = validateProviderProfile(value);
    if (profile.profile_hash !== profileHash) stateCorrupt("Provider profile path does not match its identity.");
    return profile;
  }
  async profileImportEntries(): Promise<readonly Dirent[]> { return await this.readDirectory("profiles"); }

  async writeProviderProfile(profile: ProviderProfileRecord): Promise<void> {
    validateProviderProfile(profile);
    await this.ensureDirectory(join("profiles", profile.profile_hash));
    await this.writeJson(join("profiles", profile.profile_hash, "profile.json"), profile);
  }
  async writeNewProviderProfile(profile: ProviderProfileRecord): Promise<void> { validateProviderProfile(profile); await this.ensureDirectory(join("profiles", profile.profile_hash)); await this.writeJson(join("profiles", profile.profile_hash, "profile.json"), profile, true); }
  async removeProviderProfile(profileHash: string): Promise<void> {
    stateIdentifier(profileHash, "profile hash");
    await this.removeFile(join("profiles", profileHash, "profile.json"));
  }
  async loadEncryptedWalletEnvelope(profile: string): Promise<unknown | null> {
    return await this.readJson(join("wallets", `${profile}.json`));
  }

  async writeEncryptedWalletEnvelope(profile: string, envelope: unknown): Promise<void> {
    await this.writeJson(join("wallets", `${profile}.json`), envelope);
  }
  async writeNewEncryptedWalletEnvelope(profile: string, envelope: unknown): Promise<void> { await this.writeJson(join("wallets", `${profile}.json`), envelope, true); }
  async loadEncryptedPolicyEnvelope(profile: string): Promise<unknown | null> {
    return await this.readJson(join("policies", `${profile}.json`));
  }

  async writeEncryptedPolicyEnvelope(profile: string, envelope: unknown): Promise<void> {
    await this.writeJson(join("policies", `${profile}.json`), envelope);
  }
  async loadOperation(profileHash: string, operationId: string): Promise<OperationRecord | null> {
    const value = await this.readJson(join("operations", profileHash, `${operationId}.json`));
    if (value === null) return null;
    const operation = validateOperation(value);
    if ((operation.providerDirect !== undefined || operation.evm !== undefined) && operation.terminal) {
      assertDirectTerminalReceiptAuthority(operation, await this.loadReceipt(profileHash, operationId));
    }
    return operation;
  }
  async findOperation(operationId: string): Promise<OperationRecord | null> {
    const entries = await this.readDirectory("operations");
    let found: OperationRecord | null = null;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9]{64}$/.test(entry.name)) {
        stateSecurity("Operations root contains an unsafe profile entry.");
      }
      const candidate = await this.loadOperation(entry.name, operationId);
      if (candidate !== null) {
        if (found !== null) stateCorrupt("Operation ID is duplicated across profiles.");
        found = candidate;
      }
    }
    return found;
  }
  async writeOperation(operation: OperationRecord): Promise<void> {
    await this.ensureDirectory(join("operations", operation.profileHash));
    validateEvmOperationWrite(operation, await this.readJson(join("operations", operation.profileHash, `${operation.operationId}.json`)));
    await this.writeJson(join("operations", operation.profileHash, `${operation.operationId}.json`), operation);
  }
  async listOperations(profileHash: string): Promise<readonly OperationRecord[]> {
    const directory = join("operations", profileHash);
    const entries = await this.readDirectory(directory);
    const operations: OperationRecord[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) {
        stateSecurity("Operations directory contains an unsafe entry.");
      }
      const operationId = entry.name.slice(0, -".json".length);
      const operation = await this.loadOperation(profileHash, operationId);
      if (operation === null) stateCorrupt("Operation disappeared during validation.");
      if (operation.profileHash !== profileHash || operation.operationId !== operationId) {
        stateCorrupt("Operation path binding is invalid.");
      }
      operations.push(operation);
    }
    return operations;
  }
  async listAllOperations(): Promise<readonly OperationRecord[]> {
    const profiles = await this.operationProfiles("operations");
    const operations: OperationRecord[] = [];
    for (const profileHash of profiles) operations.push(...await this.listOperations(profileHash));
    return operations;
  }

  async loadX402Operation(profileHash: string, operationId: string): Promise<X402OperationRecord | null> {
    stateIdentifier(profileHash, "x402 profile hash");
    stateIdentifier(operationId, "x402 operation ID");
    const value = await this.readJson(join("x402-operations", profileHash, `${operationId}.json`));
    if (value === null) return null;
    if (PROVIDER_X402_OPERATION_SCHEMAS.has(storedSchema(value))) return null;
    const operation = validateX402Operation(value);
    if (operation.profileHash !== profileHash || operation.operationId !== operationId) {
      stateCorrupt("x402 operation path binding is invalid.");
    }
    await validateX402TerminalGraph((path) => this.readJson(path), operation);
    return operation;
  }

  async findX402Operation(operationId: string): Promise<X402OperationRecord | null> {
    stateIdentifier(operationId, "x402 operation ID");
    const profiles = await this.operationProfiles("x402-operations");
    let found: X402OperationRecord | null = null;
    for (const profileHash of profiles) {
      const candidate = await this.loadX402Operation(profileHash, operationId);
      if (candidate !== null) {
        if (found !== null) stateCorrupt("x402 operation ID is duplicated across profiles.");
        found = candidate;
      }
    }
    return found;
  }

  async writeX402Operation(operation: X402OperationRecord): Promise<void> {
    validateX402Operation(operation);
    stateIdentifier(operation.profileHash, "x402 profile hash");
    stateIdentifier(operation.operationId, "x402 operation ID");
    const path = join("x402-operations", operation.profileHash, `${operation.operationId}.json`);
    const stored = await this.readJson(path);
    if (stored !== null && PROVIDER_X402_OPERATION_SCHEMAS.has(storedSchema(stored))) {
      stateCorrupt("Local x402 operation path is occupied by another strategy.");
    }
    const previous = stored === null ? null : validateX402Operation(stored);
    if (previous !== null) {
      validateX402AppendOnly(previous, operation);
      validateX402ScanContinuity(previous, operation);
    }
    await validateX402TerminalGraph((path) => this.readJson(path), operation);
    await this.ensureDirectory(join("x402-operations", operation.profileHash));
    await this.writeJson(path, operation);
  }

  async listX402Operations(profileHash: string): Promise<readonly X402OperationRecord[]> {
    stateIdentifier(profileHash, "x402 profile hash");
    const directory = join("x402-operations", profileHash);
    const entries = await this.readDirectory(directory);
    const operations: X402OperationRecord[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) {
        stateSecurity("x402 operations directory contains an unsafe entry.");
      }
      const value = await this.readJson(join(directory, entry.name));
      if (value === null) stateCorrupt("x402 operation disappeared during validation.");
      if (PROVIDER_X402_OPERATION_SCHEMAS.has(storedSchema(value))) continue;
      const operation = validateX402Operation(value);
      const operationId = entry.name.slice(0, -".json".length);
      if (operation.profileHash !== profileHash || operation.operationId !== operationId) {
        stateCorrupt("x402 operation path binding is invalid.");
      }
      await validateX402TerminalGraph((path) => this.readJson(path), operation);
      operations.push(operation);
    }
    return operations;
  }

  async listAllX402Operations(): Promise<readonly X402OperationRecord[]> {
    const profiles = await this.operationProfiles("x402-operations");
    const operations: X402OperationRecord[] = [];
    for (const profileHash of profiles) operations.push(...await this.listX402Operations(profileHash));
    return operations;
  }

  async loadX402Result(profileHash: string, operationId: string): Promise<X402ResultRecord | null> {
    stateIdentifier(profileHash, "x402 profile hash");
    stateIdentifier(operationId, "x402 operation ID");
    const operation = await this.findX402Operation(operationId);
    if (operation === null || operation.resultLink === undefined) return null;
    if (operation.profileHash !== profileHash) stateCorrupt("x402 result profile does not bind its authoritative operation.");
    const value = await this.readJson(join("x402-results", profileHash, `${operationId}.json`));
    if (value === null) return null;
    const result = validateX402Result(value);
    if (result.operationId !== operationId) stateCorrupt("x402 result path binding is invalid.");
    return result;
  }

  /** Exact-path crash recovery only; ordinary result readers intentionally hide unlinked artifacts. */
  async loadX402RecoveryResult(profileHash: string, operationId: string): Promise<X402ResultRecord | null> {
    stateIdentifier(profileHash, "x402 profile hash");
    stateIdentifier(operationId, "x402 operation ID");
    const operation = await this.loadX402Operation(profileHash, operationId);
    if (operation === null || operation.terminal || operation.resultLink !== undefined) return null;
    const value = await this.readJson(join("x402-results", profileHash, `${operationId}.json`));
    if (value === null) return null;
    const result = validateX402Result(value);
    if (result.operationId !== operationId) stateCorrupt("x402 recovery result path binding is invalid.");
    return result;
  }

  async findX402Result(operationId: string): Promise<X402ResultRecord | null> {
    stateIdentifier(operationId, "x402 operation ID");
    const profiles = await this.operationProfiles("x402-results");
    let found: X402ResultRecord | null = null;
    for (const profileHash of profiles) {
      const candidate = await this.loadX402Result(profileHash, operationId);
      if (candidate !== null) {
        if (found !== null) stateCorrupt("x402 result ID is duplicated across profiles.");
        found = candidate;
      }
    }
    return found;
  }

  async writeX402Result(profileHash: string, result: X402ResultRecord): Promise<void> {
    stateIdentifier(profileHash, "x402 profile hash");
    stateIdentifier(result.operationId, "x402 operation ID");
    validateX402Result(result);
    const operation = await this.findX402Operation(result.operationId);
    if (operation === null) stateCorrupt("x402 result has no authoritative operation.");
    if (operation.profileHash !== profileHash) stateCorrupt("x402 result profile does not bind its authoritative operation.");
    if (operation.terminal) stateCorrupt("x402 result cannot overwrite a terminal operation graph.");
    if (operation.resultLink !== undefined) stateCorrupt("x402 result cannot overwrite a linked result graph.");
    await this.ensureDirectory(join("x402-results", profileHash));
    await this.writeJson(join("x402-results", profileHash, `${result.operationId}.json`), result);
  }

  async listX402Results(profileHash: string): Promise<readonly X402ResultRecord[]> {
    stateIdentifier(profileHash, "x402 profile hash");
    const directory = join("x402-results", profileHash);
    const entries = await this.readDirectory(directory);
    const results: X402ResultRecord[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) stateSecurity("x402 results directory contains an unsafe entry.");
      const operationId = entry.name.slice(0, -".json".length);
      const result = await this.loadX402Result(profileHash, operationId);
      if (result !== null) results.push(result);
    }
    return results;
  }

  async loadX402Receipt(profileHash: string, operationId: string): Promise<X402ReceiptRecord | null> {
    stateIdentifier(profileHash, "x402 profile hash");
    stateIdentifier(operationId, "x402 operation ID");
    const operation = await this.findX402Operation(operationId);
    if (operation === null || !operation.terminal || operation.receiptLink === undefined) return null;
    if (operation.profileHash !== profileHash) stateCorrupt("x402 receipt profile does not bind its authoritative operation.");
    const value = await this.readJson(join("x402-receipts", profileHash, `${operationId}.json`));
    if (value === null) return null;
    const receipt = validateX402Receipt(value);
    if (receipt.operationId !== operationId) stateCorrupt("x402 receipt path binding is invalid.");
    return receipt;
  }

  /** Exact-path crash recovery only; ordinary receipt readers intentionally hide unlinked artifacts. */
  async loadX402RecoveryReceipt(profileHash: string, operationId: string): Promise<X402ReceiptRecord | null> {
    stateIdentifier(profileHash, "x402 profile hash");
    stateIdentifier(operationId, "x402 operation ID");
    const operation = await this.loadX402Operation(profileHash, operationId);
    if (operation === null || operation.terminal || operation.receiptLink !== undefined) return null;
    const value = await this.readJson(join("x402-receipts", profileHash, `${operationId}.json`));
    if (value === null) return null;
    const receipt = validateX402Receipt(value);
    if (receipt.operationId !== operationId) stateCorrupt("x402 recovery receipt path binding is invalid.");
    validateX402RecoveryReceiptAuthority(operation, receipt);
    if (receipt.result !== undefined) {
      const resultValue = await this.readJson(join("x402-results", profileHash, `${operationId}.json`));
      if (resultValue === null) stateCorrupt("x402 recovery receipt has a dangling result.");
      const result = validateX402Result(resultValue);
      if (
        result.operationId !== operationId || result.resultHash !== receipt.result.resultHash ||
        result.integrityHash !== receipt.result.resultIntegrityHash || result.mediaType !== receipt.result.mediaType ||
        result.byteLength !== receipt.result.byteLength
      ) stateCorrupt("x402 recovery receipt result binding is invalid.");
    }
    return receipt;
  }

  async findX402Receipt(operationId: string): Promise<X402ReceiptRecord | null> {
    stateIdentifier(operationId, "x402 operation ID");
    const profiles = await this.operationProfiles("x402-receipts");
    let found: X402ReceiptRecord | null = null;
    for (const profileHash of profiles) {
      const candidate = await this.loadX402Receipt(profileHash, operationId);
      if (candidate !== null) {
        if (found !== null) stateCorrupt("x402 receipt ID is duplicated across profiles.");
        found = candidate;
      }
    }
    return found;
  }

  async writeX402Receipt(profileHash: string, receipt: X402ReceiptRecord): Promise<void> {
    stateIdentifier(profileHash, "x402 profile hash");
    stateIdentifier(receipt.operationId, "x402 operation ID");
    validateX402Receipt(receipt);
    const operation = await this.findX402Operation(receipt.operationId);
    if (operation === null) stateCorrupt("x402 receipt has no authoritative operation.");
    if (operation.profileHash !== profileHash) stateCorrupt("x402 receipt profile does not bind its authoritative operation.");
    if (operation.terminal) stateCorrupt("x402 receipt cannot overwrite a terminal operation graph.");
    validateX402RecoveryReceiptAuthority(operation, receipt);
    const path = join("x402-receipts", profileHash, `${receipt.operationId}.json`);
    const stored = await this.readJson(path);
    if (stored !== null && storedSchema(stored) === PROVIDER_X402_RECEIPT_SCHEMA) {
      stateCorrupt("Local x402 receipt path is occupied by the provider strategy.");
    }
    await this.ensureDirectory(join("x402-receipts", profileHash));
    await this.writeJson(path, receipt);
  }

  async listX402Receipts(profileHash: string): Promise<readonly X402ReceiptRecord[]> {
    stateIdentifier(profileHash, "x402 profile hash");
    const directory = join("x402-receipts", profileHash);
    const entries = await this.readDirectory(directory);
    const receipts: X402ReceiptRecord[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) stateSecurity("x402 receipts directory contains an unsafe entry.");
      const operationId = entry.name.slice(0, -".json".length);
      const receipt = await this.loadX402Receipt(profileHash, operationId);
      if (receipt !== null) receipts.push(receipt);
    }
    return receipts;
  }

  async loadReceipt(profileHash: string, operationId: string): Promise<ReceiptRecord | null> {
    const value = await this.readJson(join("receipts", profileHash, `${operationId}.json`));
    return value === null ? null : validateReceipt(value);
  }

  async writeReceipt(profileHash: string, receipt: ReceiptRecord): Promise<void> {
    await this.ensureDirectory(join("receipts", profileHash));
    await this.writeJson(join("receipts", profileHash, `${receipt.operationId}.json`), receipt);
  }
  private async operationProfiles(rootName: "operations" | "x402-operations" | "x402-results" | "x402-receipts"): Promise<readonly string[]> {
    const entries = await this.readDirectory(rootName);
    const profiles: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9]{64}$/.test(entry.name)) {
        stateSecurity(`${rootName} root contains an unsafe profile entry.`);
      }
      profiles.push(entry.name);
    }
    return profiles.sort();
  }
}

function storedSchema(value: unknown): unknown { return isPlainRecord(value) ? value.schemaVersion : undefined; }
