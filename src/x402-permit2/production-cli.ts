import { randomUUID } from "node:crypto";
import { canonicalJson } from "../canonical.js";
import type { BoundCommand } from "../command-binder.js";
import type { OutputEnvelope } from "../commands.js";
import { ApnError } from "../errors.js";
import { LocalWalletNative } from "../local-wallet-native.js";
import { MacOSLoginKeychainSecret } from "../macos-keychain.js";
import { successEnvelope, failureEnvelope } from "../output.js";
import { HttpsBaseRpc } from "../rpc.js";
import type { RuntimeFactoryOptions } from "../runtime-factory-options.js";
import { StateStore } from "../state.js";
import { canonicalIdempotencyKey } from "../transfer-policy.js";
import { canonicalProfile } from "../wallet-policy.js";
import { HttpsX402Http } from "../x402-http.js";
import { normalizeX402HttpRequest } from "../x402-http-request.js";
import { inspectCheckedPermit2Challenge } from "./checked-inspection.js";
import { inspectPermit2Offer } from "./inspection.js";
import { permit2WalletBinding } from "./owner-binding.js";
import { permit2PublicRpc } from "./preflight.js";
import { Permit2ApprovalRiskCoordinator } from "./production-approval-risk.js";
import { Permit2ProductionJournal } from "./production-journal.js";
import { Permit2ProductionPreparation } from "./production-prepare.js";
import { Permit2ProductionRepository, permit2ProductionId, publicPermit2Production } from "./production-repository.js";
import { Permit2ProductionResults, type Permit2ProductionResult } from "./production-results.js";

/** CLI-only same-process wiring. Generic Core and MCP cannot reach this paid path. */
export async function executePermit2ProductionCli(bound: BoundCommand, options: RuntimeFactoryOptions, root: string): Promise<OutputEnvelope> {
  const request = bound.request, requestId = randomUUID();
  let operationId: string | undefined;
  const output = (data: Permit2ProductionResult) => successEnvelope(request, requestId,
    { proofClass: "permit2_production_status", data, operation: null, receipt: null, nextActions: [] });
  try {
    if (request.command !== "x402.permit2.approve" && request.command !== "x402.permit2.observe") throw new ApnError("APN_UNSUPPORTED_COMMAND", "Permit2 production command is CLI-only.");
    if (bound.rpcUrl === undefined) throw new ApnError("APN_RPC_CONFIG", "Avalanche RPC URL is required.");
    const state = new StateStore(root), records = new Permit2ProductionRepository(root), clock = () => options.clock?.now() ?? new Date();
    if (request.command === "x402.permit2.observe") {
      const record = await records.findOperation(request.operationId);
      if (request.profile !== undefined && record !== null && canonicalProfile(request.profile) !== record.material.wallet.profile) throw new ApnError("APN_OPERATION_BLOCKED", "Permit2 operation profile does not match.");
      const preparation = new Permit2ProductionPreparation(root, { rpc: permit2PublicRpc(bound.rpcUrl, root), now: clock });
      return output(await new Permit2ProductionResults(state, new Permit2ProductionJournal(root, preparation, clock))
        .observe(request.operationId, bound.rpcUrl, request.expiredUnused ? "expired_unused" : "settlement", request.transaction));
    }
    const profile = canonicalProfile(request.profile), key = canonicalIdempotencyKey(request.idempotencyKey);
    const exact = normalizeX402HttpRequest({ schemaVersion: "apn.http-request.v1", url: request.url, method: "GET", headers: {}, bodyBase64: null });
    const id = permit2ProductionId(profile, key), saved = await records.findOperation(id); operationId = id;
    if (saved !== null) {
      if (canonicalJson(saved.material.checked.request) !== canonicalJson(exact)) throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "Permit2 key names a different frozen request.");
      if (saved.exposureAt !== null || saved.exposureJournal !== undefined || saved.terminal || !["prepared", "reserving", "reserved"].includes(saved.state)) return output({ status: publicPermit2Production(saved), code: saved.terminal ? "terminal" : "held" });
    }
    // These constructors are inert. Branded local capability and metadata are checked before unsigned HTTP.
    const native = options.native ?? new LocalWalletNative(state, options.wrappingSecret ?? new MacOSLoginKeychainSecret(), options.approval);
    LocalWalletNative.resolvePermit2LocalCapability(native, root);
    const wallet = await permit2WalletBinding(state, profile);
    new HttpsBaseRpc(bound.rpcUrl);
    const preparation = new Permit2ProductionPreparation(root, { rpc: permit2PublicRpc(bound.rpcUrl, root), now: clock });
    if (saved === null) {
      const checked = await inspectCheckedPermit2Challenge(options.http ?? new HttpsX402Http(), exact, wallet.account);
      const selected = inspectPermit2Offer({ accepts: checked.challenge.accepts, payer: wallet.account });
      await preparation.prepare({ profile, idempotencyKey: key, checked,
        expected: { index: selected.index, requirement: selected.requirement, challengeHash: checked.challengeHash } });
    }
    return output(await new Permit2ApprovalRiskCoordinator(root, bound.rpcUrl, native, preparation, clock).signAndSubmitOnce(id));
  } catch (error) {
    if (operationId !== undefined && !(error instanceof ApnError && error.code === "APN_IDEMPOTENCY_CONFLICT")) {
      try {
        const saved = await new Permit2ProductionRepository(root).findOperation(operationId);
        if (saved !== null) return output({ status: publicPermit2Production(saved), code: "held" });
      } catch { /* No error payload or inferred terminal verdict. */ }
    }
    // No private request, network error details, signed material or response bytes are projected.
    return failureEnvelope(request.command, requestId, new ApnError(error instanceof ApnError ? error.code : "APN_INTERNAL", "Permit2 CLI request could not proceed."));
  }
}
