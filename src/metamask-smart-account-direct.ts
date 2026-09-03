import {
  ExecutionMode,
  createExecution,
  type PermissionContext,
} from "@metamask/smart-accounts-kit";
import {
  getErc20PeriodTransferEnforcerAvailableAmount,
  redelegatePermissionContextAction,
} from "@metamask/smart-accounts-kit/actions";
import { DelegationManager } from "@metamask/smart-accounts-kit/contracts";
import { decodeDelegations, encodeDelegations } from "@metamask/smart-accounts-kit/utils";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { sha256 } from "./canonical.js";
import { BASE_USDC, CHAIN_ID } from "./constants.js";
import type {
  SmartAccountDirectEffectRecord,
  SmartAccountDirectEffectStorePort,
} from "./encrypted-smart-account-direct-effect-store.js";
import type { SmartAccountPermissionStorePort } from "./encrypted-smart-account-permission-store.js";
import { ApnError } from "./errors.js";
import { smartAccountEnvironment } from "./metamask-smart-account-grant.js";
import {
  isGrantedPermissionRecord,
  type GrantedSmartAccountPermissionRecord,
} from "./metamask-smart-account-record.js";
import type { Address, Economics, Hex, ProviderDelegatedDirectBinding } from "./model.js";
import type { RpcPort } from "./ports.js";
import type {
  DirectExecutionPort,
  ProviderDelegatedDirectPreparation,
  ProviderDirectExecutionInput,
  ProviderDirectPrepareInput,
} from "./provider-ports.js";

const ERC20_ABI = [{
  type: "function",
  name: "transfer",
  stateMutability: "nonpayable",
  inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ name: "", type: "bool" }],
}] as const;

export interface SmartAccountAllowancePort {
  available(record: GrantedSmartAccountPermissionRecord): Promise<string>;
}

interface RedemptionMaterial {
  readonly childContext: Hex;
  readonly childFingerprint: string;
  readonly calldata: Hex;
}

export interface SmartAccountDelegationEnginePort {
  createRedemption(input: {
    readonly record: GrantedSmartAccountPermissionRecord;
    readonly operationId: string;
    readonly fingerprint: string;
    readonly recipient: Address;
    readonly amountAtomic: string;
    readonly preparedAt: string;
    readonly expiresAt: string;
    readonly rpcUrl: string;
  }): Promise<RedemptionMaterial>;
  signTransaction(input: {
    readonly privateKey: Hex;
    readonly delegationManager: Address;
    readonly calldata: Hex;
    readonly economics: Economics;
  }): Promise<Hex>;
}

export class OfficialSmartAccountAllowance implements SmartAccountAllowancePort {
  private readonly client;

  constructor(rpcUrl: string) {
    this.client = createPublicClient({ chain: base, transport: http(rpcUrl) });
  }

  async available(record: GrantedSmartAccountPermissionRecord): Promise<string> {
    const root = oneRoot(record.grant_context);
    try {
      return (await getErc20PeriodTransferEnforcerAvailableAmount(
        this.client,
        smartAccountEnvironment(),
        { delegation: root },
      )).availableAmount.toString();
    } catch {
      throw new ApnError("APN_PROVIDER_UNAVAILABLE", "Current Smart Account allowance could not be verified.", { retryable: true });
    }
  }
}

