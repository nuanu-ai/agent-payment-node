import { randomUUID } from "node:crypto";
import type { BoundCommand } from "../command-binder.js";
import type { OutputEnvelope } from "../commands.js";
import { MacOSLoginKeychainSecret } from "../macos-keychain.js";
import { successEnvelope, failureEnvelope } from "../output.js";
import type { RuntimeFactoryOptions } from "../runtime-factory-options.js";
import { StateStore } from "../state.js";
import { exactChainConsent } from "../tty-approval.js";
import { ApnError } from "../errors.js";
import { MerchantCustody } from "./custody.js";
import { MerchantHttp } from "./http.js";
import { MerchantService } from "./service.js";
import { publicMerchant, type MerchantOperation } from "./model.js";
import { MerchantRpc } from "./rpc.js";
import { formatUnits } from "viem";
import { MERCHANT_ASSET_PINS } from "./asset-pins.js";
import { merchantTerms } from "./terms.js";
export async function executeMerchantCli(bound: BoundCommand, options: RuntimeFactoryOptions, root: string): Promise<OutputEnvelope> {
    const request = bound.request, requestId = randomUUID();
    try {
        const state = new StateStore(root), now = () => options.clock?.now() ?? new Date(), rpc = new MerchantRpc(state), http = options.http ?? new MerchantHttp();
        const service = new MerchantService(state, { rpc, http, now, assets: MERCHANT_ASSET_PINS, ...(request.command !== "x402.merchant.approve" ? {} : { custody: new MerchantCustody(state, options.wrappingSecret ?? new MacOSLoginKeychainSecret(), now), approve: async (o) => {
                    const t = merchantTerms(o);
                    await exactChainConsent(["Agent Payment Node: x402 ERC-20 transfer-proof merchant payment", `Operation: ${o.operationId}`, `Profile: ${o.profile}; local payer: ${t.payer}`, `GET ${t.url}`, `Chain: ${t.asset.networkName} mainnet ${t.chain}; token: ${t.asset.symbol} ${t.token}`, `Merchant payee: ${t.payee}`, `Merchant payment window: ${String(o.frozen.accepted.maxTimeoutSeconds)} seconds from each challenge read (refused once passed)`, `Exact principal: ${t.amount} atomic ${t.asset.symbol} (${formatUnits(BigInt(t.amount), t.asset.decimals)} ${t.asset.symbol})`, `Mechanism: ${t.mechanism.provider} / ${t.mechanism.reference}`, `Full native pre-submission admission budget: ${o.envelope.maximumNativeFee} wei (L1 is estimated; no signed L1 inclusion cap)`, `Signed execution cap: ${o.feeContext?.executionUpper ?? "missing"} wei; estimated L1 upper: ${o.feeContext?.l1EstimatedUpper ?? "missing"} wei; estimated operator fee: ${o.feeContext?.operatorEstimatedUpper ?? "missing"} wei; full owner hold: ${o.effectBinding?.nativeAmountAtomic ?? "missing"} wei`, `Policy window ends: ${o.effectBinding?.policyEndsAt ?? "missing"}; foreground authority lasts at most 60 seconds after confirmation`, `Nonce: ${o.envelope.nonce}; gas: ${o.envelope.gas}; max fee per gas: ${o.envelope.maxFeePerGas}; priority: ${o.envelope.maxPriorityFeePerGas}`, `Challenge: ${o.frozen.challengeHash}; operation: ${o.fingerprint}`, `Policy revision: ${o.policy.revision}; activation: ${o.policy.activationDigest}`, `Deadline: ${o.expiresAt}`, "One ERC20 transfer is signed and broadcast once. Ambiguous outcomes remain held for observation.", t.legacy ? "Finalized payment and HTTP 200 Bitcoin-price delivery are separate proofs." : "Finalized payment and the merchant's HTTP 200 delivery are separate proofs."], o.fingerprint.slice(0, 8), o.expiresAt, options.merchantTtyOptions ?? {});
                } }) });
        const o = request.command === "x402.merchant.prepare" ? await service.prepare(request) : request.command === "x402.merchant.approve" ? await service.approve(request.operationId) : request.command === "x402.merchant.observe" ? await service.observe(request.operationId, request.deliver) : request.command === "x402.merchant.retire-unsent" ? await service.retireUnsent(request.operationId) : request.command === "x402.merchant.status" ? await service.status(request.operationId) : null;
        if (o === null)
            throw new ApnError("APN_UNSUPPORTED_COMMAND", "Merchant command is unavailable.");
        return successEnvelope(request, requestId, { proofClass: merchantProofClass(o), data: publicMerchant(o), operation: null, receipt: null, nextActions: [] });
    }
    catch (error) {
        // Only the asset-choice refusals keep their message: APN builds it from registry data (symbols and addresses) to list the offer.
        const actionable = error instanceof ApnError && ["merchant_asset_choice_required", "merchant_asset_not_offered"].includes(String(error.details?.reason));
        return failureEnvelope(request.command, requestId, new ApnError(error instanceof ApnError ? error.code : "APN_INTERNAL", actionable ? (error as ApnError).message : "Merchant transfer-proof command could not proceed.", error instanceof ApnError ? error.details : undefined));
    }
}
/** What proves the state a merchant command answers with. */
function merchantProofClass(o: MerchantOperation): string {
    if (o.state === "retired_unsent") return "merchant_unsent_retired";
    if (o.state === "delivered") return o.schemaVersion === "apn.x402-merchant.v1" ? "external_merchant_price_delivered" : "external_merchant_delivered";
    if (o.state === "failed_before_effect") return "merchant_attempt_never_sent";
    if (o.state === "failed_proven_superseded") return "finalized_nonce_superseded_without_receipt";
    if (o.state === "abandoned_unknown") return "owner_acknowledgement_only";
    return o.receipt?.status === "success" ? "canonical_finalized_erc20_payment" : "merchant_local_journal";
}
