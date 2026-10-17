import assert from "node:assert/strict";
import test from "node:test";
import { savedApprovalProof } from "./circle-v2-evm-approval-public-fixture.js";
import { approvalReceiptIdentity } from "../../src/legacy/circle-sealed-burn-retirement.js";
import type { CircleReceiptProof } from "../../src/circle-v2-evm/protocol.js";
test("authentic saved identity pins all original approval receipt and transaction fields", () => {
  assert.equal(approvalReceiptIdentity(savedApprovalProof as CircleReceiptProof), "b9af6f9f65b2fc0f3ac51f3cad9fa47c9411824c4dd646715b5dde0edba4827b");
});
