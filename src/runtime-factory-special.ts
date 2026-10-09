import { RelayKeylessStatusService } from "./relay/status.js";
import { RelayObserveService } from "./relay/observe.js";
import { RelayNativeObserveService } from "./relay/native-observe.js";
import { RelayBaseObserveService } from "./relay/base-observe.js";
import { RelayArbitrumSourceObserveService } from "./relay/arbitrum-source-observe.js";
import { RelayArbitrumApprovalDecisionService } from "./relay/arbitrum-approval-decision.js";
import { LocalRelayArbitrumApprovalSigner, RelayArbitrumApprovalExecuteService } from "./relay/arbitrum-approval-execute.js";
import { LocalRelayArbitrumDepositSigner, RelayArbitrumDepositDispatchService } from "./relay/arbitrum-deposit-dispatch.js";
import { RelayArbitrumDepositPreflightReader } from "./relay/arbitrum-deposit-preflight.js";
import { RelayArbitrumApprovalPreflightReader } from "./relay/arbitrum-approval-preflight.js";
import { EvmDirectRpcGuard } from "./evm-direct-rpc-guard.js";
import { RelayArbitrumSourceFinalityObserver } from "./relay/arbitrum-source-finality.js";
import { RelayBnbReadOnlyRpc, RelayEthereumFinalityRpc } from "./relay/observe-rpc.js";
import { ApnError } from "./errors.js";
import { ApnCore } from "./core.js";
import { MacOSLoginKeychainSecret } from "./macos-keychain.js";
import { HttpsBaseRpc } from "./rpc.js";
import { TtyRelayArbitrumApprovalConfirmation, TtyRelayArbitrumDepositConfirmation } from "./tty-approval.js";
import { gaslessRpcFactory } from "./gasless/rpc.js";
import type { RuntimeFactoryOptions } from "./runtime-factory-options.js";
import type { BoundCommand } from "./command-binder.js";
import type { StateStore } from "./state.js";

