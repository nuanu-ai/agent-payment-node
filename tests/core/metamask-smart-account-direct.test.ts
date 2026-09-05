import assert from "node:assert/strict";
import test from "node:test";
import { MetaMaskSmartAccountAdapter } from "../../src/metamask-smart-account-adapter.js";
import { metamaskSmartAccountCapabilitySnapshot } from "../../src/provider-profile.js";

test("MetaMask Smart Account exposes direct transfer through its provider bundle", () => {
  const capabilities = metamaskSmartAccountCapabilitySnapshot();
  assert.equal(capabilities.direct.available, true);
  assert.equal(capabilities.direct.mode, "delegated_session_transaction");
  assert.equal(capabilities.direct.execution_owner, "apn");
  assert.equal(capabilities.direct.retry_owner, "apn_operation_state");

  const adapter = new MetaMaskSmartAccountAdapter(
    {
      load: async () => null,
      save: async () => undefined,
      remove: async () => undefined,
      compareAndSet: async () => false,
    },
    { request: async () => ({}), sync: async () => ({}) },
  );
  assert.equal(adapter.bundle().direct?.mode, "delegated_session_transaction");
});
