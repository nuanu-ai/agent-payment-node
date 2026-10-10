# Linea native-fill archive trace

The normal Linea observation session now reads the exact full callTracer response from the explicitly configured archive reader. The previous scalar path sent it to the frozen primary reader, which can refuse debug_traceTransaction even when the archive reader accepted the preparation trace probe. The primary RPC origin remains the identity in the proof.

Only chain 59144 with the existing session batch primitive changes. Other chains and the legacy non-session adapter retain their scalar route. The trace read uses archive_deployment with eth_chainId decoded by rpcArchiveChainValue and the exact full trace decoded by rpcRecordValue. It keeps the existing read budget, provider scheduler, shared physical gate and command deadline.

The normal runtime binds bridgeRpcFactory in src/runtime-factory.ts:407. src/lifi/service.ts:192-208 creates execution and observation sessions; src/lifi/rpc-transport.ts:211-217 passes sessionBatchCall into BridgeRpc. src/lifi/observation.ts:247 still rejects an origin that differs from the frozen operation, and the following deployment checks retain code/configuration/block identity. Receipt membership, canonical block membership, native amount parsing and reanchoring remain unchanged.

The retained parent-routing-failure.log runs the production factory regression against the frozen c280 parent adapter bytes. It fails with APN_RPC_PROTOCOL for debug_traceTransaction on primary. The test uses the existing immutable public finalized Linea fixture with SHA256 ecc7d70307afd5d529965c5f37139df5380958408b28524b9e089917b1900b04; it does not claim current genuine-owner completion.

New tests cover primary trace refusal with valid archive proof, wrong archive chain, RPC error, missing/malformed/oversized trace, changed trace, changed receipt, canonical membership, reanchor, wrong native amount, original deadline, request limits and frozen primary origin. Initial compile/setup/assertion failures stay in the evidence directory. The test clock now yields the event loop before advancing so queued physical attempts retain distinct transport timestamps; production pacing was not changed.

No live RPC, signing, sending, journal mutation, package publication, actual kernel, or ALL7 run occurred in this author packet. The root producer will validate the accepted child before observation-only reconciliation of the old unknown operation.

Writing pass: removed staging and repeated conclusions. No supplied prose was rewritten.

Validation: strict production and test compilation passed with pinned Node v24.15.0 and TypeScript 5.9.2. The scanner passed 885 source files; rpc-adapter remains 490 lines. All 2655 tracked shipping artifacts were byte-identical after a second production emit, and six fresh-process import orders passed. Focused runner counts are recorded in qa.json after completion; the initial 205/206 run was superseded after correcting the test clock.
