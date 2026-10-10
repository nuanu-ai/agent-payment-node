import { canonicalJson } from "../canonical.js";
import { ApnError } from "../errors.js";
import { StateStore } from "../state.js";
import { permit2WalletBinding } from "./owner-binding.js";
import { Permit2HttpObservationStore, normalizePermit2Locator } from "./production-http-observations.js";
import { Permit2ProductionJournal } from "./production-journal.js";
import { observePermit2Production, type Permit2ObservationMode, type Permit2ObservationProjection } from "./production-observer.js";
import { Permit2ProductionRepository, publicPermit2Production, type Permit2ProductionRecord } from "./production-repository.js";

type Status = ReturnType<typeof publicPermit2Production> | null;
type Code = "not_found" | "state_unavailable" | "hint_saved" | "hint_unavailable" | "not_exposed" | "terminal" | "held" |
  "invalid_candidate" | "invalid_mode" | "owner_mismatch" | "observed_hold" | "finalized" | "reconciled";
export interface Permit2ProductionResult { readonly status: Status; readonly code: Code; readonly observation?: Permit2ObservationProjection }
/** Result handling only. Sidecar content never supplies a proof, grant or accounting decision. */
export class Permit2ProductionResults {
  readonly #records: Permit2ProductionRepository; readonly #hints: Permit2HttpObservationStore;
  readonly #state: StateStore; readonly #journal: Permit2ProductionJournal;
  constructor(state: StateStore, journal: Permit2ProductionJournal) {
    if (state.root !== journal.root || Object.getPrototypeOf(journal) !== Permit2ProductionJournal.prototype) {
      throw new ApnError("APN_OPERATION_BLOCKED", "Permit2 result context is not owned.");
    }
    this.#state = state; this.#journal = journal; this.#records = new Permit2ProductionRepository(state.root);
    this.#hints = new Permit2HttpObservationStore(state.root);
  }
  #result(record: Permit2ProductionRecord | null, code: Code, observation?: Permit2ObservationProjection): Permit2ProductionResult {
    return Object.freeze({ status: record === null ? null : publicPermit2Production(record), code, ...(observation === undefined ? {} : { observation }) });
  }
  async recordHttp(id: string, observation: unknown): Promise<Permit2ProductionResult> {
    let record: Permit2ProductionRecord | null = null;
    try {
      record = await Permit2ProductionRepository.findOwnedOperation(this.#records, id); if (record === null) return this.#result(null, "not_found");
      await this.#hints.write(id, observation); return this.#result(record, "hint_saved");
    } catch { return this.#result(record, record === null ? "state_unavailable" : "hint_unavailable"); }
  }
  async observe(id: string, rpcUrl: string, mode: Permit2ObservationMode = "settlement", candidate?: string): Promise<Permit2ProductionResult> {
    let record: Permit2ProductionRecord | null = null;
    try { record = await Permit2ProductionRepository.findOwnedOperation(this.#records, id); }
    catch { return this.#result(null, "state_unavailable"); }
    if (record === null) return this.#result(null, "not_found");
    if (record.terminal) return this.#result(record, "terminal");
    if (mode !== "settlement" && mode !== "expired_unused") return this.#result(record, "invalid_mode");
    const j = record.exposureJournal;
    if (j === undefined || !j.holdConfirmed || record.exposureAt === null) return this.#result(record, "not_exposed");
    let locator: string | null = null;
    if (candidate !== undefined) {
      if (mode !== "settlement") return this.#result(record, "invalid_candidate");
      try { locator = normalizePermit2Locator(candidate); } catch { return this.#result(record, "invalid_candidate"); }
    }
    if (j.terminalIntent !== null) {
      try {
        record = await Permit2ProductionJournal.prototype.reconcileTerminal.call(this.#journal, id);
        if (record.terminal) return this.#result(record, "reconciled");
      } catch { return this.#result(record, "held"); }
      const intent = record.exposureJournal!.terminalIntent!;
      if ((intent.outcome === "settled" ? "settlement" : "expired_unused") !== mode || locator !== null && locator !== intent.transactionHash) return this.#result(record, "held");
      locator = intent.transactionHash;
    } else if (mode === "settlement" && locator === null) {
      try { locator = (await this.#hints.read(id, record))?.locator ?? null; } catch { return this.#result(record, "hint_unavailable"); }
    }
    if (record.exposureJournal?.signed == null) return this.#result(record, "not_exposed");
    if (mode === "settlement" && locator === null) return this.#result(record, "held");
    try {
      if (canonicalJson(await permit2WalletBinding(this.#state, record.material.wallet.profile)) !== canonicalJson(record.material.wallet)) return this.#result(record, "owner_mismatch");
    } catch { return this.#result(record, "owner_mismatch"); }
    try {
      const checked = await observePermit2Production({ profile: record.material.wallet.profile, stateRoot: this.#state.root, rpcUrl,
        record, signed: record.exposureJournal?.signed ?? null, mode, locator });
      if (checked.proof === null) return this.#result(record, "observed_hold", checked.projection);
      try {
        record = await Permit2ProductionJournal.prototype.finalize.call(this.#journal, id, checked.proof, mode);
        return this.#result(record, record.terminal ? "finalized" : "held", checked.projection);
      } catch {
        try { record = await Permit2ProductionRepository.findOwnedOperation(this.#records, id) ?? record; } catch { /* Keep the last validated safe status. */ }
        return this.#result(record, "held", checked.projection);
      }
    } catch { return this.#result(record, "held"); }
  }
}
