import type { Address, Hex } from "../model.js";
import type { BridgeLog } from "./model.js";
import { type NearTronOfflineBinding } from "./near-tron-offline.js";
export declare const nearSourceEventsAbi: readonly [{
    readonly name: "NEARIntentsBridgeStarted";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "transactionId";
        readonly indexed: true;
    }, {
        readonly type: "bytes32";
        readonly name: "quoteId";
        readonly indexed: true;
    }, {
        readonly type: "address";
        readonly name: "depositAddress";
        readonly indexed: true;
    }, {
        readonly type: "address";
        readonly name: "sendingAssetId";
    }, {
        readonly type: "uint256";
        readonly name: "amount";
    }, {
        readonly type: "uint256";
        readonly name: "deadline";
    }, {
        readonly type: "uint256";
        readonly name: "minAmountOut";
    }];
}, {
    readonly name: "BridgeToNonEVMChainBytes32";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "transactionId";
        readonly indexed: true;
    }, {
        readonly type: "uint256";
        readonly name: "destinationChainId";
        readonly indexed: true;
    }, {
        readonly type: "bytes32";
        readonly name: "receiver";
    }];
}, {
    readonly name: "LiFiTransferStarted";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "tuple";
        readonly components: readonly [{
            readonly type: "bytes32";
            readonly name: "transactionId";
        }, {
            readonly type: "string";
            readonly name: "bridge";
        }, {
            readonly type: "string";
            readonly name: "integrator";
        }, {
            readonly type: "address";
            readonly name: "referrer";
        }, {
            readonly type: "address";
            readonly name: "sendingAssetId";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "uint256";
            readonly name: "minAmount";
        }, {
            readonly type: "uint256";
            readonly name: "destinationChainId";
        }, {
            readonly type: "bool";
            readonly name: "hasSourceSwaps";
        }, {
            readonly type: "bool";
            readonly name: "hasDestinationCall";
        }];
        readonly name: "bridgeData";
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
}];
export interface NearSourceTransaction {
    readonly chainId: 8453;
    readonly hash: Hex;
    readonly from: Address;
    readonly to: Address;
    readonly input: Hex;
    readonly valueAtomic: string;
}
/** Membership and finality must be verified by the caller's RPC adapter. */
export interface NearSafeSourceReceipt {
    readonly chainId: 8453;
    readonly transactionHash: Hex;
    readonly status: "success";
    readonly blockNumberAtomic: string;
    readonly blockHash: Hex;
    readonly safe: true;
    readonly logs: readonly BridgeLog[];
}
export interface NearTronSourceDepositCandidate {
    readonly kind: "offline_near_tron_source_deposit_candidate";
    readonly executionAdmitted: false;
    readonly bridgeCompletion: false;
    readonly recipientDelivery: "unverified";
    readonly status: "unverified";
    readonly chainId: 8453;
    readonly transactionHash: Hex;
    readonly blockNumberAtomic: string;
    readonly blockHash: Hex;
    readonly logsHash: string;
    readonly transactionId: Hex;
    readonly quoteId: Hex;
    readonly depositAddress: Address;
    readonly sourceToken: Address;
    readonly bridgeAmountAtomic: string;
    readonly facetMinimumOutputAtomic: string;
    readonly tronRecipient: string;
    readonly facetNonEvmReceiver: Hex;
    readonly quotedDestinationToken: string;
    readonly minimumOutputAtomic: string;
    readonly refundTo: Address;
}
export declare function inspectNearBaseTronSourceReceiptOffline(frozenQuote: unknown, binding: NearTronOfflineBinding, tx: NearSourceTransaction, receipt: NearSafeSourceReceipt): NearTronSourceDepositCandidate;
