import { randomUUID } from "node:crypto";
import { MacOSLoginKeychainSecret } from "../macos-keychain.js";
import { successEnvelope, failureEnvelope } from "../output.js";
import { StateStore } from "../state.js";
import { exactChainConsent } from "../tty-approval.js";
import { ApnError } from "../errors.js";
import { MerchantCustody } from "./custody.js";
import { MerchantHttp } from "./http.js";
import { MerchantService } from "./service.js";
import { publicMerchant } from "./model.js";
import { MerchantRpc } from "./rpc.js";
import { MERCHANT_AMOUNT, MERCHANT_OWNER, MERCHANT_PAYEE, MERCHANT_TOKEN, MERCHANT_URL } from "./pins.js";
export async function executeMerchantCli(bound, options, root) {
    const request = bound.request, requestId = randomUUID();
    try {
        const state = new StateStore(root), now = () => options.clock?.now() ?? new Date(), rpc = new MerchantRpc(state), http = options.http ?? new MerchantHttp();
        const service = new MerchantService(state, { rpc, http, now, ...(request.command !== "x402.merchant.approve" ? {} : { custody: new MerchantCustody(state, options.wrappingSecret ?? new MacOSLoginKeychainSecret(), now), approve: async (o) => {
                    await exactChainConsent(["Agent Payment Node: x402engine USDm merchant payment", `Operation: ${o.operationId}`, `Profile: ${o.profile}; local payer: ${MERCHANT_OWNER}`, `GET ${MERCHANT_URL}`, `Chain: MegaETH mainnet eip155:4326; token: ${MERCHANT_TOKEN}`, `Merchant payee: ${MERCHANT_PAYEE}`, `Exact principal: ${MERCHANT_AMOUNT} atomic USDm (0.001 USDm)`, `Full native pre-submission admission budget: ${o.envelope.maximumNativeFee} wei (L1 is estimated; no signed L1 inclusion cap)`, `Signed execution cap: ${o.feeContext?.executionUpper ?? "missing"} wei; estimated L1 upper: ${o.feeContext?.l1EstimatedUpper ?? "missing"} wei; full owner hold: ${o.effectBinding?.nativeAmountAtomic ?? "missing"} wei`, `Policy window ends: ${o.effectBinding?.policyEndsAt ?? "missing"}; foreground authority lasts at most 60 seconds after confirmation`, `Nonce: ${o.envelope.nonce}; gas: ${o.envelope.gas}; max fee per gas: ${o.envelope.maxFeePerGas}; priority: ${o.envelope.maxPriorityFeePerGas}`, `Challenge: ${o.frozen.challengeHash}; operation: ${o.fingerprint}`, `Policy revision: ${o.policy.revision}; activation: ${o.policy.activationDigest}`, `Deadline: ${o.expiresAt}`, "One ERC20 transfer is signed and broadcast once. Ambiguous outcomes remain held for observation.", "Finalized payment and HTTP 200 Bitcoin-price delivery are separate proofs."], o.fingerprint.slice(0, 8), o.expiresAt, options.merchantTtyOptions ?? {});
                } }) });
        const o = request.command === "x402.merchant.prepare" ? await service.prepare(request) : request.command === "x402.merchant.approve" ? await service.approve(request.operationId) : request.command === "x402.merchant.observe" ? await service.observe(request.operationId, request.deliver) : request.command === "x402.merchant.retire-unsent" ? await service.retireUnsent(request.operationId) : request.command === "x402.merchant.status" ? await service.status(request.operationId) : null;
        if (o === null)
            throw new ApnError("APN_UNSUPPORTED_COMMAND", "Pinned merchant command is unavailable.");
        return successEnvelope(request, requestId, { proofClass: o.state === "retired_unsent" ? "merchant_unsent_retired" : o.state === "delivered" ? "external_merchant_price_delivered" : o.receipt?.status === "success" ? "canonical_finalized_erc20_payment" : "merchant_local_journal", data: publicMerchant(o), operation: null, receipt: null, nextActions: [] });
    }
    catch (error) {
        return failureEnvelope(request.command, requestId, new ApnError(error instanceof ApnError ? error.code : "APN_INTERNAL", "Pinned USDm merchant command could not proceed.", error instanceof ApnError ? error.details : undefined));
    }
}
//# sourceMappingURL=cli.js.map