export class OfficialSmartAccountDelegationEngine implements SmartAccountDelegationEnginePort {
  async createRedemption(input: Parameters<SmartAccountDelegationEnginePort["createRedemption"]>[0]): Promise<RedemptionMaterial> {
    const account = privateKeyToAccount(input.record.session_private_key);
    const execution = createExecution({
      target: BASE_USDC,
      value: 0n,
      callData: encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [input.recipient, BigInt(input.amountAtomic)] }),
    });
    const afterThreshold = Math.floor(Date.parse(input.preparedAt) / 1000);
    const beforeThreshold = Math.min(input.record.granted_expires_at_unix, Math.floor(Date.parse(input.expiresAt) / 1000));
    if (beforeThreshold <= afterThreshold) throw new ApnError("APN_PERMISSION_INACTIVE", "Smart Account authority expires before execution.");
    const client = createWalletClient({ account, chain: base, transport: http(input.rpcUrl) });
    const child = await redelegatePermissionContextAction(client, {
      account,
      environment: smartAccountEnvironment(),
      permissionContext: input.record.grant_context as PermissionContext,
      chainId: CHAIN_ID,
      to: input.record.session_address,
      salt: keccak256(toHex(`apn.smart-account.direct\0${input.operationId}\0${input.fingerprint}`)),
      caveats: [
        { type: "exactExecution", execution },
        { type: "limitedCalls", limit: 1 },
        { type: "timestamp", afterThreshold, beforeThreshold },
        { type: "redeemer", redeemers: [input.record.session_address] },
      ],
    });
    const chain = decodeDelegations(child.permissionContext);
    if (chain.length !== 2 || chain[0] === undefined || chain[1] === undefined) {
      throw new ApnError("APN_PROVIDER_PROTOCOL", "MetaMask produced an invalid child delegation chain.");
    }
    const childContext = encodeDelegations([chain[0]]);
    const calldata = DelegationManager.encode.redeemDelegations({
      delegations: [child.permissionContext],
      modes: [ExecutionMode.SingleDefault],
      executions: [[execution]],
    });
    return {
      childContext,
      childFingerprint: sha256(`apn.smart-account.child\0${childContext}`),
      calldata,
    };
  }

  async signTransaction(input: Parameters<SmartAccountDelegationEnginePort["signTransaction"]>[0]): Promise<Hex> {
    const account = privateKeyToAccount(input.privateKey);
    const nonce = BigInt(input.economics.nonceAtomic);
    if (nonce > BigInt(Number.MAX_SAFE_INTEGER)) throw new ApnError("APN_RPC_PROTOCOL", "Session nonce is outside the supported transaction range.");
    return await account.signTransaction({
      chainId: CHAIN_ID,
      type: "eip1559",
      to: input.delegationManager,
      data: input.calldata,
      value: 0n,
      nonce: Number(nonce),
      gas: BigInt(input.economics.gasLimitAtomic),
      maxFeePerGas: BigInt(input.economics.maxFeePerGasAtomic),
      maxPriorityFeePerGas: BigInt(input.economics.maxPriorityFeePerGasAtomic),
    });
  }
}

export class MetaMaskSmartAccountDirectAdapter implements DirectExecutionPort {
  readonly mode = "delegated_session_transaction" as const;

