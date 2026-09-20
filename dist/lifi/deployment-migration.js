import { canonicalJson, hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { bridgeIntentBinding, sealBridgeOperation } from "./operation-model.js";
import { validateBridgeOperation } from "./operation-validation.js";
export const LINEA_DEPLOYMENT_MIGRATION_SCHEMA = "apn.bridge-deployment-migration.v1";
const destinationTransactionHash = "0x0c9c1ca15d1678a8f47857fb264b0bc19ff1f1c22d4c71dd6f8d25773b560654";
const destinationBlock = { numberAtomic: "32091740", hash: "0xf5cabb6d15cfe03450e394e08ae29eed3c22492ac1da5ff27a68762186de6bba", timestampAtomic: "1789914016" };
const oldDeployment = {
    chainId: 59144, peerChainId: 1, tool: "across", rpcOrigin: "https://rpc.linea.build",
    block: { numberAtomic: "32090534", hash: "0xd97567d963a90e816e57fe3bc5dd0cc9ce30f8c136825432ac5ccbacaa307123", timestampAtomic: "1789904040" },
    contractHash: "8fb1e8223c2d09b49cc1f138599e8f628e56fea91f7769a94860965cb02dd61e",
    codeHash: "3309d23ade289942b0b6023721f6c09a644524917e59b81f0d29c7b1fb189942",
    configurationHash: "9a2b274533c664cc533a22fe774e7c283c7d0ce3aecdfe65d940e91ba7a786a1",
};
const newDeployment = {
    chainId: 59144, peerChainId: 1, tool: "across", rpcOrigin: "https://rpc.linea.build", block: destinationBlock,
    contractHash: "14e2009052caef86f6a5592d52704a63860154f0b0b051c32bfa1ad9448b265f",
    codeHash: "92be1364e421c29baa34aca55cac947d45f9ea91a05a16753aba3c97dc501ad0",
    configurationHash: "37419cf0d4a7311341ed94f791aaa187951be14730c647036c7794c61ae965de",
};
export const LINEA_DEPLOYMENT_MIGRATION_CANDIDATE = Object.freeze({ schemaVersion: LINEA_DEPLOYMENT_MIGRATION_SCHEMA,
    route: { fromChainId: 1, toChainId: 59144, tool: "across", fromToken: "0x0000000000000000000000000000000000000000", toToken: "0x0000000000000000000000000000000000000000" },
    destinationTransactionHash, destinationBlock, oldDeployment, newDeployment });
function same(left, right) { return canonicalJson(left) === canonicalJson(right); }
function blocked(reason) { throw new ApnError("APN_OPERATION_BLOCKED", "The saved operation is not eligible for the recognized Linea deployment migration.", { reason }); }
export function assertLineaDeploymentMigrationProof(proof, deployment) {
    const c = LINEA_DEPLOYMENT_MIGRATION_CANDIDATE;
    if (proof.chainId !== 59144 || proof.transactionHash !== c.destinationTransactionHash || proof.status !== "success" ||
        !same(proof.block, c.destinationBlock) || proof.safeBlock === null || BigInt(proof.safeBlock.numberAtomic) < BigInt(proof.block.numberAtomic) ||
        proof.rpcOrigin !== c.newDeployment.rpcOrigin)
        blocked("destination_transaction_mismatch");
    if (!same(deployment, c.newDeployment) || !same(deployment.block, proof.block))
        blocked("destination_deployment_mismatch");
}
export function migrateLineaDeploymentOperation(operation, deployment) {
    validateBridgeOperation(operation);
    const c = LINEA_DEPLOYMENT_MIGRATION_CANDIDATE, request = operation.intent.materialization.request;
    const alreadyCurrent = same(operation.intent.destinationDeployment, c.newDeployment);
    if (operation.terminal || !["source_pending", "destination_pending", "unknown_finality"].includes(operation.state))
        blocked("ineligible_phase");
    if (request.fromChainId !== c.route.fromChainId || request.toChainId !== c.route.toChainId || request.fromToken !== c.route.fromToken ||
        request.toToken !== c.route.toToken || operation.intent.materialization.tool !== c.route.tool)
        blocked("route_mismatch");
    if ((!alreadyCurrent && !same(operation.intent.destinationDeployment, c.oldDeployment)) || !same(deployment, c.newDeployment))
        blocked("deployment_mismatch");
    if (operation.providerObservation?.status !== "completed_observed" || operation.providerObservation.destinationTransactionHash !== c.destinationTransactionHash ||
        operation.sourceProof === null || operation.destinationProof !== null || operation.effects.length !== 1 || operation.effects[0]?.role !== "bridge" ||
        operation.effects[0].submissionAttempts !== 1 || operation.effects[0].phase !== "safe_success" || operation.effects[0].safeProof === null ||
        operation.sourceProof.transactionHash !== operation.effects[0].transactionHash || operation.usageLease?.state !== "reserved")
        blocked("operation_evidence_mismatch");
    if (alreadyCurrent) {
        const original = resealDeployment(operation, c.oldDeployment);
        const audit = auditFor(original, operation);
        return { operation, previousOperation: original, audit, alreadyCurrent: true };
    }
    const migrated = resealDeployment(operation, deployment);
    return { operation: migrated, previousOperation: operation, audit: auditFor(operation, migrated), alreadyCurrent: false };
}
function resealDeployment(operation, deployment) {
    const draft = structuredClone(operation);
    draft.intent.destinationDeployment = deployment;
    const newFingerprint = hashObject(bridgeIntentBinding(draft));
    draft.fingerprint = newFingerprint;
    if (draft.approval !== null)
        draft.approval.fingerprint = newFingerprint;
    let previousHash = newFingerprint;
    const transitions = draft.transitions.map((entry) => {
        const body = structuredClone(entry);
        delete body.transitionHash;
        if (body.approval !== null)
            body.approval.fingerprint = newFingerprint;
        body.previousHash = previousHash;
        const sealed = { ...body, transitionHash: hashObject(body) };
        previousHash = sealed.transitionHash;
        return sealed;
    });
    const { integrityHash: _old, ...body } = draft;
    const migrated = sealBridgeOperation({ ...body, transitions });
    validateBridgeOperation(migrated);
    return migrated;
}
function auditFor(oldOperation, newOperation) {
    const body = {
        schemaVersion: LINEA_DEPLOYMENT_MIGRATION_SCHEMA, operationId: oldOperation.operationId,
        candidateHash: hashObject(LINEA_DEPLOYMENT_MIGRATION_CANDIDATE), destinationTransactionHash,
        destinationBlock, oldFingerprint: oldOperation.fingerprint, newFingerprint: newOperation.fingerprint,
        oldIntegrityHash: oldOperation.integrityHash, newIntegrityHash: newOperation.integrityHash,
        oldTransitionRoot: oldOperation.transitions.at(-1).transitionHash, newTransitionRoot: newOperation.transitions.at(-1).transitionHash,
        touchedFields: ["intent.destinationDeployment", "fingerprint", "approval.fingerprint", "transitions[].approval.fingerprint", "transitions[].previousHash", "transitions[].transitionHash", "integrityHash"],
    };
    return { ...body, auditDigest: hashObject(body) };
}
//# sourceMappingURL=deployment-migration.js.map