import type { BridgeDeploymentIdentity, BridgeTransactionProof } from "./model.js";
import { type BridgeOperationRecord } from "./operation-model.js";
export declare const LINEA_DEPLOYMENT_MIGRATION_SCHEMA: "apn.bridge-deployment-migration.v1";
declare const destinationBlock: {
    readonly numberAtomic: "32091740";
    readonly hash: "0xf5cabb6d15cfe03450e394e08ae29eed3c22492ac1da5ff27a68762186de6bba";
    readonly timestampAtomic: "1789914016";
};
export declare const LINEA_DEPLOYMENT_MIGRATION_CANDIDATE: Readonly<{
    schemaVersion: "apn.bridge-deployment-migration.v1";
    route: {
        fromChainId: number;
        toChainId: number;
        tool: string;
        fromToken: string;
        toToken: string;
    };
    destinationTransactionHash: "0x0c9c1ca15d1678a8f47857fb264b0bc19ff1f1c22d4c71dd6f8d25773b560654";
    destinationBlock: {
        readonly numberAtomic: "32091740";
        readonly hash: "0xf5cabb6d15cfe03450e394e08ae29eed3c22492ac1da5ff27a68762186de6bba";
        readonly timestampAtomic: "1789914016";
    };
    oldDeployment: {
        readonly chainId: 59144;
        readonly peerChainId: 1;
        readonly tool: "across";
        readonly rpcOrigin: "https://rpc.linea.build";
        readonly block: {
            readonly numberAtomic: "32090534";
            readonly hash: "0xd97567d963a90e816e57fe3bc5dd0cc9ce30f8c136825432ac5ccbacaa307123";
            readonly timestampAtomic: "1789904040";
        };
        readonly contractHash: "8fb1e8223c2d09b49cc1f138599e8f628e56fea91f7769a94860965cb02dd61e";
        readonly codeHash: "3309d23ade289942b0b6023721f6c09a644524917e59b81f0d29c7b1fb189942";
        readonly configurationHash: "9a2b274533c664cc533a22fe774e7c283c7d0ce3aecdfe65d940e91ba7a786a1";
    };
    newDeployment: {
        readonly chainId: 59144;
        readonly peerChainId: 1;
        readonly tool: "across";
        readonly rpcOrigin: "https://rpc.linea.build";
        readonly block: {
            readonly numberAtomic: "32091740";
            readonly hash: "0xf5cabb6d15cfe03450e394e08ae29eed3c22492ac1da5ff27a68762186de6bba";
            readonly timestampAtomic: "1789914016";
        };
        readonly contractHash: "14e2009052caef86f6a5592d52704a63860154f0b0b051c32bfa1ad9448b265f";
        readonly codeHash: "92be1364e421c29baa34aca55cac947d45f9ea91a05a16753aba3c97dc501ad0";
        readonly configurationHash: "37419cf0d4a7311341ed94f791aaa187951be14730c647036c7794c61ae965de";
    };
}>;
export interface BridgeDeploymentMigrationAudit {
    readonly schemaVersion: typeof LINEA_DEPLOYMENT_MIGRATION_SCHEMA;
    readonly operationId: string;
    readonly candidateHash: string;
    readonly destinationTransactionHash: string;
    readonly destinationBlock: typeof destinationBlock;
    readonly oldFingerprint: string;
    readonly newFingerprint: string;
    readonly oldIntegrityHash: string;
    readonly newIntegrityHash: string;
    readonly oldTransitionRoot: string;
    readonly newTransitionRoot: string;
    readonly touchedFields: readonly ["intent.destinationDeployment", "fingerprint", "approval.fingerprint", "transitions[].approval.fingerprint", "transitions[].previousHash", "transitions[].transitionHash", "integrityHash"];
    readonly auditDigest: string;
}
export declare function assertLineaDeploymentMigrationProof(proof: BridgeTransactionProof, deployment: BridgeDeploymentIdentity): void;
export declare function migrateLineaDeploymentOperation(operation: BridgeOperationRecord, deployment: BridgeDeploymentIdentity): {
    readonly operation: BridgeOperationRecord;
    readonly previousOperation: BridgeOperationRecord;
    readonly audit: BridgeDeploymentMigrationAudit;
    readonly alreadyCurrent: boolean;
};
export {};
