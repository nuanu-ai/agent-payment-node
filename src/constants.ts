export const OUTPUT_VERSION = "apn.cli.v1" as const;
export const PRODUCT_VERSION = "0.5.0" as const;
export const STATE_VERSION = "apn.state.v1" as const;
export const NATIVE_IPC_VERSION = "apn.native.v1" as const;
export const CHAIN_ID = 8453 as const;
export const CHAIN_CAIP2 = "eip155:8453" as const;
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const USDC_DECIMALS = 6 as const;
export const ETH_DECIMALS = 18 as const;
export const APPROVAL_WINDOW_MS = 10 * 60 * 1000;
export const MAX_NONCE_SCAN_BLOCKS = 2048n;
export const MAX_RPC_RESPONSE_BYTES = 1024 * 1024;
export const MAX_IPC_FRAME_BYTES = 64 * 1024;
export const NATIVE_REQUEST_FD_ENV = "APN_NATIVE_REQUEST_FD" as const;
export const NATIVE_RESPONSE_FD_ENV = "APN_NATIVE_RESPONSE_FD" as const;
export const HOST_SERIALIZED_ENV = "APN_HOST_SERIALIZED" as const;
export const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;
