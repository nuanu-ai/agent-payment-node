import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { ApnError } from "../../errors.js";
import { USDT_EXECUTION_OPEN_STATES, UsdtExecutionJournal, type UsdtExecutionRecord } from "../../gasless-usdt/execution-journal.js";
import { field, readableClaims, requiredRecordPath, salvageEvm, salvageRecord, STATE_HASH, type OperationFamilyAdapter,
  type OperationStore } from "../adapter.js";
import { dataOutcome, operationOutcome } from "../../core-outcome.js";
import { evmClaim } from "./family-claims.js";
import { assertResumeOptions, oneObservationOnly } from "../../operation-command-options.js";
import { installed, OPERATION_RESUME, OPERATION_STATUS } from "./family-commands.js";

const STORE: OperationStore = { directory: "gasless-usdt-executions", perProfile: false };
/** Gasless USDT signs on Ethereum with the owner's EOA, the shared EntryPoint and nonce key 0. */
export const GASLESS_USDT_CHAIN_ID = 1;

/**
 * Gasless USDT executions. A bound preparation holds nothing (execution re-guards the exact nonces it uses); an
 * execution is admitted before its first RPC read or signature and holds the sender while it can still sign, send or land.
 * Its profile hash is the allowlist overlay's, as the execution journal stores it.
 */
export const gaslessUsdtAdapter: OperationFamilyAdapter<UsdtExecutionRecord> = {
  family: "gasless_usdt",
  stores: [STORE],
  async load(root, recordPath) { return await new UsdtExecutionJournal(root).load(requiredRecordPath(recordPath, STORE).operationId); },
  identity: record => ({ profileHash: record.profileHash, operationId: record.operationId, idempotencyHash: null, requestHash: null }),
  claims: record => readableClaims(() => [evmClaim(GASLESS_USDT_CHAIN_ID, record.sender)]),
  terminal: record => !USDT_EXECUTION_OPEN_STATES.includes(record.state),
  state: record => record.state,
  salvage: raw => salvageRecord(raw, value => [salvageEvm(GASLESS_USDT_CHAIN_ID, field(value, "sender"))]),
  view: async record => record,
  status: async (context, record) => dataOutcome(await installed(context.gaslessUsdtExecute, "Gasless USDT execution runtime is unavailable.")
    .status(record.profileHash, record.operationId), "local_gasless_usdt_execution_journal"),
  // Resume observes a sent execution and retires an unsent one under the effect lock; it never signs or resends.
  async resume(context, record, options) {
    assertResumeOptions(options, { refuseWait: () => oneObservationOnly("Gasless USDT") });
    return operationOutcome(await installed(context.gaslessUsdtExecute, "Gasless USDT execution runtime is unavailable.")
      .resume(record.profileHash, record.operationId));
  },
  commands: { status: OPERATION_STATUS, resume: OPERATION_RESUME },
  // The USDT command runtime (bound journal and execution) is built for the family's own resume.
  runtimeCommand: async () => "gasless.usdt.resume",
};

/**
 * A bound preparation that never executed holds nothing and is not indexed (its execution takes the same ID). The
 * generic commands answer it with its own status command, under the profile hash its bound journal is filed by.
 */
export async function unexecutedUsdtPreparation(root: string, operationId: string): Promise<ApnError | null> {
  const directory = join(root, "gasless-usdt-bound-operations");
  const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
  let profiles: readonly string[];
  try { profiles = await readdir(directory); } catch (error) { if (absent(error)) return null; throw error; }
  for (const profileHash of profiles.filter(name => STATE_HASH.test(name))) {
    try { if (!(await lstat(join(directory, profileHash, `${operationId}.json`))).isFile()) continue; }
    catch (error) { if (absent(error)) continue; throw error; }
    return new ApnError("APN_OPERATION_BLOCKED", "This gasless USDT operation is prepared but was never executed; its own status reads it.",
      { operationId, family: "gasless_usdt", reason: "gasless_usdt_not_executed",
        nextActions: [`apn gasless usdt status --profile-hash ${profileHash} --operation ${operationId}`] });
  }
  return null;
}
