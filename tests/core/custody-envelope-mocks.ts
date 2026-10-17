/**
 * Replaces only the material validators that sit after decryption (signed-transaction parsing, operation and binding
 * checks), so every store's real envelope code (layout checks, HKDF info, AAD, base64, AES-GCM, canonical plaintext)
 * runs on small synthetic records. Call before the stores are imported.
 */
import { mock } from "node:test";
import { keccak256, type Hex } from "viem";

async function actual<T>(path: string): Promise<T> {
  return await import(new URL(`${path}?custody-envelope-actual`, import.meta.url).href) as T;
}

export async function installCustodyEnvelopeMocks(): Promise<void> {
  const gasless = await actual<typeof import("../../src/gasless/material-validation.js")>("../../src/gasless/material-validation.js");
  mock.module("../../src/gasless/material-validation.js", { namedExports: { ...gasless, validateGaslessMaterial: async (value: unknown) => value } });
  const bridge = await actual<typeof import("../../src/lifi/transaction.js")>("../../src/lifi/transaction.js");
  mock.module("../../src/lifi/transaction.js", { namedExports: { ...bridge, verifyBridgeSigned: async () => undefined } });
  const swap = await actual<typeof import("../../src/swap/model.js")>("../../src/swap/model.js");
  mock.module("../../src/swap/model.js", { namedExports: { ...swap, validateSwapOperation: (value: unknown) => value } });
  const binding = await actual<typeof import("../../src/swap/uniswap-ethereum/execution/binding.js")>("../../src/swap/uniswap-ethereum/execution/binding.js");
  mock.module("../../src/swap/uniswap-ethereum/execution/binding.js", { namedExports: { ...binding,
    validateUniswapExecutionBinding: (value: unknown) => value, verifySignedUniswapTransaction: async (raw: Hex) => keccak256(raw) } });
  const circle = await actual<typeof import("../../src/circle-v2-evm/funding-operation.js")>("../../src/circle-v2-evm/funding-operation.js");
  mock.module("../../src/circle-v2-evm/funding-operation.js", { namedExports: { ...circle, validateCircleFundingOperation: (value: unknown) => value } });
  const terms = await actual<typeof import("../../src/x402-merchant/terms.js")>("../../src/x402-merchant/terms.js");
  mock.module("../../src/x402-merchant/terms.js", { namedExports: { ...terms, merchantTerms: (o: { readonly terms: unknown }) => o.terms } });
  const rpc = await actual<typeof import("../../src/x402-merchant/rpc.js")>("../../src/x402-merchant/rpc.js");
  mock.module("../../src/x402-merchant/rpc.js", { namedExports: { ...rpc, merchantTransferData: (t: { readonly data: unknown }) => t.data } });
  const codec = await actual<typeof import("../../src/x402-codec.js")>("../../src/x402-codec.js");
  mock.module("../../src/x402-codec.js", { namedExports: { ...codec, decodePaymentSignatureHeader: codec.decodeCanonicalBase64Json } });
}