export function createSpecialApnCore(bound: BoundCommand, options: RuntimeFactoryOptions, state: StateStore): ApnCore | null {
  if (bound.request.command === "gasless.transfer.quote") {
    if (bound.rpcUrl === undefined) throw new ApnError("APN_RPC_CONFIG", "Ethereum quote requires an explicit public RPC URL.");
    // This read path has no custody implementation, signer, journal or effect transport.
    const unavailable = async (): Promise<never> => { throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Quote is read only."); };
    return new ApnCore({ state, gasless: { rpcFor: options.gasless?.rpcFor ??
      gaslessRpcFactory({ APN_ETHEREUM_RPC_URL: bound.rpcUrl }),
      custody: { load: unavailable, seal: unavailable } } });
  }
  if (bound.request.command === "x402.permit2.status") return new ApnCore({ state });
  if (bound.request.command === "relay.arbitrum.observe") {
    const url = bound.rpcUrl ?? "";
    // Construct only the guarded Arbitrum read path. No wallet, signer, or send transport exists here.
    const observer = new RelayArbitrumSourceFinalityObserver(url, state, options.relayArbitrumObserveRpc);
    return new ApnCore({ state, relayArbitrumObserve: options.relayArbitrumObserve ??
      new RelayArbitrumSourceObserveService(state, observer) });
  }
  if (bound.request.command === "relay.arbitrum.approval-check") {
    const url = bound.rpcUrl ?? "";
    const guard = new EvmDirectRpcGuard(state);
    const reader = new RelayArbitrumApprovalPreflightReader(url, state, options.relayArbitrumApprovalRpc,
      () => guard);
    return new ApnCore({ state, relayArbitrumApprovalDecision: options.relayArbitrumApprovalDecision ??
      new RelayArbitrumApprovalDecisionService(state, reader) });
  }
  if (bound.request.command === "relay.arbitrum.approval-execute") {
    const url = bound.rpcUrl ?? "";
    const guard = new EvmDirectRpcGuard(state);
    const rpc = options.relayArbitrumApprovalExecuteRpc ?? new HttpsBaseRpc(url);
    const reader = new RelayArbitrumApprovalPreflightReader(url, state, rpc, () => guard);
    const wrapping = options.wrappingSecret ?? new MacOSLoginKeychainSecret();
    const tty = new TtyRelayArbitrumApprovalConfirmation(options.relayExecuteTtyOptions);
    return new ApnCore({ state, relayArbitrumApprovalExecute: options.relayArbitrumApprovalExecute ??
      new RelayArbitrumApprovalExecuteService(state, reader, {
        confirm: summary => tty.confirm(summary), signer: new LocalRelayArbitrumApprovalSigner(state, wrapping),
        send: raw => guard.post(url, () => rpc.submitRawTransaction(raw)),
        now: () => options.clock?.now() ?? new Date(),
      }, wrapping) });
  }
  if (bound.request.command === "relay.arbitrum.deposit-dispatch") {
    const url = bound.rpcUrl ?? "";
    const guard = new EvmDirectRpcGuard(state);
    const rpc = options.relayArbitrumDepositDispatchRpc ?? new HttpsBaseRpc(url);
    const reader = new RelayArbitrumDepositPreflightReader(url, state, rpc, () => guard);
    const wrapping = options.wrappingSecret ?? new MacOSLoginKeychainSecret();
    const tty = new TtyRelayArbitrumDepositConfirmation(options.relayExecuteTtyOptions);
    return new ApnCore({ state, relayArbitrumDepositDispatch: options.relayArbitrumDepositDispatch ??
      new RelayArbitrumDepositDispatchService(state, reader, {
        confirm: summary => tty.confirm(summary), signer: new LocalRelayArbitrumDepositSigner(state, wrapping),
        send: raw => guard.post(url, () => rpc.submitRawTransaction(raw)),
        now: () => options.clock?.now() ?? new Date(),
      }, wrapping) });
  }
  if (bound.request.command === "relay.base.observe") {
    const baseUrl = bound.rpcUrl ?? "";
    const baseInvocation = () => new RelayBnbReadOnlyRpc(baseUrl, state, options.relayObserveBaseRpc, undefined, 8453);
    const source = bound.ethereumRpcUrl === undefined ? undefined :
      new RelayEthereumFinalityRpc(bound.ethereumRpcUrl, state, options.relayObserveSourceRpc);
    return new ApnCore({ state, relayBaseObserve: options.relayBaseObserve ??
      new RelayBaseObserveService(state, baseInvocation,
        new RelayKeylessStatusService(state, options.relayStatusFetch), source) });
  }
  if (bound.request.command === "relay.observe") {
    const sourceUrl = bound.rpcUrl ?? "";
    const bnbUrl = bound.bnbRpcUrl ?? "";
    // Construct only keyless readers. No wallet, signer, custody, or execution runtime is installed.
    const source = new RelayEthereumFinalityRpc(sourceUrl, state, options.relayObserveSourceRpc);
    const bnbInvocation = () => new RelayBnbReadOnlyRpc(bnbUrl, state, options.relayObserveBnbRpc);
    const nativeSource = (chainId: 56 | 8453) => new RelayEthereumFinalityRpc(sourceUrl, state, options.relayObserveSourceRpc, undefined, chainId);
    const native = new RelayNativeObserveService(state, nativeSource,
      chainId => new RelayBnbReadOnlyRpc(bnbUrl, state, options.relayObserveBnbRpc, chainId === 4326 ? new EvmDirectRpcGuard(state, 10) : undefined, chainId),
      new RelayKeylessStatusService(state, options.relayStatusFetch), options.clock);
    return new ApnCore({ state, relayObserve: options.relayObserve ??
      new RelayObserveService(state, source, bnbInvocation,
        new RelayKeylessStatusService(state, options.relayStatusFetch), native) });
  }
  return null;
}
