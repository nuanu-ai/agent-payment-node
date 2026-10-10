import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, symlink, mkdir, link, lstat, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Cleanup85CancellationProof } from "../../src/circle-cleanup85-cancellation-contract.js";
import type { VerifiedCleanup86CurrentPurpose } from "../../src/circle-v2-evm/cleanup86-current-purpose.js";
/** F85 is a labeled TEST public-accounting/wire oracle, since no authentic finalized85 fixture
 * exists. Current policy approval, lock scope, admission issuer, one-use certificate, 83/84 public
 * cryptography, carry ledger and controller fences remain production. No private owner/key positive. */
test("current86 actual permission issuer with explicit future F85 TEST public-state oracle", async t => {
  let accountingCalls = 0, accountingRefuse = false;
  const realAccounts = await import("viem/accounts"), testKey = `0x${"0".repeat(63)}1` as const;
  let testOwnerOracle: `0x${string}` | undefined, testSigns = 0, testCanonicalF85Witnesses = false;
  t.mock.module("viem/accounts", { namedExports: { ...realAccounts, privateKeyToAccount: (key: `0x${string}`) => {
    const account = realAccounts.privateKeyToAccount(key);
    if (testOwnerOracle === undefined) return account;
    return {...account,address:testOwnerOracle,signTransaction: async (...args: Parameters<typeof account.signTransaction>) => { testSigns++; return account.signTransaction(...args); }};
  } } });
  t.mock.module("../../src/circle-cleanup85-native-cancellation.js", { namedExports: { verifyCleanup85CancellationAccounting: async () => { accountingCalls++; if (accountingRefuse) throw Error("TEST_F85_accounting_refusal"); } } });
  let publicProof: typeof import("../../src/circle-v2-evm/cleanup85-public-proof.js");
  t.mock.module("../../src/circle-v2-evm/cleanup85-public-proof.js", { namedExports: {
    verifyCleanup85PublicWire: (...args: Parameters<typeof publicProof.verifyCleanup85PublicWire>) => publicProof.verifyCleanup85PublicWire(...args),
    cleanup85Reanchor: (...args: Parameters<typeof publicProof.cleanup85Reanchor>) => publicProof.cleanup85Reanchor(...args),
    assertCancellationProofShape: (...args: Parameters<typeof publicProof.assertCancellationProofShape>) => publicProof.assertCancellationProofShape(...args),
    verifyCancellationPublic: async (source: import("../../src/circle-v2-evm/rpc.js").CircleRpc, proof: Cleanup85CancellationProof) => {
      publicProof.assertCancellationProofShape(proof);
      if (!testCanonicalF85Witnesses) return structuredClone(proof.observation);
      // Explicit fixed-owner signature/accounting oracle; the ten canonical witnesses below
      // execute through the real cumulative-budget transport in the same public-verifier order.
      await publicProof.cleanup85Reanchor(source,proof.observation);
      const fresh = await source.observation(proof.transactionHash as `0x${string}`,"finalized"); assert.ok(fresh);
      for (const key of ["canonicalBlock","recheckedBlock","finalityHead"] as const) assert.deepEqual(fresh[key],proof.observation[key]);
      await publicProof.cleanup85Reanchor(source,fresh); return fresh;
    }
  } });
  // Register the future-public oracle before any shared production graph is loaded.
  publicProof = await import(new URL("../../src/circle-v2-evm/cleanup85-public-proof.js?unmocked-shape", import.meta.url).href);
  const { temporaryState } = await import("./helpers.js"), { cleanup85PublicState, cleanup85PublicTransport } = await import("./cleanup85-native-public-fixture.js");
  const { hashObject, canonicalJson } = await import("../../src/canonical.js"), { CircleRpc } = await import("../../src/circle-v2-evm/rpc.js");
  const { circleEnvelope } = await import("../../src/circle-v2-evm/operation-model.js"), { circleMechanism } = await import("../../src/circle-v2-evm/usage.js");
  const { CIRCLE_SOURCE_TOKEN, circleRoute } = await import("../../src/circle-v2-evm/catalog.js");
  const { Cleanup85RecoveryStore, assertCleanup85Window } = await import("../../src/circle-v2-evm/cleanup85-recovery-store.js");
  const { Cleanup86Store, validateCleanup86Intent } = await import("../../src/circle-v2-evm/cleanup86-store.js");
  const { verifyCleanup86CurrentPurpose, verifiedCleanup86CurrentPurpose, assertCleanup86CurrentPermission } = await import("../../src/circle-v2-evm/cleanup86-current-purpose.js");
  const { resolveCleanup85NativeLineage, verifiedCleanup85NativeLineage } = await import("../../src/circle-cleanup85-unsigned-retirement.js");
  const { withCleanup85FinancialScope } = await import("../../src/circle-cleanup85-financial-scope.js");
  const { executeAllowlistPolicyCommand } = await import("../../src/allowlist-policy-command.js"), { AllowlistPolicyStore } = await import("../../src/allowlist-policy-store.js");
  const { AssetUsageLedger } = await import("../../src/asset-usage-ledger.js"), { StateStore } = await import("../../src/state.js");
  const { executeCleanup86, executeFreshCleanup86 } = await import("../../src/circle-v2-evm/cleanup86-controller.js");
  const variants = ["positive", "expired_legacy", "proof", "proof_hash", "root", "copied_token", "nonce", "fee", "day", "expired", "policy", "daily", "perop", "carry", "no_reset", "material", "sign", "send", "history", "history_one", "history_gap", "history_high", "history_corrupt", "history_symlink", "history_directory", "no_private_dto", "no_repeat", "legacy_strict", "historical_reload", "rpc_budget", "f85_accounting_refusal", "claimed_unknown", "normal_cli", "normal_preflight_fee", "normal_preflight_native", "normal_preflight_call", "normal_preflight_receipt", "normal_preflight_rpc", "reprepare_positive", "reprepare_generation_hardlink", "reprepare_preflight_call", "reprepare_sign", "reprepare_send", "reprepare_effect", "reprepare_material", "reprepare_first_failure", "reprepare_history", "reprepare_malformed", "reprepare_symlink", "reprepare_mode", "reprepare_hardlink", "reprepare_hardlink_drift", "reprepare_global", "reprepare_unknown", "reprepare_generation", "reprepare_drift", "reprepare_full_test_material", "normal_full_test_material", "normal_postquote_code", "normal_postquote_storage", "normal_postquote_header", "normal_legacy_first_deployment", "receipt_wrong_envelope", "receipt_stale", "receipt_reused", "receipt_fabricated", "late_full_test_material", "late_positive", "late_sign", "late_send", "late_material", "late_first_failure", "late_history1", "late_extra", "late_missing_effect", "late_missing_history", "late_history_body", "late_history_signed", "late_effect_signed", "late_generation_malformed", "late_generation_mode", "late_generation_hardlink", "late_effect_hardlink", "late_history_hardlink", "late_global", "late_generation3", "late_generation2", "late_drift", "late_hardlink_drift", "late_postpurpose_drift", "late_fee_overflow", "late_preflight_fee", "late_preflight_native", "late_preflight_call", "late_preflight_receipt", "late_preflight_rpc", "late_postconsent_fee", "late_postconsent_native", "late_postconsent_call", "late_postconsent_receipt", "late_receipt_fabricated", "late_receipt_wrong_envelope", "late_receipt_stale", "late_receipt_reused"] as const;
  for (const variant of variants) await t.test(variant, async t => {
    testOwnerOracle = undefined; testSigns = 0; testCanonicalF85Witnesses = false;
    const temp = await temporaryState(); t.after(temp.cleanup); const f = await cleanup85PublicState(temp.root), transport = await cleanup85PublicTransport(); let clock = Date.parse("2026-10-09T20:00:00.000Z");
    const store = new Cleanup86Store(temp.root), { CircleNonceRetirementStore } = await import("../../src/circle-v2-evm/nonce-retirement-store.js"), parentIntent = (await new CircleNonceRetirementStore(temp.root).intent(f.parent))!;
    const recovery = (await new Cleanup85RecoveryStore(temp.root).load(f.parent, parentIntent))!;
    const frozenPath = join(temp.root, "circle-cleanup85-recovery", `${f.parent.operationId}-intent.json`), frozen = await readFile(frozenPath), parentPath = join(temp.root, "circle-v2-evm", `${f.parent.operationId}.json`), parentBytes = await readFile(parentPath);
    let approvals = 0; const renew = async (profile: string, suffix = "first") => {
      const policies = new AllowlistPolicyStore(temp.root), old = await policies.read(profile), route = circleRoute(1329, "evm-live-seller"), file = join(temp.root, `current-${profile}-${suffix}.json`);
      const policy = { schemaVersion: "apn.allowlist-policy-file.v1", overlayVersion: `current86.${old.records.length + 1}`, accounts: { evm: profile === f.parent.profile ? f.parent.sourceCustody.walletAddress : f.parent.destinationCustody.walletAddress }, effectiveAt: "2026-10-09T19:00:00.000Z", expiresAt: "2026-10-10T01:00:00.000Z", admissions: [
        { chain: "eip155:42161", kind: "token", identifier: CIRCLE_SOURCE_TOKEN, rail: "bridge", maximumPerTransferAtomic: "40100", dailyLimitAtomic: "40100", mechanism: circleMechanism(1329) },
        { chain: "eip155:42161", kind: "native", rail: "bridge", maximumPerTransferAtomic: variant === "perop" ? "14999999999999" : "30000000000000", dailyLimitAtomic: variant === "daily" ? "74999999999999" : "500000000000000", mechanism: circleMechanism(1329) },
        { chain: "eip155:1329", kind: "native", rail: "bridge", maximumPerTransferAtomic: route.destinationNativeCap, dailyLimitAtomic: route.destinationNativeCap, mechanism: circleMechanism(1329) }] };
      await writeFile(file, JSON.stringify(policy), { mode: 0o600 });
      const context = { state: f.state, clock: { now: () => new Date(clock) }, allowlistPolicyApproval: { approve: async (intent: { fingerprint: string; code: string }) => { assert.match(intent.fingerprint, /^[a-f0-9]{64}$/); assert.ok(intent.code.length > 0); approvals++; } } };
      const staged = await executeAllowlistPolicyCommand({ command: "allowlist.policy.stage", profile, file, ...(old.records.length === 0 ? {} : { expectedRevision: old.records.at(-1)!.revision }) }, context);
      const revision = (staged.data as { revision: number }).revision;
      await executeAllowlistPolicyCommand({ command: "allowlist.policy.activate", profile, revision }, context);
    };
    await renew(f.parent.profile); await renew(f.parent.destinationProfile); assert.equal(approvals, 2);
    const lineage = verifiedCleanup85NativeLineage(await resolveCleanup85NativeLineage(f.state, f.request), f.state, f.request);
    const envelopeBody = { chainId: 42161, from: f.parent.sourceCustody.walletAddress, to: recovery.recipientCustody.walletAddress, nonceAtomic: "85", valueAtomic: "1", data: "0x" as const, gasLimitAtomic: "21000", maxFeePerGasAtomic: "45000000", maxPriorityFeePerGasAtomic: "1" }, head = transport.snapshot.archiveAnchor;
    const observation = { transaction: {}, receipt: { blockNumber: head.number, blockHash: head.hash }, canonicalBlock: head, recheckedBlock: head, finalityHead: head, chainId: 42161, finalityTag: "finalized" as const };
    const proofBody = { version: "apn.circle-cleanup85-native-cancellation-proof.v1" as const, requestBinding: hashObject(f.request), operationId: lineage.operationId, fingerprint: "a".repeat(64), materialHash: "b".repeat(64), transactionHash: `0x${"c".repeat(64)}` as const, envelope: { ...envelopeBody, envelopeHash: hashObject(envelopeBody) }, sourceCustody: recovery.sourceCustody, recipientCustody: recovery.recipientCustody, observation, actualFeeAtomic: "1", nativeConsumedAtomic: "2", nativeReservationId: "d".repeat(64), nativeOutcomeDigest: "e".repeat(64) }, proof = { ...proofBody, proofHash: hashObject(proofBody) } as Cleanup85CancellationProof;
    const { envelopeHash: _old, ...old } = f.parent.effects[2]!.envelope, envelope = circleEnvelope({ ...old, nonceAtomic: variant === "nonce" ? "87" : "86", ...(variant === "fee" ? { gasLimitAtomic: "15000000000001", maxFeePerGasAtomic: "1", maxPriorityFeePerGasAtomic: "0" } : {}) });
    const https: typeof transport.https = { request: async (...args) => { const q = JSON.parse(args[2]!); if (q.method === "eth_getTransactionCount") return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: q.id, result: variant === "carry" ? "0x57" : "0x56" }) }; if (q.method === "eth_getBlockByNumber" && q.params[0] === "finalized") return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: q.id, result: head }) }; return transport.https.request(...args); } };
    const source = new CircleRpc("https://arbitrum-one-public.nodies.app", 42161, https, variant === "rpc_budget" ? 2 : 256), destination = new CircleRpc("https://evm-rpc.sei-apis.com", 1329, https);
    if (variant === "normal_cli" || variant === "normal_full_test_material" || variant === "normal_legacy_first_deployment" || variant.startsWith("normal_postquote_") || variant.startsWith("normal_preflight_") || variant.startsWith("reprepare_") || variant.startsWith("late_")) {
      let legacyBytes: Buffer | undefined, legacyHash: string | undefined;
      const late = variant.startsWith("late_"), predecessors: Record<string,{bytes:Buffer;identity:unknown}>={};
      const legacyPath = join(temp.root,"circle-cleanup85-recovery",`${f.parent.operationId}-cleanup86-intent.json`);
      if (variant.startsWith("reprepare_") || late) {
        await withCleanup85FinancialScope(f.state, f.request, lineage.operationId, async scope => {
          const certificate = await verifyCleanup86CurrentPurpose(f.state,f.parent,recovery,proof,envelope,source,destination,() => clock,scope);
          const legacy = await store.startCurrent(f.state,f.parent,recovery,envelope,certificate); legacyHash = legacy.intentHash;
        });
        legacyBytes = await readFile(legacyPath);
        const kind = variant.slice("reprepare_".length).replace("first_failure","first-failure");
        if (["sign","send","effect","material","first-failure","history"].includes(kind)) await writeFile(join(temp.root,"circle-cleanup85-recovery",`${f.parent.operationId}-cleanup86-${kind === "history" ? "history-0" : kind}.json`),"{}",{mode:0o600});
        if (kind === "malformed") await writeFile(legacyPath,"not JSON");
        if (kind === "symlink") { const { unlink } = await import("node:fs/promises"); await unlink(legacyPath); await symlink(parentPath,legacyPath); }
        if (kind === "hardlink") await link(legacyPath,join(temp.root,"external-legacy-alias.json"));
        if (kind === "mode") { const { chmod } = await import("node:fs/promises"); await chmod(legacyPath,0o644); }
        if (kind === "global") await writeFile(join(temp.root,`${f.parent.operationId}-cleanup86-sign.json`),"{}",{mode:0o600});
        if (kind === "unknown" || kind === "generation") await writeFile(join(temp.root,"circle-cleanup85-recovery",`${f.parent.operationId}-cleanup86-${kind === "unknown" ? "foreign" : "generation-2-intent"}.json`),"{}",{mode:0o600});
      }
      if(late) {
        await withCleanup85FinancialScope(f.state,f.request,lineage.operationId,async scope=>{
          const seedSource=new CircleRpc("https://arbitrum-one-public.nodies.app",42161,https),seedDestination=new CircleRpc("https://evm-rpc.sei-apis.com",1329,https);
          const {envelopeHash:_seedHash,...seedBody}=envelope; const seedEnvelope=circleEnvelope({...seedBody,gasLimitAtomic:"46789",maxFeePerGasAtomic:"40044000",maxPriorityFeePerGasAtomic:"0"});
          const certificate=await verifyCleanup86CurrentPurpose(f.state,f.parent,recovery,proof,seedEnvelope,seedSource,seedDestination,()=>clock,scope);
          const first=await store.startReprepared(f.state,f.parent,recovery,seedEnvelope,certificate,await store.unsignedOrphan(f.parent,recovery));
          await store.saveEffect(f.parent,first,null,{phase:"prepared",transactionHash:null,materialHash:null});
        });
        const prefix=join(temp.root,"circle-cleanup85-recovery",`${f.parent.operationId}-cleanup86-`);
        for(const k of ["intent","generation-1-intent","effect","history-0"]) {const path=`${prefix}${k}.json`,st=await lstat(path);predecessors[k]={bytes:await readFile(path),identity:{dev:st.dev,ino:st.ino,nlink:st.nlink}};}
        const kind=variant.slice(5), write=async(k:string,v:unknown)=>writeFile(`${prefix}${k}.json`,canonicalJson(v),{mode:0o600});
        if(["sign","send","material","first_failure"].includes(kind))await write(kind.replace("_","-"),{});
        if(kind==="history1"||kind==="extra")await write(kind==="history1"?"history-1":"unknown",{});
        if(kind==="missing_effect"||kind==="missing_history")await unlink(`${prefix}${kind==="missing_effect"?"effect":"history-0"}.json`);
        if(kind==="history_body"||kind==="history_signed"||kind==="effect_signed"){
          const key=kind==="effect_signed"?"effect":"history-0",old=JSON.parse(predecessors[key]!.bytes.toString()),{effectHash:_h,...body}=old;
          const changed={...body,...(kind==="history_body"?{sequence:1}:{phase:"signing_started"})};await write(key,{...changed,effectHash:hashObject(changed)});
        }
        if(kind==="generation_malformed")await writeFile(`${prefix}generation-1-intent.json`,"not JSON");
        if(kind==="generation_mode") {const {chmod}=await import("node:fs/promises");await chmod(`${prefix}generation-1-intent.json`,0o644);}
        if(["generation_hardlink","effect_hardlink","history_hardlink"].includes(kind))await link(`${prefix}${kind==="generation_hardlink"?"generation-1-intent":kind==="effect_hardlink"?"effect":"history-0"}.json`,join(temp.root,"external-late-alias.json"));
        if(kind==="global")await writeFile(join(temp.root,`${f.parent.operationId}-cleanup86-send.json`),"{}",{mode:0o600});
        if(kind==="generation3"||kind==="generation2")await write(`generation-${kind==="generation3"?3:2}-intent`,{});
        if(kind.startsWith("receipt_")) {
          const lateStore=new Cleanup86Store(temp.root);
          await withCleanup85FinancialScope(f.state,f.request,lineage.operationId,async scope=>{
            const {envelopeHash:_freshHash,...freshBody}=envelope; const src=new CircleRpc("https://arbitrum-one-public.nodies.app",42161,https),dst=new CircleRpc("https://evm-rpc.sei-apis.com",1329,https),fresh=circleEnvelope({...freshBody,maxFeePerGasAtomic:"80088000",maxPriorityFeePerGasAtomic:"0"});
            const certificate=await verifyCleanup86CurrentPurpose(f.state,f.parent,recovery,proof,fresh,src,dst,()=>clock,scope),current={state:f.state,recovery,certificate};let prompts=0,keys=0;
            const ports={now:()=>clock,preflight:async()=>{},confirm:async()=>{prompts++;throw Error("TEST_stop_prompt");},seal:async()=>{keys++;throw Error("forbidden");},send:async()=>{throw Error("forbidden");}};
            const publish=async()=>{const i=await lateStore.startLateReprepared(f.state,f.parent,recovery,fresh,certificate,await lateStore.unsignedPrepared(f.parent,recovery));if(kind==="receipt_stale")clock+=60000;return kind==="receipt_wrong_envelope"?{...i,envelope:circleEnvelope({...fresh,maxFeePerGasAtomic:"1"})}:i;};
            if(kind==="receipt_fabricated"){const i=await publish();await assert.rejects(executeCleanup86(temp.root,f.parent,i,lateStore,ports,{...current,initialPreflight:{kind:"fake"}} as typeof current),/initial_preflight_required/);}
            else {await assert.rejects(executeFreshCleanup86(temp.root,f.parent,fresh,lateStore,ports,current,async()=>{},publish),kind==="receipt_stale"?/initial_preflight_required/:kind==="receipt_wrong_envelope"?/preflight_frame_changed/:/TEST_stop_prompt/);if(kind==="receipt_reused")await assert.rejects(executeCleanup86(temp.root,f.parent,(await lateStore.intent(f.parent,recovery))!,lateStore,ports,current),/certificate_used/);}
            assert.equal(keys,0);assert.equal(prompts,kind==="receipt_reused"?1:0);
          });return;
        }
      }
      const { CircleEvmService } = await import("../../src/circle-v2-evm/runtime.js"), { approvalCode } = await import("../../src/approval-code.js");
      if (variant === "normal_legacy_first_deployment") {
        const {Cleanup85RecoveryRuntime} = await import("../../src/circle-v2-evm/cleanup85-recovery-runtime.js");
        // Read-only TEST historical financial oracle: permits reaching the legacy first pin read.
        // The deliberately corrupt deployment refuses before quote, TTY or any private effect.
        t.mock.method(Cleanup85RecoveryRuntime.prototype as unknown as {financialGuard:()=>Promise<void>},"financialGuard",async()=>{});
        await store.start(f.parent,recovery,{cancellationProofHash:proof.proofHash,envelope,policies:recovery.policies,capturedAt:recovery.capturedAt,windowEndsAt:recovery.windowEndsAt});
      }
      const readStore=late?new Cleanup86Store(temp.root):store;
      const fullTestMaterial = variant.endsWith("full_test_material");
      if (fullTestMaterial) { testOwnerOracle = f.parent.sourceCustody.walletAddress; testCanonicalF85Witnesses = true; }
      let keys = 0, terminals = 0, closed = 0, testSends = 0, wrappingLoads = 0; const entered = performance.now(), clockNow = () => clock + Math.floor(performance.now() - entered); t.mock.method(Date, "now", clockNow);
      const { EncryptedWalletStore } = await import("../../src/encrypted-wallet-store.js");
      t.mock.method(EncryptedWalletStore.prototype, "describe", async (profile: string, beforeDecrypt?: () => void, beforeKeyLoad?: (identity: { profile: string; address: typeof f.parent.sourceCustody.walletAddress; bindingHash: string; createdAt: string }) => Promise<void>) => { assert.equal(profile, f.parent.profile); await beforeKeyLoad?.({ profile, address: f.parent.sourceCustody.walletAddress, bindingHash: f.parent.sourceCustody.walletBindingHash, createdAt: f.parent.sourceCustody.walletCreatedAt }); beforeDecrypt?.(); keys++; if (fullTestMaterial) return {secret:{privateKey:testKey,directEffects:{},x402Effects:{}}} as never; throw Error("TEST_private_broker_refusal"); });
      const terminal = { isTerminal: () => true, openTerminal: async () => { terminals++; return { fd: 123, write: async () => {}, read: async function* () { const saved = (await readStore.intent(f.parent, recovery))!; if(variant === "late_postpurpose_drift") await writeFile(join(temp.root,"circle-cleanup85-recovery",`${f.parent.operationId}-cleanup86-effect.json`),predecessors.effect!.bytes); yield Buffer.from(approvalCode("bridge", f.parent.operationId, saved.intentHash) + "\n"); }, close: async () => { closed++; } }; } };
      const runtimeRequestCounts: Record<string,number> = {};
      let guardDepth = 0, preflightInvocation = 0;
      if (fullTestMaterial) {
        const originalGuarded = CircleRpc.prototype.guarded;
        t.mock.method(CircleRpc.prototype,"guarded",function<T>(this: InstanceType<typeof CircleRpc>,guard:()=>void,action:()=>Promise<T>):Promise<T> {
          const first = guardDepth++ === 0; if (first) preflightInvocation++;
          return originalGuarded.call(this,guard,action).finally(()=>{guardDepth--;}) as Promise<T>;
        });
      }
      t.after(() => { if (fullTestMaterial) t.diagnostic(JSON.stringify({TEST_ONLY:true,runtimeRequestCounts,testSigns,testSends,wrappingLoads})); });
      let oldReceiptReads = 0, injected = false, approveCallCompleted = false, quoteCompleted = false;
      const runtimeTransport: typeof https = { request: async (...args) => {
        const q = JSON.parse(args[2]!);
        const requestPhase = guardDepth > 0 ? `preflight_${preflightInvocation}` : terminals === 0 ? "before_prompt" : wrappingLoads === 0 ? "after_prompt_before_seal" : "after_seal"; const requestKey = `${args[0]}:${requestPhase}`; runtimeRequestCounts[requestKey] = (runtimeRequestCounts[requestKey] ?? 0) + 1;
        if (variant === "normal_legacy_first_deployment" && q.method === "eth_getCode") { assert.equal(quoteCompleted,false); return {status:200,body:JSON.stringify({jsonrpc:"2.0",id:q.id,result:"0x00"})}; }
        if (q.method === "eth_estimateGas") {quoteCompleted = true;if(variant === "late_fee_overflow")return {status:200,body:JSON.stringify({jsonrpc:"2.0",id:q.id,result:"0x30d40"})};}
        if (quoteCompleted && variant === "normal_postquote_code" && q.method === "eth_getCode") return {status:200,body:JSON.stringify({jsonrpc:"2.0",id:q.id,result:"0x00"})};
        if (quoteCompleted && variant === "normal_postquote_storage" && q.method === "eth_getStorageAt") return {status:200,body:JSON.stringify({jsonrpc:"2.0",id:q.id,result:"0x"+"0".repeat(64)})};
        if (quoteCompleted && variant === "normal_postquote_header" && q.method === "eth_getBlockByNumber") return {status:200,body:JSON.stringify({jsonrpc:"2.0",id:q.id,result:{...head,hash:"0x"+"0".repeat(64)}})};
        if (testCanonicalF85Witnesses && ["eth_getTransactionByHash","eth_getTransactionReceipt"].includes(q.method) && q.params[0] === proof.transactionHash) return {status:200,body:JSON.stringify({jsonrpc:"2.0",id:q.id,result:q.method === "eth_getTransactionByHash" ? proof.observation.transaction : proof.observation.receipt})};
        if (q.method === "eth_sendRawTransaction") { assert.equal(fullTestMaterial,true); testSends++; const {keccak256,parseTransaction,recoverTransactionAddress} = await import("viem"); const raw = q.params[0]; const tx = parseTransaction(raw); assert.equal(tx.chainId,42161); assert.equal(tx.nonce,86); assert.equal(tx.to?.toLowerCase(),envelope.to.toLowerCase()); assert.equal(tx.data,envelope.data); assert.equal(tx.value ?? 0n,0n); assert.equal(await recoverTransactionAddress({serializedTransaction:raw}),realAccounts.privateKeyToAccount(testKey).address); return {status:200,body:JSON.stringify({jsonrpc:"2.0",id:q.id,result:keccak256(raw)})}; }
        if (fullTestMaterial && q.method === "eth_getTransactionReceipt" && !["0x24cb1b6244a30ca2a829b4f561c907565d49aad806735137e3160ae0f7f03b95"].includes(q.params[0])) { const saved = await readStore.intent(f.parent,recovery); const metadata = saved === null ? null : await new (await import("../../src/circle-v2-evm/cleanup86-custody.js")).Cleanup86Custody(f.state,{load:async()=>null,create:async()=>Buffer.alloc(32)}).publicMetadata(f.parent,saved); if (metadata?.transactionHash === q.params[0]) return {status:200,body:JSON.stringify({jsonrpc:"2.0",id:q.id,result:null})}; }
        if (q.method === "eth_getBlockByNumber" && args[0] === "https://arb1.arbitrum.io/rpc" && (variant === "normal_preflight_fee" || variant === "late_preflight_fee" || variant === "late_postconsent_fee" && terminals>0)) return { status: 200, body: JSON.stringify({jsonrpc:"2.0",id:q.id,result:{...head,baseFeePerGas:"0xffffffffffff"}}) };
        if (q.method === "eth_getBalance" && q.params[1] === "pending" && (variant === "normal_preflight_native" || variant === "late_preflight_native" || variant === "late_postconsent_native" && terminals>0)) return { status:200,body:JSON.stringify({jsonrpc:"2.0",id:q.id,result:"0x0"}) };
        if (q.method === "eth_getTransactionReceipt" && q.params[0] === "0x24cb1b6244a30ca2a829b4f561c907565d49aad806735137e3160ae0f7f03b95") { oldReceiptReads++; const exactGuardReceipt=approveCallCompleted; approveCallCompleted=false; if ((variant === "normal_preflight_receipt" || variant === "late_preflight_receipt" || variant === "late_postconsent_receipt" && terminals>0) && exactGuardReceipt) return {status:200,body:JSON.stringify({jsonrpc:"2.0",id:q.id,result:{}})}; }
        if (q.method === "eth_call" && String(q.params[0].data).startsWith("0x095ea7b3")) {
          if ((variant === "normal_preflight_rpc" || variant === "late_preflight_rpc")) return {status:503,body:"TEST initial RPC refusal"};
          if (variant === "reprepare_hardlink_drift" && !injected) { injected = true; await link(legacyPath,join(temp.root,"external-inflight-alias.json")); }
          if (variant === "late_drift" && !injected) {injected=true;await writeFile(join(temp.root,"circle-cleanup85-recovery",`${f.parent.operationId}-cleanup86-effect.json`),predecessors.effect!.bytes);}
          if (variant === "late_hardlink_drift" && !injected){injected=true;await link(join(temp.root,"circle-cleanup85-recovery",`${f.parent.operationId}-cleanup86-effect.json`),join(temp.root,"late-inflight-alias.json"));}
          if (variant === "reprepare_drift" && !injected) { injected = true; await writeFile(join(temp.root,"circle-cleanup85-recovery",`${f.parent.operationId}-cleanup86-history-9.json`),"{}",{mode:0o600}); }
          approveCallCompleted = true;
          return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: q.id, result: "0x" + "0".repeat(63) + ((["normal_preflight_call","reprepare_preflight_call","late_preflight_call"].includes(variant) || variant === "late_postconsent_call" && terminals>0) ? "0" : "1") }) };
        }
        return https.request(...args);
      } };
      const service = new CircleEvmService(f.state, { load: async () => { if (fullTestMaterial) { wrappingLoads++; return Buffer.alloc(32,7); } keys++; throw Error("TEST_private_broker_refusal"); }, create: async () => { throw Error("forbidden"); } }, { APN_ARBITRUM_RPC_URL: "https://arbitrum-one-public.nodies.app", APN_SEI_RPC_URL: "https://evm-rpc.sei-apis.com" }, clockNow, terminal, runtimeTransport, { cancellation: { inspect: async () => ({ operationId: proof.operationId, phase: "finalized", transactionHash: proof.transactionHash, proof }), execute: async () => { throw Error("no native cancellation dispatch"); } }, verifyCancellationAccounting: async () => { accountingCalls++; } });
      const positive = ["normal_cli","reprepare_positive","reprepare_generation_hardlink","reprepare_full_test_material","normal_full_test_material","late_positive","late_full_test_material"].includes(variant);
      if (fullTestMaterial) await service.approveCleanup86(f.parent.operationId);
      else await assert.rejects(service.approveCleanup86(f.parent.operationId), (error: unknown)=>{
        const expected:Record<string,string>={fee:"fee",native:"pendingNative",call:"approveCall",receipt:"oldReceipt"},suffix=variant.split("_").at(-1)!;
        if(expected[suffix] && (variant.startsWith("normal_preflight_") || variant.startsWith("late_preflight_") || variant.startsWith("late_postconsent_") || variant==="reprepare_preflight_call")) {assert.equal((error as {code:string}).code,"APN_OPERATION_BLOCKED");assert.equal((error as {details:{failurePredicate:string}}).details.failurePredicate,expected[suffix]);}
        return (positive ? /TEST_private_broker_refusal/ : ["normal_preflight_fee","normal_preflight_native","normal_preflight_call","normal_preflight_receipt","reprepare_preflight_call"].includes(variant) ? /cleanup86_fresh_network_guard/ : /./).test(String(error)); });
      if(late && !positive) {
        assert.equal(keys,0);assert.equal(testSigns,0);assert.equal(testSends,0);
        const post=variant.startsWith("late_postconsent_")||variant==="late_postpurpose_drift";
        assert.deepEqual([terminals,closed],post?[1,1]:[0,0]);
        const {access}=await import("node:fs/promises"),g2=join(temp.root,"circle-cleanup85-recovery",`${f.parent.operationId}-cleanup86-generation-2-intent.json`);
        if(!post && variant!=="late_generation2")await assert.rejects(access(g2));
        if(variant.startsWith("late_postconsent_")){const selected=(await readStore.intent(f.parent,recovery))!;assert.equal(selected.version,"apn.circle-cleanup86-intent.v5");assert.equal((await readStore.effect(f.parent,selected))!.phase,"prepared");await assert.rejects(service.approveCleanup86(f.parent.operationId),/existing_observe_only/);}
        for(const kind of ["sign","send","material","first-failure"]) if(!["late_sign","late_send","late_material","late_first_failure"].includes(variant))await assert.rejects(access(join(temp.root,"circle-cleanup85-recovery",`${f.parent.operationId}-cleanup86-${kind}.json`)));
        if(variant.includes("preflight")||variant.includes("postconsent")||variant==="late_fee_overflow")for(const [k,v]of Object.entries(predecessors))assert.deepEqual(await readFile(join(temp.root,"circle-cleanup85-recovery",`${f.parent.operationId}-cleanup86-${k}.json`)),v.bytes);
        return;
      }
      if (!positive) {
        assert.deepEqual([keys,terminals,closed],[0,0,0]);
        if (variant.startsWith("normal_postquote_")) assert.equal(quoteCompleted,true);
        const { access } = await import("node:fs/promises");
        await assert.rejects(access(join(temp.root,"circle-cleanup85-recovery",`${f.parent.operationId}-cleanup86-generation-1-intent.json`)));
        if (legacyBytes === undefined && variant !== "normal_legacy_first_deployment") assert.equal(await readStore.intent(f.parent,recovery),null);
        if (variant === "normal_legacy_first_deployment") { const retained = (await readStore.intent(f.parent,recovery))!; assert.equal(retained.version,"apn.circle-cleanup86-intent.v1"); assert.equal(await readStore.effect(f.parent,retained),null); assert.equal(quoteCompleted,false); }
        else if (legacyBytes !== undefined && !["reprepare_malformed","reprepare_symlink","reprepare_mode"].includes(variant)) assert.deepEqual(await readFile(legacyPath),legacyBytes);
        assert.deepEqual(await readFile(frozenPath),frozen); assert.deepEqual(await readFile(parentPath),parentBytes); return;
      }
      const intent = (await readStore.intent(f.parent, recovery))!; assert.equal(intent.version, late ? "apn.circle-cleanup86-intent.v5" : variant.startsWith("reprepare_") ? "apn.circle-cleanup86-intent.v4" : "apn.circle-cleanup86-intent.v3"); if (legacyBytes !== undefined) { assert.deepEqual(await readFile(legacyPath),legacyBytes); assert.equal(intent.unsignedPredecessor!.intentHash,legacyHash); } assert.equal((await readStore.effect(f.parent, intent))!.phase, "unknown"); assert.equal(await readStore.claimed(f.parent, intent, "sign"), true); assert.deepEqual([keys, terminals, closed], [1, 1, 1]);
      if (fullTestMaterial) {
        assert.equal(intent.envelope.maxFeePerGasAtomic,(BigInt(head.baseFeePerGas) * (late?4n:2n)).toString());
        assert.equal(intent.envelope.maxPriorityFeePerGasAtomic,"0");
        assert.equal(intent.currentPurpose!.envelopeHash,intent.envelope.envelopeHash);
        assert.equal(intent.currentPurpose!.cleanupReservationId,f.parent.usage[3]!.reservationId);
        assert.equal(intent.currentPurpose!.maximumFeeAtomic,"15000000000000");
        if (legacyBytes !== undefined) { const previous = JSON.parse(legacyBytes.toString("utf8")); assert.notEqual(intent.envelope.envelopeHash,previous.envelope.envelopeHash); assert.equal(intent.currentPurpose!.cleanupReservationHash,previous.currentPurpose.cleanupReservationHash); }
        const count = (role:string) => Object.entries(runtimeRequestCounts).filter(([key])=>key.startsWith(role)).reduce((n,[,value])=>n+value,0);
        assert.equal(count("https://arbitrum-one-public.nodies.app/"),254); assert.equal(count("https://evm-rpc.sei-apis.com/"),104); assert.equal(count("https://arb1.arbitrum.io/rpc"),7);
        t.diagnostic(JSON.stringify({TEST_COMMAND_COUNTS:true,variant,runtimeRequestCounts:{...runtimeRequestCounts},preflightInvocation,testSigns,testSends,wrappingLoads}));
        assert.equal(preflightInvocation,3); assert.equal(await readStore.claimed(f.parent,intent,"send"),true); assert.deepEqual([testSigns,testSends,wrappingLoads],[1,1,1]); }
      if (variant === "reprepare_generation_hardlink") { await link(join(temp.root,"circle-cleanup85-recovery",`${f.parent.operationId}-cleanup86-generation-1-intent.json`),join(temp.root,"external-generation-alias.json")); await assert.rejects(readStore.intent(f.parent,recovery),/exactly one link|hardlink alias/); await assert.rejects(service.approveCleanup86(f.parent.operationId)); assert.deepEqual([keys,terminals],[1,1]); return; }
      if(late)for(const [k,v]of Object.entries(predecessors)){const path=join(temp.root,"circle-cleanup85-recovery",`${f.parent.operationId}-cleanup86-${k}.json`),st=await lstat(path);assert.deepEqual(await readFile(path),v.bytes);assert.deepEqual({dev:st.dev,ino:st.ino,nlink:st.nlink},v.identity);}
      const publicStatus = await service.status(f.parent.operationId); assert.equal(publicStatus.cleanup85_recovery!.cleanup86!.intentHash,intent.intentHash);
      const observed = await service.observe(f.parent.operationId); assert.equal(observed.integrityHash,f.parent.integrityHash); assert.equal(keys,1);
      await assert.rejects(service.approveCleanup86(f.parent.operationId), /existing_observe_only/); assert.equal(keys, 1); assert.equal(terminals, 1); if(fullTestMaterial) assert.deepEqual([testSigns,testSends,wrappingLoads],[1,1,1]);
      assert.deepEqual(await readFile(frozenPath), frozen); assert.deepEqual(await readFile(parentPath), parentBytes); t.diagnostic(fullTestMaterial ? "Explicit TEST owner-identity oracle: valid unrelated TEST-key serialization, production seal/encryption/hash validation, exactly one TEST SEND, selected-generation pending observer; no authentic owner wire/finality proof" : `normal86 bounded TEST public requests=${transport.rows.length}; no signing/send; genuine TEST terminal consumed once`); return;
    }
    let token: VerifiedCleanup86CurrentPurpose | undefined, historicalIntentHash: string | undefined;
    await withCleanup85FinancialScope(f.state, f.request, lineage.operationId, async scope => {
      if (variant === "expired_legacy") { assert.throws(() => assertCleanup85Window(recovery, clock), /window_expired/); return; }
      if (variant === "proof") Object.assign(proof, { requestBinding: "f".repeat(64) });
      if (variant === "proof_hash") Object.assign(proof, { proofHash: "f".repeat(64) });
      accountingRefuse = variant === "f85_accounting_refusal";
      const mint = () => verifyCleanup86CurrentPurpose(f.state, f.parent, recovery, proof, envelope, source, destination, () => clock, scope);
      if (["proof", "proof_hash", "nonce", "fee", "daily", "perop", "carry", "rpc_budget", "f85_accounting_refusal"].includes(variant)) { await assert.rejects(mint()); accountingRefuse = false; return; }
      token = await mint(); const purpose = verifiedCleanup86CurrentPurpose(token, f.state, f.parent, recovery, envelope);
      assert.equal(purpose.maximumFeeAtomic, "15000000000000"); assert.notDeepEqual(purpose.policies, recovery.policies); assert.equal(purpose.recoveryBinding, recovery.recoveryBinding);
      assert.throws(() => verifiedCleanup86CurrentPurpose({ ...token! }, f.state, f.parent, recovery, envelope), /private_current/);
      if (variant === "root") { assert.throws(() => verifiedCleanup86CurrentPurpose(token!, new StateStore(temp.root), f.parent, recovery, envelope), /private_current/); return; }
      if (variant === "copied_token") return;
      if (variant === "day") clock = Date.parse("2026-10-10T00:00:00.000Z");
      if (variant === "expired") clock = Date.parse(purpose.windowEndsAt!);
      if (variant === "day" || variant === "expired") { await assert.rejects(store.startCurrent(f.state, f.parent, recovery, envelope, token)); return; }
      if (variant === "policy") { const originalRead = AllowlistPolicyStore.prototype.readUnderProfileLock; t.mock.method(AllowlistPolicyStore.prototype, "readUnderProfileLock", async function(this: InstanceType<typeof AllowlistPolicyStore>, profile: string) { const value = await originalRead.call(this, profile); return profile === f.parent.profile ? { ...value, entries: [] } : value; }); await assert.rejects(assertCleanup86CurrentPermission(token, f.state, f.parent, recovery, envelope), /active_owner_asset_policy_required/); return; }
      if (["material", "sign", "send", "history"].includes(variant)) { await writeFile(join(temp.root, "circle-cleanup85-recovery", `${f.parent.operationId}-cleanup86-${variant === "history" ? "history-0" : variant}.json`), "{}", { mode: 0o600 }); await assert.rejects(store.startCurrent(f.state, f.parent, recovery, envelope, token), /existing_observe_only/); return; }
      if (variant.startsWith("history_")) {
        const suffix = variant === "history_one" ? "1.json" : variant === "history_gap" ? "7.json" : variant === "history_high" ? "999999999999999999999999.json" : variant === "history_corrupt" ? "broken.json" : "2.json";
        const marker = join(temp.root, "circle-cleanup85-recovery", `${f.parent.operationId}-cleanup86-history-${suffix}`);
        if (variant === "history_symlink") await symlink(parentPath, marker);
        else if (variant === "history_directory") await mkdir(marker, { mode: 0o700 });
        else await writeFile(marker, variant === "history_corrupt" ? "not JSON" : "{}", { mode: 0o600 });
        await assert.rejects(store.startCurrent(f.state, f.parent, recovery, envelope, token), /existing_observe_only/);
        assert.equal(await store.intent(f.parent, recovery), null); return;
      }
      if (variant.startsWith("receipt_")) {
        let prompts = 0, privateCalls = 0, preflightCalls = 0;
        const ports = { now: () => clock, preflight: async () => { preflightCalls++; }, confirm: async () => { prompts++; throw Error("TEST_stop_prompt"); }, seal: async () => { privateCalls++; throw Error("forbidden"); }, send: async () => { throw Error("forbidden"); } };
        const current = {state:f.state,recovery,certificate:token};
        if (variant === "receipt_fabricated") {
          const i = await store.startCurrent(f.state,f.parent,recovery,envelope,token);
          await assert.rejects(executeCleanup86(temp.root,f.parent,i,store,ports,{...current, initialPreflight:{kind:"verified-cleanup86-initial-preflight"}} as typeof current),/initial_preflight_required/);
          assert.equal(preflightCalls,0); assert.equal(prompts,0);
        } else {
          const publish = async () => {
            const i = await store.startCurrent(f.state,f.parent,recovery,envelope,token!);
            if (variant === "receipt_stale") clock += 60_000;
            if (variant === "receipt_wrong_envelope") return {...i,envelope:circleEnvelope({...envelope,maxFeePerGasAtomic:"1",maxPriorityFeePerGasAtomic:"0"})};
            return i;
          };
          await assert.rejects(executeFreshCleanup86(temp.root,f.parent,envelope,store,ports,current,async () => {preflightCalls++;},publish),variant === "receipt_stale" ? /initial_preflight_required/ : variant === "receipt_wrong_envelope" ? /preflight_frame_changed/ : /TEST_stop_prompt/);
          if (variant === "receipt_reused") { const i = (await store.intent(f.parent,recovery))!; await assert.rejects(executeCleanup86(temp.root,f.parent,i,store,ports,current),/certificate_used/); }
          assert.equal(prompts,variant === "receipt_reused" ? 1 : 0);
        }
        assert.equal(privateCalls,0); return;
      }
      const intent = await store.startCurrent(f.state, f.parent, recovery, envelope, token); assert.equal(intent.version, "apn.circle-cleanup86-intent.v3"); assert.equal((await store.intent(f.parent, recovery))!.intentHash, intent.intentHash);
      if (variant === "legacy_strict") { const { currentPurpose: _purpose, intentHash: _hash, ...body } = intent; assert.throws(() => validateCleanup86Intent({ ...body, version: "apn.circle-cleanup86-intent.v1", intentHash: hashObject({ ...body, version: "apn.circle-cleanup86-intent.v1" }) }, recovery), /intent_binding/); return; }
      if (variant === "historical_reload") { historicalIntentHash = intent.intentHash; return; }
      let prompts = 0, privateCalls = 0; const ports = { now: () => clock, preflight: async () => { await assertCleanup86CurrentPermission(token!, f.state, f.parent, recovery, envelope); }, confirm: async () => { prompts++; if (variant === "claimed_unknown") return; if (variant === "no_reset") { clock += 60_000; return; } throw Error("TEST_stops_at_genuine_owner_foreground_grant_before_private"); }, seal: async () => { privateCalls++; throw Error("forbidden"); }, send: async () => { throw Error("forbidden"); } };
      if (variant === "no_private_dto") { await assert.rejects(executeCleanup86(temp.root, f.parent, intent, store, ports), /private_current/); assert.equal(prompts, 0); return; }
      await assert.rejects(executeCleanup86(temp.root, f.parent, intent, store, ports, { state: f.state, recovery, certificate: token }), variant === "claimed_unknown" ? /forbidden/ : variant === "no_reset" ? /foreground_authority/ : /TEST_stops/); assert.equal(prompts, 1); assert.equal(privateCalls, variant === "claimed_unknown" ? 1 : 0);
      if (variant === "claimed_unknown") { assert.equal((await store.effect(f.parent, intent))!.phase, "unknown"); assert.equal(await store.claimed(f.parent, intent, "sign"), true); }
      await assert.rejects(executeCleanup86(temp.root, f.parent, intent, store, ports, { state: f.state, recovery, certificate: token }), /certificate_used|purpose_expired/); assert.equal(prompts, 1);
      await assert.rejects(store.startCurrent(f.state, f.parent, recovery, envelope, token), /existing_observe_only|purpose_expired/);
    });
    if (historicalIntentHash !== undefined) { await renew(f.parent.profile, "later"); clock += 86_400_000; assert.equal((await store.intent(f.parent, recovery))!.intentHash, historicalIntentHash); }
    if (token !== undefined) assert.throws(() => verifiedCleanup86CurrentPurpose(token!, f.state, f.parent, recovery, envelope), /held_financial_scope/);
    assert.deepEqual(await readFile(frozenPath), frozen); assert.deepEqual(await readFile(parentPath), parentBytes);
    for (const row of f.parent.usage) assert.deepEqual(await new AssetUsageLedger(temp.root).load(row, row.reservationId), row);
    assert.ok(transport.rows.every(x => x.method !== "eth_sendRawTransaction"));
  });
  assert.ok(accountingCalls > 0);
});
