# Circle V2 actual no-hook Iris response

The v6 normal observer refused `circle_evm_iris_hook` before any destination envelope, signing or submission. The actual COMPLETE response has `decodedMessageBody.hookData: null`; its signed raw message is exactly 376 bytes (228-byte body), containing no hook. Source finality and the issuer fee are valid; this refusal was a decoded API representation mismatch.

The prior nonce/preflight review proved selected nonce fields and synthetic binding. It did not exercise the full real response through the runtime API adapter and therefore missed null hookData. This change adds that missing regression, without rebuilding the response or dropping null fields.

The production binder now permits null alongside omitted hookData and `0x`, only after the existing exact 376-byte signed-message decoder has excluded hook bytes. Nonempty hooks, other types, extra raw bytes, decoded fee/body mismatches and invalid signatures remain rejected. No wire bounds, deployment pins, fee limits, nonce or signature checks changed.

The new test feeds the complete saved actual JSON through `CircleEvmService` attestation port, production HTTPS JSON response parsing, production current-attester reader and production binder/signature recovery. Transport and deployment reads use offline public snapshots; no private material, policy mutation or financial call is reachable. The finalized saved source context and public threshold-two attester snapshot are included separately. Both actual signatures recover enabled Circle attesters; nonce `0x61e1723eed95d9ff527f852541862ac14b5399f6be5d56ff029620d74e1d6384`, fee 5 and net mint 40095 bind. The historical public snapshot establishes fixture validity, not fresh paid admission.

Validation: full source TypeScript build PASS; full test TypeScript build PASS; focused Circle suite 60/60 PASS, including ten malformed variants in the actual-response test. Protocol 212 lines; new test 38 lines. Source/dist parity regenerated normally. No live operation state or financial effect changed; a reviewed replacement consumer is required before another normal observer/mint command.
