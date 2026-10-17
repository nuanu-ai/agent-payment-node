import type { UNISWAP_ROUTER } from "../uniswap-pin.js";

/** The unsigned Universal Router transaction the keyless route builds, binds and signs. */
export interface UniswapTransactionEnvelope { readonly from: string; readonly to: typeof UNISWAP_ROUTER; readonly data: `0x${string}`;
  readonly value: string; readonly gasLimit: string; readonly chainId: 1; readonly maxFeePerGas?: string;
  readonly maxPriorityFeePerGas?: string; readonly gasPrice?: string }
