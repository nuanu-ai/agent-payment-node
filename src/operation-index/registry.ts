import type { OperationFamilyAdapter } from "./adapter.js";
import { bridgeAdapter } from "./adapters/bridge.js";
import { circleAdapter } from "./adapters/circle.js";
import { directAdapter } from "./adapters/direct.js";
import { facilitatorGaslessAdapter, gaslessTransferAdapter, metaMaskGaslessAdapter, smartAccountGaslessAdapter } from "./adapters/gasless.js";
import { megaGaszipAdapter, seiGaszipAdapter } from "./adapters/gaszip.js";
import { merchantAdapter } from "./adapters/merchant.js";
import { permit2Adapter } from "./adapters/permit2.js";
import { railAdapter } from "./adapters/rail.js";
import { relayAdapter } from "./adapters/relay.js";
import { x402Adapter } from "./adapters/x402.js";
import { circleApprovalAdapter } from "./adapters/circle-approval.js";
import { circleSourceAdapter } from "./adapters/circle-source.js";
import { gaslessUsdtAdapter } from "./adapters/gasless-usdt.js";
import { metaMaskNativeAdapter } from "./adapters/metamask-native.js";
import { oneClickSourceAdapter } from "./adapters/oneclick.js";
import { stargateNativeAdapter, stargateTokenAdapter } from "./adapters/stargate.js";
import { swapAdapter } from "./adapters/swap.js";
import { uniswapTokenAdapter } from "./adapters/uniswap-token.js";
import { x402SolanaAdapter } from "./adapters/x402-solana.js";
import { permit2AllowanceAdapter } from "./adapters/permit2-allowance.js";
import { walletAllowanceRevokeAdapter } from "./adapters/wallet-allowance.js";
import type { OperationFamily } from "./types.js";

export type OperationRegistry = ReadonlyMap<OperationFamily, OperationFamilyAdapter>;

/** Built on first use, never at module evaluation: the adapters import the conflict-domain module, which imports them. */
let registry: OperationRegistry | undefined;

/**
 * Every family the index covers, in the order the guard reports blockers (the order the former store scan used,
 * then the families phase 4b WP2 added).
 */
export function operationRegistry(): OperationRegistry {
  registry ??= new Map(([
    seiGaszipAdapter, circleAdapter, megaGaszipAdapter, merchantAdapter, permit2Adapter, relayAdapter, facilitatorGaslessAdapter,
    smartAccountGaslessAdapter, metaMaskGaslessAdapter, gaslessTransferAdapter, bridgeAdapter, railAdapter, directAdapter, x402Adapter,
    // Phase 4b WP2: every other money family.
    gaslessUsdtAdapter, metaMaskNativeAdapter, swapAdapter, uniswapTokenAdapter, stargateNativeAdapter, stargateTokenAdapter,
    oneClickSourceAdapter, circleSourceAdapter, circleApprovalAdapter,
    x402SolanaAdapter, permit2AllowanceAdapter, walletAllowanceRevokeAdapter,
  ] as readonly unknown[] as readonly OperationFamilyAdapter[]).map(adapter => [adapter.family, adapter]));
  return registry;
}
