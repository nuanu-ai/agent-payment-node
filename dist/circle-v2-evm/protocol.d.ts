/** Finite CCTP V2 Fast codecs. Pure caller-supplied chain observations are not RPC authenticity proof.
 * Wire layouts/signatures: circlefin/evm-cctp-contracts commit 6e7513cdb2bee6bb0cddf331fe972600fc5017c9. */
import { type Address, type Hex } from "viem";
import { type CircleDestinationChain } from "./catalog.js";
export declare const CIRCLE_ZERO: Hex;
export declare const CIRCLE_ABI: readonly [{
    readonly name: "approve";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "spender";
    }, {
        readonly type: "uint256";
        readonly name: "amount";
    }];
    readonly outputs: readonly [{
        readonly type: "bool";
    }];
}, {
    readonly name: "depositForBurn";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "uint256";
        readonly name: "amount";
    }, {
        readonly type: "uint32";
        readonly name: "destinationDomain";
    }, {
        readonly type: "bytes32";
        readonly name: "mintRecipient";
    }, {
        readonly type: "address";
        readonly name: "burnToken";
    }, {
        readonly type: "bytes32";
        readonly name: "destinationCaller";
    }, {
        readonly type: "uint256";
        readonly name: "maxFee";
    }, {
        readonly type: "uint32";
        readonly name: "minFinalityThreshold";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "receiveMessage";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "bytes";
        readonly name: "message";
    }, {
        readonly type: "bytes";
        readonly name: "attestation";
    }];
    readonly outputs: readonly [{
        readonly type: "bool";
    }];
}, {
    readonly name: "DepositForBurn";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "burnToken";
        readonly indexed: true;
    }, {
        readonly type: "uint256";
        readonly name: "amount";
    }, {
        readonly type: "address";
        readonly name: "depositor";
        readonly indexed: true;
    }, {
        readonly type: "bytes32";
        readonly name: "mintRecipient";
    }, {
        readonly type: "uint32";
        readonly name: "destinationDomain";
    }, {
        readonly type: "bytes32";
        readonly name: "destinationTokenMessenger";
    }, {
        readonly type: "bytes32";
        readonly name: "destinationCaller";
    }, {
        readonly type: "uint256";
        readonly name: "maxFee";
    }, {
        readonly type: "uint32";
        readonly name: "minFinalityThreshold";
        readonly indexed: true;
    }, {
        readonly type: "bytes";
        readonly name: "hookData";
    }];
}, {
    readonly name: "MessageSent";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "bytes";
        readonly name: "message";
    }];
}, {
    readonly name: "MessageReceived";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "caller";
        readonly indexed: true;
    }, {
        readonly type: "uint32";
        readonly name: "sourceDomain";
    }, {
        readonly type: "bytes32";
        readonly name: "nonce";
        readonly indexed: true;
    }, {
        readonly type: "bytes32";
        readonly name: "sender";
    }, {
        readonly type: "uint32";
        readonly name: "finalityThresholdExecuted";
        readonly indexed: true;
    }, {
        readonly type: "bytes";
        readonly name: "messageBody";
    }];
}, {
    readonly name: "MintAndWithdraw";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "mintRecipient";
        readonly indexed: true;
    }, {
        readonly type: "uint256";
        readonly name: "amount";
    }, {
        readonly type: "address";
        readonly name: "mintToken";
        readonly indexed: true;
    }];
}, {
    readonly name: "Transfer";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "from";
        readonly indexed: true;
    }, {
        readonly type: "address";
        readonly name: "to";
        readonly indexed: true;
    }, {
        readonly type: "uint256";
        readonly name: "value";
    }];
}, {
    readonly name: "Approval";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "owner";
        readonly indexed: true;
    }, {
        readonly type: "address";
        readonly name: "spender";
        readonly indexed: true;
    }, {
        readonly type: "uint256";
        readonly name: "value";
    }];
}];
export declare function circleFail(reason: string): never;
export declare function circleRecord(value: unknown): Record<string, unknown>;
export declare function circleHex(value: unknown, bytes?: number): Hex;
export declare function circleUint(value: unknown): bigint;
export declare const circleWord: (address: string) => Hex;
export declare function encodeCircleApproval(reset?: boolean): Hex;
export declare function encodeCircleBurn(chain: CircleDestinationChain): Hex;
export interface CircleMessage {
    readonly bytes: Hex;
    readonly hash: Hex;
    readonly nonce: Hex;
    readonly body: Hex;
    readonly destinationChain: CircleDestinationChain;
    readonly finalityExecuted: number;
    readonly expirationBlock: string;
    readonly feeExecutedAtomic: string;
    readonly receivedAtomic: string;
}
export declare function decodeCircleMessage(value: unknown, chain: CircleDestinationChain, attested: boolean): CircleMessage;
/** The caller must read chain ID, receipt, canonical included block and finality head independently and recheck the included block. */
export interface CircleObservation {
    readonly transaction: unknown;
    readonly receipt: unknown;
    readonly canonicalBlock: unknown;
    readonly recheckedBlock: unknown;
    readonly finalityHead: unknown;
    readonly chainId: number;
    readonly finalityTag: "included" | "safe" | "finalized";
}
export interface CircleReceiptProof {
    readonly transactionHash: Hex;
    readonly blockHash: Hex;
    readonly blockNumberAtomic: string;
    readonly finalityBlockHash: Hex;
    readonly finalityBlockNumberAtomic: string;
    readonly transactionHashBinding: string;
    readonly finalityTag: "included" | "safe" | "finalized";
    readonly receiptHash: string;
    readonly logsHash: string;
    readonly actualFeeAtomic: string;
}
export declare function verifyCircleObservation(input: CircleObservation, expected: {
    chain: number;
    from: Address;
    to: Address;
    data: Hex;
    transactionHash?: Hex;
    maxNativeDebitAtomic: bigint;
    maxGasAtomic: bigint;
}): CircleReceiptProof;
export interface CircleSourceProof extends CircleReceiptProof {
    readonly kind: "circle_v2_evm_source";
    readonly destinationChain: CircleDestinationChain;
    readonly sourceMessage: Hex;
    readonly sourceMessageHash: Hex;
    readonly integrityHash: string;
}
export declare function decodeCircleSource(input: CircleObservation, chain: CircleDestinationChain): CircleSourceProof;
export declare function assertCircleSource(source: CircleSourceProof): void;
export interface CircleAttesterSnapshot {
    readonly threshold: number;
    readonly enabledAttesters: readonly Address[];
    readonly chainId: CircleDestinationChain;
    readonly transmitter: Address;
    readonly blockHash: Hex;
    readonly blockNumberAtomic: string;
    readonly deploymentDigest: string;
}
export interface CircleAttestation extends CircleMessage {
    readonly kind: "circle_v2_evm_attestation";
    readonly attestation: Hex;
    readonly sourceTransactionHash: Hex;
    readonly sourceMessageHash: Hex;
    readonly responseHash: string;
    readonly attesterSnapshotHash: string;
    readonly signers: readonly Address[];
    readonly attesterConfigurationHash: string;
    readonly integrityHash: string;
}
/** Config digest deliberately excludes observation block and block-bearing deployment digest. Deployment pins are checked separately. */
export declare function circleAttesterConfigurationHash(snapshot: CircleAttesterSnapshot): string;
export declare function verifyCircleAttestationSigners(message: CircleMessage, attestation: Hex, snapshot: CircleAttesterSnapshot): Promise<readonly Address[]>;
export declare function bindCircleAttestation(source: CircleSourceProof, response: unknown, snapshot: CircleAttesterSnapshot): Promise<CircleAttestation>;
export declare function assertCircleAttestation(source: CircleSourceProof, attested: CircleAttestation): void;
export declare function encodeCircleMint(attested: CircleAttestation): Hex;
export declare function decodeCircleDestination(source: CircleSourceProof, attested: CircleAttestation, input: CircleObservation, usedNonceAtomic: string, destinationProfile?: string): {
    sourceTransactionHash: `0x${string}`;
    attestedMessageHash: `0x${string}`;
    nonce: `0x${string}`;
    nonceConsumed: true;
    recipient: `0x${string}`;
    token: `0x${string}`;
    amountAtomic: string;
    transactionHash: Hex;
    blockHash: Hex;
    blockNumberAtomic: string;
    finalityBlockHash: Hex;
    finalityBlockNumberAtomic: string;
    transactionHashBinding: string;
    finalityTag: "included" | "safe" | "finalized";
    receiptHash: string;
    logsHash: string;
    actualFeeAtomic: string;
    kind: "circle_v2_evm_destination";
};
export declare function verifyCircleApproval(input: CircleObservation, reset: boolean, allowanceAtReceiptAtomic: string): CircleReceiptProof;
