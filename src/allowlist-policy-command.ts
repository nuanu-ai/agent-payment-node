import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { isAbsolute, join, normalize, parse, resolve, sep } from "node:path";
import type { CommandOutcome, CommandRequest } from "./commands.js";
import { ApnError } from "./errors.js";
import { loadAllowlistInventory } from "./allowlist-inventory.js";
import { activeAllowlistPolicy } from "./allowlist-active-policy.js";
import {
  allowlistAdmissions,
  allowlistDecisionCode,
  allowlistDecisionFingerprint,
  type AllowlistPolicyApprovalPort,
} from "./allowlist-policy-activation.js";
import { AllowlistPolicyStore, stagedRecordAccounts, type StagedAllowlistPolicyRecord } from "./allowlist-policy-store.js";
import { parseAllowlistPolicyFile, type AllowlistPolicyFile } from "./allowlist-policy-v2.js";
import type { ClockPort } from "./ports.js";

const MAX_POLICY_FILE_BYTES = 256 * 1024;

type AllowlistPolicyRequest = Extract<CommandRequest, { readonly command: `allowlist.policy.${string}` }>;

export interface AllowlistPolicyCommandContext {
  readonly state: { readonly root: string };
  readonly clock: ClockPort;
  readonly allowlistPolicyApproval?: AllowlistPolicyApprovalPort;
}

export async function executeAllowlistPolicyCommand(request: AllowlistPolicyRequest, context: AllowlistPolicyCommandContext): Promise<CommandOutcome> {
  const store = new AllowlistPolicyStore(context.state.root);
  switch (request.command) {
    case "allowlist.policy.status": return outcome(await status(store, request.profile, instant(context.clock.now())), "allowlist_policy_status");
    case "allowlist.policy.stage": return outcome(await store.stage({ profile: request.profile, policy: await readPolicyFile(request.file),
      ...(request.expectedRevision === undefined ? {} : { expectedRevision: request.expectedRevision }), now: context.clock.now() }),
    "staged_unadmitted_allowlist_policy");
    case "allowlist.policy.prepare": {
      if ((request.mechanismProvider === undefined) !== (request.mechanismReference === undefined)) {
        invalid("Pinned mechanism provider and reference must be supplied together.", "invalid_mechanism");
      }
      const inventory = loadAllowlistInventory();
      return outcome(await store.prepare({ overlayVersion: request.overlayVersion, profile: request.profile, account: request.account,
        datasetVersion: inventory.dataset.version, datasetSha256: inventory.dataset.sha256,
        inventorySha256: inventory.inventorySha256, effectiveAt: request.effectiveAt,
        ...(request.expiresAt === undefined ? {} : { expiresAt: request.expiresAt }),
        admissions: [{ chain: request.chain, kind: request.kind,
          ...(request.identifier === undefined ? {} : { identifier: request.identifier }), rail: request.rail,
          maximumPerTransferAtomic: request.maximumPerTransferAtomic, dailyLimitAtomic: request.dailyLimitAtomic,
          ...(request.mechanismProvider === undefined ? {} : { mechanism: {
            provider: request.mechanismProvider, reference: request.mechanismReference!,
          } }) }],
        ...(request.expectedRevision === undefined ? {} : { expectedRevision: request.expectedRevision }), now: context.clock.now() }),
      "staged_unadmitted_allowlist_policy");
    }
    case "allowlist.policy.activate":
    case "allowlist.policy.revoke":
      return outcome(await decide(store, request, context),
        request.command === "allowlist.policy.activate" ? "owner_activated_allowlist_policy" : "owner_revoked_allowlist_policy");
  }
}

