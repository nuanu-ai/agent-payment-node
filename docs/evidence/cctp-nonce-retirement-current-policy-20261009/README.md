# Fresh current authority for the existing nonce cleanup

The v10 live command refused owner_policy_changed before any intent, TTY approval, signature or send. It compared the old parent policy activation to current owner policy even though the new approve0 cleanup requires separate current authority.

The explicit cleanup-nonce command now captures a create-only sidecar containing the parent binding, unchanged source/destination custody identities, both current policy digest/revision/activation identities, capture time and earliest true policy window end. It re-admits existing historical reservations under current policy and verifies each retained ledger hold. It reserves no additional budget and releases no hold during authorization. Original parent policies, expiry, material hashes and chained prefix remain unchanged.

Current policy and custody are checked under the existing owner/address/operation and true allowlist locks. The current frame hash binds the foreground code, private grant and permanent SIGN/SEND claims. Normal policy writers remain excluded throughout wallet access and queued HTTPS dispatch. Existing private guards enforce the fresh sixty-second consent and current policy window at wallet, signing, fencing and actual TLS request body boundaries. A later activation, altered owner, missing native admission or closed hold refuses financial work. Persisted sidecar metadata cannot itself grant dispatch. Original approval/burn tombstones, observer-only recovery and exact finalized chain/ledger proof are unchanged.

This packet is source-only. No live wallet, profile, policy, operation or ledger was mutated. Independent review and a new consumer are required before another live command.

Pinned Node 24.15.0 strict production and focused Circle/MCP/discovery test compilation passed. The focused configuration explicitly uses the existing pinned node_modules/@types. The earlier /tmp configuration HTTP mismatch was traced by the separate diagnostic executor to ambient type-root resolution; no HTTP source or strict compiler settings were weakened. Repeat production builds are byte-identical across 2,409 dist files; all 803 TypeScript source files are at most 500 lines. Final Circle and MCP runtime tests passed 98/98, including compatible current activation with historical holds, subsequent activation refusal, owner/native/ledger negatives and replaced sidecar claim-hash refusal. Detailed counts and test results accompany this report.

Text was shortened by removing repeated staging language; requirements and verification limits remain explicit.
