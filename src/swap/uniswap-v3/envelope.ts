import type { UniswapNativeChainId } from "./native-lane.js";

/** The unsigned router transaction a keyless native-input route builds, binds and signs; `to` is its lane's pinned router. */
export interface UniswapTransactionEnvelope { readonly from: string; readonly to: `0x${string}`; readonly data: `0x${string}`;
  readonly value: string; readonly gasLimit: string; readonly chainId: UniswapNativeChainId; readonly maxFeePerGas?: string;
  readonly maxPriorityFeePerGas?: string; readonly gasPrice?: string }
