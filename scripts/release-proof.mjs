import { resolve } from "node:path";

const BUNDLE_ID = "ai.nuanu.apn.keychain-agent";
const ACCESS_GROUP_SUFFIX = "ai.nuanu.apn.keys";

export function assertNotarizedAppProof(proof, { expectedTeamId, expectedApp } = {}) {
  if (
    proof === null ||
    typeof proof !== "object" ||
    Array.isArray(proof) ||
    proof.schemaVersion !== "apn.notarized-app.v1" ||
    proof.proofClass !== "developer_id_notarized_stapled_gatekeeper" ||
    proof.releaseEligible !== true ||
    proof.bundleId !== BUNDLE_ID ||
    typeof proof.version !== "string" ||
    !/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(proof.version) ||
    !/^[A-Z0-9]{10}$/.test(proof.teamId ?? "") ||
    proof.accessGroup !== `${proof.teamId}.${ACCESS_GROUP_SUFFIX}` ||
    !Array.isArray(proof.architectures) ||
    proof.architectures.length !== 1 ||
    proof.architectures[0] !== "arm64" ||
    !/^[0-9a-f]{64}$/.test(proof.bundleDigest ?? "") ||
    typeof proof.app !== "string"
  ) {
    throw new Error("notarized-app proof manifest is invalid");
  }
  if (expectedTeamId !== undefined && proof.teamId !== expectedTeamId) {
    throw new Error("notarized-app proof Team ID differs from the independently expected Team ID");
  }
  if (expectedApp !== undefined && resolve(proof.app) !== resolve(expectedApp)) {
    throw new Error("notarized-app proof names a different app bundle");
  }
  return proof;
}

export function assertSameNotarizedApp(actual, claimed) {
  const fields = ["version", "teamId", "bundleId", "accessGroup", "bundleDigest"];
  for (const field of fields) {
    if (actual[field] !== claimed[field]) {
      throw new Error(`fresh notarized-app proof differs from the release claim: ${field}`);
    }
  }
  if (JSON.stringify(actual.architectures) !== JSON.stringify(claimed.architectures)) {
    throw new Error("fresh notarized-app proof differs from the release claim: architectures");
  }
}
