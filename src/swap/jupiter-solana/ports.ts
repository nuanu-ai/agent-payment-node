import type { JupiterBuildResponse, JupiterOrderResponse, JupiterQuoteResponse } from "./codec.js";

export interface JupiterExactInRequest { readonly inputMint: string; readonly outputMint: string; readonly amount: string; readonly taker: string; readonly recipient: string; readonly slippageBps: number }
/** Read only and intentionally has no generic HTTP or program-label lookup capability. */
export interface JupiterReadOnlyProviderPort {
  quoteExactIn(request: JupiterExactInRequest): Promise<JupiterQuoteResponse>;
  orderExactIn(request: JupiterExactInRequest, quote: JupiterQuoteResponse): Promise<JupiterOrderResponse>;
  buildExactIn(requestId: string, quote: JupiterQuoteResponse): Promise<JupiterBuildResponse>;
}
export interface SolanaAccountDescriptor { readonly address: string; readonly owner: string; readonly executable: boolean; readonly dataHash: string }
export interface SolanaAddressTableDescriptor extends SolanaAccountDescriptor { readonly addresses: readonly string[] }
/** Implementations return frozen account bytes/metadata only. This module supplies no RPC implementation. */
export interface SolanaAccountResolverPort {
  resolveAccounts(addresses: readonly string[]): Promise<readonly SolanaAccountDescriptor[]>;
  resolveAddressTables(addresses: readonly string[]): Promise<readonly SolanaAddressTableDescriptor[]>;
}
export interface SolanaProofReaderPort {
  call(method: "simulateTransaction" | "getSignatureStatuses" | "getTransaction", params: readonly unknown[]): Promise<unknown>;
}