async function decide(store: AllowlistPolicyStore,
  request: Extract<AllowlistPolicyRequest, { readonly command: "allowlist.policy.activate" | "allowlist.policy.revoke" }>,
  context: AllowlistPolicyCommandContext): Promise<unknown> {
  const approval = context.allowlistPolicyApproval;
  if (approval === undefined) {
    throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "Allowlist policy decisions require the foreground terminal approval.",
      { approval_boundary: "foreground_tty" });
  }
  const action = request.command === "allowlist.policy.activate" ? "activate" : "revoke";
  const now = instant(context.clock.now());
  const state = await store.read(request.profile);
  const head = state.entries.at(-1) ?? null;
  const active = activeAllowlistPolicy(state);
  const record = state.records.find((candidate) => candidate.revision === request.revision);
  if (record === undefined) throw new ApnError("APN_OPERATION_NOT_FOUND", "The staged allowlist revision does not exist.", { reason: "unknown_revision" });
  if (action === "activate") {
    if (active?.record.revision === record.revision) invalid("This revision is already the active allowlist policy.", "already_active");
    if (record.registry.expiresAt !== undefined && now >= record.registry.expiresAt) {
      throw new ApnError("APN_OPERATION_BLOCKED", "An expired staged revision cannot be activated.", { reason: "allowlist_policy_expired" });
    }
  } else if (active === null || active.record.revision !== record.revision) {
    invalid("Only the currently active revision can be revoked.", "not_active_revision");
  }
  const fingerprint = allowlistDecisionFingerprint({ action, profileHash: state.profileHash, revision: record.revision,
    stagedRecordDigest: record.recordDigest, policyDigest: record.registry.policyDigest, headEntryDigest: head?.entryDigest ?? null });
  await approval.approve({ action, profile: state.profile, record, accounts: stagedRecordAccounts(record),
    currentActiveRevision: active?.record.revision ?? null, fingerprint, code: allowlistDecisionCode(action, fingerprint) });
  const entry = await store.appendDecision(state.profile, head?.entryDigest ?? null, {
    status: action === "activate" ? "active" : "revoked", revision: record.revision, stagedRecordDigest: record.recordDigest,
    policyDigest: record.registry.policyDigest, ...(action === "activate" ? { registry: record.registry } : {}),
    approvalFingerprint: fingerprint, decidedAt: instant(context.clock.now()),
  });
  return { profile: state.profile, status: entry.status, revision: entry.revision, policyDigest: entry.policyDigest,
    activationDigest: entry.entryDigest, sequence: entry.sequence, decidedAt: entry.decidedAt,
    previousActiveRevision: active?.record.revision ?? null, effectiveAt: record.registry.effectiveAt ?? null,
    expiresAt: record.registry.expiresAt ?? null };
}

async function status(store: AllowlistPolicyStore, profile: string, now: string): Promise<unknown> {
  const state = await store.read(profile);
  const head = state.entries.at(-1) ?? null;
  const active = activeAllowlistPolicy(state);
  const latest = state.records.at(-1);
  const registry = active?.record.registry;
  const activation = head === null ? "never_activated" : active === null ? "revoked"
    : registry?.expiresAt !== undefined && now >= registry.expiresAt ? "expired"
      : registry?.effectiveAt !== undefined && now < registry.effectiveAt ? "scheduled" : "active";
  return { profile: state.profile, activation, stagedRevisions: state.records.length,
    staged: latest === undefined ? null : view(latest),
    active: active === null ? null : { ...view(active.record), activationDigest: active.entry.entryDigest, activatedAt: active.entry.decidedAt,
      sequence: active.entry.sequence },
    lastDecision: head === null ? null : { status: head.status, revision: head.revision, sequence: head.sequence,
      decidedAt: head.decidedAt, activationDigest: head.entryDigest } };
}

function view(record: StagedAllowlistPolicyRecord): Record<string, unknown> {
  return { revision: record.revision, recordSchema: record.schemaVersion, overlayVersion: record.overlay.overlayVersion,
    preparedAt: record.preparedAt, recordDigest: record.recordDigest, policyDigest: record.registry.policyDigest,
    registrySchema: record.registry.schemaVersion, effectiveAt: record.registry.effectiveAt ?? null,
    expiresAt: record.registry.expiresAt ?? null, accounts: stagedRecordAccounts(record), admissions: allowlistAdmissions(record.registry) };
}

/** Read one owner-written policy file: absolute canonical path, no symlinks, owned by this user, not group/world writable. */
async function readPolicyFile(path: string): Promise<AllowlistPolicyFile> {
  if (!isAbsolute(path) || normalize(path) !== path || resolve(path) !== path) {
    invalid("The policy file path must be absolute and canonical.", "invalid_policy_file_path");
  }
  let component = parse(path).root;
  try {
    for (const part of path.slice(component.length).split(sep).filter(Boolean)) {
      component = join(component, part);
      if ((await lstat(component)).isSymbolicLink()) unsafe("The policy file path traverses a symbolic link; pass the real path.");
    }
  } catch (error) {
    if (error instanceof ApnError) throw error;
    invalid("The policy file cannot be found.", "policy_file_missing");
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    .catch(() => unsafe("The policy file cannot be opened as a regular file without following links."));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.uid !== process.geteuid?.() || (before.mode & 0o022) !== 0 || before.nlink !== 1 ||
        before.size > MAX_POLICY_FILE_BYTES) {
      unsafe("The policy file must be a bounded regular file owned by you and not writable by group or others.");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== before.size) {
      unsafe("The policy file changed while it was read.");
    }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
    catch { return invalid("The policy file is not strict UTF-8 JSON.", "invalid_policy_file"); }
    return parseAllowlistPolicyFile(value);
  } finally { await handle.close(); }
}

function outcome(data: unknown, proofClass: string): CommandOutcome {
  return { proofClass, data, operation: null, receipt: null, nextActions: [] };
}
function instant(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) invalid("The evaluation instant is invalid.", "invalid_time");
  return value.toISOString();
}
function invalid(message: string, reason: string): never { throw new ApnError("APN_INVALID_INPUT", message, { reason }); }
function unsafe(message: string): never { throw new ApnError("APN_STATE_SECURITY", message, { reason: "unsafe_policy_file" }); }
