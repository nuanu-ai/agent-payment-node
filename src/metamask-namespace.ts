export function isMetaMaskEvmNamespace(value: unknown): value is "evm" | "eip155" {
  return value === "evm" || value === "eip155";
}
