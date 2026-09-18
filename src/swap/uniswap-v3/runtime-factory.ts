import { AssetUsageLedger } from "../../asset-usage-ledger.js";
import { ApnError } from "../../errors.js";
import type { EvmRpcCall } from "../../evm-ports.js";
import { bridgeRpcCall } from "../../lifi/rpc.js";
import type { WrappingSecretPort } from "../../macos-keychain.js";
import type { ClockPort } from "../../ports.js";
import type { StateStore } from "../../state.js";
import type { TtyTransferApprovalOptions } from "../../tty-approval.js";
import { SwapOperationRepository } from "../repository.js";
import { GuardedSwapApprovalRepository, GuardedSwapRuntime, type GuardedSwapForegroundApprovalPort,
  type GuardedSwapPolicyResolver } from "../runtime.js";
import { GuardedSwapService } from "../service.js";
import { EncryptedUniswapExecutionEffectStore, LocalUniswapEthereumSigner, UniswapEthereumExecutionDriver,
  UniswapEthereumReceiptObserver, UniswapExecutionBindingStore, UniswapExecutionGuard, UniswapSingleSendAdapter } from "../uniswap-ethereum/execution/index.js";
import { UniswapLocalOwnerAdmission } from "./admission.js";
import { KeylessUniswapQuoteBuilder, type UniswapKeylessQuoteRequest } from "./builder.js";
import { SavedUniswapQuoteStore } from "./material.js";
import { UNISWAP_V3_KEYLESS_PROTOCOL_REGISTRY, type UniswapV3PinVerifier } from "./pins.js";
import { TtyUniswapSwapApproval } from "./tty.js";

/** Until the allowlist activation installs its resolver, no profile has an active swap admission: preparation refuses. */
export const NO_ACTIVE_SWAP_ADMISSION: GuardedSwapPolicyResolver = async () => null;

/** Only the foreground CLI approve command receives a terminal; every other surface refuses consent outright. */
export const REFUSING_SWAP_APPROVAL: GuardedSwapForegroundApprovalPort = {
  async approve() {
    throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "Guarded swap approval must continue in the foreground CLI.",
      { reason: "swap_foreground_cli_required" });
  },
};

export interface UniswapKeylessRuntimeOptions {
  readonly state: StateStore;
  readonly wrapping: WrappingSecretPort;
  readonly clock: ClockPort;
  readonly policy: GuardedSwapPolicyResolver;
  readonly foreground: "tty" | GuardedSwapForegroundApprovalPort;
  readonly tty?: TtyTransferApprovalOptions;
  /** Ethereum mainnet reader/sender. Production passes lazyEthereumRpcCall(process.env). */
  readonly call: EvmRpcCall;
  /** Code-pin verifier. Production passes verifyUniswapV3CodePins. */
  readonly verifyPins: UniswapV3PinVerifier;
}

/** Resolves APN_ETHEREUM_RPC_URL on first use, so offline commands never need it and online ones fail closed without it. */
export function lazyEthereumRpcCall(environment: Readonly<Record<string, string | undefined>>): EvmRpcCall {
  let resolved: EvmRpcCall | undefined;
  return async (method, params) => await (resolved ??= bridgeRpcCall(1, environment).call)(method, params);
}

export function createUniswapKeylessRuntime(options: UniswapKeylessRuntimeOptions): GuardedSwapRuntime<UniswapKeylessQuoteRequest> {
  const { state, wrapping, clock, call } = options, root = state.root;
  const quotes = new SavedUniswapQuoteStore(root), operations = new SwapOperationRepository(root), usage = new AssetUsageLedger(root);
  const effects = new EncryptedUniswapExecutionEffectStore(state, wrapping), admission = new UniswapLocalOwnerAdmission(state, options.policy);
  const signer = new LocalUniswapEthereumSigner(state, wrapping, effects), sender = new UniswapSingleSendAdapter(effects, call);
  const observer = new UniswapEthereumReceiptObserver(call, () => clock.now());
  const execution = new UniswapEthereumExecutionDriver({ core: new GuardedSwapService(operations, usage),
    protocolRegistry: UNISWAP_V3_KEYLESS_PROTOCOL_REGISTRY, admission, guard: new UniswapExecutionGuard(call, clock, options.verifyPins),
    bindings: new UniswapExecutionBindingStore(root), signer, sender, observer, effects, clock });
  const foregroundApproval = options.foreground === "tty" ? new TtyUniswapSwapApproval(quotes, clock, options.tty) : options.foreground;
  return new GuardedSwapRuntime<UniswapKeylessQuoteRequest>({ chain: "eip155:1", builder: new KeylessUniswapQuoteBuilder(call, quotes, options.verifyPins),
    policy: options.policy, clock, protocolRegistry: UNISWAP_V3_KEYLESS_PROTOCOL_REGISTRY, usage, operations, ownerAdmission: admission,
    foregroundApproval, execution, approvals: new GuardedSwapApprovalRepository(root), rpc: { call }, effectStore: effects, signer, sender,
    observer, caps: { approvalCapAtomic: "0" } });
}
