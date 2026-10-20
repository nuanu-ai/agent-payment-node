import { canonicalJson, domainHash, sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import type { Address, Hex } from "./model.js";
import { parseAtomic } from "./money.js";
import type { RpcPort } from "./ports.js";
import type { InspectCandidate, Permit2InspectCandidate } from "./x402-model.js";
import type { X402Asset } from "./x402-network.js";
import { paymentIdentifierState, selectPrepareOffer, tokenDomainSeparator, validatePrepareEvidence, type FreshChallenge,
  type SelectedPrepareOffer } from "./x402-policy.js";
import type { X402Permit2PrepareEvidence } from "./x402-permit2-rpc.js";
import { permit2SellerSponsorsEip2612 } from "./x402-permit2/prepare.js";
import { PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY } from "./x402-permit2/registry.js";
import { validatePermit2PaymentPayload } from "./x402-permit2/codec-shape.js";
import { x402Eip2612Info, x402Permit2Authorization } from "./x402-permit2-exact.js";

/** What prepare freezes from its single pinned chain read, whichever method the offer uses. */
export interface X402PrepareRead {
  readonly selected: SelectedPrepareOffer;
  readonly balanceAtomic: string;
  readonly block: { readonly number: string; readonly hash: Hex; readonly timestamp: string };
  readonly observedAt: string;
  /** The token's on-chain decimals(), read for every token outside the released USDC pairs. */
  readonly decimals?: number;
}

export interface X402PrepareReadInput {
  /** Named in the refusal that asks the owner for an allowance to Permit2. */
  readonly profile: string;
  readonly rpc: RpcPort;
  readonly rpcOrigin: string;
  readonly discovered: FreshChallenge;
  /** Offers of the selected chain+token within the owner's cap and payee pin, in seller index order. */
  readonly underCap: readonly InspectCandidate[];
  readonly wallet: Address;
  readonly asset: X402Asset;
  readonly transferMethod: "eip3009" | "erc7710";
  /** Only APN's own local signer signs Permit2 witness transfers. */
  readonly permit2Signer: boolean;
  readonly nonce: Hex;
  readonly startedAtMs: number;
  readonly nowMs: () => number;
}

/**
 * The deterministic method rule: EIP-3009 when the seller offers it for this chain+token (no allowance needed), else
 * Permit2 when the payer is the local wallet; the lowest-index offer of that method that fits the balance (and, for
 * Permit2, the allowance or a seller-sponsored permit) wins. An operation never changes method afterwards.
 */
export async function readAndSelectX402Offer(input: X402PrepareReadInput): Promise<X402PrepareRead> {
  const permit2 = input.underCap.filter((candidate): candidate is Permit2InspectCandidate => candidate.assetTransferMethod === "permit2");
  if (input.transferMethod === "eip3009" && input.permit2Signer && permit2.length > 0 &&
      !input.underCap.some((candidate) => candidate.assetTransferMethod === "eip3009")) return await readPermit2(input, permit2);
  const evidence = await input.rpc.getX402PrepareEvidence(input.wallet, input.nonce);
  const completedAtMs = input.nowMs();
  const selected = selectPrepareOffer(input.discovered, input.underCap, evidence, input.wallet, {
    asset: input.asset, rpcOriginHash: sha256(input.rpcOrigin), invocationStartedAtMs: input.startedAtMs, invocationCompletedAtMs: completedAtMs,
  }, input.transferMethod);
  return { selected, balanceAtomic: evidence.usdcAtomic, block: evidence.block, observedAt: evidence.observedAt,
    ...(evidence.tokenFacts === undefined ? {} : { decimals: evidence.tokenFacts.decimals }) };
}

async function readPermit2(input: X402PrepareReadInput, candidates: readonly Permit2InspectCandidate[]): Promise<X402PrepareRead> {
  if (input.rpc.getX402Permit2PrepareEvidence === undefined) throw new ApnError("APN_RPC_CONFIG", "RPC adapter lacks x402 Permit2 support.");
  const sponsors = permit2SellerSponsorsEip2612(input.discovered.paymentRequired);
  // The token's domain and permit nonce are read only when some offer could be paid only through the seller's sponsored permit.
  const permitNeeded = (allowance: string) => sponsors && candidates.some((candidate) => candidate.tokenName !== undefined &&
    BigInt(candidate.amountAtomic) > BigInt(allowance));
  const evidence: X402Permit2PrepareEvidence = await input.rpc.getX402Permit2PrepareEvidence(input.wallet, input.nonce, permitNeeded);
  validatePrepareEvidence(evidence, input.wallet, { asset: input.asset, rpcOriginHash: sha256(input.rpcOrigin),
    invocationStartedAtMs: input.startedAtMs, invocationCompletedAtMs: input.nowMs() }, "permit2");
  const balance = parseAtomic(evidence.usdcAtomic), allowance = parseAtomic(evidence.allowanceAtomic);
  let funded = false, allowanceShort = false;
  for (const candidate of candidates) {
    const amount = parseAtomic(candidate.amountAtomic, { positive: true });
    // As in the foreground Permit2 lane, the payee is never the payer, the token or a Permit2 contract.
    if ([input.wallet, input.asset.token, PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY]
      .some((address) => address.toLowerCase() === candidate.payTo.toLowerCase())) continue;
    if (amount > balance) continue;
    funded = true;
    let eip2612: { readonly tokenName: string; readonly tokenVersion: string; readonly nonce: string } | null = null;
    if (amount > allowance) {
      // The seller's sponsored exact-amount permit must sign the token's own domain: its hint must recompute DOMAIN_SEPARATOR.
      const permit = evidence.permit;
      if (!sponsors || candidate.tokenName === undefined || candidate.tokenVersion === undefined || permit === undefined ||
          tokenDomainSeparator(candidate.tokenName, candidate.tokenVersion, input.asset) !== permit.domainSeparator.toLowerCase()) {
        allowanceShort = true;
        continue;
      }
      eip2612 = { tokenName: candidate.tokenName, tokenVersion: candidate.tokenVersion, nonce: permit.nonce };
    }
    const requirements = input.discovered.paymentRequired.accepts[Number(candidate.index)];
    if (requirements === undefined) throw new ApnError("APN_HTTP_PROTOCOL", "Selected seller index is missing from the fresh challenge.");
    // Every check the paid request's wire codec makes runs now, before anything is signed (R3): a well-formed placeholder
    // signature stands in for the real ones, which the codec checks only for shape.
    if (!permit2WireAccepts(input, requirements, candidate, eip2612)) continue;
    const declaredCanonicalJson = canonicalJson(requirements);
    return {
      selected: {
        requirements,
        selectedOffer: { index: candidate.index, declaredCanonicalJson, offerHash: domainHash("apn.x402.offer.v1", declaredCanonicalJson),
          resolved: { assetTransferMethod: "permit2", paymentFlow: "permit2WitnessTransfer", eip2612 } },
        amountAtomic: candidate.amountAtomic, payee: candidate.payTo as Address, maxTimeoutSeconds: Number(candidate.maxTimeoutSeconds),
      },
      balanceAtomic: evidence.usdcAtomic, block: evidence.block, observedAt: evidence.observedAt, decimals: evidence.tokenFacts.decimals,
    };
  }
  if (!funded && candidates.some((candidate) => ![input.wallet, input.asset.token, PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY]
    .some((address) => address.toLowerCase() === candidate.payTo.toLowerCase()))) {
    throw new ApnError("APN_INSUFFICIENT_USDC", "The token balance is insufficient for every Permit2 offer within the explicit cap.");
  }
  if (allowanceShort) {
    throw new ApnError("APN_X402_UNSUPPORTED_OFFER", `The wallet's allowance to Permit2 (${PERMIT2_ADDRESS}) for ${input.asset.token} is below the price and the ` +
      "seller sponsors no permit APN can verify. The owner sets a bounded allowance in the foreground; APN never approves unattended.",
    { reason: "x402_permit2_allowance_required", chain: input.asset.network, asset: input.asset.token, spender: PERMIT2_ADDRESS,
      nextActions: [`apn x402 permit2 allowance set --profile ${input.profile} --chain ${input.asset.network} --asset ${input.asset.token} ` +
        "--amount <atomic> --rpc-url <https-rpc> --max-gas-limit <uint> --max-fee-per-gas-wei <wei> --max-priority-fee-per-gas-wei <wei> --idempotency-key <key>"] });
  }
  throw new ApnError("APN_X402_UNSUPPORTED_OFFER", "No fresh Permit2 offer can be paid by this wallet.", { reason: "x402_permit2_no_payable_offer" });
}

/**
 * The seller's payment-identifier declaration the operation binds. The Permit2 wire carries no extension besides the
 * sponsored permit, so a Permit2 payment omits an optional identifier and refuses a required one.
 */
export function x402PaymentIdentifier(paymentRequired: FreshChallenge["paymentRequired"], operationId: string,
  method: "eip3009" | "erc7710" | "permit2") {
  const state = paymentIdentifierState(paymentRequired, operationId);
  if (method !== "permit2" || state === undefined) return state;
  const declaration = JSON.parse(state.declarationCanonicalJson) as { readonly info?: { readonly required?: unknown } };
  if (declaration.info?.required === true) {
    throw new ApnError("APN_X402_UNSUPPORTED_OFFER", "The seller requires a payment identifier, which a Permit2 payment cannot carry.",
      { reason: "x402_permit2_payment_identifier_required" });
  }
  return undefined;
}

const PLACEHOLDER_SIGNATURE = `0x${"0".repeat(63)}1${"0".repeat(63)}11b` as Hex;
function permit2WireAccepts(input: X402PrepareReadInput, requirements: unknown, candidate: Permit2InspectCandidate,
  eip2612: { readonly tokenName: string; readonly tokenVersion: string; readonly nonce: string } | null): boolean {
  const terms = { chainId: input.asset.chainId, token: input.asset.token, from: input.wallet, to: candidate.payTo, value: candidate.amountAtomic,
    nonce: input.nonce, deadline: String(Number(candidate.maxTimeoutSeconds) + 1) };
  const permit = eip2612 === null ? null : { name: eip2612.tokenName, version: eip2612.tokenVersion, nonce: eip2612.nonce };
  try {
    validatePermit2PaymentPayload({ x402Version: 2, resource: input.discovered.paymentRequired.resource, accepted: requirements,
      payload: { signature: PLACEHOLDER_SIGNATURE, permit2Authorization: x402Permit2Authorization(terms) },
      ...(permit === null ? {} : { extensions: { eip2612GasSponsoring: { info: x402Eip2612Info(terms, permit, PLACEHOLDER_SIGNATURE) } } }) });
    return true;
  } catch { return false; }
}
