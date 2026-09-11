import { encodeAbiParameters, getAddress, hashDomain, parseAbiParameters, toFunctionSelector } from "viem";
import { hashObject } from "../canonical.js";
import type { Hex } from "../model.js";
import type { GaslessChainId, GaslessDeployment } from "./model.js";
import { GASLESS_REGISTRY_DATA } from "./registry-data.js";
import { gaslessChain, gaslessFailure } from "./validation.js";

const ENTRY_POINT = getAddress("0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108");
const DELEGATE = getAddress("0xe6Cae83BdE06E4c305530e199D7217f42808555B");
const PAYMASTER = getAddress("0x0578cFB241215b77442a541325d6A4E6dFE700Ec");
const TOKEN_SLOT = "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3";
const PAYMASTER_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const DOMAIN_TYPES = { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" },
  { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }] } as const;
const word = (value: string): Hex => `0x${value.replace(/^0x/u, "").toLowerCase().padStart(64, "0")}`;

export const GASLESS_DEPLOYMENTS: readonly GaslessDeployment[] = deepFreeze(GASLESS_REGISTRY_DATA.map((r) => {
  const token = getAddress(r.token), tokenDomain = { name: r.tokenName, version: "2" as const,
    chainId: r.chainId, verifyingContract: token, domainSeparator: r.tokenDomain };
  if (hashDomain({ domain: { name: tokenDomain.name, version: tokenDomain.version,
    chainId: BigInt(r.chainId), verifyingContract: token }, types: DOMAIN_TYPES }) !== tokenDomain.domainSeparator) {
    gaslessFailure("APN_STATE_CORRUPT", "gasless_registry_domain");
  }
  const call = (address: typeof token, signature: string, expected: Hex) => ({
    kind: "call" as const, address, data: toFunctionSelector(signature), expected,
  });
  return { chainId: r.chainId, network: r.label, rpcEnv: `APN_${r.network}_RPC_URL`,
    bundlerEnv: `APN_${r.network}_BUNDLER_RPC_URL`, publicBundlerUrl: r.publicBundlerUrl,
    token, tokenDomain, paymaster: PAYMASTER, entryPoint: ENTRY_POINT, delegate: DELEGATE,
    code: [
      { address: token, codeHash: r.tokenProxyHash },
      { address: getAddress(r.tokenImplementation), codeHash: r.tokenImplementationHash },
      { address: getAddress(r.signatureChecker), codeHash: r.signatureCheckerHash },
      { address: ENTRY_POINT, codeHash: r.entryPointHash },
      { address: DELEGATE, codeHash: r.delegateHash },
      { address: PAYMASTER, codeHash: r.paymasterProxyHash },
      { address: getAddress(r.paymasterImplementation), codeHash: r.paymasterImplementationHash },
    ], reads: [
      { kind: "storage" as const, address: token, data: TOKEN_SLOT, expected: word(r.tokenImplementation) },
      { kind: "storage" as const, address: PAYMASTER, data: PAYMASTER_SLOT, expected: word(r.paymasterImplementation) },
      call(PAYMASTER, "entryPoint()", word(ENTRY_POINT)), call(PAYMASTER, "token()", word(token)),
      call(PAYMASTER, "wrappedNativeToken()", word(r.wrappedNativeToken)), call(DELEGATE, "entryPoint()", word(ENTRY_POINT)),
      call(token, "name()", encodeAbiParameters(parseAbiParameters("string"), [r.tokenName])),
      call(token, "decimals()", word("6")), call(token, "DOMAIN_SEPARATOR()", r.tokenDomain),
    ], evidenceHash: "b05aca1551fafb5734cccc0fe2b51d493782471544d03e63ae267c4b58104972" } satisfies GaslessDeployment;
}));

export function gaslessDeployment(chainId: GaslessChainId): GaslessDeployment {
  const row = GASLESS_DEPLOYMENTS.find((d) => d.chainId === gaslessChain(chainId));
  if (row === undefined) gaslessFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "gasless_chain_unavailable");
  return row;
}
export function gaslessProtocolHash(row: GaslessDeployment): string {
  return hashObject({ chainId: row.chainId, token: row.token, tokenDomain: row.tokenDomain,
    paymaster: row.paymaster, entryPoint: row.entryPoint, delegate: row.delegate, code: row.code, reads: row.reads });
}
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
