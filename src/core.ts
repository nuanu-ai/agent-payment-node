import type { CommandOutcome, CommandRequest, OutputEnvelope } from "./commands.js";import { OUTPUT_VERSION, PRODUCT_VERSION } from "./constants.js";import { failureEnvelope, successEnvelope } from "./output.js";
import { dataOutcome, operationOutcome, receiptOutcome } from "./core-outcome.js";
import { RuntimeContext, type CoreDependencies } from "./runtime.js";
import { TransferService } from "./transfer-service.js";
import { WalletService } from "./wallet-service.js";
import { OperationService } from "./operation-service.js";
import { inspectX402 } from "./x402-http.js";
import { canonicalIdempotencyKey, canonicalOperationId } from "./transfer-policy.js";
import { X402Service } from "./x402-service.js";
import { ApnError } from "./errors.js";
import { assertLocalNetworkProfile } from "./x402-network.js";
import { evmWalletBalance } from "./evm-wallet-balance.js";
import { assertDirectEvmProfile } from "./evm-transfer-prepare.js";
import { readProfilePortfolio } from "./portfolio/command.js";
import { ProviderWalletService } from "./provider-wallet-service.js";
import { ProviderX402TransactionRecoveryService } from "./provider-x402-transaction-recovery.js";
import { ProviderPermissionService } from "./provider-permission-service.js";
import { RailOperationService } from "./rail-operation-service.js";
import { solanaCapabilities } from "./chain-policy-service.js";
import { tronCapabilities } from "./tron/catalog.js";
import { bridgeCapabilities } from "./lifi/catalog.js";
import { BridgeService } from "./lifi/service.js";
import { bridgeOwner } from "./lifi/owner.js";
import { publicCircleApproval } from "./lifi/circle-v2-approval-executor.js";
import { confirmCircleApproval } from "./lifi/circle-v2-approval-tty.js";
import { GaslessService } from "./gasless/service.js";
import { gaslessCapabilities } from "./gasless/catalog.js";
import { gaslessChain } from "./gasless/validation.js";
import { gaslessObservationRpcEnv } from "./gasless/observation-source.js";
import { MetaMaskGaslessService } from "./metamask-gasless/service.js";
import { mmAddress, mmChain } from "./metamask-gasless/validation.js";
import { mmFail } from "./metamask-gasless/reasons.js";
import { canonicalProfile } from "./wallet-policy.js";
import { publicRelayNativeSourceJournal } from "./relay/native-source.js";
import { OperationAbandonService } from "./operation-abandon-service.js";
import { SmartAccountGaslessService } from "./smart-account-gasless/service.js";
import { saRequest } from "./smart-account-gasless/schema.js";
import { saFail } from "./smart-account-gasless/reasons.js";
import { FacilitatorGaslessService } from "./facilitator-gasless/service.js";
import { facilitatorFail } from "./facilitator-gasless/failure.js";
import { loadAllowlistInventory, resolveAllowlistAsset } from "./allowlist-inventory.js";
import { executeAllowlistPolicyCommand } from "./allowlist-policy-command.js";
import { executeUniswapCommand } from "./swap/uniswap-command-service.js";import { executeSunSwapCommand } from "./swap/sunswap-tron/command-service.js";import { executeJupiterCommand } from "./swap/jupiter-solana/command-service.js";import { executeOrcaCommand } from "./swap/orca-solana/command-service.js";
export type { CommandRequest, OutputEnvelope } from "./commands.js";export type { CoreDependencies } from "./runtime.js";
export {
  ASSET_POLICY_REGISTRY_SCHEMA,
  ASSET_POLICY_REGISTRY_SCHEMA_V2,
  assetPolicyDigest,
  evaluateAssetPolicy,
  sealAssetPolicyRegistry,
  validateAssetPolicyRegistry,
} from "./asset-policy-registry.js";
export {
  ALLOWLIST_DATASET_PATH,
  ALLOWLIST_DATASET_SCHEMA,
  ALLOWLIST_DATASET_SHA256,
  ALLOWLIST_DATASET_VERSION,
  ALLOWLIST_INVENTORY_SCHEMA,
  assertAllowlistExecutionConfigured,
  compileAllowlistInventory,
  loadAllowlistInventory,
  resolveAllowlistAsset,
} from "./allowlist-inventory.js";
export type {
  AllowlistInventory,
  CandidateAsset,
  CandidateDeployment,
  CandidateFamily,
  CandidateKind,
  CandidateNetwork,
  CandidateRail,
  CandidateRails,
} from "./allowlist-inventory.js";
export * from "./allowlist-policy.js";
export type {
  AssetAtomicCaps,
  AssetPolicyAdmission,
  AssetPolicyChain,
  AssetPolicyChainFamily,
  AssetPolicyEvaluationInput,
  AssetPolicyRail,
  AssetPolicyRegistry,
  AssetPolicyRegistrySchema,
  AssetPolicyRow,
  AssetRailAdmission,
  UnsignedAssetPolicyRegistry,
} from "./asset-policy-registry.js";
export {
  ASSET_USAGE_RESERVATION_SCHEMA,
  ASSET_USAGE_WINDOW,
  AssetUsageLedger,
  validateAssetUsageReservation,
} from "./asset-usage-ledger.js";
export type {
  AssetUsageIdentity,
  AssetUsageReservation,
  AssetUsageReserveInput,
  AssetUsageSnapshot,
  AssetUsageState,
  AssetUsageTransitionInput,
} from "./asset-usage-ledger.js";
export { AssetPortfolioReader } from "./asset-portfolio-reader.js";
export type {
  AssetPortfolio, AssetPortfolioInput, BatchBalanceAsset, BatchBalanceAvailable, BatchBalanceMode, BatchBalanceRequest,
  BatchBalanceResult, BatchBalanceRow, BatchBalanceUnavailable, FamilyBalanceBatchPort, PortfolioAccount,
  PortfolioNetworkResult, PortfolioRow, PortfolioRowStatus, PortfolioUnavailableReason,
} from "./asset-portfolio-reader.js";
export {
  DIRECT_ASSET_USAGE_LEASE_SCHEMA,
  DirectAssetUsageAdapter,
  validateDirectAssetUsageLease,
} from "./direct-asset-usage.js";
export type {
  DirectAssetUsageInput,
  DirectAssetUsageLease,
} from "./direct-asset-usage.js";
export * from "./swap/index.js";
export * from "./stargate-v2/index.js";
export class ApnCore {
  readonly context: RuntimeContext;
  readonly wallet: WalletService;
  readonly transfer: TransferService;
  readonly operations: OperationService;
  readonly x402: X402Service;
  readonly providerWallet: ProviderWalletService;
  readonly providerPermissions: ProviderPermissionService;
  readonly providerTransactionRecovery: ProviderX402TransactionRecoveryService;
  readonly rails: RailOperationService;
  readonly bridges: BridgeService;
  readonly gasless: GaslessService;
  readonly metaMaskGasless: MetaMaskGaslessService;
  readonly smartAccountGasless: SmartAccountGaslessService;
  readonly facilitatorGasless: FacilitatorGaslessService;
  readonly operationAbandon: OperationAbandonService;
  constructor(dependencies: CoreDependencies) {
    this.context = new RuntimeContext(dependencies);
    this.wallet = new WalletService(this.context);
    this.transfer = new TransferService(this.context);
    this.operations = new OperationService(this.context.state, this.context.providerX402Repository,
      undefined, undefined, undefined, this.context.metaMaskGasless?.records, this.context.smartAccountGasless?.records,
      this.context.facilitatorGasless?.records);
    this.x402 = new X402Service(this.context);
    this.providerWallet = new ProviderWalletService(this.context);
    this.providerPermissions = new ProviderPermissionService(this.context);
    this.providerTransactionRecovery = new ProviderX402TransactionRecoveryService(this.context);
    this.rails = new RailOperationService(this.context);
    this.bridges = new BridgeService(this.context);
    this.gasless = new GaslessService(this.context);
    this.metaMaskGasless = new MetaMaskGaslessService(this.context);
    this.smartAccountGasless = new SmartAccountGaslessService(this.context);
    this.facilitatorGasless = new FacilitatorGaslessService(this.context);
    this.operationAbandon = new OperationAbandonService(this.context, this.rails, this.gasless, this.metaMaskGasless,
      this.facilitatorGasless);
  }
  async execute(request: CommandRequest): Promise<OutputEnvelope> {
    const requestId = this.context.ids.next();
    try {
      return successEnvelope(request, requestId, await this.dispatch(request));
    } catch (error) {
      return failureEnvelope(request.command, requestId, error);
    }
  }
  private async dispatch(request: CommandRequest): Promise<CommandOutcome> {
    switch (request.command) {
      case "relay.prepare": {
        const service = this.context.relayPrepare;
        if (service === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Relay prepare runtime is unavailable.");
        return operationOutcome(await service.prepare(request));
      }
      case "relay.base.prepare": {
        const service = this.context.relayPrepare;
        if (service === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Relay Base prepare runtime is unavailable.");
        return operationOutcome(await service.prepareBase(request));
      }
      case "relay.arbitrum.prepare": {
        const service = this.context.relayPrepare;
        if (service === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Relay Arbitrum prepare runtime is unavailable.");
        return operationOutcome(await service.prepareArbitrum(request));
      }
      case "relay.native.prepare": {
        const service = this.context.relayPrepare;
        if (service === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Relay native prepare runtime is unavailable.");
        return operationOutcome(await service.prepareNative(request));
      }
      case "relay.preflight": {
        const service = this.context.relayPreflight;
        if (service === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Relay preflight runtime is unavailable.");
        return dataOutcome(await service.preflight(request), "read_only_rpc_observation");
      }
      case "relay.execute": {
        canonicalOperationId(request.operationId);
        const service = this.context.relayExecute;
        if (service === undefined || this.context.relayExecuteConfirmation === undefined) {
          throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Relay execute runtime and foreground confirmation are required.");
        }
        return dataOutcome(await service.execute(request.operationId), "source_effect_journal");
      }
      case "relay.native.execute": {
        canonicalOperationId(request.operationId);
        const service = this.context.relayNativeExecute;
        if (service === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Relay native execute runtime and foreground confirmation are required.");
        return dataOutcome(publicRelayNativeSourceJournal(await service.execute(request.operationId)), "source_effect_journal");
      }
      case "relay.retire": {
        const service = this.context.relayRetire;
        if (service === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Relay retirement runtime is unavailable.");
        return operationOutcome(await service.retire(request));
      }
      case "relay.status": {
        const service = this.context.relayStatus;
        if (service === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Relay status runtime is unavailable.");
        return dataOutcome(await service.status(request.operationId), "provider_assertion");
      }
      case "relay.observe": {
        const service = this.context.relayObserve;
        if (service === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Relay observe runtime is unavailable.");
        return dataOutcome(await service.observe(request.operationId), "read_only_rpc_observation");
      }
      case "relay.base.observe": {
        const service = this.context.relayBaseObserve;
        if (service === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Relay Base observe runtime is unavailable.");
        return dataOutcome(await service.observe(request.operationId), "read_only_rpc_observation");
      }
      case "relay.arbitrum.observe": {
        const service = this.context.relayArbitrumObserve;
        if (service === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Relay Arbitrum source observer is unavailable.");
        return dataOutcome(await service.observe(request.operationId), "read_only_rpc_observation");
      }
      case "relay.arbitrum.approval-check": {
        const service = this.context.relayArbitrumApprovalDecision;
        if (service === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Relay Arbitrum approval decision is unavailable.");
        return dataOutcome(await service.decide(request.profile, request.operationId), "read_only_rpc_observation");
      }
      case "relay.arbitrum.approval-execute": {
        const service = this.context.relayArbitrumApprovalExecute;
        if (service === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Relay Arbitrum approval execution is unavailable.");
        return dataOutcome(await service.execute(request.profile, request.operationId), "source_effect_journal");
      }
      case "relay.arbitrum.deposit-dispatch": {
        const service = this.context.relayArbitrumDepositDispatch;
        if (service === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Relay Arbitrum deposit dispatch is unavailable.");
        return dataOutcome(await service.execute(request.profile, request.operationId), "source_effect_journal");
      }
      case "stargate.native.prepare": {
        const service = this.context.stargateNative;
        if (service === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Stargate native runtime is unavailable.");
        return operationOutcome(await service.prepare(request));
      }
      case "stargate.native.execute": case "stargate.native.observe": case "stargate.native.status": case "stargate.native.receipt": {
        const service = this.context.stargateNative;
        if (service === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Stargate native runtime is unavailable.");
        if (request.command === "stargate.native.execute") return operationOutcome(await service.execute(request.operationId));
        if (request.command === "stargate.native.observe") return operationOutcome(await service.observe(request.operationId));
        if (request.command === "stargate.native.status") return operationOutcome(await service.status(request.operationId));
        return receiptOutcome(await service.receipt(request.operationId));
      }
      case "stargate.token.prepare": {
        const service = this.context.stargateToken;
        if (service === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Stargate token runtime is unavailable.");
        return operationOutcome(await service.prepare(request));
      }
      case "stargate.token.execute": case "stargate.token.cleanup": case "stargate.token.observe": case "stargate.token.status": case "stargate.token.receipt": {
        const service = this.context.stargateToken;
        if (service === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Stargate token runtime is unavailable.");
        if (request.command === "stargate.token.execute") return operationOutcome(await service.execute(request.operationId));
        if (request.command === "stargate.token.cleanup") return operationOutcome(await service.cleanup(request.operationId));
        if (request.command === "stargate.token.observe") return operationOutcome(await service.observe(request.operationId));
        if (request.command === "stargate.token.status") return operationOutcome(await service.status(request.operationId));
        return receiptOutcome(await service.receipt(request.operationId));
      }
      case "swap.uniswap.inventory": case "swap.uniswap.quote": case "swap.uniswap.prepare": case "swap.uniswap.status": case "swap.uniswap.approve": case "swap.uniswap.execute":
      case "swap.uniswap-token.inventory": case "swap.uniswap-token.quote": case "swap.uniswap-token.prepare": case "swap.uniswap-token.status":
      case "swap.uniswap-token.approve": case "swap.uniswap-token.execute": case "swap.uniswap-token.cleanup": return await executeUniswapCommand(request, this.context);
      case "swap.sunswap.inventory": case "swap.sunswap.quote": case "swap.sunswap.prepare": case "swap.sunswap.status": case "swap.sunswap.approve": case "swap.sunswap.execute": return await executeSunSwapCommand(request, this.context);
      case "swap.jupiter.inventory": case "swap.jupiter.quote": case "swap.jupiter.prepare": case "swap.jupiter.status": case "swap.jupiter.approve": case "swap.jupiter.execute": return await executeJupiterCommand(request, this.context);
      case "swap.orca.inventory": case "swap.orca.quote": case "swap.orca.prepare": case "swap.orca.status": case "swap.orca.approve": case "swap.orca.execute": return await executeOrcaCommand(request, this.context);
      case "allowlist.inventory": return dataOutcome(loadAllowlistInventory(), "frozen_candidate_inventory");
      case "allowlist.resolve": return dataOutcome({
        dataset: loadAllowlistInventory().dataset,
        asset: resolveAllowlistAsset(request),
      }, "exact_candidate_identity");
      case "allowlist.policy.status": case "allowlist.policy.prepare": case "allowlist.policy.stage":
      case "allowlist.policy.activate": case "allowlist.policy.revoke": return await executeAllowlistPolicyCommand(request, this.context);
      case "circle.approval.prepare": {
        await this.context.ready();
        const owner = (await bridgeOwner(this.context.state, request.profile)).owner;
        const executor = this.context.circleApproval;
        if (executor === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Circle approval executor is unavailable.");
        return dataOutcome(publicCircleApproval(await executor.prepare({ profile: owner.profile, payer: owner.address,
          walletBindingHash: owner.walletBindingHash, walletCreatedAt: owner.walletCreatedAt,
          approvalCapAtomic: request.approvalCapAtomic })), "circle_approval_prepared_unsigned");
      }
      case "circle.approval.execute":
      case "circle.approval.status": {
        const executor = this.context.circleApproval;
        if (executor === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Circle approval executor is unavailable.");
        const record = request.command === "circle.approval.execute"
          ? await executor.execute(request.operationId, confirmCircleApproval)
          : await executor.status(request.operationId);
        return dataOutcome(publicCircleApproval(record), record.phase === "completed" ? "circle_approval_safe_receipt_and_allowance" : "circle_approval_journal_state");
      }
      case "oneclick.source.submit": {
        const service = this.context.oneClickSource;
        if (service === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "1Click source runtime is unavailable.");
        return dataOutcome(await service.submit(request), "oneclick_source_submission_only");
      }
      case "oneclick.source.status": {
        const service = this.context.oneClickSource;
        if (service === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "1Click source runtime is unavailable.");
        return dataOutcome(await service.status(request.operationId), "oneclick_source_and_provider_observation_untrusted");
      }
      case "circle.source.submit": {
        const service = this.context.circleSource;
        if (service === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Circle source runtime is unavailable.");
        return dataOutcome(await service.submit(request), "circle_base_source_submission_only");
      }
      case "gasless.capabilities": return dataOutcome(gaslessCapabilities(request.profile), "static_gasless_capabilities");
      case "gasless.balance": {
        const provider = await this.gaslessProvider(request.profile);
        return dataOutcome(provider === "coinbase-agentic-wallet"
          ? request.chainId !== 8453 ? mmFail("mm_gasless_capability_unavailable") : await this.providerWallet.balance(request.profile)
          : provider === "metamask-smart-account"
          ? await this.smartAccountGasless.balance(request.profile, request.chainId)
          : provider === "metamask-agent-wallet" ? await this.metaMaskGasless.balance(request.profile, mmChain(request.chainId))
          : request.chainId === 43114 ? await this.facilitatorGasless.balance(request.profile)
          : await this.gasless.balance(request.profile, gaslessChain(request.chainId, "APN_PROVIDER_CAPABILITY_UNAVAILABLE")), "chain_verified_public_read");
      }
      case "gasless.transfer.prepare": return operationOutcome(await this.prepareGasless(request));
      case "gasless.usdt.prepare": {
        const service = this.context.gaslessUsdtPrepare;
        if (service === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE",
          "Gasless USDT prepare runtime is unavailable.", { reason: "gasless_usdt_prepare_runtime_unavailable" });
        return operationOutcome(await service.prepare(request));
      }
      case "gasless.usdt.execute": case "gasless.usdt.execution-status": case "gasless.usdt.observe": {
        const service = this.context.gaslessUsdtExecute;
        if (service === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Gasless USDT execution runtime is unavailable.");
        if (request.command === "gasless.usdt.execute") return operationOutcome(await service.execute(request.profileHash, request.operationId));
        if (request.command === "gasless.usdt.observe") return operationOutcome(await service.observe(request.profileHash, request.operationId));
        return dataOutcome(await service.status(request.profileHash, request.operationId), "local_gasless_usdt_execution_journal");
      }
      case "gasless.usdt.status": case "gasless.usdt.resume":
        if (this.context.gaslessUsdt === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE",
          "Gasless USDT operation command runtime is unavailable.", { reason: "gasless_usdt_command_runtime_unavailable" });
        if (request.command === "gasless.usdt.status") {
          try { return operationOutcome(await this.context.gaslessUsdt.forProfile(request.profileHash).statusBound(request.operationId)); }
          catch (error) {
            if (!(error instanceof ApnError) || error.code !== "APN_OPERATION_NOT_FOUND") throw error;
          }
        }
        return operationOutcome(await this.context.gaslessUsdt.forProfile(request.profileHash)[request.command.endsWith("status") ? "status" : "resume"](request.operationId));
      case "gasless.transfer.approve": {
        const stored = await this.operations.required(request.operationId), { kind } = stored;
        if (kind === "direct_transfer" && stored.record.providerDirect?.coinbaseGasless !== undefined) {
          return operationOutcome(await this.transfer.approve(request.operationId));
        }
        if (kind === "facilitator_gasless_transfer") return operationOutcome(await this.facilitatorGasless.approve(request.operationId));
        return operationOutcome(kind === "smart_account_gasless_transfer" ? await this.smartAccountGasless.approve(request.operationId)
          : kind === "metamask_gasless_transfer" ? await this.metaMaskGasless.approve(request.operationId) : await this.gasless.approve(request.operationId));
      }
      case "bridge.capabilities": return dataOutcome(bridgeCapabilities(request.profile), "static_bridge_capabilities");
      case "bridge.inventory": return dataOutcome(await this.bridges.inventory(), "provider_inventory_only");
      case "bridge.routes": return dataOutcome(await this.bridges.routes(request.profile, request.request), "profile_bound_bridge_quote");
      case "bridge.prepare": return operationOutcome(await this.bridges.prepare(request));
      case "bridge.approve": return operationOutcome(await this.bridges.approve(request.operationId));
      case "version":
        return dataOutcome({
          product: "agent-payment-node",
          product_version: PRODUCT_VERSION,
          cli_version: OUTPUT_VERSION,
          proof_class: "local_build_metadata",
        }, "local_build_metadata");
      case "doctor.keychain": return dataOutcome(await this.wallet.doctorKeychain(), "encrypted_apn_home_status");
      case "wallet.ensure": return dataOutcome(await this.wallet.ensure(request.profile), "encrypted_apn_home_status");
      case "wallet.import": return dataOutcome(await this.wallet.importNew(request.profile, request.keyFile, request.keyName, request.expectedAddress), "encrypted_apn_home_status");
      case "wallet.ensure-tron": return dataOutcome(await this.rails.policies.ensure(request.profile, "tron", request.provider, request.acceptRisk), "chain_account_binding");
      case "wallet.balance-tron": return dataOutcome(await this.rails.policies.balance(request.profile, "tron", request.asset), "chain_verified_public_read");
      case "wallet.capabilities-tron": return dataOutcome({ ...tronCapabilities(), ...(request.profile === undefined ? {} : {
        profile: request.profile, account: await this.context.chainAccounts?.account(request.profile, "tron") ?? null,
      }) }, "inspected_provider_capabilities");
      case "policy.admit-tron": return dataOutcome(await this.rails.policies.admit({ ...request, rail: "tron" }), "human_admitted_chain_policy");
      case "transfer.prepare-tron": return operationOutcome(await this.rails.prepare({ ...request, rail: "tron" }));
      case "wallet.ensure-solana": return dataOutcome(await this.rails.policies.ensure(request.profile, "solana", request.provider, request.acceptRisk), "chain_account_binding");
      case "wallet.balance-solana": return dataOutcome(await this.rails.policies.balance(request.profile, "solana", request.asset), "chain_verified_public_read");
      case "wallet.capabilities-solana": return dataOutcome({ ...solanaCapabilities(), ...(request.profile === undefined ? {} : {
        profile: request.profile, account: await this.context.chainAccounts?.account(request.profile, "solana") ?? null,
      }) }, "inspected_provider_capabilities");
      case "policy.admit-solana": return dataOutcome(await this.rails.policies.admit({ ...request, rail: "solana" }), "human_admitted_chain_policy");
      case "transfer.prepare-solana": return operationOutcome(await this.rails.prepare({ ...request, rail: "solana" }));
      case "wallet.connect": return dataOutcome(await this.providerWallet.connect(request), "provider_profile_binding");
      case "wallet.permission.list":
      case "wallet.permission.sync":
      case "wallet.permission.disable":
      case "wallet.permission.forget":
        return dataOutcome(await this.providerPermissions.execute(request), "provider_permission_binding");
      case "wallet.status": {
        const providerStatus = await this.providerWallet.status(request.profile);
        return providerStatus === null
          ? dataOutcome(await this.wallet.status(request.profile), "encrypted_apn_home_status")
          : dataOutcome(providerStatus, "provider_profile_binding");
      }
      case "wallet.balance": return dataOutcome(
        request.asset === undefined ? await this.providerWallet.balance(request.profile) ?? await this.wallet.balance(request.profile) :
          await evmWalletBalance(this.context, request.profile, request.asset),
        "chain_verified_public_read",
      );
      case "wallet.portfolio": return dataOutcome(await readProfilePortfolio(this.context, request.profile), "chain_verified_public_read");
      case "wallet.policy.show": return dataOutcome(await this.wallet.policyShow(request.profile, request.chainId), "encrypted_profile_policy_status");
      case "wallet.policy.set": return dataOutcome(await this.wallet.policySet(request), "encrypted_profile_policy_status");
      case "x402.inspect": return dataOutcome(await inspectX402(this.context.requireHttp(), request.url, request.httpRequest, request.chainId, request.payer), "seller_challenge_static");
      case "x402.fetch.prepare": {
        await assertLocalNetworkProfile(this.context, request.profile, request.chainId);
        if ((request.chainId ?? 8453) === 8453) await this.providerWallet.assertPaymentAvailable(request.profile, "x402", request.idempotencyKey);
        return operationOutcome(await this.x402.prepare(request));
      }
      case "x402.fetch.approve": {
        await this.x402.approve(request);
        return await this.operations.x402Outcome(request.operationId, {
          exposeSellerResult: true,
          exposeTerminalReceipt: true,
        });
      }
      case "transfer.prepare": {
        await assertDirectEvmProfile(this.context, request.profile, request.asset?.chainId);
        if ((request.asset?.chainId ?? 8453) === 8453) await this.providerWallet.assertPaymentAvailable(request.profile, "direct", request.idempotencyKey);
        return operationOutcome(await this.transfer.prepare(request));
      }
      case "transfer.approve": {
        const operation = await this.operations.required(request.operationId);
        if (operation.kind === "relay_unsigned") throw new ApnError("APN_OPERATION_BLOCKED", "Unsigned Relay operation has no approval or execution path.");
        if (operation.kind === "gasless_transfer" || operation.kind === "metamask_gasless_transfer" || operation.kind === "smart_account_gasless_transfer" ||
          operation.kind === "facilitator_gasless_transfer") throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "Use the gasless approval command for this USDC transfer.", {
          ...(operation.kind === "metamask_gasless_transfer" ? { reason: "mm_gasless_approval" } : {}),
          ...(operation.kind === "smart_account_gasless_transfer" ? { reason: "sa_gasless_approval" } : {}),
          ...(operation.kind === "facilitator_gasless_transfer" ? { reason: "facilitator_gasless_approval" } : {}),
          nextActions: [`apn gasless transfer approve --operation ${request.operationId}`],
        });
        return operationOutcome(operation.kind === "rail_transfer" ? await this.rails.approve(request.operationId) : await this.transfer.approve(request.operationId));
      }
      case "operation.resume": {
        if (request.observeOnly !== undefined && request.observeOnly !== true) throw new ApnError("APN_INVALID_INPUT", "observeOnly must be true.");
        if (request.observeOnly && (request.waitSeconds !== undefined || request.observationRpcEnv !== undefined)) {
          throw new ApnError("APN_INVALID_INPUT", "Observation-only direct recovery cannot be combined with wait or gasless observation options.");
        }
        if (request.observationRpcEnv !== undefined) {
          gaslessObservationRpcEnv(request.observationRpcEnv);
          if (request.waitSeconds !== undefined || this.context.rpcUrl !== undefined) throw new ApnError("APN_INVALID_INPUT",
            "Observation RPC recovery cannot be combined with --rpc-url or --wait-seconds.", { reason: "gasless_observation_rpc_options" });
        }
        await this.context.ready();
        const operation = await this.operations.required(request.operationId);
        if (operation.kind === "relay_unsigned") throw new ApnError("APN_OPERATION_BLOCKED", "Unsigned Relay operation has no resume or execution path.");
        if (request.observeOnly && (operation.kind !== "direct_transfer" || operation.record.providerDirect !== undefined)) {
          throw new ApnError("APN_INVALID_INPUT", "Observation-only recovery requires a saved local direct transfer.");
        }
        if (request.observationRpcEnv !== undefined && operation.kind !== "gasless_transfer" && operation.kind !== "metamask_gasless_transfer" &&
          operation.kind !== "smart_account_gasless_transfer") {
          throw new ApnError("APN_INVALID_INPUT", "Observation RPC recovery requires a saved Local, MetaMask or Smart Account gasless operation.",
            { reason: "gasless_observation_operation_kind" });
        }
        if (operation.kind === "facilitator_gasless_transfer") {
          if (request.waitSeconds !== undefined) facilitatorFail("facilitator_gasless_input");
          return operationOutcome(await this.facilitatorGasless.resume(request.operationId));
        }
        if (operation.kind === "smart_account_gasless_transfer") {
          if (request.waitSeconds !== undefined) saFail("sa_gasless_input");
          return operationOutcome(await this.smartAccountGasless.resume(request.operationId, request.observationRpcEnv));
        }
        if (operation.kind === "metamask_gasless_transfer") {
          if (request.waitSeconds !== undefined) throw new ApnError("APN_INVALID_INPUT", "MetaMask gasless recovery performs one bounded observation; omit --wait-seconds.", { reason: "mm_gasless_input" });
          return operationOutcome(await this.metaMaskGasless.resume(request.operationId, request.observationRpcEnv));
        }
        if (operation.kind === "gasless_transfer") {
          if (request.waitSeconds !== undefined) throw new ApnError("APN_INVALID_INPUT", "Gasless recovery performs one bounded observation; omit --wait-seconds.");
          return operationOutcome(await this.gasless.resume(request.operationId, request.observationRpcEnv));
        }
        if (operation.kind === "bridge_route") {
          if (request.waitSeconds !== undefined) throw new ApnError("APN_INVALID_INPUT", "Bridge recovery performs one bounded observation; omit --wait-seconds.");
          return operationOutcome(await this.bridges.resume(request.operationId));
        }
        if (operation.kind === "rail_transfer") {
          if (request.waitSeconds !== undefined) throw new ApnError("APN_INVALID_INPUT", "Solana resume performs one bounded observation; omit --wait-seconds.");
          return operationOutcome(await this.rails.resume(request.operationId));
        }
        if (operation.kind === "x402_fetch") {
          const settlementWait = await this.x402.resume(request.operationId, request.waitSeconds);
          return await this.operations.x402Outcome(request.operationId, {
            exposeSellerResult: true,
            exposeTerminalReceipt: true,
            ...(settlementWait === undefined ? {} : { settlementWait }),
          });
        }
        return operationOutcome(await this.transfer.resume(request.operationId, request.waitSeconds, request.observeOnly));
      }
      case "operation.repair-deployment": return dataOutcome(await this.bridges.repairDeployment(request.operationId), "local_journal_migration");
      case "operation.abandon": return operationOutcome(await this.operationAbandon.abandon(request.operationId));
      case "operation.recover-provider-request": return operationOutcome(
        await this.transfer.recoverProviderRequest(request.operationId, request.providerRequestId),
      );
      case "operation.recover-transaction-settlement": {
        const recovered = await this.providerTransactionRecovery.recover(request);
        return {
          proofClass: recovered.operation.proofClass,
          data: null,
          operation: recovered.operation,
          receipt: recovered.receipt,
          nextActions: recovered.operation.nextActions,
        };
      }
      case "operation.status": {
        canonicalOperationId(request.operationId);
        await this.context.ready();
        await this.x402.recoverRead(request.operationId);
        const operation = await this.operations.required(request.operationId);
        if (operation.kind === "relay_unsigned") return operationOutcome(await this.operations.status(request.operationId));
        if (operation.kind === "smart_account_gasless_transfer") return operationOutcome(await this.smartAccountGasless.status(request.operationId));
        if (operation.kind === "facilitator_gasless_transfer") return operationOutcome(await this.facilitatorGasless.status(request.operationId));
        if (operation.kind === "bridge_route") return operationOutcome(await this.bridges.status(request.operationId));
        if (operation.kind === "gasless_transfer") return operationOutcome(await this.gasless.status(request.operationId));
        if (operation.kind === "metamask_gasless_transfer") return operationOutcome(await this.metaMaskGasless.status(request.operationId));
        if (operation.kind === "rail_transfer") return operationOutcome(await this.operations.status(request.operationId));
        return operation.kind === "x402_fetch"
          ? await this.operations.x402Outcome(request.operationId, {
              exposeSellerResult: false,
              exposeTerminalReceipt: false,
            })
          : operationOutcome(await this.transfer.status(request.operationId));
      }
      case "receipt.get": {
        canonicalOperationId(request.operationId);
        await this.context.ready();
        await this.x402.recoverRead(request.operationId);
        const operation = await this.operations.required(request.operationId);
        if (operation.kind === "relay_unsigned") throw new ApnError("APN_RECEIPT_NOT_FOUND", "Unsigned Relay operation has no receipt.");
        if (operation.kind === "smart_account_gasless_transfer") return receiptOutcome(await this.smartAccountGasless.receipt(request.operationId));
        if (operation.kind === "facilitator_gasless_transfer") return receiptOutcome(await this.facilitatorGasless.receipt(request.operationId));
        if (operation.kind === "bridge_route") return receiptOutcome(await this.bridges.receipt(request.operationId));
        if (operation.kind === "gasless_transfer") return receiptOutcome(await this.gasless.receipt(request.operationId));
        if (operation.kind === "metamask_gasless_transfer") return receiptOutcome(await this.metaMaskGasless.receipt(request.operationId));
        if (operation.kind === "rail_transfer") return receiptOutcome(await this.rails.receipt(request.operationId));
        return operation.kind === "x402_fetch"
          ? await this.operations.x402ReceiptOutcome(request.operationId)
          : receiptOutcome(await this.transfer.receipt(request.operationId));
      }
    }
  }
  private async prepareGasless(request: Extract<CommandRequest, { command: "gasless.transfer.prepare" }>) {
    const key = canonicalIdempotencyKey(request.idempotencyKey);
    const existing = await this.operations.findIdempotency(this.context.state.idempotencyHash(key));
    if (existing?.kind === "direct_transfer" && existing.record.providerDirect?.coinbaseGasless !== undefined)
      return await this.transfer.prepareCoinbaseGasless(request);
    if (existing?.kind === "smart_account_gasless_transfer")
      return await this.smartAccountGasless.prepare({ ...request, request: saRequest(request.request) });
    if (existing?.kind === "facilitator_gasless_transfer") return await this.facilitatorGasless.prepare(request);
    const provider = await this.gaslessProvider(request.profile);
    if (provider === "metamask-smart-account") return await this.smartAccountGasless.prepare({ ...request, request: saRequest(request.request) });
    if (provider === "coinbase-agentic-wallet") return await this.transfer.prepareCoinbaseGasless(request);
    if (provider === "metamask-agent-wallet") return await this.metaMaskGasless.prepare({ ...request, request: { ...request.request,
      chainId: mmChain(request.request.chainId), recipient: mmAddress(request.request.recipient) } });
    // Avalanche has no EIP-7702 bundler path; new Local transfers there use the public x402 facilitator route.
    if (request.request.chainId === 43114 && existing?.kind !== "gasless_transfer") return await this.facilitatorGasless.prepare(request);
    return await this.gasless.prepare({ ...request, request: { ...request.request,
      chainId: gaslessChain(request.request.chainId, "APN_PROVIDER_CAPABILITY_UNAVAILABLE") } });
  }
  private async gaslessProvider(input: string): Promise<"local" | "metamask-agent-wallet" | "metamask-smart-account" | "coinbase-agentic-wallet"> {
    const profile = canonicalProfile(input);
    const stored = await this.context.state.loadProviderProfile(this.context.state.profileHash(profile));
    if (stored === null || stored.provider_id === "local") return "local";
    if (stored.provider_id === "metamask-agent-wallet") return "metamask-agent-wallet";
    if (stored.provider_id === "metamask-smart-account") return "metamask-smart-account";
    if (stored.provider_id === "coinbase-agentic-wallet") return "coinbase-agentic-wallet";
    return mmFail("mm_gasless_capability_unavailable");
  }
}
