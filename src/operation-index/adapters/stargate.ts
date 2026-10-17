import { FileStargateNativeJournal } from "../../stargate-v2/native-journal.js";
import type { StargateNativeOperation } from "../../stargate-v2/native-execution.js";
import { FileStargateTokenJournal } from "../../stargate-v2/token-journal.js";
import type { StargateTokenOperation } from "../../stargate-v2/token-model.js";
import { ApnError } from "../../errors.js";
import { legacyStargateTerminal } from "../../legacy/stargate-v2/closure.js";
import { isLegacyStargateRecord, loadLegacyStargateRecord, type LegacyStargateFamily, type LegacyStargateRecord } from "../../legacy/stargate-v2/reader.js";
import { field, readableClaims, requiredRecordPath, salvageEvm, type OperationFamilyAdapter, type OperationStore } from "../adapter.js";
import { operationOutcome, receiptOutcome } from "../../core-outcome.js";
import type { RuntimeContext } from "../../runtime.js";
import { evmClaim, namedProfileHash, pastUnstartedDeadline, salvageNamedRecord } from "./family-claims.js";
import { assertResumeOptions, oneObservationOnly } from "../../operation-command-options.js";
import { installed, OPERATION_RESUME, OPERATION_STATUS } from "./family-commands.js";

/** Native ETH from Ethereum (chain 1) and token USDC from Optimism (chain 10); the record's own envelope names the chain. */
export const STARGATE_NATIVE_SOURCE_CHAIN = 1, STARGATE_TOKEN_SOURCE_CHAIN_ID = 10;

interface StargateRecord { readonly schemaVersion: string; readonly operationId: string; readonly profile: string; readonly owner: string; readonly phase: string; readonly expiresAt: string }
/** The Stargate runtime's own status, observe (never signs or resends) and receipt. */
interface StargateService { status(id: string): Promise<unknown>; observe(id: string): Promise<unknown>; receipt(id: string): Promise<unknown> }

/**
 * The live journal's reader, widened by the frozen read-only reader of the schemas only unreleased builds wrote (native v1,
 * token v1..v4): such a record is read, claims its signing account like any other, and is terminal by its old terminal
 * phase or by its chain-proven closure. Nothing executes it; its status (and `operation resume`) runs the closure check.
 */
async function withLegacy<R>(live: () => Promise<R | null>, root: string, family: LegacyStargateFamily, operationId: string): Promise<R | LegacyStargateRecord | null> {
  try { return await live(); }
  catch (error) {
    if (!(error instanceof ApnError) || error.code !== "APN_STATE_CORRUPT" || error.details?.reason !== "schema") throw error;
    const legacy = await loadLegacyStargateRecord(root, family, operationId);
    if (legacy === null) throw error;
    return legacy;
  }
}

function stargateAdapter<R extends StargateRecord>(family: LegacyStargateFamily, directory: string, chainId: number,
  read: (root: string, operationId: string) => Promise<R | null>, terminal: (record: R) => boolean,
  service: (context: RuntimeContext) => StargateService, runtimeCommand: "stargate.native.status" | "stargate.token.status",
  exit?: string): OperationFamilyAdapter<R | LegacyStargateRecord> {
  const store: OperationStore = { directory, perProfile: false };
  return {
    family,
    stores: [store],
    async load(root, recordPath) {
      const { operationId } = requiredRecordPath(recordPath, store);
      return await withLegacy(async () => await read(root, operationId), root, family, operationId);
    },
    // Stargate hashes its own profile and key into the operation ID, so replay is by ID; the claim uses the state's profile hash.
    identity: record => ({ profileHash: namedProfileHash(record.profile), operationId: record.operationId, idempotencyHash: null, requestHash: null }),
    claims: record => readableClaims(() => [evmClaim(chainId, record.owner)]),
    holdsProfile: record => !isLegacyStargateRecord(record),
    terminal: (record, root) => isLegacyStargateRecord(record) ? legacyStargateTerminal(root, record) : terminal(record as R),
    state: record => record.phase,
    salvage: raw => salvageNamedRecord(raw, value => [salvageEvm(chainId, field(value, "owner"))], "profile"),
    view: async record => record,
    status: async (context, record) => operationOutcome(await service(context).status(record.operationId)),
    async resume(context, record, options) {
      assertResumeOptions(options, { refuseWait: () => oneObservationOnly("Stargate") });
      // An unreleased-schema record has no runtime to observe: its one recovery is the chain-proven closure its status runs.
      return operationOutcome(await (isLegacyStargateRecord(record) ? service(context).status(record.operationId) : service(context).observe(record.operationId)));
    },
    receipt: async (context, record) => receiptOutcome(await service(context).receipt(record.operationId)),
    commands: { status: OPERATION_STATUS, resume: OPERATION_RESUME, ...(exit === undefined ? {} : { exit }) },
    runtimeCommand: async () => runtimeCommand,
  };
}

/** Execute refuses an expired `prepared` or `approved` journal before signing; once a hash is recorded it is observed to the end. */
export const stargateNativeAdapter = stargateAdapter<StargateNativeOperation>("stargate_native", "stargate-v2-native", STARGATE_NATIVE_SOURCE_CHAIN,
  async (root, id) => await new FileStargateNativeJournal(root).load(id),
  record => record.phase === "observed" || record.phase === "failed_confirmed_revert" ||
    (record.phase === "prepared" || record.phase === "approved") && record.transactionHash === undefined && pastUnstartedDeadline(record.expiresAt),
  context => installed(context.stargateNative, "Stargate native runtime is unavailable."), "stargate.native.status");

/** Neither an approval nor a send is signed past the prepare expiry; any signed approval, send or cleanup ends observed or cleaned. */
export const stargateTokenAdapter = stargateAdapter<StargateTokenOperation>("stargate_token", "stargate-v2-token", STARGATE_TOKEN_SOURCE_CHAIN_ID,
  async (root, id) => await new FileStargateTokenJournal(root).load(id),
  record => record.phase === "observed" || record.phase === "cleaned" ||
    (record.phase === "prepared" || record.phase === "approved") && record.approvalTransactionHash === undefined &&
      record.transactionHash === undefined && pastUnstartedDeadline(record.expiresAt),
  context => installed(context.stargateToken, "Stargate token runtime is unavailable."), "stargate.token.status",
  "apn stargate token cleanup --operation <operation-id>");
