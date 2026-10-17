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
import type { OperationFamily } from "./types.js";

export type OperationRegistry = ReadonlyMap<OperationFamily, OperationFamilyAdapter>;

/** Built on first use, never at module evaluation: the adapters import the conflict-domain module, which imports them. */
let registry: OperationRegistry | undefined;

/**
 * Every family the index covers, in the order the guard reports blockers (the order the former store scan used).
 * Phase 4b WP2 appends the swap, Uniswap-token, Stargate, USDT, 1Click, Circle-source, Circle-approval and
 * MetaMask-native adapters to this list.
 */
export function operationRegistry(): OperationRegistry {
  registry ??= new Map(([
    seiGaszipAdapter, circleAdapter, megaGaszipAdapter, merchantAdapter, permit2Adapter, relayAdapter, facilitatorGaslessAdapter,
    smartAccountGaslessAdapter, metaMaskGaslessAdapter, gaslessTransferAdapter, bridgeAdapter, railAdapter, directAdapter, x402Adapter,
  ] as readonly unknown[] as readonly OperationFamilyAdapter[]).map(adapter => [adapter.family, adapter]));
  return registry;
}
