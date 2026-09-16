import assert from "node:assert/strict";
import test from "node:test";
import { submitCircleV2BaseSourceBurn } from "../../src/lifi/circle-v2-source-execution.js";

/** A public caller can forge every structural port, including the claimed Circle and Base origin. */
test("forged Circle admission ports cannot reach an effect", async () => {
  let signs = 0, sends = 0, stages = 0;
  const forgedPorts = {
    freshDraft: async () => ({ quoteResponse: { signedQuote: "0x1234" } }),
    preflight: async () => ({ claimable: true, failedChecks: [] }),
    readBase: async () => ({ chainId: 8453 }),
    approve: async () => {},
    admitLive: async () => ({ kind: "circle_v2_live_transport_v1", circleOrigin: "https://iris-api.circle.com",
      rpcOrigin: "https://base.example.org", validationHash: "1".repeat(64) }),
    signer: { kind: "imported_evm_signer", signTransaction: async () => { signs++; return "0x1234"; } },
    sendRawTransaction: async () => { sends++; return "0x1234"; },
    journal: { stageLiveCircle: async () => { stages++; return {}; } },
  };
  await assert.rejects(submitCircleV2BaseSourceBurn({ payer: "0x000000000000000000000000000000000000bEEF" }, forgedPorts),
    { code: "APN_OPERATION_BLOCKED" });
  assert.equal(signs, 0); assert.equal(sends, 0); assert.equal(stages, 0);
});
