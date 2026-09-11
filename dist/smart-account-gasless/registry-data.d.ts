/** Public deployment evidence 747/748; every runtime hash is refreshed at an explicit chain block. */
export declare const SA_BASE_PROTOCOL: {
    readonly manager: {
        readonly address: "0xdb9b1e94b5b69df7e401ddbede43491141047db3";
        readonly codeHash: "0x7c4661fe830df0bb9354f85a6a478882e436b7a234a0cf1f8206ce6753925670";
    };
    readonly value: {
        readonly address: "0x92bf12322527caa612fd31a0e810472bbb106a8f";
        readonly codeHash: "0x825495cede463ecea97c3c6c2bee85d5a4645906e1f0498a9432b39f43cfad19";
    };
    readonly amount: {
        readonly address: "0xf100b0819427117ecf76ed94b358b1a5b5c6d2fc";
        readonly codeHash: "0xa9104d82ccfcdb251f90da0f1b49f36432d574925f72ed4cb97bec5b3a94cd54";
    };
    readonly calldata: {
        readonly address: "0xc2b0d624c1c4319760c96503ba27c347f3260f55";
        readonly codeHash: "0x26a87ea53c698e47fbea2566d50d18964062d0c74bd0baebc60316393461bf84";
    };
    readonly timestamp: {
        readonly address: "0x1046bb45c8d673d4ea75321280db34899413c069";
        readonly codeHash: "0x1da353833766081398664c131a50988f6f7190d6a1a974f497607b974705900c";
    };
    readonly redeemer: {
        readonly address: "0xe144b0b2618071b4e56f746313528a669c7e65c5";
        readonly codeHash: "0x0acea3889e6bab48774ee99ed9ada1b91875bde5a15976330063e91998e84228";
    };
    readonly period: {
        readonly address: "0x474e3ae7e169e940607cc624da8a15eb120139ab";
        readonly codeHash: "0xd9a721435a13aaa562f7e6c7f7d062170a725ffdb7dd7c1e30798194ee9e186c";
    };
    readonly nonce: {
        readonly address: "0xde4f2fac4b3d87a1d9953ca5fc09fca7f366254f";
        readonly codeHash: "0x7bbb80e3cd46e4a1cee4c2cbf712f6de0aa06f9bce616c39e1358210ee023ad8";
    };
    readonly delegate: {
        readonly address: "0x63c0c19a282a1b52b07dd5a65b58948a07dae32b";
        readonly codeHash: "0x6af675ac126c441bec5d5013da3331a52e7465fc0d5a662a8708a9f33ce497ba";
    };
};
export declare const SA_BASE_TOKEN: {
    readonly address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    readonly decimals: 6;
    readonly name: "USD Coin";
    readonly version: "2";
    readonly proxyCodeHash: "0xa6705a10bb756b5dea144591118be77d7af0c3eee3bf2dfe2583dcb0364fefab";
    readonly implementationSlot: "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3";
    readonly implementationAddress: "0x2ce6311ddae708829bc0784c967b7d77d19fd779";
    readonly implementationCodeHash: "0x11b75a237997ab8328f65b2d5a55c10f0346d0a175741ed42ddf4f2c66b9e873";
    readonly domainSeparator: "0x02fa7265e7c5d81118673727957699e4d68f74cd74b7db77da710fe8a2c7834f";
};
export declare const SA_EVIDENCE_SOURCES: Readonly<{
    allowanceDeployment747: "c7b4ca4ff0f006c05a5100082f5d7801efd529138b273c6093d5029ef2e57705";
    nonceDeployment748: "5d3f26e7dd4bb380506f6466dc9890b3ad787ae964480f9ca1d24384e69fad82";
    tokenRegistry: "b05aca1551fafb5734cccc0fe2b51d493782471544d03e63ae267c4b58104972";
}>;
export declare const SA_FACILITATOR_URL = "https://tx-sentinel-base-mainnet.dev-api.cx.metamask.io/platform/v2/x402";
export declare const SA_FACILITATORS: readonly ["0xb4827a2a066cd2ef88560efdf063dd05c6c41cc7"];
