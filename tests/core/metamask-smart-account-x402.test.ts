import assert from "node:assert/strict";
import test from "node:test";
import {
  ALL_METAMASK_FACILITATOR_ADDRESSES,
  METAMASK_FACILITATOR_ADDRESSES_DEV,
} from "@metamask/7715-permission-types";
import { BASE_USDC } from "../../src/constants.js";
import { decodePaymentRequiredHeader, inspectCandidates } from "../../src/x402-codec.js";
import { sameDelegationSalt } from "../../src/metamask-smart-account-x402.js";
import { metamaskSmartAccountX402CapabilitySnapshot } from "../../src/provider-profile.js";
import { canonicalPaymentRequiredHeader } from "./x402-vectors.js";
import type { PaymentRequired } from "@x402/core/types";

const URL = "https://seller.example/smart-account";
const FACILITATOR = "0x3333333333333333333333333333333333333333";

test("Slice 3 capability exposes APN-owned delegated ERC-7710 x402", () => {
  const capabilities = metamaskSmartAccountX402CapabilitySnapshot();
  assert.equal(capabilities.direct.available, true);
  assert.equal(capabilities.direct.mode, "delegated_session_transaction");
  assert.equal(capabilities.x402.available, true);
  assert.equal(capabilities.x402.mode, "delegated_erc7710_apn_paid_retry");
  assert.equal(capabilities.x402.execution_owner, "apn");
  assert.equal(capabilities.x402.retry_owner, "apn_state_machine");
});

test("strict inspection accepts only explicit ERC-7710 offers without EIP-3009 token-domain defaults", () => {
  const paymentRequired: PaymentRequired = {
    x402Version: 2,
    resource: { url: URL },
    accepts: [{
      scheme: "exact",
      network: "eip155:8453",
      amount: "1000",
      asset: BASE_USDC,
      payTo: "0x2222222222222222222222222222222222222222",
      maxTimeoutSeconds: 60,
      extra: {
        assetTransferMethod: "erc7710",
        facilitatorAddresses: [FACILITATOR],
      },
    }],
  };
  const [candidate] = inspectCandidates(paymentRequired, URL);
  assert.ok(candidate !== undefined);
  assert.equal(candidate.assetTransferMethod, "erc7710");
  assert.deepEqual(candidate.facilitatorAddresses, [FACILITATOR]);

  for (const extra of [
    {},
    { assetTransferMethod: "erc7710", facilitatorAddresses: [] },
    { assetTransferMethod: "erc7710", facilitatorAddresses: [FACILITATOR, FACILITATOR] },
    { assetTransferMethod: "erc7710", facilitatorAddresses: ["0xnot-an-address"] },
    { assetTransferMethod: "erc7710", facilitatorAddresses: [FACILITATOR], unsafe: true },
  ]) {
    const rejected = {
      ...paymentRequired,
      accepts: [{ ...paymentRequired.accepts[0], extra }],
    } as PaymentRequired;
    assert.deepEqual(inspectCandidates(rejected, URL), []);
  }
});

test("ERC-7710 facilitator sets are canonical regardless of seller order", () => {
  const facilitators = [
    "0x3333333333333333333333333333333333333333",
    "0x1111111111111111111111111111111111111111",
    "0x2222222222222222222222222222222222222222",
  ];
  const paymentRequired: PaymentRequired = {
    x402Version: 2,
    resource: { url: URL },
    accepts: [{
      scheme: "exact",
      network: "eip155:8453",
      amount: "1000",
      asset: BASE_USDC,
      payTo: "0x2222222222222222222222222222222222222222",
      maxTimeoutSeconds: 60,
      extra: { assetTransferMethod: "erc7710", facilitatorAddresses: facilitators },
    }],
  };

  const [candidate] = inspectCandidates(paymentRequired, URL);
  assert.ok(candidate !== undefined && candidate.assetTransferMethod === "erc7710");
  assert.deepEqual(candidate.facilitatorAddresses, [...facilitators].sort());
});

test("ERC-7710 deterministic salt comparison accepts equivalent uint256 encodings", () => {
  assert.equal(sameDelegationSalt("0x01", `0x${"0".repeat(62)}01`), true);
  assert.equal(sameDelegationSalt("0x01", "0x02"), false);
});

test("current official seller shape uses the pinned MetaMask facilitator set when none is published", () => {
  const decoded = decodePaymentRequiredHeader(canonicalPaymentRequiredHeader({
    x402Version: 2,
    error: "Payment Required",
    message: "This field is presentation-only.",
    developerNote: "This field is never persisted or echoed.",
    resource: { url: URL, description: "URL inspection", mimeType: "application/json" },
    accepts: [{
      scheme: "exact",
      network: "eip155:8453",
      amount: "10000",
      asset: BASE_USDC,
      payTo: "0x2222222222222222222222222222222222222222",
      maxTimeoutSeconds: 300,
      extra: {
        assetTransferMethod: "erc7710",
        name: "USD Coin",
        version: "2",
        decimals: 6,
      },
    }],
  }));
  const [candidate] = inspectCandidates(decoded, URL);
  assert.ok(candidate !== undefined && candidate.assetTransferMethod === "erc7710");
  assert.deepEqual(candidate.facilitatorAddresses, ALL_METAMASK_FACILITATOR_ADDRESSES.map((value) => value.toLowerCase()).sort());
  assert.equal(candidate.facilitatorAddresses.includes(METAMASK_FACILITATOR_ADDRESSES_DEV[0].toLowerCase()), true);
  assert.equal("message" in decoded, false);
  assert.equal("developerNote" in decoded, false);

  for (const extra of [
    { assetTransferMethod: "erc7710", decimals: 18 },
    { assetTransferMethod: "erc7710", paymentFlow: "upfront" },
    { assetTransferMethod: "erc7710", name: "" },
  ]) {
    const rejected = { ...decoded, accepts: [{ ...decoded.accepts[0], extra }] } as PaymentRequired;
    assert.deepEqual(inspectCandidates(rejected, URL), []);
  }
});
