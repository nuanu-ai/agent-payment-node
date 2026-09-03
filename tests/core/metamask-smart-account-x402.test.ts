import assert from "node:assert/strict";
import test from "node:test";
import { BASE_USDC } from "../../src/constants.js";
import { inspectCandidates } from "../../src/x402-codec.js";
import { metamaskSmartAccountX402CapabilitySnapshot } from "../../src/provider-profile.js";
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
