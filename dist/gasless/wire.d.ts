import type { Address, Hex } from "../model.js";
import type { GaslessBootstrapMaterial } from "./ports.js";
import type { GaslessIntent, GaslessUserOperation } from "./model.js";
export declare function gaslessBatch(token: Address, recipient: Address, recipientAtomic: string, paymaster: Address): Hex;
export declare function validateGaslessBatch(intent: GaslessIntent): void;
export declare function gaslessPermitTypedData(intent: GaslessIntent): {
    readonly domain: {
        readonly name: "USDC" | "USD Coin";
        readonly version: "2";
        readonly chainId: import("./model.js").GaslessChainId;
        readonly verifyingContract: `0x${string}`;
    };
    readonly types: {
        readonly Permit: readonly [{
            readonly name: "owner";
            readonly type: "address";
        }, {
            readonly name: "spender";
            readonly type: "address";
        }, {
            readonly name: "value";
            readonly type: "uint256";
        }, {
            readonly name: "nonce";
            readonly type: "uint256";
        }, {
            readonly name: "deadline";
            readonly type: "uint256";
        }];
    };
    readonly primaryType: "Permit";
    readonly message: {
        readonly owner: `0x${string}`;
        readonly spender: `0x${string}`;
        readonly value: bigint;
        readonly nonce: bigint;
        readonly deadline: bigint;
    };
};
export declare function gaslessAuthorizationRequest(intent: GaslessIntent): {
    readonly chainId: import("./model.js").GaslessChainId;
    readonly address: `0x${string}`;
    readonly nonce: number;
};
export declare function gaslessUserOperation(intent: GaslessIntent, bootstrap: Pick<GaslessBootstrapMaterial, "permitSignature" | "authorization">, signature: Hex): GaslessUserOperation;
export declare function gaslessUserOperationTypedData(intent: GaslessIntent, wire: GaslessUserOperation): {
    readonly types: {
        readonly PackedUserOperation: readonly [{
            readonly type: "address";
            readonly name: "sender";
        }, {
            readonly type: "uint256";
            readonly name: "nonce";
        }, {
            readonly type: "bytes";
            readonly name: "initCode";
        }, {
            readonly type: "bytes";
            readonly name: "callData";
        }, {
            readonly type: "bytes32";
            readonly name: "accountGasLimits";
        }, {
            readonly type: "uint256";
            readonly name: "preVerificationGas";
        }, {
            readonly type: "bytes32";
            readonly name: "gasFees";
        }, {
            readonly type: "bytes";
            readonly name: "paymasterAndData";
        }];
    };
    readonly primaryType: "PackedUserOperation";
    readonly domain: {
        readonly name: "ERC4337";
        readonly version: "1";
        readonly chainId: import("./model.js").GaslessChainId;
        readonly verifyingContract: `0x${string}`;
    };
    readonly message: {
        readonly sender: `0x${string}`;
        readonly nonce: bigint;
        readonly initCode: `0x${string}`;
        readonly callData: `0x${string}`;
        readonly accountGasLimits: `0x${string}`;
        readonly preVerificationGas: bigint;
        readonly gasFees: `0x${string}`;
        readonly paymasterAndData: Hex;
    };
};
export declare function gaslessUserOperationHash(intent: GaslessIntent, wire: GaslessUserOperation): Hex;
export declare function validateGaslessWire(intent: GaslessIntent, value: unknown): GaslessUserOperation;
export declare function gaslessEnvelopeBinding(intent: Omit<GaslessIntent, "unsignedEnvelopeHash"> | GaslessIntent): unknown;
