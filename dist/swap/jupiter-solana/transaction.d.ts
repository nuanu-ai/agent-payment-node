import type { SolanaAccountDescriptor, SolanaAccountResolverPort, SolanaAddressTableDescriptor } from "./ports.js";
export interface SolanaAccountBinding extends SolanaAccountDescriptor {
    readonly signer: boolean;
    readonly writable: boolean;
    readonly source: "static" | "lookup";
}
export interface SolanaInstructionEnvelope {
    readonly programId: string;
    readonly accounts: readonly SolanaAccountBinding[];
    readonly data: Uint8Array;
}
export interface JupiterV0Envelope {
    readonly transactionBase64: string;
    readonly transactionHash: string;
    readonly messageHash: string;
    readonly blockhash: string;
    readonly signerCount: number;
    readonly feePayer: string;
    readonly accounts: readonly SolanaAccountBinding[];
    readonly addressTables: readonly SolanaAddressTableDescriptor[];
    readonly lookupBindingDigest: string;
    readonly loadedWritable: readonly string[];
    readonly loadedReadonly: readonly string[];
    readonly instructions: readonly SolanaInstructionEnvelope[];
}
export declare function parseJupiterV0Envelope(transactionBase64: string, resolver: SolanaAccountResolverPort): Promise<JupiterV0Envelope>;
