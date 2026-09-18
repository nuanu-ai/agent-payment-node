import {
  SWAP_MECHANISM_PIN_SCHEMA,
  loadAllowlistInventory,
  type AllowlistPolicyOverlayV2Input,
  type SwapMechanismPin,
} from "../../src/core.js";

export const EVM_OWNER = "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1";
export const TRON_OWNER = "TBXSw8fM4jpQkGc6zZjsVABFpVN7UvXPdV";
export const SOLANA_OWNER = "675kPX9MHTjS2zt1qfr1NYHuzeLsM4vQKhBXmaQ5aqUJ";
export const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
export const TRON = "tron:00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc";
export const SOLANA = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const inventory = loadAllowlistInventory();

export function uniswapPin(overrides: Partial<SwapMechanismPin> = {}): SwapMechanismPin {
  return { schemaVersion: SWAP_MECHANISM_PIN_SCHEMA, protocolFamily: "uniswap_ethereum", networkFamily: "evm",
    chain: "eip155:1", protocolVersion: "2.2.0", constructorKind: "builder_api", constructorIdentity: "owner.api",
    constructorVersion: "1.0.0", routerProgramIdentity: "0x1111111111111111111111111111111111111111",
    auxiliaryContractProgramIdentities: ["0x2222222222222222222222222222222222222222"], quoteSchemaVersion: "1.0.0",
    transactionSchemaVersion: "1.0.0", validationPolicyIdentity: "owner.validation", validationPolicyVersion: "1.0.0", ...overrides };
}

/** Owner-supplied example admissions: ETH on two rails with different caps, USDC swap, TRON and Solana natives and tokens. */
export function ownerAdmissions(): AllowlistPolicyOverlayV2Input["admissions"] {
  return [
    { chain: "eip155:1", kind: "native", rail: "direct", maximumPerTransferAtomic: "1200000000000000", dailyLimitAtomic: "4000000000000000" },
    { chain: "eip155:1", kind: "native", rail: "swap", maximumPerTransferAtomic: "2000000000000000", dailyLimitAtomic: "4000000000000000",
      mechanism: uniswapPin() },
    { chain: "eip155:1", kind: "token", identifier: USDC, rail: "swap", maximumPerTransferAtomic: "3000000", dailyLimitAtomic: "10000000",
      mechanism: uniswapPin() },
    { chain: TRON, kind: "native", rail: "direct", maximumPerTransferAtomic: "8900000", dailyLimitAtomic: "29700000" },
    { chain: TRON, kind: "token", identifier: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", rail: "direct",
      maximumPerTransferAtomic: "3000000", dailyLimitAtomic: "10000000" },
    { chain: SOLANA, kind: "native", rail: "direct", maximumPerTransferAtomic: "28600000", dailyLimitAtomic: "95500000" },
  ];
}

export function overlayV2(overrides: Partial<AllowlistPolicyOverlayV2Input> = {}): AllowlistPolicyOverlayV2Input {
  return { overlayVersion: "owner.2", profile: "card2-v2", accounts: { evm: EVM_OWNER, tron: TRON_OWNER, solana: SOLANA_OWNER },
    datasetVersion: inventory.dataset.version, datasetSha256: inventory.dataset.sha256, inventorySha256: inventory.inventorySha256,
    effectiveAt: "2026-09-18T01:00:00.000Z", expiresAt: "2026-10-18T01:00:00.000Z", admissions: ownerAdmissions(), ...overrides };
}

