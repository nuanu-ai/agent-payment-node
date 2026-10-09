/** eth_call uint256 return DATA is one ABI word, not a JSON-RPC QUANTITY. */
export function gaszipOracleUint256(value, refuse) {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value))
        return refuse("oracle_uint256_data");
    return BigInt(value);
}
//# sourceMappingURL=gaszip-oracle-data.js.map