  constructor(
    private readonly permissions: SmartAccountPermissionStorePort,
    private readonly effects: SmartAccountDirectEffectStorePort,
    private readonly rpc: RpcPort,
    private readonly allowance: SmartAccountAllowancePort,
    private readonly engine: SmartAccountDelegationEnginePort = new OfficialSmartAccountDelegationEngine(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async prepare(input: ProviderDirectPrepareInput): Promise<ProviderDelegatedDirectPreparation> {
    const record = await this.preflightRecord(input);
    return {
      permissionRevision: record.revision,
      rootGrantFingerprint: record.grant_fingerprint,
      sessionAddress: record.session_address,
      delegationManager: record.delegation_manager,
      permissionExpiresAtUnix: record.granted_expires_at_unix,
    };
  }

  async preflight(input: ProviderDirectExecutionInput): Promise<void> {
    const record = await this.preflightRecord(input);
    assertFrozenBinding(input.binding, record);
  }

  async execute(input: ProviderDirectExecutionInput) {
    const binding = delegatedBinding(input.binding);
    const existing = await this.effects.load(input.operationId);
    if (existing !== null) return await this.resumeEffect(existing, input);
    const record = await this.preflightRecord(input);
    assertFrozenBinding(binding, record);
    let redemption: RedemptionMaterial;
    try {
      redemption = validateRedemption(await this.engine.createRedemption({
        record,
        operationId: input.operationId,
        fingerprint: input.fingerprint,
        recipient: input.recipient,
        amountAtomic: input.amountAtomic,
        preparedAt: input.preparedAt,
        expiresAt: input.expiresAt,
        rpcUrl: input.rpcUrl,
      }));
    } catch (error) {
      if (error instanceof ApnError) throw error;
      throw new ApnError("APN_PROVIDER_PROTOCOL", "MetaMask child delegation construction failed safely.");
    }
    const nonceAtomic = await this.rpc.getPendingNonce(record.session_address);
    const fees = await this.rpc.estimateTransaction({
      from: record.session_address,
      to: record.delegation_manager,
      data: redemption.calldata,
    });
    const recheckedNonceAtomic = await this.rpc.getPendingNonce(record.session_address);
    if (nonceAtomic !== recheckedNonceAtomic) {
      throw new ApnError("APN_RPC_PROTOCOL", "Session nonce changed during exact delegated simulation.");
    }
    const economics = validatedEconomics(nonceAtomic, fees);
    const session = await this.rpc.getBalances(record.session_address);
    if (session.address.toLowerCase() !== record.session_address.toLowerCase()) {
      throw new ApnError("APN_RPC_PROTOCOL", "RPC gas balance response does not match the session identity.");
    }
    if (rpcAtomic(session.ethAtomic, true, "session ETH") < BigInt(economics.maximumGasCostAtomic)) {
      throw new ApnError("APN_INSUFFICIENT_GAS", "Session ETH is insufficient for the exact delegated transaction gas estimate.");
    }
    let rawTransaction: Hex;
    try {
      rawTransaction = await this.engine.signTransaction({
        privateKey: record.session_private_key,
        delegationManager: record.delegation_manager,
        calldata: redemption.calldata,
        economics,
      });
    } catch (error) {
      if (error instanceof ApnError) throw error;
      throw new ApnError("APN_PROVIDER_PROTOCOL", "Delegated transaction signing failed safely.");
    }
    const transactionHash = keccak256(rawTransaction);
    const timestamp = this.instant();
    const effect = await this.effects.seal({
      schema_version: "apn.metamask-smart-account-direct-effect.v1",
      operation_id: input.operationId,
      profile_hash: input.profileHash,
      intent_fingerprint: input.fingerprint,
      root_grant_fingerprint: record.grant_fingerprint,
      child_fingerprint: redemption.childFingerprint,
      owner_address: record.owner_address,
      session_address: record.session_address,
      recipient: input.recipient,
      amount_atomic: input.amountAtomic,
      delegation_manager: record.delegation_manager,
      child_context: redemption.childContext,
      redemption_calldata: redemption.calldata,
      raw_transaction: rawTransaction,
      transaction_hash: transactionHash,
      nonce_atomic: nonceAtomic,
      economics,
      phase: "sealed",
      submission_attempts: 0,
      sealed_at: timestamp,
      updated_at: timestamp,
    });
    return await this.submit(effect);
  }

  async observe(input: { readonly recoveryToken: string; readonly sender: Address }) {
    const effect = await this.effects.load(input.recoveryToken);
    if (effect === null || effect.owner_address.toLowerCase() !== input.sender.toLowerCase()) {
      return { disposition: "ambiguous" as const, reason: "delegated_effect_not_found" };
    }
    if (effect.phase === "submitted") {
      return { disposition: "acknowledged" as const, transactionHash: effect.transaction_hash };
    }
    if (effect.submission_attempts >= 2) {
      return {
        disposition: "pending" as const,
        recoveryToken: effect.operation_id,
        providerState: "SUBMISSION_AMBIGUOUS",
      };
    }
    return await this.submit(effect);
  }

  private async preflightRecord(input: ProviderDirectPrepareInput): Promise<GrantedSmartAccountPermissionRecord> {
    const record = await this.permissions.load(input.profileHash);
    const nowUnix = Math.floor(this.now().getTime() / 1000);
    if (record === null || !isGrantedPermissionRecord(record) || record.phase !== "active" ||
      nowUnix >= record.granted_expires_at_unix) {
      throw new ApnError("APN_PERMISSION_INACTIVE", "Smart Account permission is not active.");
    }
    if (record.owner_address.toLowerCase() !== input.sender.toLowerCase()) {
      throw new ApnError("APN_PROFILE_DRIFT", "Smart Account owner does not match the frozen provider profile.");
    }
    const amount = BigInt(input.amountAtomic);
    if (amount > BigInt(record.granted_cap_atomic)) allowanceInsufficient();
    const available = providerAtomic(await this.allowance.available(record), "remaining allowance");
    if (amount > available) allowanceInsufficient();
    const [owner, session] = await Promise.all([
      this.rpc.getBalances(record.owner_address),
      this.rpc.getBalances(record.session_address),
    ]);
    if (owner.address.toLowerCase() !== record.owner_address.toLowerCase() ||
      session.address.toLowerCase() !== record.session_address.toLowerCase()) {
      throw new ApnError("APN_RPC_PROTOCOL", "RPC balance response does not match Smart Account identities.");
    }
    if (rpcAtomic(owner.usdcAtomic, true, "owner USDC") < amount) {
      throw new ApnError("APN_INSUFFICIENT_USDC", "Owner Smart Account USDC is insufficient for this transfer.");
    }
    if (rpcAtomic(session.ethAtomic, true, "session ETH") === 0n) {
      throw new ApnError("APN_INSUFFICIENT_GAS", "Session account has no Base ETH for delegated execution gas.");
    }
    return record;
  }

  private async resumeEffect(effect: SmartAccountDirectEffectRecord, input: ProviderDirectExecutionInput) {
    if (effect.profile_hash !== input.profileHash || effect.intent_fingerprint !== input.fingerprint ||
      effect.owner_address.toLowerCase() !== input.sender.toLowerCase() ||
      effect.recipient.toLowerCase() !== input.recipient.toLowerCase() || effect.amount_atomic !== input.amountAtomic) {
      throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "Sealed Smart Account effect conflicts with the frozen operation.");
    }
    return effect.phase === "submitted"
      ? { disposition: "acknowledged" as const, transactionHash: effect.transaction_hash }
      : await this.submit(effect);
  }

  private async submit(effect: SmartAccountDirectEffectRecord) {
    const attempts = effect.submission_attempts + 1;
    const pending = await this.effects.transition(effect.operation_id, "submission_pending", attempts, this.instant());
    try {
      const returned = await this.rpc.submitRawTransaction(pending.raw_transaction);
      if (returned.toLowerCase() !== pending.transaction_hash.toLowerCase()) {
        await this.effects.transition(effect.operation_id, "submission_ambiguous", attempts, this.instant());
        return { disposition: "ambiguous" as const, reason: "rpc_transaction_identity_mismatch" };
      }
      await this.effects.transition(effect.operation_id, "submitted", attempts, this.instant());
      return { disposition: "acknowledged" as const, transactionHash: pending.transaction_hash };
    } catch {
      await this.effects.transition(effect.operation_id, "submission_ambiguous", attempts, this.instant());
      return {
        disposition: "pending" as const,
        recoveryToken: effect.operation_id,
        providerState: "SUBMISSION_AMBIGUOUS",
      };
    }
  }

  private instant(): string {
    const value = this.now();
    if (!Number.isFinite(value.getTime())) throw new ApnError("APN_INTERNAL", "Smart Account clock is invalid.");
    return value.toISOString();
  }
}

function oneRoot(context: Hex) {
  const roots = decodeDelegations(context);
  if (roots.length !== 1 || roots[0] === undefined) {
    throw new ApnError("APN_PROVIDER_PROTOCOL", "Stored Smart Account authority is not one root delegation.");
  }
  return roots[0];
}

function delegatedBinding(binding: ProviderDirectExecutionInput["binding"]): ProviderDelegatedDirectBinding {
  if (binding.executionMode !== "delegated_session_transaction") {
    throw new ApnError("APN_PROVIDER_PROTOCOL", "Smart Account direct operation has the wrong execution mode.");
  }
  return binding;
}

function assertFrozenBinding(
  binding: ProviderDirectExecutionInput["binding"],
  record: GrantedSmartAccountPermissionRecord,
): void {
  const delegated = delegatedBinding(binding);
  if (delegated.permissionRevision !== record.revision ||
    delegated.rootGrantFingerprint !== record.grant_fingerprint ||
    delegated.sessionAddress.toLowerCase() !== record.session_address.toLowerCase() ||
    delegated.delegationManager.toLowerCase() !== record.delegation_manager.toLowerCase() ||
    delegated.permissionExpiresAtUnix !== record.granted_expires_at_unix) {
    throw new ApnError("APN_PROFILE_DRIFT", "Smart Account permission changed after transfer preparation.");
  }
}

function allowanceInsufficient(): never {
  throw new ApnError("APN_PERMISSION_ALLOWANCE_INSUFFICIENT", "Current Smart Account allowance is insufficient for this transfer.");
}

function validateRedemption(value: RedemptionMaterial): RedemptionMaterial {
  if (!/^0x(?:[0-9a-fA-F]{2})+$/u.test(value.childContext) ||
    !/^0x(?:[0-9a-fA-F]{2})+$/u.test(value.calldata) ||
    value.childFingerprint !== sha256(`apn.smart-account.child\0${value.childContext}`)) {
    throw new ApnError("APN_PROVIDER_PROTOCOL", "MetaMask child delegation material is inconsistent.");
  }
  return value;
}

function validatedEconomics(nonceAtomic: string, fees: Omit<Economics, "nonceAtomic" | "maximumGasCostAtomic">): Economics {
  const nonce = rpcAtomic(nonceAtomic, true, "session nonce");
  const gas = rpcAtomic(fees.gasLimitAtomic, false, "gas estimate");
  const maxFee = rpcAtomic(fees.maxFeePerGasAtomic, false, "maximum fee");
  const priority = rpcAtomic(fees.maxPriorityFeePerGasAtomic, true, "priority fee");
  if (priority > maxFee) throw new ApnError("APN_RPC_PROTOCOL", "RPC priority fee exceeds the maximum fee.");
  return {
    nonceAtomic: nonce.toString(),
    gasLimitAtomic: gas.toString(),
    maxFeePerGasAtomic: maxFee.toString(),
    maxPriorityFeePerGasAtomic: priority.toString(),
    maximumGasCostAtomic: (gas * maxFee).toString(),
  };
}

function rpcAtomic(value: string, zeroAllowed: boolean, label: string): bigint {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value) || (!zeroAllowed && value === "0")) {
    throw new ApnError("APN_RPC_PROTOCOL", `RPC ${label} is not a canonical atomic value.`);
  }
  return BigInt(value);
}

function providerAtomic(value: string, label: string): bigint {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new ApnError("APN_PROVIDER_PROTOCOL", `MetaMask ${label} is not a canonical atomic value.`);
  }
  return BigInt(value);
}
