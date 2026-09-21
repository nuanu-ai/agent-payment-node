import type { BridgeBlock, BridgeDeploymentIdentity, BridgeProtocolReceipt, BridgeTransactionProof } from "./model.js";
import { type BridgeOperationRecord, type BridgeVerifiedDestinationProof } from "./operation-model.js";
export declare const BASE_DEPLOYMENT_MIGRATION_SCHEMA: "apn.bridge-base-usdc-deployment-migration.v1";
export declare const BASE_DEPLOYMENT_MIGRATION_CANDIDATE: Readonly<{
    schemaVersion: "apn.bridge-base-usdc-deployment-migration.v1";
    operationId: "0e3491acbe5a0b9687d0d18e7e4bc605199a9d8b9cb7ab5c8c9217e303eba189";
    profileHash: "8692e4b95d088a0e95bcab3edf8a641f8d04f54ed4b1d26af61f7a9e344f58bd";
    oldFingerprint: "cee3ce81b8f9d1411ae18775917277298c964195d702204b7432e0ea222ee218";
    oldIntegrityHash: "b22b0a40cf7d29d0ca67be2aeb65072151f9639dc1d8baee246e7d28d52e759a";
    oldTransitionRoot: "51362ebdd03691b307408a62fdc752d69fbd3f71354d5adca95d73a79658ca40";
    newFingerprint: "44ee8db54293fc52a90d54f9167f299504cf0f6924e79206c4909b4318fa67a6";
    newIntegrityHash: "a9301e10cb4bf0b7e63d97e585996be3e4be1ee4c5995b5d647638f6aec6ee69";
    newTransitionRoot: "7b3d6eb3ea075d29788c8c194feff9ecb825b5877cae551173a1b6807767abf9";
    route: {
        fromChainId: number;
        toChainId: number;
        tool: string;
        amountAtomic: string;
        bridgeAmountAtomic: string;
        outputAmountAtomic: string;
        recipient: string;
        fromToken: string;
        toToken: string;
    };
    approvalTransactionHash: "0xe6d3017ad15f50ac5e784654231440293a8a7e30fce65af732eb7ed26b80a916";
    sourceTransactionHash: "0xb7156c7626ce87f2250adcda6ef8e6383308a8c6baa0d8a8c1bbd2bf536e03ea";
    destinationTransactionHash: "0x66d8b4cfd8d676778ed1445a388a7a2bc2e487bf342c13102128461a8b0910e6";
    sourceBlock: {
        readonly numberAtomic: "25991578";
        readonly hash: "0xa5d09b09f95cb83bd60cac35e4da453286c69a3123e1ea80ce23f8d75c3ff770";
        readonly timestampAtomic: "1789580279";
    };
    destinationBlock: {
        readonly numberAtomic: "51395469";
        readonly hash: "0x74f557f8da50f60b81ab32f4871dc619ddf92b08f505edd8c9a56ef8169f2222";
        readonly timestampAtomic: "1789580285";
    };
    sourceSafeBlock: {
        readonly numberAtomic: "26024956";
        readonly hash: "0x5e404085d24ddc013b6312c58725ced1473ce5a984b3fe3dce46f3ecab91ac88";
        readonly timestampAtomic: "1789982423";
    };
    destinationSafeBlock: {
        readonly numberAtomic: "51596747";
        readonly hash: "0x5a7faf1f747fdf165ed9267831df50e8e69782d601db422d87a6bef92b5bb937";
        readonly timestampAtomic: "1789982841";
    };
    destinationTransactionProofHash: "c0f88fe5350b05930d3ae5b42f8534c345dce4817318cf826c16dc618f3b5ce9";
    oldSourceDeployment: {
        readonly chainId: 1;
        readonly peerChainId: 8453;
        readonly tool: "across";
        readonly rpcOrigin: "https://ethereum-rpc.publicnode.com";
        readonly block: {
            readonly numberAtomic: "25991490";
            readonly hash: "0x1c59ca0c82c4c5c4367de512bd2e2f34327c164d8a6f0c3f628cf11d5ad57f2e";
            readonly timestampAtomic: "1789579223";
        };
        readonly contractHash: "b5a4ad94f455725ae857b2d61cfe52f6886aecddfdf13296ee3244170bd72b0a";
        readonly codeHash: "050dd58c1d09b8c0cf10a62344ba33dec13e11c98cc15d35881ac7162201381b";
        readonly configurationHash: "ca0e2e4c2c76ff3d1a896431f9f595a1e254d93001fe390f8a543fe2341822d1";
    };
    oldDestinationDeployment: {
        readonly chainId: 8453;
        readonly peerChainId: 1;
        readonly tool: "across";
        readonly rpcOrigin: "https://base-rpc.publicnode.com";
        readonly block: {
            readonly numberAtomic: "51395108";
            readonly hash: "0x43f43936f6e6045c52fcbbe97367cac24d843f99a4e38a2723c0d203417d4a33";
            readonly timestampAtomic: "1789579563";
        };
        readonly contractHash: "bf61900beb9f9bba54cce385ce88b3297bdaf6d8f311ccbc451cbf812bf9d997";
        readonly codeHash: "2a422dd13d2b6b06b12aa01892018c18d6ca04660b24f180e585a953045b5f09";
        readonly configurationHash: "45b25bcdabef208739a45af8ffd0e7e3c2445a4e40ca55fbafd8d6627d3788be";
    };
    verifiedSourceDeployment: {
        readonly rpcOrigin: "https://eth.drpc.org";
        readonly block: {
            readonly numberAtomic: "25991578";
            readonly hash: "0xa5d09b09f95cb83bd60cac35e4da453286c69a3123e1ea80ce23f8d75c3ff770";
            readonly timestampAtomic: "1789580279";
        };
        readonly chainId: 1;
        readonly peerChainId: 8453;
        readonly tool: "across";
        readonly contractHash: "b5a4ad94f455725ae857b2d61cfe52f6886aecddfdf13296ee3244170bd72b0a";
        readonly codeHash: "050dd58c1d09b8c0cf10a62344ba33dec13e11c98cc15d35881ac7162201381b";
        readonly configurationHash: "ca0e2e4c2c76ff3d1a896431f9f595a1e254d93001fe390f8a543fe2341822d1";
    };
    newDestinationDeployment: {
        readonly rpcOrigin: "https://base.drpc.org";
        readonly block: {
            readonly numberAtomic: "51395469";
            readonly hash: "0x74f557f8da50f60b81ab32f4871dc619ddf92b08f505edd8c9a56ef8169f2222";
            readonly timestampAtomic: "1789580285";
        };
        readonly chainId: 8453;
        readonly peerChainId: 1;
        readonly tool: "across";
        readonly contractHash: "bf61900beb9f9bba54cce385ce88b3297bdaf6d8f311ccbc451cbf812bf9d997";
        readonly codeHash: "2a422dd13d2b6b06b12aa01892018c18d6ca04660b24f180e585a953045b5f09";
        readonly configurationHash: "45b25bcdabef208739a45af8ffd0e7e3c2445a4e40ca55fbafd8d6627d3788be";
    };
}>;
export interface BaseDeploymentMigrationAudit {
    readonly schemaVersion: typeof BASE_DEPLOYMENT_MIGRATION_SCHEMA;
    readonly operationId: string;
    readonly candidateHash: string;
    readonly sourceTransactionHash: string;
    readonly destinationTransactionHash: string;
    readonly oldFingerprint: string;
    readonly newFingerprint: string;
    readonly oldIntegrityHash: string;
    readonly newIntegrityHash: string;
    readonly oldTransitionRoot: string;
    readonly newTransitionRoot: string;
    readonly touchedFields: readonly string[];
    readonly auditDigest: string;
}
export interface BaseMigrationObservation {
    readonly transaction: BridgeTransactionProof;
    readonly receipt: BridgeProtocolReceipt;
}
export declare function assertBaseDeploymentMigrationProof(operation: BridgeOperationRecord, source: BaseMigrationObservation, sourceDeployment: BridgeDeploymentIdentity, destination: BaseMigrationObservation, destinationDeployment: BridgeDeploymentIdentity, sourceFinalityBlock: BridgeBlock, destinationFinalityBlock: BridgeBlock): BridgeVerifiedDestinationProof;
export declare function migrateBaseDeploymentOperation(operation: BridgeOperationRecord, destinationProof?: BridgeVerifiedDestinationProof): {
    readonly operation: BridgeOperationRecord;
    readonly previousOperation: BridgeOperationRecord;
    readonly audit: BaseDeploymentMigrationAudit;
    readonly alreadyCurrent: boolean;
};
