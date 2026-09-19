import { recoverTypedDataAddress } from "viem";
import { canonicalJson, domainHash } from "../canonical.js";
import { ApnError } from "../errors.js";
import type { Address, Hex } from "../model.js";
import type { Permit2OfferSelection } from "./offer.js";
import { PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY } from "./registry.js";

const PLAN_DOMAIN = "apn.x402-permit2.plan.v1";
const MAX_UINT256 = (1n << 256n) - 1n;
export const EIP2612_GAS_SPONSORING = "eip2612GasSponsoring" as const;

/** Must equal the x402 exact proxy's witness layout; the test suite cross-checks it against @x402/evm. */
export const PERMIT2_WITNESS_TYPES = {
  PermitWitnessTransferFrom: [
    { name: "permitted", type: "TokenPermissions" }, { name: "spender", type: "address" }, { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" }, { name: "witness", type: "Witness" },
  ],
  TokenPermissions: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }],
  Witness: [{ name: "to", type: "address" }, { name: "validAfter", type: "uint256" }],
} as const;
export const EIP2612_PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
  ],
} as const;

export interface Permit2Authorization {
  readonly from: Address;
  readonly permitted: { readonly token: Address; readonly amount: string };
  readonly spender: Address;
  readonly nonce: string;
  readonly deadline: string;
  readonly witness: { readonly to: Address; readonly validAfter: "0" };
}
export interface Eip2612PermitInfo {
  readonly from: Address; readonly asset: Address; readonly spender: Address; readonly amount: string;
  readonly nonce: string; readonly deadline: string; readonly version: "1";
}
export interface Permit2TypedData {
  readonly domain: Readonly<Record<string, string | number>>;
  readonly types: typeof PERMIT2_WITNESS_TYPES | typeof EIP2612_PERMIT_TYPES;
  readonly primaryType: "PermitWitnessTransferFrom" | "Permit";
  readonly message: Readonly<Record<string, unknown>>;
}
/** What the owner approves: one Permit2 witness transfer and, only when allowance is short, one exact-amount EIP-2612 permit. */
export interface Permit2SigningPlan {
  readonly selection: Permit2OfferSelection;
  readonly authorization: Permit2Authorization;
  readonly permit2: Permit2TypedData;
  readonly eip2612: { readonly info: Eip2612PermitInfo; readonly typedData: Permit2TypedData } | null;
  readonly planHash: string;
}
export interface Permit2PlanInput {
  readonly payer: Address;
  readonly nowSeconds: number;
  /** 256-bit random unordered Permit2 nonce, drawn by the caller from a CSPRNG. */
  readonly nonce: bigint;
  /** allowance(payer, Permit2) read at prepare from the admitted chain. */
  readonly permit2AllowanceAtomic: string;
  /** nonces(payer) of the token, read at prepare; required only when the permit is needed. */
  readonly eip2612Nonce: bigint | null;
  /** True only when the seller's 402 advertised the `eip2612GasSponsoring` extension. */
  readonly sellerSponsorsEip2612: boolean;
}

export function planPermit2Authorization(selection: Permit2OfferSelection, input: Permit2PlanInput): Permit2SigningPlan {
  if (typeof input.payer !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(input.payer) || input.payer.toLowerCase() === selection.payTo.toLowerCase()) {
    invalid("The payer must be an exact EVM address other than the payee.");
  }
  if (!Number.isSafeInteger(input.nowSeconds) || input.nowSeconds < 1) invalid("The signing instant is invalid.");
  if (typeof input.nonce !== "bigint" || input.nonce < 0n || input.nonce > MAX_UINT256) invalid("The Permit2 nonce is invalid.");
  if (!/^(0|[1-9][0-9]{0,77})$/u.test(input.permit2AllowanceAtomic)) invalid("The observed Permit2 allowance is invalid.");
  const { listAsset } = selection;
  const deadline = String(input.nowSeconds + selection.maxTimeoutSeconds);
  const authorization: Permit2Authorization = {
    from: input.payer,
    permitted: { token: listAsset.token, amount: selection.amountAtomic },
    spender: X402_EXACT_PERMIT2_PROXY,
    nonce: input.nonce.toString(),
    deadline,
    witness: { to: selection.payTo, validAfter: "0" },
  };
  const permit2: Permit2TypedData = {
    domain: { name: "Permit2", chainId: listAsset.chainId, verifyingContract: PERMIT2_ADDRESS },
    types: PERMIT2_WITNESS_TYPES,
    primaryType: "PermitWitnessTransferFrom",
    message: {
      permitted: { token: listAsset.token, amount: BigInt(selection.amountAtomic) }, spender: X402_EXACT_PERMIT2_PROXY,
      nonce: input.nonce, deadline: BigInt(deadline), witness: { to: selection.payTo, validAfter: 0n },
    },
  };
  let eip2612: Permit2SigningPlan["eip2612"] = null;
  if (BigInt(input.permit2AllowanceAtomic) < BigInt(selection.amountAtomic)) {
    if (!input.sellerSponsorsEip2612) {
      throw new ApnError("APN_X402_UNSUPPORTED_OFFER", "Permit2 lacks allowance and the seller does not sponsor an EIP-2612 permit.",
        { reason: "x402_permit2_allowance_required", rail: "x402" });
    }
    if (typeof input.eip2612Nonce !== "bigint" || input.eip2612Nonce < 0n || input.eip2612Nonce > MAX_UINT256) invalid("The token permit nonce is invalid.");
    const info: Eip2612PermitInfo = { from: input.payer, asset: listAsset.token, spender: PERMIT2_ADDRESS, amount: selection.amountAtomic,
      nonce: input.eip2612Nonce.toString(), deadline, version: "1" };
    eip2612 = { info, typedData: {
      domain: { name: listAsset.tokenDomain.name, version: listAsset.tokenDomain.version, chainId: listAsset.chainId, verifyingContract: listAsset.token },
      types: EIP2612_PERMIT_TYPES,
      primaryType: "Permit",
      // Exactly the payment amount, never an unlimited approval.
      message: { owner: input.payer, spender: PERMIT2_ADDRESS, value: BigInt(selection.amountAtomic), nonce: input.eip2612Nonce, deadline: BigInt(deadline) },
    } };
  }
  const planHash = domainHash(PLAN_DOMAIN, canonicalJson({ offerHash: selection.offerHash, index: selection.index, authorization,
    eip2612: eip2612?.info ?? null }));
  return { selection, authorization, permit2, eip2612, planHash };
}

/** Recover the payer from a frozen typed-data/signature pair without signing or sending anything. */
export async function recoverPermit2Payer(typedData: Permit2TypedData, signature: Hex): Promise<Address> {
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/u.test(signature)) {
    throw new ApnError("APN_NATIVE_PROTOCOL", "The supplied signature is malformed.");
  }
  try {
    return await recoverTypedDataAddress({ ...typedData, signature } as Parameters<typeof recoverTypedDataAddress>[0]) as Address;
  } catch {
    throw new ApnError("APN_NATIVE_PROTOCOL", "The supplied signature does not recover.");
  }
}

/** Verify that a supplied signature recovers to the frozen payer. */
export async function verifyPermit2PayerSignature(typedData: Permit2TypedData, signature: Hex, payer: Address): Promise<void> {
  const recovered = await recoverPermit2Payer(typedData, signature);
  if (recovered.toLowerCase() !== payer.toLowerCase()) throw new ApnError("APN_WALLET_MISMATCH", "The signature is not the frozen payer's.");
}

function invalid(message: string): never { throw new ApnError("APN_INVALID_INPUT", message); }
