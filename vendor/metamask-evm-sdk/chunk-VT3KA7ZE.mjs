import { createRequire as __apnSdkCreateRequire, isBuiltin as __apnSdkIsBuiltin } from "node:module"; const __apnSdkRequire = __apnSdkCreateRequire(import.meta.url); const require = (name) => { if (typeof name !== "string" || !__apnSdkIsBuiltin(name)) throw new Error("APN SDK refuses non-builtin dynamic require"); return __apnSdkRequire(name); };
import {
  C,
  D,
  H,
  K,
  N,
  T,
  U,
  V,
  a,
  c,
  c2,
  d,
  h,
  i,
  m,
  ne,
  p,
  s,
  x,
  y,
  z
} from "./chunk-YOJA2JWO.mjs";
import {
  require_classPrivateFieldInitSpec,
  require_deep_freeze_strict,
  require_lib as require_lib2,
  require_lib2 as require_lib3,
  require_lib3 as require_lib4,
  require_lib4 as require_lib5,
  require_lib5 as require_lib6,
  require_lib6 as require_lib7,
  require_objectWithoutProperties,
  require_once,
  require_ours
} from "./chunk-XUIZAIKJ.mjs";
import {
  require_defineProperty,
  require_json_stable_stringify,
  require_lib4 as require_lib,
  require_objectSpread2
} from "./chunk-KARUJRYC.mjs";
import {
  require_loglevel
} from "./chunk-OJOIMBBT.mjs";
import {
  HashMD,
  hmac,
  mod,
  secp256k1,
  sha256,
  sha512
} from "./chunk-D6DBKKWT.mjs";
import {
  AbiDecodingDataSizeTooSmallError,
  AbiDecodingZeroDataError,
  AbiEventNotFoundError,
  AbiEventSignatureEmptyTopicsError,
  AbiEventSignatureNotFoundError,
  AtomicReadyWalletRejectedUpgradeError,
  AtomicityNotSupportedError,
  BaseError,
  BaseError2,
  BundleTooLargeError,
  BytesSizeMismatchError,
  CallExecutionError,
  ChainDisconnectedError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  DecodeLogDataMismatch,
  DecodeLogTopicsMismatch,
  DuplicateIdError,
  FeeCapTooHighError,
  HttpRequestError,
  IntegerOutOfRangeError,
  InternalRpcError,
  InvalidAddressError,
  InvalidChainIdError,
  InvalidHexValueError,
  InvalidInputRpcError,
  InvalidLegacyVError,
  InvalidParamsRpcError,
  InvalidRequestRpcError,
  InvalidSerializableTransactionError,
  InvalidSerializedTransactionError,
  InvalidSerializedTransactionTypeError,
  InvalidStorageKeySizeError,
  JsonRpcVersionUnsupportedError,
  LimitExceededRpcError,
  LruMap,
  MethodNotFoundRpcError,
  MethodNotSupportedRpcError,
  ParseRpcError,
  PositionOutOfBoundsError,
  ProviderDisconnectedError,
  RawContractError,
  ResourceNotFoundRpcError,
  ResourceUnavailableRpcError,
  RpcRequestError,
  SwitchChainError,
  TipAboveFeeCapError,
  TransactionExecutionError,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  TransactionReceiptRevertedError,
  TransactionRejectedRpcError,
  UnauthorizedProviderError,
  UnknownBundleIdError,
  UnknownNodeError,
  UnknownRpcError,
  UnsupportedChainIdError,
  UnsupportedNonOptionalCapabilityError,
  UnsupportedProviderMethodError,
  UserRejectedRequestError,
  WaitForTransactionReceiptTimeoutError,
  WalletConnectSessionSettlementError,
  addressResolverAbi,
  assertRequest,
  bytesRegex,
  bytesToHex,
  call,
  checksumAddress,
  concat,
  concat2,
  concatHex,
  createCursor,
  decodeAbiParameters,
  decodeFunctionResult,
  deploylessCallViaBytecodeBytecode,
  encodeAbiParameters,
  encodeDeployData,
  encodeFunctionData,
  erc1271Abi,
  erc6492SignatureValidatorAbi,
  erc6492SignatureValidatorByteCode,
  extract,
  formatAbiItem,
  formatBlockParameter,
  formatEther,
  formatGwei,
  formatTransactionRequest,
  formatUnits,
  from,
  from2,
  fromBoolean,
  fromBytes,
  fromHex,
  fromNumber,
  fromString,
  fromString2,
  getAbiItem,
  getAbortError,
  getAddress,
  getCallError,
  getChainContractAddress,
  getNodeError,
  hexToBigInt,
  hexToBool,
  hexToBytes,
  hexToNumber,
  integerRegex,
  isAbortError,
  isAddress,
  isAddressEqual,
  isHex,
  keccak256,
  localBatchGatewayUrl,
  maxUint256,
  multicall3Abi,
  multicall3Bytecode,
  numberToHex,
  padHex,
  padLeft,
  padRight,
  parseAccount,
  prettyPrint,
  serializeStateOverride,
  size,
  size2,
  size3,
  slice,
  slice2,
  slice3,
  sliceHex,
  stringToBytes,
  stringToHex,
  stringify,
  stringify2,
  textResolverAbi,
  toBigInt,
  toBoolean,
  toBytes,
  toEventSelector,
  toHex,
  toNumber,
  toNumber2,
  toRpc,
  toString,
  trim,
  trimLeft,
  trimLeft2,
  universalResolverResolveAbi,
  universalResolverReverseAbi,
  validate,
  validate2,
  withResolvers
} from "./chunk-VXZBS4XQ.mjs";
import {
  keccak_256
} from "./chunk-YZGUBLTF.mjs";
import {
  abytes,
  ahash,
  anumber,
  bytesToHex as bytesToHex2,
  checkOpts,
  clean,
  concatBytes,
  createHasher,
  createView,
  hexToBytes as hexToBytes2,
  kdfInputToBytes,
  rotl,
  utf8ToBytes
} from "./chunk-PL6MZGBX.mjs";
import {
  __export,
  __reExport,
  __toESM
} from "./chunk-UST3XQO6.mjs";

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/getAction.js
function getAction(client, actionFn, name) {
  const action_implicit = client[actionFn.name];
  if (typeof action_implicit === "function")
    return action_implicit;
  const action_explicit = client[name];
  if (typeof action_explicit === "function")
    return action_explicit;
  return (params) => actionFn(client, params);
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/errors/log.js
var FilterTypeNotSupportedError = class extends BaseError {
  constructor(type) {
    super(`Filter type "${type}" is not supported.`, {
      name: "FilterTypeNotSupportedError"
    });
  }
};

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/abi/encodeEventTopics.js
var docsPath = "/docs/contract/encodeEventTopics";
function encodeEventTopics(parameters) {
  const { abi: abi2, eventName, args } = parameters;
  let abiItem = abi2[0];
  if (eventName) {
    const item = getAbiItem({ abi: abi2, name: eventName });
    if (!item)
      throw new AbiEventNotFoundError(eventName, { docsPath });
    abiItem = item;
  }
  if (abiItem.type !== "event")
    throw new AbiEventNotFoundError(void 0, { docsPath });
  let topics = [];
  if (args && "inputs" in abiItem) {
    const indexedInputs = abiItem.inputs?.filter((param) => "indexed" in param && param.indexed);
    const args_ = Array.isArray(args) ? args : Object.values(args).length > 0 ? indexedInputs?.map((x2) => args[x2.name]) ?? [] : [];
    if (args_.length > 0) {
      topics = indexedInputs?.map((param, i2) => {
        if (Array.isArray(args_[i2]))
          return args_[i2].map((_2, j2) => encodeArg({ param, value: args_[i2][j2] }));
        return typeof args_[i2] !== "undefined" && args_[i2] !== null ? encodeArg({ param, value: args_[i2] }) : null;
      }) ?? [];
    }
  }
  if (abiItem.anonymous)
    return topics;
  const definition = formatAbiItem(abiItem);
  const signature = toEventSelector(definition);
  return [signature, ...topics];
}
function encodeArg({ param, value }) {
  if (param.type === "string" || param.type === "bytes")
    return keccak256(toBytes(value));
  if (param.type === "tuple" || param.type.match(/^(.*)\[(\d+)?\]$/))
    throw new FilterTypeNotSupportedError(param.type);
  return encodeAbiParameters([param], [value]);
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/filters/createFilterRequestScope.js
function createFilterRequestScope(client, { method }) {
  const requestMap = {};
  if (client.transport.type === "fallback")
    client.transport.onResponse?.(({ method: method_, response: id, status, transport }) => {
      if (status === "success" && method === method_)
        requestMap[id] = transport.request;
    });
  return ((id) => requestMap[id] || client.request);
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/createContractEventFilter.js
async function createContractEventFilter(client, parameters) {
  const { address, abi: abi2, args, eventName, fromBlock, strict, toBlock } = parameters;
  const getRequest = createFilterRequestScope(client, {
    method: "eth_newFilter"
  });
  const topics = eventName ? encodeEventTopics({
    abi: abi2,
    args,
    eventName
  }) : void 0;
  const id = await client.request({
    method: "eth_newFilter",
    params: [
      {
        address,
        fromBlock: typeof fromBlock === "bigint" ? numberToHex(fromBlock) : fromBlock,
        toBlock: typeof toBlock === "bigint" ? numberToHex(toBlock) : toBlock,
        topics
      }
    ]
  });
  return {
    abi: abi2,
    args,
    eventName,
    id,
    request: getRequest(id),
    strict: Boolean(strict),
    type: "event"
  };
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/errors/getContractError.js
var EXECUTION_REVERTED_ERROR_CODE = 3;
function getContractError(err, { abi: abi2, address, args, docsPath: docsPath3, functionName, sender }) {
  const error = err instanceof RawContractError ? err : err instanceof BaseError ? err.walk((err2) => "data" in err2) || err.walk() : {};
  const { code, data, details, message, shortMessage } = error;
  const cause = (() => {
    if (err instanceof AbiDecodingZeroDataError)
      return new ContractFunctionZeroDataError({ functionName, cause: err });
    if ([EXECUTION_REVERTED_ERROR_CODE, InternalRpcError.code].includes(code) && (data || details || message || shortMessage) || code === InvalidInputRpcError.code && details === "execution reverted" && data) {
      return new ContractFunctionRevertedError({
        abi: abi2,
        data: typeof data === "object" ? data.data : data,
        functionName,
        message: error instanceof RpcRequestError ? details : shortMessage ?? message,
        cause: err
      });
    }
    return err;
  })();
  return new ContractFunctionExecutionError(cause, {
    abi: abi2,
    args,
    contractAddress: address,
    docsPath: docsPath3,
    functionName,
    sender
  });
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/accounts/utils/publicKeyToAddress.js
function publicKeyToAddress(publicKey) {
  const address = keccak256(`0x${publicKey.substring(4)}`).substring(26);
  return checksumAddress(`0x${address}`);
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/signature/recoverPublicKey.js
async function recoverPublicKey({ hash: hash2, signature }) {
  const hashHex = isHex(hash2) ? hash2 : toHex(hash2);
  const { secp256k1: secp256k13 } = await import("./secp256k1-JKIM6I6Q.mjs");
  const signature_ = (() => {
    if (typeof signature === "object" && "r" in signature && "s" in signature) {
      const { r, s: s2, v, yParity } = signature;
      const yParityOrV2 = Number(yParity ?? v);
      const recoveryBit2 = toRecoveryBit(yParityOrV2);
      return new secp256k13.Signature(hexToBigInt(r), hexToBigInt(s2)).addRecoveryBit(recoveryBit2);
    }
    const signatureHex = isHex(signature) ? signature : toHex(signature);
    if (size(signatureHex) !== 65)
      throw new Error("invalid signature length");
    const yParityOrV = hexToNumber(`0x${signatureHex.slice(130)}`);
    const recoveryBit = toRecoveryBit(yParityOrV);
    return secp256k13.Signature.fromCompact(signatureHex.substring(2, 130)).addRecoveryBit(recoveryBit);
  })();
  const publicKey = signature_.recoverPublicKey(hashHex.substring(2)).toHex(false);
  return `0x${publicKey}`;
}
function toRecoveryBit(yParityOrV) {
  if (yParityOrV === 0 || yParityOrV === 1)
    return yParityOrV;
  if (yParityOrV === 27)
    return 0;
  if (yParityOrV === 28)
    return 1;
  throw new Error("Invalid yParityOrV value");
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/signature/recoverAddress.js
async function recoverAddress({ hash: hash2, signature }) {
  return publicKeyToAddress(await recoverPublicKey({ hash: hash2, signature }));
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/encoding/toRlp.js
function toRlp(bytes, to = "hex") {
  const encodable = getEncodable(bytes);
  const cursor = createCursor(new Uint8Array(encodable.length));
  encodable.encode(cursor);
  if (to === "hex")
    return bytesToHex(cursor.bytes);
  return cursor.bytes;
}
function getEncodable(bytes) {
  if (Array.isArray(bytes))
    return getEncodableList(bytes.map((x2) => getEncodable(x2)));
  return getEncodableBytes(bytes);
}
function getEncodableList(list) {
  const bodyLength = list.reduce((acc, x2) => acc + x2.length, 0);
  const sizeOfBodyLength = getSizeOfLength(bodyLength);
  const length = (() => {
    if (bodyLength <= 55)
      return 1 + bodyLength;
    return 1 + sizeOfBodyLength + bodyLength;
  })();
  return {
    length,
    encode(cursor) {
      if (bodyLength <= 55) {
        cursor.pushByte(192 + bodyLength);
      } else {
        cursor.pushByte(192 + 55 + sizeOfBodyLength);
        if (sizeOfBodyLength === 1)
          cursor.pushUint8(bodyLength);
        else if (sizeOfBodyLength === 2)
          cursor.pushUint16(bodyLength);
        else if (sizeOfBodyLength === 3)
          cursor.pushUint24(bodyLength);
        else
          cursor.pushUint32(bodyLength);
      }
      for (const { encode: encode4 } of list) {
        encode4(cursor);
      }
    }
  };
}
function getEncodableBytes(bytesOrHex) {
  const bytes = typeof bytesOrHex === "string" ? hexToBytes(bytesOrHex) : bytesOrHex;
  const sizeOfBytesLength = getSizeOfLength(bytes.length);
  const length = (() => {
    if (bytes.length === 1 && bytes[0] < 128)
      return 1;
    if (bytes.length <= 55)
      return 1 + bytes.length;
    return 1 + sizeOfBytesLength + bytes.length;
  })();
  return {
    length,
    encode(cursor) {
      if (bytes.length === 1 && bytes[0] < 128) {
        cursor.pushBytes(bytes);
      } else if (bytes.length <= 55) {
        cursor.pushByte(128 + bytes.length);
        cursor.pushBytes(bytes);
      } else {
        cursor.pushByte(128 + 55 + sizeOfBytesLength);
        if (sizeOfBytesLength === 1)
          cursor.pushUint8(bytes.length);
        else if (sizeOfBytesLength === 2)
          cursor.pushUint16(bytes.length);
        else if (sizeOfBytesLength === 3)
          cursor.pushUint24(bytes.length);
        else
          cursor.pushUint32(bytes.length);
        cursor.pushBytes(bytes);
      }
    }
  };
}
function getSizeOfLength(length) {
  if (length < 2 ** 8)
    return 1;
  if (length < 2 ** 16)
    return 2;
  if (length < 2 ** 24)
    return 3;
  if (length < 2 ** 32)
    return 4;
  throw new BaseError("Length is too large.");
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/authorization/hashAuthorization.js
function hashAuthorization(parameters) {
  const { chainId, nonce, to } = parameters;
  const address = parameters.contractAddress ?? parameters.address;
  const hash2 = keccak256(concatHex([
    "0x05",
    toRlp([
      chainId ? numberToHex(chainId) : "0x",
      address,
      nonce ? numberToHex(nonce) : "0x"
    ])
  ]));
  if (to === "bytes")
    return hexToBytes(hash2);
  return hash2;
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/authorization/recoverAuthorizationAddress.js
async function recoverAuthorizationAddress(parameters) {
  const { authorization, signature } = parameters;
  return recoverAddress({
    hash: hashAuthorization(authorization),
    signature: signature ?? authorization
  });
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/errors/estimateGas.js
var EstimateGasExecutionError = class extends BaseError {
  constructor(cause, { account, docsPath: docsPath3, chain: chain2, data, gas, gasPrice, maxFeePerGas, maxPriorityFeePerGas, nonce, to, value }) {
    const prettyArgs = prettyPrint({
      from: account?.address,
      to,
      value: typeof value !== "undefined" && `${formatEther(value)} ${chain2?.nativeCurrency?.symbol || "ETH"}`,
      data,
      gas,
      gasPrice: typeof gasPrice !== "undefined" && `${formatGwei(gasPrice)} gwei`,
      maxFeePerGas: typeof maxFeePerGas !== "undefined" && `${formatGwei(maxFeePerGas)} gwei`,
      maxPriorityFeePerGas: typeof maxPriorityFeePerGas !== "undefined" && `${formatGwei(maxPriorityFeePerGas)} gwei`,
      nonce
    });
    super(cause.shortMessage, {
      cause,
      docsPath: docsPath3,
      metaMessages: [
        ...cause.metaMessages ? [...cause.metaMessages, " "] : [],
        "Estimate Gas Arguments:",
        prettyArgs
      ].filter(Boolean),
      name: "EstimateGasExecutionError"
    });
    Object.defineProperty(this, "cause", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    this.cause = cause;
  }
};

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/errors/getEstimateGasError.js
function getEstimateGasError(err, { docsPath: docsPath3, ...args }) {
  const cause = (() => {
    const cause2 = getNodeError(err, args);
    if (cause2 instanceof UnknownNodeError)
      return err;
    return cause2;
  })();
  return new EstimateGasExecutionError(cause, {
    docsPath: docsPath3,
    ...args
  });
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/errors/fee.js
var BaseFeeScalarError = class extends BaseError {
  constructor() {
    super("`baseFeeMultiplier` must be greater than 1.", {
      name: "BaseFeeScalarError"
    });
  }
};
var Eip1559FeesNotSupportedError = class extends BaseError {
  constructor() {
    super("Chain does not support EIP-1559 fees.", {
      name: "Eip1559FeesNotSupportedError"
    });
  }
};
var MaxFeePerGasTooLowError = class extends BaseError {
  constructor({ maxPriorityFeePerGas }) {
    super(`\`maxFeePerGas\` cannot be less than the \`maxPriorityFeePerGas\` (${formatGwei(maxPriorityFeePerGas)} gwei).`, { name: "MaxFeePerGasTooLowError" });
  }
};

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/errors/block.js
var BlockNotFoundError = class extends BaseError {
  constructor({ blockHash, blockNumber }) {
    let identifier = "Block";
    if (blockHash)
      identifier = `Block at hash "${blockHash}"`;
    if (blockNumber)
      identifier = `Block at number "${blockNumber}"`;
    super(`${identifier} could not be found.`, { name: "BlockNotFoundError" });
  }
};

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/formatters/transaction.js
var transactionType = {
  "0x0": "legacy",
  "0x1": "eip2930",
  "0x2": "eip1559",
  "0x3": "eip4844",
  "0x4": "eip7702"
};
function formatTransaction(transaction, _2) {
  const transaction_ = {
    ...transaction,
    blockHash: transaction.blockHash ? transaction.blockHash : null,
    blockNumber: transaction.blockNumber ? BigInt(transaction.blockNumber) : null,
    ...transaction.blockTimestamp != null && {
      blockTimestamp: BigInt(transaction.blockTimestamp)
    },
    chainId: transaction.chainId ? hexToNumber(transaction.chainId) : void 0,
    gas: transaction.gas ? BigInt(transaction.gas) : void 0,
    gasPrice: transaction.gasPrice ? BigInt(transaction.gasPrice) : void 0,
    maxFeePerBlobGas: transaction.maxFeePerBlobGas ? BigInt(transaction.maxFeePerBlobGas) : void 0,
    maxFeePerGas: transaction.maxFeePerGas ? BigInt(transaction.maxFeePerGas) : void 0,
    maxPriorityFeePerGas: transaction.maxPriorityFeePerGas ? BigInt(transaction.maxPriorityFeePerGas) : void 0,
    nonce: transaction.nonce ? hexToNumber(transaction.nonce) : void 0,
    to: transaction.to ? transaction.to : null,
    transactionIndex: transaction.transactionIndex ? Number(transaction.transactionIndex) : null,
    type: transaction.type ? transactionType[transaction.type] : void 0,
    typeHex: transaction.type ? transaction.type : void 0,
    value: transaction.value ? BigInt(transaction.value) : void 0,
    v: transaction.v ? BigInt(transaction.v) : void 0
  };
  if (transaction.authorizationList)
    transaction_.authorizationList = formatAuthorizationList(transaction.authorizationList);
  transaction_.yParity = (() => {
    if (transaction.yParity)
      return Number(transaction.yParity);
    if (typeof transaction_.v === "bigint") {
      if (transaction_.v === 0n || transaction_.v === 27n)
        return 0;
      if (transaction_.v === 1n || transaction_.v === 28n)
        return 1;
      if (transaction_.v >= 35n)
        return transaction_.v % 2n === 0n ? 1 : 0;
    }
    return void 0;
  })();
  if (transaction_.type === "legacy") {
    delete transaction_.accessList;
    delete transaction_.maxFeePerBlobGas;
    delete transaction_.maxFeePerGas;
    delete transaction_.maxPriorityFeePerGas;
    delete transaction_.yParity;
  }
  if (transaction_.type === "eip2930") {
    delete transaction_.maxFeePerBlobGas;
    delete transaction_.maxFeePerGas;
    delete transaction_.maxPriorityFeePerGas;
  }
  if (transaction_.type === "eip1559")
    delete transaction_.maxFeePerBlobGas;
  return transaction_;
}
function formatAuthorizationList(authorizationList) {
  return authorizationList.map((authorization) => ({
    address: authorization.address,
    chainId: Number(authorization.chainId),
    nonce: Number(authorization.nonce),
    r: authorization.r,
    s: authorization.s,
    yParity: Number(authorization.yParity)
  }));
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/formatters/block.js
function formatBlock(block, _2) {
  const transactions = (block.transactions ?? []).map((transaction) => {
    if (typeof transaction === "string")
      return transaction;
    return formatTransaction(transaction);
  });
  return {
    ...block,
    baseFeePerGas: block.baseFeePerGas ? BigInt(block.baseFeePerGas) : null,
    blobGasUsed: block.blobGasUsed ? BigInt(block.blobGasUsed) : void 0,
    difficulty: block.difficulty ? BigInt(block.difficulty) : void 0,
    excessBlobGas: block.excessBlobGas ? BigInt(block.excessBlobGas) : void 0,
    gasLimit: block.gasLimit ? BigInt(block.gasLimit) : void 0,
    gasUsed: block.gasUsed ? BigInt(block.gasUsed) : void 0,
    hash: block.hash ? block.hash : null,
    logsBloom: block.logsBloom ? block.logsBloom : null,
    nonce: block.nonce ? block.nonce : null,
    number: block.number ? BigInt(block.number) : null,
    size: block.size ? BigInt(block.size) : void 0,
    timestamp: block.timestamp ? BigInt(block.timestamp) : void 0,
    transactions,
    totalDifficulty: block.totalDifficulty ? BigInt(block.totalDifficulty) : null
  };
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/getBlock.js
async function getBlock(client, { blockHash, blockNumber, blockTag = client.experimental_blockTag ?? "latest", includeTransactions: includeTransactions_ } = {}) {
  const includeTransactions = includeTransactions_ ?? false;
  const blockNumberHex = blockNumber !== void 0 ? numberToHex(blockNumber) : void 0;
  let block = null;
  if (blockHash) {
    block = await client.request({
      method: "eth_getBlockByHash",
      params: [blockHash, includeTransactions]
    }, { dedupe: true });
  } else {
    block = await client.request({
      method: "eth_getBlockByNumber",
      params: [blockNumberHex || blockTag, includeTransactions]
    }, { dedupe: Boolean(blockNumberHex) });
  }
  if (!block)
    throw new BlockNotFoundError({ blockHash, blockNumber });
  const format = client.chain?.formatters?.block?.format || formatBlock;
  return format(block, "getBlock");
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/getGasPrice.js
async function getGasPrice(client) {
  const gasPrice = await client.request({
    method: "eth_gasPrice"
  });
  return BigInt(gasPrice);
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/estimateMaxPriorityFeePerGas.js
async function estimateMaxPriorityFeePerGas(client, args) {
  return internal_estimateMaxPriorityFeePerGas(client, args);
}
async function internal_estimateMaxPriorityFeePerGas(client, args) {
  const { block: block_, chain: chain2 = client.chain, request } = args || {};
  try {
    const maxPriorityFeePerGas = chain2?.fees?.maxPriorityFeePerGas ?? chain2?.fees?.defaultPriorityFee;
    if (typeof maxPriorityFeePerGas === "function") {
      const block = block_ || await getAction(client, getBlock, "getBlock")({});
      const maxPriorityFeePerGas_ = await maxPriorityFeePerGas({
        block,
        client,
        request
      });
      if (maxPriorityFeePerGas_ === null)
        throw new Error();
      return maxPriorityFeePerGas_;
    }
    if (typeof maxPriorityFeePerGas !== "undefined")
      return maxPriorityFeePerGas;
    const maxPriorityFeePerGasHex = await client.request({
      method: "eth_maxPriorityFeePerGas"
    });
    return hexToBigInt(maxPriorityFeePerGasHex);
  } catch {
    const [block, gasPrice] = await Promise.all([
      block_ ? Promise.resolve(block_) : getAction(client, getBlock, "getBlock")({}),
      getAction(client, getGasPrice, "getGasPrice")({})
    ]);
    if (typeof block.baseFeePerGas !== "bigint")
      throw new Eip1559FeesNotSupportedError();
    const maxPriorityFeePerGas = gasPrice - block.baseFeePerGas;
    if (maxPriorityFeePerGas < 0n)
      return 0n;
    return maxPriorityFeePerGas;
  }
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/estimateFeesPerGas.js
async function estimateFeesPerGas(client, args) {
  return internal_estimateFeesPerGas(client, args);
}
async function internal_estimateFeesPerGas(client, args) {
  const { block: block_, chain: chain2 = client.chain, request, type = "eip1559" } = args || {};
  const baseFeeMultiplier = await (async () => {
    if (typeof chain2?.fees?.baseFeeMultiplier === "function")
      return chain2.fees.baseFeeMultiplier({
        block: block_,
        client,
        request
      });
    return chain2?.fees?.baseFeeMultiplier ?? 1.2;
  })();
  if (baseFeeMultiplier < 1)
    throw new BaseFeeScalarError();
  const decimals = baseFeeMultiplier.toString().split(".")[1]?.length ?? 0;
  const denominator = 10 ** decimals;
  const multiply = (base) => base * BigInt(Math.ceil(baseFeeMultiplier * denominator)) / BigInt(denominator);
  const block = block_ ? block_ : await getAction(client, getBlock, "getBlock")({});
  if (typeof chain2?.fees?.estimateFeesPerGas === "function") {
    const fees = await chain2.fees.estimateFeesPerGas({
      block: block_,
      client,
      multiply,
      request,
      type
    });
    if (fees !== null)
      return fees;
  }
  if (type === "eip1559") {
    if (typeof block.baseFeePerGas !== "bigint")
      throw new Eip1559FeesNotSupportedError();
    const maxPriorityFeePerGas = typeof request?.maxPriorityFeePerGas === "bigint" ? request.maxPriorityFeePerGas : await internal_estimateMaxPriorityFeePerGas(client, {
      block,
      chain: chain2,
      request
    });
    const baseFeePerGas = multiply(block.baseFeePerGas);
    const maxFeePerGas = request?.maxFeePerGas ?? baseFeePerGas + maxPriorityFeePerGas;
    return {
      maxFeePerGas,
      maxPriorityFeePerGas
    };
  }
  const gasPrice = request?.gasPrice ?? multiply(await getAction(client, getGasPrice, "getGasPrice")({}));
  return {
    gasPrice
  };
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/getTransactionCount.js
async function getTransactionCount(client, { address, blockHash, blockNumber, blockTag = "latest", requireCanonical }) {
  const block = formatBlockParameter({
    blockHash,
    blockNumber,
    blockTag,
    requireCanonical
  });
  const count = await client.request({
    method: "eth_getTransactionCount",
    params: [address, block]
  }, {
    dedupe: typeof blockNumber === "bigint" || blockHash !== void 0
  });
  return hexToNumber(count);
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/blob/blobsToCommitments.js
function blobsToCommitments(parameters) {
  const { kzg } = parameters;
  const to = parameters.to ?? (typeof parameters.blobs[0] === "string" ? "hex" : "bytes");
  const blobs = typeof parameters.blobs[0] === "string" ? parameters.blobs.map((x2) => hexToBytes(x2)) : parameters.blobs;
  const commitments = [];
  for (const blob of blobs)
    commitments.push(Uint8Array.from(kzg.blobToKzgCommitment(blob)));
  return to === "bytes" ? commitments : commitments.map((x2) => bytesToHex(x2));
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/blob/blobsToProofs.js
function blobsToProofs(parameters) {
  const { kzg } = parameters;
  const to = parameters.to ?? (typeof parameters.blobs[0] === "string" ? "hex" : "bytes");
  const blobs = typeof parameters.blobs[0] === "string" ? parameters.blobs.map((x2) => hexToBytes(x2)) : parameters.blobs;
  const commitments = typeof parameters.commitments[0] === "string" ? parameters.commitments.map((x2) => hexToBytes(x2)) : parameters.commitments;
  const proofs = [];
  for (let i2 = 0; i2 < blobs.length; i2++) {
    const blob = blobs[i2];
    const commitment = commitments[i2];
    proofs.push(Uint8Array.from(kzg.computeBlobKzgProof(blob, commitment)));
  }
  return to === "bytes" ? proofs : proofs.map((x2) => bytesToHex(x2));
}

// node_modules/@noble/hashes/esm/sha256.js
var sha2562 = sha256;

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/hash/sha256.js
function sha2563(value, to_) {
  const to = to_ || "hex";
  const bytes = sha2562(isHex(value, { strict: false }) ? toBytes(value) : value);
  if (to === "bytes")
    return bytes;
  return toHex(bytes);
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/blob/commitmentToVersionedHash.js
function commitmentToVersionedHash(parameters) {
  const { commitment, version: version3 = 1 } = parameters;
  const to = parameters.to ?? (typeof commitment === "string" ? "hex" : "bytes");
  const versionedHash = sha2563(commitment, "bytes");
  versionedHash.set([version3], 0);
  return to === "bytes" ? versionedHash : bytesToHex(versionedHash);
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/blob/commitmentsToVersionedHashes.js
function commitmentsToVersionedHashes(parameters) {
  const { commitments, version: version3 } = parameters;
  const to = parameters.to ?? (typeof commitments[0] === "string" ? "hex" : "bytes");
  const hashes = [];
  for (const commitment of commitments) {
    hashes.push(commitmentToVersionedHash({
      commitment,
      to,
      version: version3
    }));
  }
  return hashes;
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/constants/blob.js
var blobsPerTransaction = 6;
var bytesPerFieldElement = 32;
var fieldElementsPerBlob = 4096;
var bytesPerBlob = bytesPerFieldElement * fieldElementsPerBlob;
var maxBytesPerTransaction = bytesPerBlob * blobsPerTransaction - // terminator byte (0x80).
1 - // zero byte (0x00) appended to each field element.
1 * fieldElementsPerBlob * blobsPerTransaction;

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/constants/kzg.js
var versionedHashVersionKzg = 1;

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/errors/blob.js
var BlobSizeTooLargeError = class extends BaseError {
  constructor({ maxSize, size: size5 }) {
    super("Blob size is too large.", {
      metaMessages: [`Max: ${maxSize} bytes`, `Given: ${size5} bytes`],
      name: "BlobSizeTooLargeError"
    });
  }
};
var EmptyBlobError = class extends BaseError {
  constructor() {
    super("Blob data must not be empty.", { name: "EmptyBlobError" });
  }
};
var InvalidVersionedHashSizeError = class extends BaseError {
  constructor({ hash: hash2, size: size5 }) {
    super(`Versioned hash "${hash2}" size is invalid.`, {
      metaMessages: ["Expected: 32", `Received: ${size5}`],
      name: "InvalidVersionedHashSizeError"
    });
  }
};
var InvalidVersionedHashVersionError = class extends BaseError {
  constructor({ hash: hash2, version: version3 }) {
    super(`Versioned hash "${hash2}" version is invalid.`, {
      metaMessages: [
        `Expected: ${versionedHashVersionKzg}`,
        `Received: ${version3}`
      ],
      name: "InvalidVersionedHashVersionError"
    });
  }
};

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/blob/toBlobs.js
function toBlobs(parameters) {
  const to = parameters.to ?? (typeof parameters.data === "string" ? "hex" : "bytes");
  const data = typeof parameters.data === "string" ? hexToBytes(parameters.data) : parameters.data;
  const size_ = size(data);
  if (!size_)
    throw new EmptyBlobError();
  if (size_ > maxBytesPerTransaction)
    throw new BlobSizeTooLargeError({
      maxSize: maxBytesPerTransaction,
      size: size_
    });
  const blobs = [];
  let active = true;
  let position = 0;
  while (active) {
    const blob = createCursor(new Uint8Array(bytesPerBlob));
    let size5 = 0;
    while (size5 < fieldElementsPerBlob) {
      const bytes = data.slice(position, position + (bytesPerFieldElement - 1));
      blob.pushByte(0);
      blob.pushBytes(bytes);
      if (bytes.length < 31) {
        blob.pushByte(128);
        active = false;
        break;
      }
      size5++;
      position += 31;
    }
    blobs.push(blob);
  }
  return to === "bytes" ? blobs.map((x2) => x2.bytes) : blobs.map((x2) => bytesToHex(x2.bytes));
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/blob/toBlobSidecars.js
function toBlobSidecars(parameters) {
  const { data, kzg, to } = parameters;
  const blobs = parameters.blobs ?? toBlobs({ data, to });
  const commitments = parameters.commitments ?? blobsToCommitments({ blobs, kzg, to });
  const proofs = parameters.proofs ?? blobsToProofs({ blobs, commitments, kzg, to });
  const sidecars = [];
  for (let i2 = 0; i2 < blobs.length; i2++)
    sidecars.push({
      blob: blobs[i2],
      commitment: commitments[i2],
      proof: proofs[i2]
    });
  return sidecars;
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/transaction/getTransactionType.js
function getTransactionType(transaction) {
  if (transaction.type)
    return transaction.type;
  if (typeof transaction.authorizationList !== "undefined")
    return "eip7702";
  if (typeof transaction.blobs !== "undefined" || typeof transaction.blobVersionedHashes !== "undefined" || typeof transaction.maxFeePerBlobGas !== "undefined" || typeof transaction.sidecars !== "undefined")
    return "eip4844";
  if (typeof transaction.maxFeePerGas !== "undefined" || typeof transaction.maxPriorityFeePerGas !== "undefined") {
    return "eip1559";
  }
  if (typeof transaction.gasPrice !== "undefined") {
    if (typeof transaction.accessList !== "undefined")
      return "eip2930";
    return "legacy";
  }
  throw new InvalidSerializableTransactionError({ transaction });
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/errors/getTransactionError.js
function getTransactionError(err, { docsPath: docsPath3, ...args }) {
  const cause = (() => {
    const cause2 = getNodeError(err, args);
    if (cause2 instanceof UnknownNodeError)
      return err;
    return cause2;
  })();
  return new TransactionExecutionError(cause, {
    docsPath: docsPath3,
    ...args
  });
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/getChainId.js
async function getChainId(client) {
  const chainIdHex = await client.request({
    method: "eth_chainId"
  }, { dedupe: true });
  return hexToNumber(chainIdHex);
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/fillTransaction.js
async function fillTransaction(client, parameters) {
  const { account = client.account, accessList, authorizationList, chain: chain2 = client.chain, blobVersionedHashes, blobs, data, gas, gasPrice, maxFeePerBlobGas, maxFeePerGas, maxPriorityFeePerGas, nonce: nonce_, nonceManager, to, type, value, ...rest } = parameters;
  const nonce = await (async () => {
    if (!account)
      return nonce_;
    if (!nonceManager)
      return nonce_;
    if (typeof nonce_ !== "undefined")
      return nonce_;
    const account_ = parseAccount(account);
    const chainId = chain2 ? chain2.id : await getAction(client, getChainId, "getChainId")({});
    return await nonceManager.consume({
      address: account_.address,
      chainId,
      client
    });
  })();
  assertRequest(parameters);
  const chainFormat = chain2?.formatters?.transactionRequest?.format;
  const format = chainFormat || formatTransactionRequest;
  const request = format({
    // Pick out extra data that might exist on the chain's transaction request type.
    ...extract(rest, { format: chainFormat }),
    account: account ? parseAccount(account) : void 0,
    accessList,
    authorizationList,
    blobs,
    blobVersionedHashes,
    data,
    gas,
    gasPrice,
    maxFeePerBlobGas,
    maxFeePerGas,
    maxPriorityFeePerGas,
    nonce,
    to,
    type,
    value
  }, "fillTransaction");
  try {
    const response = await client.request({
      method: "eth_fillTransaction",
      params: [request]
    });
    const format2 = chain2?.formatters?.transaction?.format || formatTransaction;
    const transaction = format2(response.tx);
    delete transaction.blockHash;
    delete transaction.blockNumber;
    delete transaction.r;
    delete transaction.s;
    delete transaction.transactionIndex;
    delete transaction.v;
    delete transaction.yParity;
    transaction.data = transaction.input;
    if (transaction.gas)
      transaction.gas = parameters.gas ?? transaction.gas;
    if (transaction.gasPrice)
      transaction.gasPrice = parameters.gasPrice ?? transaction.gasPrice;
    if (transaction.maxFeePerBlobGas)
      transaction.maxFeePerBlobGas = parameters.maxFeePerBlobGas ?? transaction.maxFeePerBlobGas;
    if (transaction.maxFeePerGas)
      transaction.maxFeePerGas = parameters.maxFeePerGas ?? transaction.maxFeePerGas;
    if (transaction.maxPriorityFeePerGas)
      transaction.maxPriorityFeePerGas = parameters.maxPriorityFeePerGas ?? transaction.maxPriorityFeePerGas;
    if (typeof transaction.nonce !== "undefined")
      transaction.nonce = parameters.nonce ?? transaction.nonce;
    const feeMultiplier = await (async () => {
      if (typeof chain2?.fees?.baseFeeMultiplier === "function") {
        const block = await getAction(client, getBlock, "getBlock")({});
        return chain2.fees.baseFeeMultiplier({
          block,
          client,
          request: parameters
        });
      }
      return chain2?.fees?.baseFeeMultiplier ?? 1.2;
    })();
    if (feeMultiplier < 1)
      throw new BaseFeeScalarError();
    const decimals = feeMultiplier.toString().split(".")[1]?.length ?? 0;
    const denominator = 10 ** decimals;
    const multiplyFee = (base) => base * BigInt(Math.ceil(feeMultiplier * denominator)) / BigInt(denominator);
    if (!transaction.feePayerSignature) {
      if (transaction.maxFeePerGas && !parameters.maxFeePerGas)
        transaction.maxFeePerGas = multiplyFee(transaction.maxFeePerGas);
      if (transaction.gasPrice && !parameters.gasPrice)
        transaction.gasPrice = multiplyFee(transaction.gasPrice);
    }
    return {
      raw: response.raw,
      transaction: {
        from: request.from,
        ...transaction
      },
      ...response.capabilities ? { capabilities: response.capabilities } : {}
    };
  } catch (err) {
    throw getTransactionError(err, {
      ...parameters,
      chain: client.chain
    });
  }
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/wallet/prepareTransactionRequest.js
var defaultParameters = [
  "blobVersionedHashes",
  "chainId",
  "fees",
  "gas",
  "nonce",
  "type"
];
var eip1559NetworkCache = /* @__PURE__ */ new Map();
var supportsFillTransaction = /* @__PURE__ */ new LruMap(128);
async function prepareTransactionRequest(client, args) {
  let request = args;
  request.account ??= client.account;
  request.parameters ??= defaultParameters;
  const { account: account_, chain: chain2 = client.chain, nonceManager, parameters } = request;
  const prepareTransactionRequest2 = (() => {
    if (typeof chain2?.prepareTransactionRequest === "function")
      return {
        fn: chain2.prepareTransactionRequest,
        runAt: ["beforeFillTransaction"]
      };
    if (Array.isArray(chain2?.prepareTransactionRequest))
      return {
        fn: chain2.prepareTransactionRequest[0],
        runAt: chain2.prepareTransactionRequest[1].runAt
      };
    return void 0;
  })();
  let chainId;
  async function getChainId2() {
    if (chainId)
      return chainId;
    if (typeof request.chainId !== "undefined")
      return request.chainId;
    if (chain2)
      return chain2.id;
    const chainId_ = await getAction(client, getChainId, "getChainId")({});
    chainId = chainId_;
    return chainId;
  }
  const account = account_ ? parseAccount(account_) : account_;
  let nonce = request.nonce;
  if (parameters.includes("nonce") && typeof nonce === "undefined" && account && nonceManager) {
    const chainId2 = await getChainId2();
    nonce = await nonceManager.consume({
      address: account.address,
      chainId: chainId2,
      client
    });
  }
  if (prepareTransactionRequest2?.fn && prepareTransactionRequest2.runAt?.includes("beforeFillTransaction")) {
    request = await prepareTransactionRequest2.fn({ ...request, chain: chain2 }, {
      client,
      phase: "beforeFillTransaction"
    });
    nonce ??= request.nonce;
  }
  const attemptFill = (() => {
    if ((parameters.includes("blobVersionedHashes") || parameters.includes("sidecars")) && request.kzg && request.blobs)
      return false;
    if (supportsFillTransaction.get(client.uid) === false)
      return false;
    const shouldAttempt = ["fees", "gas"].some((parameter) => parameters.includes(parameter));
    if (!shouldAttempt)
      return false;
    if (parameters.includes("chainId") && typeof request.chainId !== "number")
      return true;
    if (parameters.includes("nonce") && typeof nonce !== "number")
      return true;
    if (parameters.includes("fees") && typeof request.gasPrice !== "bigint" && (typeof request.maxFeePerGas !== "bigint" || typeof request.maxPriorityFeePerGas !== "bigint"))
      return true;
    if (parameters.includes("gas") && typeof request.gas !== "bigint")
      return true;
    return false;
  })();
  const fillResult = attemptFill ? await getAction(client, fillTransaction, "fillTransaction")({ ...request, nonce }).then((result) => {
    const { chainId: chainId2, from: from14, gas: gas2, gasPrice, nonce: nonce2, maxFeePerBlobGas, maxFeePerGas, maxPriorityFeePerGas, type: type2, ...rest } = result.transaction;
    supportsFillTransaction.set(client.uid, true);
    return {
      ...request,
      ...from14 ? { from: from14 } : {},
      ...type2 && !request.type ? { type: type2 } : {},
      ...typeof chainId2 !== "undefined" ? { chainId: chainId2 } : {},
      ...typeof gas2 !== "undefined" ? { gas: gas2 } : {},
      ...typeof gasPrice !== "undefined" ? { gasPrice } : {},
      ...typeof nonce2 !== "undefined" ? { nonce: nonce2 } : {},
      ...typeof maxFeePerBlobGas !== "undefined" && request.type !== "legacy" && request.type !== "eip2930" ? { maxFeePerBlobGas } : {},
      ...typeof maxFeePerGas !== "undefined" && request.type !== "legacy" && request.type !== "eip2930" ? { maxFeePerGas } : {},
      ...typeof maxPriorityFeePerGas !== "undefined" && request.type !== "legacy" && request.type !== "eip2930" ? { maxPriorityFeePerGas } : {},
      ..."nonceKey" in rest && typeof rest.nonceKey !== "undefined" ? { nonceKey: rest.nonceKey } : {},
      ..."keyAuthorization" in rest && typeof rest.keyAuthorization !== "undefined" && rest.keyAuthorization !== null && !("keyAuthorization" in request) ? { keyAuthorization: rest.keyAuthorization } : {},
      ..."feePayerSignature" in rest && typeof rest.feePayerSignature !== "undefined" && rest.feePayerSignature !== null ? { feePayerSignature: rest.feePayerSignature } : {},
      ..."feeToken" in rest && typeof rest.feeToken !== "undefined" && rest.feeToken !== null && !("feeToken" in request) ? { feeToken: rest.feeToken } : {},
      ...result.capabilities ? { _capabilities: result.capabilities } : {}
    };
  }).catch((e) => {
    const error = e;
    if (error.name !== "TransactionExecutionError")
      return request;
    const executionReverted = error.walk?.((e2) => {
      const error2 = e2;
      return error2.name === "ExecutionRevertedError";
    });
    if (executionReverted)
      throw e;
    const unsupported = error.walk?.((e2) => {
      const error2 = e2;
      return error2.name === "MethodNotFoundRpcError" || error2.name === "MethodNotSupportedRpcError" || error2.message?.includes("eth_fillTransaction is not available");
    });
    if (unsupported)
      supportsFillTransaction.set(client.uid, false);
    return request;
  }) : request;
  nonce ??= fillResult.nonce;
  request = {
    ...fillResult,
    ...account ? { from: account?.address } : {},
    ...typeof nonce !== "undefined" ? { nonce } : {}
  };
  const { blobs, gas, kzg, type } = request;
  if (prepareTransactionRequest2?.fn && prepareTransactionRequest2.runAt?.includes("beforeFillParameters")) {
    request = await prepareTransactionRequest2.fn({ ...request, chain: chain2 }, {
      client,
      phase: "beforeFillParameters"
    });
  }
  let block;
  async function getBlock2() {
    if (block)
      return block;
    block = await getAction(client, getBlock, "getBlock")({ blockTag: "latest" });
    return block;
  }
  if (parameters.includes("nonce") && typeof nonce === "undefined" && account && !nonceManager)
    request.nonce = await getAction(client, getTransactionCount, "getTransactionCount")({
      address: account.address,
      blockTag: "pending"
    });
  if ((parameters.includes("blobVersionedHashes") || parameters.includes("sidecars")) && blobs && kzg) {
    const commitments = blobsToCommitments({ blobs, kzg });
    if (parameters.includes("blobVersionedHashes")) {
      const versionedHashes = commitmentsToVersionedHashes({
        commitments,
        to: "hex"
      });
      request.blobVersionedHashes = versionedHashes;
    }
    if (parameters.includes("sidecars")) {
      const proofs = blobsToProofs({ blobs, commitments, kzg });
      const sidecars = toBlobSidecars({
        blobs,
        commitments,
        proofs,
        to: "hex"
      });
      request.sidecars = sidecars;
    }
  }
  if (parameters.includes("chainId"))
    request.chainId = await getChainId2();
  if ((parameters.includes("fees") || parameters.includes("type")) && typeof type === "undefined") {
    try {
      request.type = getTransactionType(request);
    } catch {
      let isEip1559Network = eip1559NetworkCache.get(client.uid);
      if (typeof isEip1559Network === "undefined") {
        const block2 = await getBlock2();
        isEip1559Network = typeof block2?.baseFeePerGas === "bigint";
        eip1559NetworkCache.set(client.uid, isEip1559Network);
      }
      request.type = isEip1559Network ? "eip1559" : "legacy";
    }
  }
  if (parameters.includes("fees")) {
    if (request.type !== "legacy" && request.type !== "eip2930") {
      if (typeof request.maxFeePerGas === "undefined" || typeof request.maxPriorityFeePerGas === "undefined") {
        const block2 = await getBlock2();
        const { maxFeePerGas, maxPriorityFeePerGas } = await internal_estimateFeesPerGas(client, {
          block: block2,
          chain: chain2,
          request
        });
        if (typeof request.maxPriorityFeePerGas === "undefined" && request.maxFeePerGas && request.maxFeePerGas < maxPriorityFeePerGas)
          throw new MaxFeePerGasTooLowError({
            maxPriorityFeePerGas
          });
        request.maxPriorityFeePerGas = maxPriorityFeePerGas;
        request.maxFeePerGas = maxFeePerGas;
      }
    } else {
      if (typeof request.maxFeePerGas !== "undefined" || typeof request.maxPriorityFeePerGas !== "undefined")
        throw new Eip1559FeesNotSupportedError();
      if (typeof request.gasPrice === "undefined") {
        const block2 = await getBlock2();
        const { gasPrice: gasPrice_ } = await internal_estimateFeesPerGas(client, {
          block: block2,
          chain: chain2,
          request,
          type: "legacy"
        });
        request.gasPrice = gasPrice_;
      }
    }
  }
  if (parameters.includes("gas") && typeof gas === "undefined")
    request.gas = await getAction(client, estimateGas, "estimateGas")({
      ...request,
      account,
      prepare: account?.type === "local" ? [] : ["blobVersionedHashes"]
    });
  if (prepareTransactionRequest2?.fn && prepareTransactionRequest2.runAt?.includes("afterFillParameters"))
    request = await prepareTransactionRequest2.fn({ ...request, chain: chain2 }, {
      client,
      phase: "afterFillParameters"
    });
  assertRequest(request);
  delete request.parameters;
  return request;
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/estimateGas.js
async function estimateGas(client, args) {
  const { account: account_ = client.account, prepare = true } = args;
  const account = account_ ? parseAccount(account_) : void 0;
  const parameters = (() => {
    if (Array.isArray(prepare))
      return prepare;
    if (account?.type !== "local")
      return ["blobVersionedHashes"];
    return void 0;
  })();
  try {
    const to = await (async () => {
      if (args.to)
        return args.to;
      if (args.authorizationList && args.authorizationList.length > 0)
        return await recoverAuthorizationAddress({
          authorization: args.authorizationList[0]
        }).catch(() => {
          throw new BaseError("`to` is required. Could not infer from `authorizationList`");
        });
      return void 0;
    })();
    const { accessList, authorizationList, blobs, blobVersionedHashes, blockNumber, blockTag, data, gas, gasPrice, maxFeePerBlobGas, maxFeePerGas, maxPriorityFeePerGas, nonce, value, stateOverride, ...rest } = prepare ? await prepareTransactionRequest(client, {
      ...args,
      parameters,
      to
    }) : args;
    if (gas && args.gas !== gas)
      return gas;
    const blockNumberHex = typeof blockNumber === "bigint" ? numberToHex(blockNumber) : void 0;
    const block = blockNumberHex || blockTag;
    const rpcStateOverride = serializeStateOverride(stateOverride);
    assertRequest(args);
    const chainFormat = client.chain?.formatters?.transactionRequest?.format;
    const format = chainFormat || formatTransactionRequest;
    const request = format({
      // Pick out extra data that might exist on the chain's transaction request type.
      ...extract(rest, { format: chainFormat }),
      account,
      accessList,
      authorizationList,
      blobs,
      blobVersionedHashes,
      data,
      gasPrice,
      maxFeePerBlobGas,
      maxFeePerGas,
      maxPriorityFeePerGas,
      nonce,
      to,
      value
    }, "estimateGas");
    return BigInt(await client.request({
      method: "eth_estimateGas",
      params: rpcStateOverride ? [
        request,
        block ?? client.experimental_blockTag ?? "latest",
        rpcStateOverride
      ] : block ? [request, block] : [request]
    }));
  } catch (err) {
    throw getEstimateGasError(err, {
      ...args,
      account,
      chain: client.chain
    });
  }
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/estimateContractGas.js
async function estimateContractGas(client, parameters) {
  const { abi: abi2, address, args, functionName, dataSuffix = typeof client.dataSuffix === "string" ? client.dataSuffix : client.dataSuffix?.value, ...request } = parameters;
  const data = encodeFunctionData({
    abi: abi2,
    args,
    functionName
  });
  try {
    const gas = await getAction(client, estimateGas, "estimateGas")({
      data: `${data}${dataSuffix ? dataSuffix.replace("0x", "") : ""}`,
      to: address,
      ...request
    });
    return gas;
  } catch (error) {
    const account = request.account ? parseAccount(request.account) : void 0;
    throw getContractError(error, {
      abi: abi2,
      address,
      args,
      docsPath: "/docs/contract/estimateContractGas",
      functionName,
      sender: account?.address
    });
  }
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/formatters/log.js
function formatLog(log2, { args, eventName } = {}) {
  return {
    ...log2,
    blockHash: log2.blockHash ? log2.blockHash : null,
    blockNumber: log2.blockNumber ? BigInt(log2.blockNumber) : null,
    blockTimestamp: log2.blockTimestamp ? BigInt(log2.blockTimestamp) : log2.blockTimestamp === null ? null : void 0,
    logIndex: log2.logIndex ? Number(log2.logIndex) : null,
    transactionHash: log2.transactionHash ? log2.transactionHash : null,
    transactionIndex: log2.transactionIndex ? Number(log2.transactionIndex) : null,
    ...eventName ? { args, eventName } : {}
  };
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/abi/decodeEventLog.js
var docsPath2 = "/docs/contract/decodeEventLog";
function decodeEventLog(parameters) {
  const { abi: abi2, data, strict: strict_, topics } = parameters;
  const strict = strict_ ?? true;
  const [signature, ...argTopics] = topics;
  if (!signature)
    throw new AbiEventSignatureEmptyTopicsError({ docsPath: docsPath2 });
  const abiItem = abi2.find((x2) => x2.type === "event" && signature === toEventSelector(formatAbiItem(x2)));
  if (!(abiItem && "name" in abiItem) || abiItem.type !== "event")
    throw new AbiEventSignatureNotFoundError(signature, { docsPath: docsPath2 });
  const { name, inputs } = abiItem;
  const isUnnamed = inputs?.some((x2) => !("name" in x2 && x2.name));
  const args = isUnnamed ? [] : {};
  const indexedInputs = inputs.map((x2, i2) => [x2, i2]).filter(([x2]) => "indexed" in x2 && x2.indexed);
  const missingIndexedInputs = [];
  for (let i2 = 0; i2 < indexedInputs.length; i2++) {
    const [param, argIndex] = indexedInputs[i2];
    const topic = argTopics[i2];
    if (!topic) {
      if (strict)
        throw new DecodeLogTopicsMismatch({
          abiItem,
          param
        });
      missingIndexedInputs.push([param, argIndex]);
      continue;
    }
    args[isUnnamed ? argIndex : param.name || argIndex] = decodeTopic({
      param,
      value: topic
    });
  }
  const nonIndexedInputs = inputs.filter((x2) => !("indexed" in x2 && x2.indexed));
  const inputsToDecode = strict ? nonIndexedInputs : [...missingIndexedInputs.map(([param]) => param), ...nonIndexedInputs];
  if (inputsToDecode.length > 0) {
    if (data && data !== "0x") {
      try {
        const decodedData = decodeAbiParameters(inputsToDecode, data);
        if (decodedData) {
          let dataIndex = 0;
          if (!strict) {
            for (const [param, argIndex] of missingIndexedInputs) {
              args[isUnnamed ? argIndex : param.name || argIndex] = decodedData[dataIndex++];
            }
          }
          if (isUnnamed) {
            for (let i2 = 0; i2 < inputs.length; i2++)
              if (args[i2] === void 0 && dataIndex < decodedData.length)
                args[i2] = decodedData[dataIndex++];
          } else
            for (let i2 = 0; i2 < nonIndexedInputs.length; i2++)
              args[nonIndexedInputs[i2].name] = decodedData[dataIndex++];
        }
      } catch (err) {
        if (strict) {
          if (err instanceof AbiDecodingDataSizeTooSmallError || err instanceof PositionOutOfBoundsError)
            throw new DecodeLogDataMismatch({
              abiItem,
              data,
              params: inputsToDecode,
              size: size(data)
            });
          throw err;
        }
      }
    } else if (strict) {
      throw new DecodeLogDataMismatch({
        abiItem,
        data: "0x",
        params: inputsToDecode,
        size: 0
      });
    }
  }
  return {
    eventName: name,
    args: Object.values(args).length > 0 ? args : void 0
  };
}
function decodeTopic({ param, value }) {
  if (param.type === "string" || param.type === "bytes" || param.type === "tuple" || param.type.match(/^(.*)\[(\d+)?\]$/))
    return value;
  const decodedArg = decodeAbiParameters([param], value) || [];
  return decodedArg[0];
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/abi/parseEventLogs.js
function parseEventLogs(parameters) {
  const { abi: abi2, args, logs, strict = true } = parameters;
  const eventName = (() => {
    if (!parameters.eventName)
      return void 0;
    if (Array.isArray(parameters.eventName))
      return parameters.eventName;
    return [parameters.eventName];
  })();
  const abiTopics = abi2.filter((abiItem) => abiItem.type === "event").map((abiItem) => ({
    abi: abiItem,
    selector: toEventSelector(abiItem)
  }));
  return logs.map((log2) => {
    const formattedLog = typeof log2.blockNumber === "string" ? formatLog(log2) : log2;
    const abiItems = abiTopics.filter((abiTopic) => formattedLog.topics[0] === abiTopic.selector);
    if (abiItems.length === 0)
      return null;
    let event;
    let abiItem;
    for (const item of abiItems) {
      try {
        event = decodeEventLog({
          ...formattedLog,
          abi: [item.abi],
          strict: true
        });
        abiItem = item;
        break;
      } catch {
      }
    }
    if (!event && !strict) {
      abiItem = abiItems[0];
      try {
        event = decodeEventLog({
          data: formattedLog.data,
          topics: formattedLog.topics,
          abi: [abiItem.abi],
          strict: false
        });
      } catch {
        const isUnnamed = abiItem.abi.inputs?.some((x2) => !("name" in x2 && x2.name));
        return {
          ...formattedLog,
          args: isUnnamed ? [] : {},
          eventName: abiItem.abi.name
        };
      }
    }
    if (!event || !abiItem)
      return null;
    if (eventName && !eventName.includes(event.eventName))
      return null;
    if (!includesArgs({
      args: event.args,
      inputs: abiItem.abi.inputs,
      matchArgs: args
    }))
      return null;
    return { ...event, ...formattedLog };
  }).filter(Boolean);
}
function includesArgs(parameters) {
  const { args, inputs, matchArgs } = parameters;
  if (!matchArgs)
    return true;
  if (!args)
    return false;
  function isEqual2(input, value, arg) {
    try {
      if (input.type === "address")
        return isAddressEqual(value, arg);
      if (input.type === "string" || input.type === "bytes")
        return keccak256(toBytes(value)) === arg;
      return value === arg;
    } catch {
      return false;
    }
  }
  if (Array.isArray(args) && Array.isArray(matchArgs)) {
    return matchArgs.every((value, index2) => {
      if (value === null || value === void 0)
        return true;
      const input = inputs[index2];
      if (!input)
        return false;
      const value_ = Array.isArray(value) ? value : [value];
      return value_.some((value2) => isEqual2(input, value2, args[index2]));
    });
  }
  if (typeof args === "object" && !Array.isArray(args) && typeof matchArgs === "object" && !Array.isArray(matchArgs))
    return Object.entries(matchArgs).every(([key, value]) => {
      if (value === null || value === void 0)
        return true;
      const input = inputs.find((input2) => input2.name === key);
      if (!input)
        return false;
      const value_ = Array.isArray(value) ? value : [value];
      return value_.some((value2) => isEqual2(input, value2, args[key]));
    });
  return false;
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/getLogs.js
async function getLogs(client, { address, blockHash, fromBlock, toBlock, event, events: events_, args, strict: strict_ } = {}) {
  const strict = strict_ ?? false;
  const events = events_ ?? (event ? [event] : void 0);
  let topics = [];
  if (events) {
    const encoded = events.flatMap((event2) => encodeEventTopics({
      abi: [event2],
      eventName: event2.name,
      args: events_ ? void 0 : args
    }));
    topics = [encoded];
    if (event)
      topics = topics[0];
  }
  let logs;
  if (blockHash) {
    logs = await client.request({
      method: "eth_getLogs",
      params: [{ address, topics, blockHash }]
    });
  } else {
    logs = await client.request({
      method: "eth_getLogs",
      params: [
        {
          address,
          topics,
          fromBlock: typeof fromBlock === "bigint" ? numberToHex(fromBlock) : fromBlock,
          toBlock: typeof toBlock === "bigint" ? numberToHex(toBlock) : toBlock
        }
      ]
    });
  }
  const formattedLogs = logs.map((log2) => formatLog(log2));
  if (!events)
    return formattedLogs;
  return parseEventLogs({
    abi: events,
    args,
    logs: formattedLogs,
    strict
  });
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/getContractEvents.js
async function getContractEvents(client, parameters) {
  const { abi: abi2, address, args, blockHash, eventName, fromBlock, toBlock, strict } = parameters;
  const event = eventName ? getAbiItem({ abi: abi2, name: eventName }) : void 0;
  const events = !event ? abi2.filter((x2) => x2.type === "event") : void 0;
  return getAction(client, getLogs, "getLogs")({
    address,
    args,
    blockHash,
    event,
    events,
    fromBlock,
    toBlock,
    strict
  });
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/readContract.js
async function readContract(client, parameters) {
  const { abi: abi2, address, args, functionName, ...rest } = parameters;
  const calldata = encodeFunctionData({
    abi: abi2,
    args,
    functionName
  });
  try {
    const { data } = await getAction(client, call, "call")({
      ...rest,
      data: calldata,
      to: address
    });
    return decodeFunctionResult({
      abi: abi2,
      args,
      functionName,
      data: data || "0x"
    });
  } catch (error) {
    throw getContractError(error, {
      abi: abi2,
      address,
      args,
      docsPath: "/docs/contract/readContract",
      functionName
    });
  }
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/simulateContract.js
async function simulateContract(client, parameters) {
  const { abi: abi2, address, args, functionName, dataSuffix = typeof client.dataSuffix === "string" ? client.dataSuffix : client.dataSuffix?.value, ...callRequest } = parameters;
  const account = callRequest.account ? parseAccount(callRequest.account) : client.account;
  const calldata = encodeFunctionData({ abi: abi2, args, functionName });
  try {
    const { data } = await getAction(client, call, "call")({
      batch: false,
      data: `${calldata}${dataSuffix ? dataSuffix.replace("0x", "") : ""}`,
      to: address,
      ...callRequest,
      account
    });
    const result = decodeFunctionResult({
      abi: abi2,
      args,
      functionName,
      data: data || "0x"
    });
    const minimizedAbi = abi2.filter((abiItem) => "name" in abiItem && abiItem.name === parameters.functionName);
    return {
      result,
      request: {
        abi: minimizedAbi,
        address,
        args,
        dataSuffix,
        functionName,
        ...callRequest,
        account
      }
    };
  } catch (error) {
    throw getContractError(error, {
      abi: abi2,
      address,
      args,
      docsPath: "/docs/contract/simulateContract",
      functionName,
      sender: account?.address
    });
  }
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/observe.js
var listenersCache = /* @__PURE__ */ new Map();
var cleanupCache = /* @__PURE__ */ new Map();
var callbackCount = 0;
function observe(observerId, callbacks, fn) {
  const callbackId = ++callbackCount;
  const getListeners = () => listenersCache.get(observerId) || [];
  const unsubscribe = () => {
    const listeners2 = getListeners();
    const nextListeners = listeners2.filter((cb) => cb.id !== callbackId);
    if (nextListeners.length === 0) {
      listenersCache.delete(observerId);
      cleanupCache.delete(observerId);
      return;
    }
    listenersCache.set(observerId, nextListeners);
  };
  const unwatch = () => {
    const listeners2 = getListeners();
    if (!listeners2.some((cb) => cb.id === callbackId))
      return;
    const cleanup2 = cleanupCache.get(observerId);
    if (listeners2.length === 1 && cleanup2) {
      const p3 = cleanup2();
      if (p3 instanceof Promise)
        p3.catch(() => {
        });
    }
    unsubscribe();
  };
  const listeners = getListeners();
  listenersCache.set(observerId, [
    ...listeners,
    { id: callbackId, fns: callbacks }
  ]);
  if (listeners && listeners.length > 0)
    return unwatch;
  const emit = {};
  for (const key in callbacks) {
    emit[key] = ((...args) => {
      const listeners2 = getListeners();
      if (listeners2.length === 0)
        return;
      for (const listener of listeners2)
        listener.fns[key]?.(...args);
    });
  }
  const cleanup = fn(emit);
  if (typeof cleanup === "function")
    cleanupCache.set(observerId, cleanup);
  return unwatch;
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/wait.js
async function wait(time, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(getAbortError(signal));
      return;
    }
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, time);
    const onAbort = () => {
      clearTimeout(timeout);
      cleanup();
      reject(getAbortError(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/poll.js
function poll(fn, { emitOnBegin, initialWaitTime, interval }) {
  let active = true;
  const unwatch = () => active = false;
  const watch = async () => {
    let data;
    if (emitOnBegin)
      data = await fn({ unpoll: unwatch });
    const initialWait = await initialWaitTime?.(data) ?? interval;
    await wait(initialWait);
    const poll2 = async () => {
      if (!active)
        return;
      await fn({ unpoll: unwatch });
      await wait(interval);
      poll2();
    };
    poll2();
  };
  watch();
  return unwatch;
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/promise/withCache.js
var promiseCache = /* @__PURE__ */ new Map();
var responseCache = /* @__PURE__ */ new Map();
function getCache(cacheKey2) {
  const buildCache = (cacheKey3, cache) => ({
    clear: () => cache.delete(cacheKey3),
    get: () => cache.get(cacheKey3),
    set: (data) => cache.set(cacheKey3, data)
  });
  const promise = buildCache(cacheKey2, promiseCache);
  const response = buildCache(cacheKey2, responseCache);
  return {
    clear: () => {
      promise.clear();
      response.clear();
    },
    promise,
    response
  };
}
async function withCache(fn, { cacheKey: cacheKey2, cacheTime = Number.POSITIVE_INFINITY }) {
  const cache = getCache(cacheKey2);
  const response = cache.response.get();
  if (response && cacheTime > 0) {
    const age = Date.now() - response.created.getTime();
    if (age < cacheTime)
      return response.data;
  }
  let promise = cache.promise.get();
  if (!promise) {
    promise = fn();
    cache.promise.set(promise);
  }
  try {
    const data = await promise;
    cache.response.set({ created: /* @__PURE__ */ new Date(), data });
    return data;
  } finally {
    cache.promise.clear();
  }
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/getBlockNumber.js
var cacheKey = (id) => `blockNumber.${id}`;
async function getBlockNumber(client, { cacheTime = client.cacheTime } = {}) {
  const blockNumberHex = await withCache(() => client.request({
    method: "eth_blockNumber"
  }), { cacheKey: cacheKey(client.uid), cacheTime });
  return BigInt(blockNumberHex);
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/getFilterChanges.js
async function getFilterChanges(_client, { filter }) {
  const strict = "strict" in filter && filter.strict;
  const logs = await filter.request({
    method: "eth_getFilterChanges",
    params: [filter.id]
  });
  if (typeof logs[0] === "string")
    return logs;
  const formattedLogs = logs.map((log2) => formatLog(log2));
  if (!("abi" in filter) || !filter.abi)
    return formattedLogs;
  return parseEventLogs({
    abi: filter.abi,
    logs: formattedLogs,
    strict
  });
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/uninstallFilter.js
async function uninstallFilter(_client, { filter }) {
  return filter.request({
    method: "eth_uninstallFilter",
    params: [filter.id]
  });
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/watchContractEvent.js
function watchContractEvent(client, parameters) {
  const { abi: abi2, address, args, batch = true, eventName, fromBlock, onError, onLogs, poll: poll_, pollingInterval = client.pollingInterval, strict: strict_ } = parameters;
  const enablePolling = (() => {
    if (typeof poll_ !== "undefined")
      return poll_;
    if (typeof fromBlock === "bigint")
      return true;
    if (client.transport.type === "webSocket" || client.transport.type === "ipc")
      return false;
    if (client.transport.type === "fallback" && (client.transport.transports[0].config.type === "webSocket" || client.transport.transports[0].config.type === "ipc"))
      return false;
    return true;
  })();
  const pollContractEvent = () => {
    const strict = strict_ ?? false;
    const observerId = stringify([
      "watchContractEvent",
      address,
      args,
      batch,
      client.uid,
      eventName,
      pollingInterval,
      strict,
      fromBlock
    ]);
    return observe(observerId, { onLogs, onError }, (emit) => {
      let previousBlockNumber;
      if (fromBlock !== void 0)
        previousBlockNumber = fromBlock - 1n;
      let filter;
      let initialized = false;
      const unwatch = poll(async () => {
        if (!initialized) {
          try {
            filter = await getAction(client, createContractEventFilter, "createContractEventFilter")({
              abi: abi2,
              address,
              args,
              eventName,
              strict,
              fromBlock
            });
          } catch {
          }
          initialized = true;
          return;
        }
        try {
          let logs;
          if (filter) {
            logs = await getAction(client, getFilterChanges, "getFilterChanges")({ filter });
          } else {
            const blockNumber = await getAction(client, getBlockNumber, "getBlockNumber")({});
            if (previousBlockNumber && previousBlockNumber < blockNumber) {
              logs = await getAction(client, getContractEvents, "getContractEvents")({
                abi: abi2,
                address,
                args,
                eventName,
                fromBlock: previousBlockNumber + 1n,
                toBlock: blockNumber,
                strict
              });
            } else {
              logs = [];
            }
            previousBlockNumber = blockNumber;
          }
          if (logs.length === 0)
            return;
          if (batch)
            emit.onLogs(logs);
          else
            for (const log2 of logs)
              emit.onLogs([log2]);
        } catch (err) {
          if (filter && err instanceof InvalidInputRpcError)
            initialized = false;
          emit.onError?.(err);
        }
      }, {
        emitOnBegin: true,
        interval: pollingInterval
      });
      return async () => {
        if (filter)
          await getAction(client, uninstallFilter, "uninstallFilter")({ filter });
        unwatch();
      };
    });
  };
  const subscribeContractEvent = () => {
    const strict = strict_ ?? false;
    const observerId = stringify([
      "watchContractEvent",
      address,
      args,
      batch,
      client.uid,
      eventName,
      pollingInterval,
      strict
    ]);
    let active = true;
    let unsubscribe = () => active = false;
    return observe(observerId, { onLogs, onError }, (emit) => {
      ;
      (async () => {
        try {
          const transport = (() => {
            if (client.transport.type === "fallback") {
              const transport2 = client.transport.transports.find((transport3) => transport3.config.type === "webSocket" || transport3.config.type === "ipc");
              if (!transport2)
                return client.transport;
              return transport2.value;
            }
            return client.transport;
          })();
          const topics = eventName ? encodeEventTopics({
            abi: abi2,
            eventName,
            args
          }) : [];
          const { unsubscribe: unsubscribe_ } = await transport.subscribe({
            params: ["logs", { address, topics }],
            onData(data) {
              if (!active)
                return;
              const log2 = data.result;
              try {
                const { eventName: eventName2, args: args2 } = decodeEventLog({
                  abi: abi2,
                  data: log2.data,
                  topics: log2.topics,
                  strict: strict_
                });
                const formatted = formatLog(log2, {
                  args: args2,
                  eventName: eventName2
                });
                emit.onLogs([formatted]);
              } catch (err) {
                let eventName2;
                let isUnnamed;
                if (err instanceof DecodeLogDataMismatch || err instanceof DecodeLogTopicsMismatch) {
                  if (strict_)
                    return;
                  eventName2 = err.abiItem.name;
                  isUnnamed = err.abiItem.inputs?.some((x2) => !("name" in x2 && x2.name));
                }
                const formatted = formatLog(log2, {
                  args: isUnnamed ? [] : {},
                  eventName: eventName2
                });
                emit.onLogs([formatted]);
              }
            },
            onError(error) {
              emit.onError?.(error);
            }
          });
          unsubscribe = unsubscribe_;
          if (!active)
            unsubscribe();
        } catch (err) {
          onError?.(err);
        }
      })();
      return () => unsubscribe();
    });
  };
  return enablePolling ? pollContractEvent() : subscribeContractEvent();
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/wallet/sendRawTransaction.js
async function sendRawTransaction(client, { serializedTransaction }) {
  return client.request({
    method: "eth_sendRawTransaction",
    params: [serializedTransaction]
  }, { retryCount: 0 });
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/promise/withRetry.js
function withRetry(fn, { delay: delay_ = 100, retryCount = 2, shouldRetry: shouldRetry2 = () => true, signal } = {}) {
  return new Promise((resolve, reject) => {
    const attemptRetry = async ({ count = 0 } = {}) => {
      if (signal?.aborted) {
        reject(getAbortError(signal));
        return;
      }
      const retry = async ({ error }) => {
        const delay = typeof delay_ === "function" ? delay_({ count, error }) : delay_;
        if (delay) {
          try {
            await wait(delay, { signal });
          } catch (err) {
            reject(err);
            return;
          }
        }
        attemptRetry({ count: count + 1 });
      };
      try {
        const data = await fn();
        resolve(data);
      } catch (err) {
        if (signal?.aborted) {
          reject(getAbortError(signal));
          return;
        }
        if (isAbortError(err)) {
          reject(err);
          return;
        }
        if (count < retryCount && await shouldRetry2({ count, error: err }))
          return retry({ error: err });
        reject(err);
      }
    };
    attemptRetry();
  });
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/formatters/transactionReceipt.js
var receiptStatuses = {
  "0x0": "reverted",
  "0x1": "success"
};
function formatTransactionReceipt(transactionReceipt, _2) {
  const receipt = {
    ...transactionReceipt,
    blockNumber: transactionReceipt.blockNumber ? BigInt(transactionReceipt.blockNumber) : null,
    contractAddress: transactionReceipt.contractAddress ? transactionReceipt.contractAddress : null,
    cumulativeGasUsed: transactionReceipt.cumulativeGasUsed ? BigInt(transactionReceipt.cumulativeGasUsed) : null,
    effectiveGasPrice: transactionReceipt.effectiveGasPrice ? BigInt(transactionReceipt.effectiveGasPrice) : null,
    gasUsed: transactionReceipt.gasUsed ? BigInt(transactionReceipt.gasUsed) : null,
    logs: transactionReceipt.logs ? transactionReceipt.logs.map((log2) => formatLog(log2)) : null,
    to: transactionReceipt.to ? transactionReceipt.to : null,
    transactionIndex: transactionReceipt.transactionIndex ? hexToNumber(transactionReceipt.transactionIndex) : null,
    status: transactionReceipt.status ? receiptStatuses[transactionReceipt.status] : null,
    type: transactionReceipt.type ? transactionType[transactionReceipt.type] || transactionReceipt.type : null
  };
  if (transactionReceipt.blobGasPrice)
    receipt.blobGasPrice = BigInt(transactionReceipt.blobGasPrice);
  if (transactionReceipt.blobGasUsed)
    receipt.blobGasUsed = BigInt(transactionReceipt.blobGasUsed);
  return receipt;
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/uid.js
var size4 = 256;
var index = size4;
var buffer;
function uid(length = 11) {
  if (!buffer || index + length > size4 * 2) {
    buffer = "";
    index = 0;
    for (let i2 = 0; i2 < size4; i2++) {
      buffer += (256 + Math.random() * 256 | 0).toString(16).substring(1);
    }
  }
  return buffer.substring(index, index++ + length);
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/clients/createClient.js
function createClient(parameters) {
  const { batch, chain: chain2, ccipRead, dataSuffix, key = "base", name = "Base Client", type = "base" } = parameters;
  const experimental_blockTag = parameters.experimental_blockTag ?? (typeof chain2?.experimental_preconfirmationTime === "number" ? "pending" : void 0);
  const blockTime = chain2?.blockTime ?? 12e3;
  const defaultPollingInterval = Math.min(Math.max(Math.floor(blockTime / 2), 500), 4e3);
  const pollingInterval = parameters.pollingInterval ?? defaultPollingInterval;
  const cacheTime = parameters.cacheTime ?? pollingInterval;
  const account = parameters.account ? parseAccount(parameters.account) : void 0;
  const { config, request, value } = parameters.transport({
    account,
    chain: chain2,
    pollingInterval
  });
  const transport = { ...config, ...value };
  const client = {
    account,
    batch,
    cacheTime,
    ccipRead,
    chain: chain2,
    dataSuffix,
    key,
    name,
    pollingInterval,
    request,
    transport,
    type,
    uid: uid(),
    ...experimental_blockTag ? { experimental_blockTag } : {}
  };
  function extend(base) {
    return (extendFn) => {
      const extended = extendFn(base);
      for (const key2 in client)
        delete extended[key2];
      const combined = { ...base, ...extended };
      return Object.assign(combined, { extend: extend(combined) });
    };
  }
  return Object.assign(client, { extend: extend(client) });
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/ens/errors.js
function isNullUniversalResolverError(err) {
  if (!(err instanceof BaseError))
    return false;
  const cause = err.walk((e) => e instanceof ContractFunctionRevertedError);
  if (!(cause instanceof ContractFunctionRevertedError))
    return false;
  if (cause.data?.errorName === "HttpError")
    return true;
  if (cause.data?.errorName === "ResolverError")
    return true;
  if (cause.data?.errorName === "ResolverNotContract")
    return true;
  if (cause.data?.errorName === "ResolverNotFound")
    return true;
  if (cause.data?.errorName === "ReverseAddressMismatch")
    return true;
  if (cause.data?.errorName === "UnsupportedResolverProfile")
    return true;
  return false;
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/ens/encodedLabelToLabelhash.js
function encodedLabelToLabelhash(label) {
  if (label.length !== 66)
    return null;
  if (label.indexOf("[") !== 0)
    return null;
  if (label.indexOf("]") !== 65)
    return null;
  const hash2 = `0x${label.slice(1, 65)}`;
  if (!isHex(hash2))
    return null;
  return hash2;
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/ens/namehash.js
function namehash(name) {
  let result = new Uint8Array(32).fill(0);
  if (!name)
    return bytesToHex(result);
  const labels = name.split(".");
  for (let i2 = labels.length - 1; i2 >= 0; i2 -= 1) {
    const hashFromEncodedLabel = encodedLabelToLabelhash(labels[i2]);
    const hashed = hashFromEncodedLabel ? toBytes(hashFromEncodedLabel) : keccak256(stringToBytes(labels[i2]), "bytes");
    result = keccak256(concat([result, hashed]), "bytes");
  }
  return bytesToHex(result);
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/ens/encodeLabelhash.js
function encodeLabelhash(hash2) {
  return `[${hash2.slice(2)}]`;
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/ens/labelhash.js
function labelhash(label) {
  const result = new Uint8Array(32).fill(0);
  if (!label)
    return bytesToHex(result);
  return encodedLabelToLabelhash(label) || keccak256(stringToBytes(label));
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/ens/packetToBytes.js
function packetToBytes(packet) {
  const value = packet.replace(/^\.|\.$/gm, "");
  if (value.length === 0)
    return new Uint8Array(1);
  const bytes = new Uint8Array(stringToBytes(value).byteLength + 2);
  let offset = 0;
  const list = value.split(".");
  for (let i2 = 0; i2 < list.length; i2++) {
    let encoded = stringToBytes(list[i2]);
    if (encoded.byteLength > 255)
      encoded = stringToBytes(encodeLabelhash(labelhash(list[i2])));
    bytes[offset] = encoded.length;
    bytes.set(encoded, offset + 1);
    offset += encoded.length + 1;
  }
  if (bytes.byteLength !== offset + 1)
    return bytes.slice(0, offset + 1);
  return bytes;
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/ens/getEnsAddress.js
async function getEnsAddress(client, parameters) {
  const { blockNumber, blockTag, coinType, name, gatewayUrls, strict } = parameters;
  const { chain: chain2 } = client;
  const universalResolverAddress = (() => {
    if (parameters.universalResolverAddress)
      return parameters.universalResolverAddress;
    if (!chain2)
      throw new Error("client chain not configured. universalResolverAddress is required.");
    return getChainContractAddress({
      blockNumber,
      chain: chain2,
      contract: "ensUniversalResolver"
    });
  })();
  const tlds = chain2?.ensTlds;
  if (tlds && !tlds.some((tld) => name.endsWith(tld)))
    return null;
  const args = (() => {
    if (coinType != null)
      return [namehash(name), BigInt(coinType)];
    return [namehash(name)];
  })();
  try {
    const functionData = encodeFunctionData({
      abi: addressResolverAbi,
      functionName: "addr",
      args
    });
    const readContractParameters = {
      address: universalResolverAddress,
      abi: universalResolverResolveAbi,
      functionName: "resolveWithGateways",
      args: [
        toHex(packetToBytes(name)),
        functionData,
        gatewayUrls ?? [localBatchGatewayUrl]
      ],
      blockNumber,
      blockTag
    };
    const readContractAction = getAction(client, readContract, "readContract");
    const res = await readContractAction(readContractParameters);
    if (res[0] === "0x")
      return null;
    const address = decodeAddress({ coinType, data: res[0], args });
    if (address === "0x")
      return null;
    if (trim(address) === "0x00")
      return null;
    return address;
  } catch (err) {
    if (strict)
      throw err;
    if (isNullUniversalResolverError(err))
      return null;
    throw err;
  }
}
function decodeAddress({ coinType, data, args }) {
  try {
    return decodeFunctionResult({
      abi: addressResolverAbi,
      args,
      functionName: "addr",
      data
    });
  } catch (err) {
    if (coinType == null)
      throw err;
    const address = trim(data);
    if (size(address) === 20)
      return getAddress(address);
    throw err;
  }
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/errors/ens.js
var EnsAvatarInvalidMetadataError = class extends BaseError {
  constructor({ data }) {
    super("Unable to extract image from metadata. The metadata may be malformed or invalid.", {
      metaMessages: [
        "- Metadata must be a JSON object with at least an `image`, `image_url` or `image_data` property.",
        "",
        `Provided data: ${JSON.stringify(data)}`
      ],
      name: "EnsAvatarInvalidMetadataError"
    });
  }
};
var EnsAvatarInvalidNftUriError = class extends BaseError {
  constructor({ reason }) {
    super(`ENS NFT avatar URI is invalid. ${reason}`, {
      name: "EnsAvatarInvalidNftUriError"
    });
  }
};
var EnsAvatarUriResolutionError = class extends BaseError {
  constructor({ uri }) {
    super(`Unable to resolve ENS avatar URI "${uri}". The URI may be malformed, invalid, or does not respond with a valid image.`, { name: "EnsAvatarUriResolutionError" });
  }
};
var EnsAvatarUnsupportedNamespaceError = class extends BaseError {
  constructor({ namespace }) {
    super(`ENS NFT avatar namespace "${namespace}" is not supported. Must be "erc721" or "erc1155".`, { name: "EnsAvatarUnsupportedNamespaceError" });
  }
};

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/ens/avatar/utils.js
var networkRegex = /(?<protocol>https?:\/\/[^/]*|ipfs:\/|ipns:\/|ar:\/)?(?<root>\/)?(?<subpath>ipfs\/|ipns\/)?(?<target>[\w\-.]+)(?<subtarget>\/.*)?/;
var ipfsHashRegex = /^(Qm[1-9A-HJ-NP-Za-km-z]{44,}|b[A-Za-z2-7]{58,}|B[A-Z2-7]{58,}|z[1-9A-HJ-NP-Za-km-z]{48,}|F[0-9A-F]{50,})(\/(?<target>[\w\-.]+))?(?<subtarget>\/.*)?$/;
var base64Regex = /^data:([a-zA-Z\-/+]*);base64,([^"].*)/;
var dataURIRegex = /^data:([a-zA-Z\-/+]*)?(;[a-zA-Z0-9].*?)?(,)/;
async function isImageUri(uri) {
  try {
    const res = await fetch(uri, { method: "HEAD" });
    if (res.status === 200) {
      const contentType = res.headers.get("content-type");
      return contentType?.startsWith("image/");
    }
    return false;
  } catch (error) {
    if (typeof error === "object" && typeof error.response !== "undefined") {
      return false;
    }
    if (!Object.hasOwn(globalThis, "Image"))
      return false;
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        resolve(true);
      };
      img.onerror = () => {
        resolve(false);
      };
      img.src = uri;
    });
  }
}
function getGateway(custom2, defaultGateway) {
  if (!custom2)
    return defaultGateway;
  if (custom2.endsWith("/"))
    return custom2.slice(0, -1);
  return custom2;
}
function resolveAvatarUri({ uri, gatewayUrls }) {
  const isEncoded = base64Regex.test(uri);
  if (isEncoded)
    return { uri, isOnChain: true, isEncoded };
  const ipfsGateway = getGateway(gatewayUrls?.ipfs, "https://ipfs.io");
  const arweaveGateway = getGateway(gatewayUrls?.arweave, "https://arweave.net");
  const networkRegexMatch = uri.match(networkRegex);
  const { protocol, subpath, target, subtarget = "" } = networkRegexMatch?.groups || {};
  const isIPNS = protocol === "ipns:/" || subpath === "ipns/";
  const isIPFS = protocol === "ipfs:/" || subpath === "ipfs/" || ipfsHashRegex.test(uri);
  if (uri.startsWith("http") && !isIPNS && !isIPFS) {
    let replacedUri = uri;
    if (gatewayUrls?.arweave)
      replacedUri = uri.replace(/https:\/\/arweave.net/g, gatewayUrls?.arweave);
    return { uri: replacedUri, isOnChain: false, isEncoded: false };
  }
  if ((isIPNS || isIPFS) && target) {
    return {
      uri: `${ipfsGateway}/${isIPNS ? "ipns" : "ipfs"}/${target}${subtarget}`,
      isOnChain: false,
      isEncoded: false
    };
  }
  if (protocol === "ar:/" && target) {
    return {
      uri: `${arweaveGateway}/${target}${subtarget || ""}`,
      isOnChain: false,
      isEncoded: false
    };
  }
  let parsedUri = uri.replace(dataURIRegex, "");
  if (parsedUri.startsWith("<svg")) {
    parsedUri = `data:image/svg+xml;base64,${btoa(parsedUri)}`;
  }
  if (parsedUri.startsWith("data:") || parsedUri.startsWith("{")) {
    return {
      uri: parsedUri,
      isOnChain: true,
      isEncoded: false
    };
  }
  throw new EnsAvatarUriResolutionError({ uri });
}
function getJsonImage(data) {
  if (typeof data !== "object" || !("image" in data) && !("image_url" in data) && !("image_data" in data)) {
    throw new EnsAvatarInvalidMetadataError({ data });
  }
  return data.image || data.image_url || data.image_data;
}
async function getMetadataAvatarUri({ gatewayUrls, uri }) {
  try {
    const res = await fetch(uri).then((res2) => res2.json());
    const image = await parseAvatarUri({
      gatewayUrls,
      uri: getJsonImage(res)
    });
    return image;
  } catch {
    throw new EnsAvatarUriResolutionError({ uri });
  }
}
async function parseAvatarUri({ gatewayUrls, uri }) {
  const { uri: resolvedURI, isOnChain } = resolveAvatarUri({ uri, gatewayUrls });
  if (isOnChain)
    return resolvedURI;
  const isImage = await isImageUri(resolvedURI);
  if (isImage)
    return resolvedURI;
  throw new EnsAvatarUriResolutionError({ uri });
}
function parseNftUri(uri_) {
  let uri = uri_;
  if (uri.startsWith("did:nft:")) {
    uri = uri.replace("did:nft:", "").replace(/_/g, "/");
  }
  const [reference, asset_namespace, tokenID] = uri.split("/");
  const [eip_namespace, chainID] = reference.split(":");
  const [erc_namespace, contractAddress] = asset_namespace.split(":");
  if (!eip_namespace || eip_namespace.toLowerCase() !== "eip155")
    throw new EnsAvatarInvalidNftUriError({ reason: "Only EIP-155 supported" });
  if (!chainID)
    throw new EnsAvatarInvalidNftUriError({ reason: "Chain ID not found" });
  if (!contractAddress)
    throw new EnsAvatarInvalidNftUriError({
      reason: "Contract address not found"
    });
  if (!tokenID)
    throw new EnsAvatarInvalidNftUriError({ reason: "Token ID not found" });
  if (!erc_namespace)
    throw new EnsAvatarInvalidNftUriError({ reason: "ERC namespace not found" });
  return {
    chainID: Number.parseInt(chainID, 10),
    namespace: erc_namespace.toLowerCase(),
    contractAddress,
    tokenID
  };
}
async function getNftTokenUri(client, { nft }) {
  if (nft.namespace === "erc721") {
    return readContract(client, {
      address: nft.contractAddress,
      abi: [
        {
          name: "tokenURI",
          type: "function",
          stateMutability: "view",
          inputs: [{ name: "tokenId", type: "uint256" }],
          outputs: [{ name: "", type: "string" }]
        }
      ],
      functionName: "tokenURI",
      args: [BigInt(nft.tokenID)]
    });
  }
  if (nft.namespace === "erc1155") {
    return readContract(client, {
      address: nft.contractAddress,
      abi: [
        {
          name: "uri",
          type: "function",
          stateMutability: "view",
          inputs: [{ name: "_id", type: "uint256" }],
          outputs: [{ name: "", type: "string" }]
        }
      ],
      functionName: "uri",
      args: [BigInt(nft.tokenID)]
    });
  }
  throw new EnsAvatarUnsupportedNamespaceError({ namespace: nft.namespace });
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/ens/avatar/parseAvatarRecord.js
async function parseAvatarRecord(client, { gatewayUrls, record }) {
  if (/eip155:/i.test(record))
    return parseNftAvatarUri(client, { gatewayUrls, record });
  return parseAvatarUri({ uri: record, gatewayUrls });
}
async function parseNftAvatarUri(client, { gatewayUrls, record }) {
  const nft = parseNftUri(record);
  const nftUri = await getNftTokenUri(client, { nft });
  const { uri: resolvedNftUri, isOnChain, isEncoded } = resolveAvatarUri({ uri: nftUri, gatewayUrls });
  if (isOnChain && (resolvedNftUri.includes("data:application/json;base64,") || resolvedNftUri.startsWith("{"))) {
    const encodedJson = isEncoded ? (
      // if it is encoded, decode it
      atob(resolvedNftUri.replace("data:application/json;base64,", ""))
    ) : (
      // if it isn't encoded assume it is a JSON string, but it could be anything (it will error if it is)
      resolvedNftUri
    );
    const decoded = JSON.parse(encodedJson);
    return parseAvatarUri({ uri: getJsonImage(decoded), gatewayUrls });
  }
  let uriTokenId = nft.tokenID;
  if (nft.namespace === "erc1155")
    uriTokenId = uriTokenId.replace("0x", "").padStart(64, "0");
  return getMetadataAvatarUri({
    gatewayUrls,
    uri: resolvedNftUri.replace(/(?:0x)?{id}/, uriTokenId)
  });
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/ens/getEnsText.js
async function getEnsText(client, parameters) {
  const { blockNumber, blockTag, key, name, gatewayUrls, strict } = parameters;
  const { chain: chain2 } = client;
  const universalResolverAddress = (() => {
    if (parameters.universalResolverAddress)
      return parameters.universalResolverAddress;
    if (!chain2)
      throw new Error("client chain not configured. universalResolverAddress is required.");
    return getChainContractAddress({
      blockNumber,
      chain: chain2,
      contract: "ensUniversalResolver"
    });
  })();
  const tlds = chain2?.ensTlds;
  if (tlds && !tlds.some((tld) => name.endsWith(tld)))
    return null;
  try {
    const readContractParameters = {
      address: universalResolverAddress,
      abi: universalResolverResolveAbi,
      args: [
        toHex(packetToBytes(name)),
        encodeFunctionData({
          abi: textResolverAbi,
          functionName: "text",
          args: [namehash(name), key]
        }),
        gatewayUrls ?? [localBatchGatewayUrl]
      ],
      functionName: "resolveWithGateways",
      blockNumber,
      blockTag
    };
    const readContractAction = getAction(client, readContract, "readContract");
    const res = await readContractAction(readContractParameters);
    if (res[0] === "0x")
      return null;
    const record = decodeFunctionResult({
      abi: textResolverAbi,
      functionName: "text",
      data: res[0]
    });
    return record === "" ? null : record;
  } catch (err) {
    if (strict)
      throw err;
    if (isNullUniversalResolverError(err))
      return null;
    throw err;
  }
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/ens/getEnsAvatar.js
async function getEnsAvatar(client, { blockNumber, blockTag, assetGatewayUrls, name, gatewayUrls, strict, universalResolverAddress }) {
  const record = await getAction(client, getEnsText, "getEnsText")({
    blockNumber,
    blockTag,
    key: "avatar",
    name,
    universalResolverAddress,
    gatewayUrls,
    strict
  });
  if (!record)
    return null;
  try {
    return await parseAvatarRecord(client, {
      record,
      gatewayUrls: assetGatewayUrls
    });
  } catch {
    return null;
  }
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/ens/getEnsName.js
async function getEnsName(client, parameters) {
  const { address, blockNumber, blockTag, coinType = 60n, gatewayUrls, strict } = parameters;
  const { chain: chain2 } = client;
  const universalResolverAddress = (() => {
    if (parameters.universalResolverAddress)
      return parameters.universalResolverAddress;
    if (!chain2)
      throw new Error("client chain not configured. universalResolverAddress is required.");
    return getChainContractAddress({
      blockNumber,
      chain: chain2,
      contract: "ensUniversalResolver"
    });
  })();
  try {
    const readContractParameters = {
      address: universalResolverAddress,
      abi: universalResolverReverseAbi,
      args: [address, coinType, gatewayUrls ?? [localBatchGatewayUrl]],
      functionName: "reverseWithGateways",
      blockNumber,
      blockTag
    };
    const readContractAction = getAction(client, readContract, "readContract");
    const [name] = await readContractAction(readContractParameters);
    return name || null;
  } catch (err) {
    if (strict)
      throw err;
    if (isNullUniversalResolverError(err))
      return null;
    throw err;
  }
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/ens/getEnsResolver.js
async function getEnsResolver(client, parameters) {
  const { blockNumber, blockTag, name } = parameters;
  const { chain: chain2 } = client;
  const universalResolverAddress = (() => {
    if (parameters.universalResolverAddress)
      return parameters.universalResolverAddress;
    if (!chain2)
      throw new Error("client chain not configured. universalResolverAddress is required.");
    return getChainContractAddress({
      blockNumber,
      chain: chain2,
      contract: "ensUniversalResolver"
    });
  })();
  const tlds = chain2?.ensTlds;
  if (tlds && !tlds.some((tld) => name.endsWith(tld)))
    throw new Error(`${name} is not a valid ENS TLD (${tlds?.join(", ")}) for chain "${chain2.name}" (id: ${chain2.id}).`);
  const [resolverAddress] = await getAction(client, readContract, "readContract")({
    address: universalResolverAddress,
    abi: [
      {
        inputs: [{ type: "bytes" }],
        name: "findResolver",
        outputs: [
          { type: "address" },
          { type: "bytes32" },
          { type: "uint256" }
        ],
        stateMutability: "view",
        type: "function"
      }
    ],
    functionName: "findResolver",
    args: [toHex(packetToBytes(name))],
    blockNumber,
    blockTag
  });
  return resolverAddress;
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/createAccessList.js
async function createAccessList(client, args) {
  const { account: account_ = client.account, blockNumber, blockTag = "latest", blobs, data, gas, gasPrice, maxFeePerBlobGas, maxFeePerGas, maxPriorityFeePerGas, to, value, ...rest } = args;
  const account = account_ ? parseAccount(account_) : void 0;
  try {
    assertRequest(args);
    const blockNumberHex = typeof blockNumber === "bigint" ? numberToHex(blockNumber) : void 0;
    const block = blockNumberHex || blockTag;
    const chainFormat = client.chain?.formatters?.transactionRequest?.format;
    const format = chainFormat || formatTransactionRequest;
    const request = format({
      // Pick out extra data that might exist on the chain's transaction request type.
      ...extract(rest, { format: chainFormat }),
      account,
      blobs,
      data,
      gas,
      gasPrice,
      maxFeePerBlobGas,
      maxFeePerGas,
      maxPriorityFeePerGas,
      to,
      value
    }, "createAccessList");
    const response = await client.request({
      method: "eth_createAccessList",
      params: [request, block]
    });
    if (response.error)
      throw new BaseError(response.error, { details: response.error });
    return {
      accessList: response.accessList,
      gasUsed: BigInt(response.gasUsed)
    };
  } catch (err) {
    throw getCallError(err, {
      ...args,
      account,
      chain: client.chain
    });
  }
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/createBlockFilter.js
async function createBlockFilter(client) {
  const getRequest = createFilterRequestScope(client, {
    method: "eth_newBlockFilter"
  });
  const id = await client.request({
    method: "eth_newBlockFilter"
  });
  return { id, request: getRequest(id), type: "block" };
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/createEventFilter.js
async function createEventFilter(client, { address, args, event, events: events_, fromBlock, strict, toBlock } = {}) {
  const events = events_ ?? (event ? [event] : void 0);
  const getRequest = createFilterRequestScope(client, {
    method: "eth_newFilter"
  });
  let topics = [];
  if (events) {
    const encoded = events.flatMap((event2) => encodeEventTopics({
      abi: [event2],
      eventName: event2.name,
      args
    }));
    topics = [encoded];
    if (event)
      topics = topics[0];
  }
  const id = await client.request({
    method: "eth_newFilter",
    params: [
      {
        address,
        fromBlock: typeof fromBlock === "bigint" ? numberToHex(fromBlock) : fromBlock,
        toBlock: typeof toBlock === "bigint" ? numberToHex(toBlock) : toBlock,
        ...topics.length ? { topics } : {}
      }
    ]
  });
  return {
    abi: events,
    args,
    eventName: event ? event.name : void 0,
    fromBlock,
    id,
    request: getRequest(id),
    strict: Boolean(strict),
    toBlock,
    type: "event"
  };
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/createPendingTransactionFilter.js
async function createPendingTransactionFilter(client) {
  const getRequest = createFilterRequestScope(client, {
    method: "eth_newPendingTransactionFilter"
  });
  const id = await client.request({
    method: "eth_newPendingTransactionFilter"
  });
  return { id, request: getRequest(id), type: "transaction" };
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/getBalance.js
async function getBalance(client, { address, blockHash, blockNumber, blockTag = client.experimental_blockTag ?? "latest", requireCanonical }) {
  const block = formatBlockParameter({
    blockHash,
    blockNumber,
    blockTag,
    requireCanonical
  });
  if (client.batch?.multicall && client.chain?.contracts?.multicall3) {
    const multicall3Address = client.chain.contracts.multicall3.address;
    const calldata = encodeFunctionData({
      abi: multicall3Abi,
      functionName: "getEthBalance",
      args: [address]
    });
    const { data } = await getAction(client, call, "call")({
      to: multicall3Address,
      data: calldata,
      blockHash,
      blockNumber,
      blockTag,
      requireCanonical
    });
    return decodeFunctionResult({
      abi: multicall3Abi,
      functionName: "getEthBalance",
      args: [address],
      data: data || "0x"
    });
  }
  const balance = await client.request({
    method: "eth_getBalance",
    params: [address, block]
  });
  return BigInt(balance);
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/getBlobBaseFee.js
async function getBlobBaseFee(client) {
  const baseFee = await client.request({
    method: "eth_blobBaseFee"
  });
  return BigInt(baseFee);
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/getBlockReceipts.js
async function getBlockReceipts(client, { blockHash, blockNumber, blockTag = client.experimental_blockTag ?? "latest" } = {}) {
  const blockNumberHex = blockNumber !== void 0 ? numberToHex(blockNumber) : void 0;
  const receipts = await client.request({
    method: "eth_getBlockReceipts",
    params: [blockHash || blockNumberHex || blockTag]
  }, { dedupe: Boolean(blockHash || blockNumberHex) });
  if (!receipts)
    throw new BlockNotFoundError({ blockHash, blockNumber });
  const format = client.chain?.formatters?.transactionReceipt?.format || formatTransactionReceipt;
  return receipts.map((receipt) => format(receipt, "getBlockReceipts"));
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/getBlockTransactionCount.js
async function getBlockTransactionCount(client, { blockHash, blockNumber, blockTag = "latest" } = {}) {
  const blockNumberHex = blockNumber !== void 0 ? numberToHex(blockNumber) : void 0;
  let count;
  if (blockHash) {
    count = await client.request({
      method: "eth_getBlockTransactionCountByHash",
      params: [blockHash]
    }, { dedupe: true });
  } else {
    count = await client.request({
      method: "eth_getBlockTransactionCountByNumber",
      params: [blockNumberHex || blockTag]
    }, { dedupe: Boolean(blockNumberHex) });
  }
  return hexToNumber(count);
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/getCode.js
async function getCode(client, { address, blockHash, blockNumber, blockTag = "latest", requireCanonical }) {
  const block = formatBlockParameter({
    blockHash,
    blockNumber,
    blockTag,
    requireCanonical
  });
  const hex = await client.request({
    method: "eth_getCode",
    params: [address, block]
  }, {
    dedupe: typeof blockNumber === "bigint" || blockHash !== void 0
  });
  if (hex === "0x")
    return void 0;
  return hex;
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/getDelegation.js
async function getDelegation(client, { address, blockNumber, blockTag = "latest" }) {
  const code = await getCode(client, {
    address,
    ...blockNumber !== void 0 ? { blockNumber } : { blockTag }
  });
  if (!code)
    return void 0;
  if (size(code) !== 23)
    return void 0;
  if (!code.startsWith("0xef0100"))
    return void 0;
  return getAddress(slice(code, 3, 23));
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/errors/eip712.js
var Eip712DomainNotFoundError = class extends BaseError {
  constructor({ address }) {
    super(`No EIP-712 domain found on contract "${address}".`, {
      metaMessages: [
        "Ensure that:",
        `- The contract is deployed at the address "${address}".`,
        "- `eip712Domain()` function exists on the contract.",
        "- `eip712Domain()` function matches signature to ERC-5267 specification."
      ],
      name: "Eip712DomainNotFoundError"
    });
  }
};

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/getEip712Domain.js
async function getEip712Domain(client, parameters) {
  const { address, factory, factoryData } = parameters;
  try {
    const [fields, name, version3, chainId, verifyingContract, salt, extensions] = await getAction(client, readContract, "readContract")({
      abi,
      address,
      functionName: "eip712Domain",
      factory,
      factoryData
    });
    return {
      domain: {
        name,
        version: version3,
        chainId: Number(chainId),
        verifyingContract,
        salt
      },
      extensions,
      fields
    };
  } catch (e) {
    const error = e;
    if (error.name === "ContractFunctionExecutionError" && error.cause.name === "ContractFunctionZeroDataError") {
      throw new Eip712DomainNotFoundError({ address });
    }
    throw error;
  }
}
var abi = [
  {
    inputs: [],
    name: "eip712Domain",
    outputs: [
      { name: "fields", type: "bytes1" },
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
      { name: "salt", type: "bytes32" },
      { name: "extensions", type: "uint256[]" }
    ],
    stateMutability: "view",
    type: "function"
  }
];

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/formatters/feeHistory.js
function formatFeeHistory(feeHistory) {
  return {
    baseFeePerGas: feeHistory.baseFeePerGas.map((value) => BigInt(value)),
    gasUsedRatio: feeHistory.gasUsedRatio,
    oldestBlock: BigInt(feeHistory.oldestBlock),
    reward: feeHistory.reward?.map((reward) => reward.map((value) => BigInt(value)))
  };
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/getFeeHistory.js
async function getFeeHistory(client, { blockCount, blockNumber, blockTag = "latest", rewardPercentiles }) {
  const blockNumberHex = typeof blockNumber === "bigint" ? numberToHex(blockNumber) : void 0;
  const feeHistory = await client.request({
    method: "eth_feeHistory",
    params: [
      numberToHex(blockCount),
      blockNumberHex || blockTag,
      rewardPercentiles
    ]
  }, { dedupe: Boolean(blockNumberHex) });
  return formatFeeHistory(feeHistory);
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/getFilterLogs.js
async function getFilterLogs(_client, { filter }) {
  const strict = filter.strict ?? false;
  const logs = await filter.request({
    method: "eth_getFilterLogs",
    params: [filter.id]
  });
  const formattedLogs = logs.map((log2) => formatLog(log2));
  if (!filter.abi)
    return formattedLogs;
  return parseEventLogs({
    abi: filter.abi,
    logs: formattedLogs,
    strict
  });
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/transaction/assertTransaction.js
function assertTransactionEIP7702(transaction) {
  const { authorizationList } = transaction;
  if (authorizationList) {
    for (const authorization of authorizationList) {
      const { chainId } = authorization;
      const address = authorization.address;
      if (!isAddress(address))
        throw new InvalidAddressError({ address });
      if (chainId < 0)
        throw new InvalidChainIdError({ chainId });
    }
  }
  assertTransactionEIP1559(transaction);
}
function assertTransactionEIP4844(transaction) {
  const { blobVersionedHashes } = transaction;
  if (blobVersionedHashes) {
    if (blobVersionedHashes.length === 0)
      throw new EmptyBlobError();
    for (const hash2 of blobVersionedHashes) {
      const size_ = size(hash2);
      const version3 = hexToNumber(slice(hash2, 0, 1));
      if (size_ !== 32)
        throw new InvalidVersionedHashSizeError({ hash: hash2, size: size_ });
      if (version3 !== versionedHashVersionKzg)
        throw new InvalidVersionedHashVersionError({
          hash: hash2,
          version: version3
        });
    }
  }
  assertTransactionEIP1559(transaction);
}
function assertTransactionEIP1559(transaction) {
  const { chainId, maxPriorityFeePerGas, maxFeePerGas, to } = transaction;
  if (chainId <= 0)
    throw new InvalidChainIdError({ chainId });
  if (to && !isAddress(to))
    throw new InvalidAddressError({ address: to });
  if (maxFeePerGas && maxFeePerGas > maxUint256)
    throw new FeeCapTooHighError({ maxFeePerGas });
  if (maxPriorityFeePerGas && maxFeePerGas && maxPriorityFeePerGas > maxFeePerGas)
    throw new TipAboveFeeCapError({ maxFeePerGas, maxPriorityFeePerGas });
}
function assertTransactionEIP2930(transaction) {
  const { chainId, maxPriorityFeePerGas, gasPrice, maxFeePerGas, to } = transaction;
  if (chainId <= 0)
    throw new InvalidChainIdError({ chainId });
  if (to && !isAddress(to))
    throw new InvalidAddressError({ address: to });
  if (maxPriorityFeePerGas || maxFeePerGas)
    throw new BaseError("`maxFeePerGas`/`maxPriorityFeePerGas` is not a valid EIP-2930 Transaction attribute.");
  if (gasPrice && gasPrice > maxUint256)
    throw new FeeCapTooHighError({ maxFeePerGas: gasPrice });
}
function assertTransactionLegacy(transaction) {
  const { chainId, maxPriorityFeePerGas, gasPrice, maxFeePerGas, to } = transaction;
  if (to && !isAddress(to))
    throw new InvalidAddressError({ address: to });
  if (typeof chainId !== "undefined" && chainId <= 0)
    throw new InvalidChainIdError({ chainId });
  if (maxPriorityFeePerGas || maxFeePerGas)
    throw new BaseError("`maxFeePerGas`/`maxPriorityFeePerGas` is not a valid Legacy Transaction attribute.");
  if (gasPrice && gasPrice > maxUint256)
    throw new FeeCapTooHighError({ maxFeePerGas: gasPrice });
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/transaction/serializeAccessList.js
function serializeAccessList(accessList) {
  if (!accessList || accessList.length === 0)
    return [];
  const serializedAccessList = [];
  for (let i2 = 0; i2 < accessList.length; i2++) {
    const { address, storageKeys } = accessList[i2];
    for (let j2 = 0; j2 < storageKeys.length; j2++) {
      if (storageKeys[j2].length - 2 !== 64) {
        throw new InvalidStorageKeySizeError({ storageKey: storageKeys[j2] });
      }
    }
    if (!isAddress(address, { strict: false })) {
      throw new InvalidAddressError({ address });
    }
    serializedAccessList.push([address, storageKeys]);
  }
  return serializedAccessList;
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/transaction/serializeTransaction.js
function serializeTransaction(transaction, signature) {
  const type = getTransactionType(transaction);
  if (type === "eip1559")
    return serializeTransactionEIP1559(transaction, signature);
  if (type === "eip2930")
    return serializeTransactionEIP2930(transaction, signature);
  if (type === "eip4844")
    return serializeTransactionEIP4844(transaction, signature);
  if (type === "eip7702")
    return serializeTransactionEIP7702(transaction, signature);
  return serializeTransactionLegacy(transaction, signature);
}
function serializeTransactionEIP7702(transaction, signature) {
  const { authorizationList, chainId, gas, nonce, to, value, maxFeePerGas, maxPriorityFeePerGas, accessList, data } = transaction;
  assertTransactionEIP7702(transaction);
  const serializedAccessList = serializeAccessList(accessList);
  const serializedAuthorizationList = serializeAuthorizationList(authorizationList);
  return concatHex([
    "0x04",
    toRlp([
      numberToHex(chainId),
      nonce ? numberToHex(nonce) : "0x",
      maxPriorityFeePerGas ? numberToHex(maxPriorityFeePerGas) : "0x",
      maxFeePerGas ? numberToHex(maxFeePerGas) : "0x",
      gas ? numberToHex(gas) : "0x",
      to ?? "0x",
      value ? numberToHex(value) : "0x",
      data ?? "0x",
      serializedAccessList,
      serializedAuthorizationList,
      ...toYParitySignatureArray(transaction, signature)
    ])
  ]);
}
function serializeTransactionEIP4844(transaction, signature) {
  const { chainId, gas, nonce, to, value, maxFeePerBlobGas, maxFeePerGas, maxPriorityFeePerGas, accessList, data } = transaction;
  assertTransactionEIP4844(transaction);
  let blobVersionedHashes = transaction.blobVersionedHashes;
  let sidecars = transaction.sidecars;
  if (transaction.blobs && (typeof blobVersionedHashes === "undefined" || typeof sidecars === "undefined")) {
    const blobs2 = typeof transaction.blobs[0] === "string" ? transaction.blobs : transaction.blobs.map((x2) => bytesToHex(x2));
    const kzg = transaction.kzg;
    const commitments2 = blobsToCommitments({
      blobs: blobs2,
      kzg
    });
    if (typeof blobVersionedHashes === "undefined")
      blobVersionedHashes = commitmentsToVersionedHashes({
        commitments: commitments2
      });
    if (typeof sidecars === "undefined") {
      const proofs2 = blobsToProofs({ blobs: blobs2, commitments: commitments2, kzg });
      sidecars = toBlobSidecars({ blobs: blobs2, commitments: commitments2, proofs: proofs2 });
    }
  }
  const serializedAccessList = serializeAccessList(accessList);
  const serializedTransaction = [
    numberToHex(chainId),
    nonce ? numberToHex(nonce) : "0x",
    maxPriorityFeePerGas ? numberToHex(maxPriorityFeePerGas) : "0x",
    maxFeePerGas ? numberToHex(maxFeePerGas) : "0x",
    gas ? numberToHex(gas) : "0x",
    to ?? "0x",
    value ? numberToHex(value) : "0x",
    data ?? "0x",
    serializedAccessList,
    maxFeePerBlobGas ? numberToHex(maxFeePerBlobGas) : "0x",
    blobVersionedHashes ?? [],
    ...toYParitySignatureArray(transaction, signature)
  ];
  const blobs = [];
  const commitments = [];
  const proofs = [];
  if (sidecars)
    for (let i2 = 0; i2 < sidecars.length; i2++) {
      const { blob, commitment, proof } = sidecars[i2];
      blobs.push(blob);
      commitments.push(commitment);
      proofs.push(proof);
    }
  return concatHex([
    "0x03",
    sidecars ? (
      // If sidecars are enabled, envelope turns into a "wrapper":
      toRlp([serializedTransaction, blobs, commitments, proofs])
    ) : (
      // If sidecars are disabled, standard envelope is used:
      toRlp(serializedTransaction)
    )
  ]);
}
function serializeTransactionEIP1559(transaction, signature) {
  const { chainId, gas, nonce, to, value, maxFeePerGas, maxPriorityFeePerGas, accessList, data } = transaction;
  assertTransactionEIP1559(transaction);
  const serializedAccessList = serializeAccessList(accessList);
  const serializedTransaction = [
    numberToHex(chainId),
    nonce ? numberToHex(nonce) : "0x",
    maxPriorityFeePerGas ? numberToHex(maxPriorityFeePerGas) : "0x",
    maxFeePerGas ? numberToHex(maxFeePerGas) : "0x",
    gas ? numberToHex(gas) : "0x",
    to ?? "0x",
    value ? numberToHex(value) : "0x",
    data ?? "0x",
    serializedAccessList,
    ...toYParitySignatureArray(transaction, signature)
  ];
  return concatHex([
    "0x02",
    toRlp(serializedTransaction)
  ]);
}
function serializeTransactionEIP2930(transaction, signature) {
  const { chainId, gas, data, nonce, to, value, accessList, gasPrice } = transaction;
  assertTransactionEIP2930(transaction);
  const serializedAccessList = serializeAccessList(accessList);
  const serializedTransaction = [
    numberToHex(chainId),
    nonce ? numberToHex(nonce) : "0x",
    gasPrice ? numberToHex(gasPrice) : "0x",
    gas ? numberToHex(gas) : "0x",
    to ?? "0x",
    value ? numberToHex(value) : "0x",
    data ?? "0x",
    serializedAccessList,
    ...toYParitySignatureArray(transaction, signature)
  ];
  return concatHex([
    "0x01",
    toRlp(serializedTransaction)
  ]);
}
function serializeTransactionLegacy(transaction, signature) {
  const { chainId = 0, gas, data, nonce, to, value, gasPrice } = transaction;
  assertTransactionLegacy(transaction);
  let serializedTransaction = [
    nonce ? numberToHex(nonce) : "0x",
    gasPrice ? numberToHex(gasPrice) : "0x",
    gas ? numberToHex(gas) : "0x",
    to ?? "0x",
    value ? numberToHex(value) : "0x",
    data ?? "0x"
  ];
  if (signature) {
    const v = (() => {
      if (signature.v >= 35n) {
        const inferredChainId = (signature.v - 35n) / 2n;
        if (inferredChainId > 0)
          return signature.v;
        return 27n + (signature.v === 35n ? 0n : 1n);
      }
      if (chainId > 0)
        return BigInt(chainId * 2) + BigInt(35n + signature.v - 27n);
      const v2 = 27n + (signature.v === 27n ? 0n : 1n);
      if (signature.v !== v2)
        throw new InvalidLegacyVError({ v: signature.v });
      return v2;
    })();
    const r = trim(signature.r);
    const s2 = trim(signature.s);
    serializedTransaction = [
      ...serializedTransaction,
      numberToHex(v),
      r === "0x00" ? "0x" : r,
      s2 === "0x00" ? "0x" : s2
    ];
  } else if (chainId > 0) {
    serializedTransaction = [
      ...serializedTransaction,
      numberToHex(chainId),
      "0x",
      "0x"
    ];
  }
  return toRlp(serializedTransaction);
}
function toYParitySignatureArray(transaction, signature_) {
  const signature = signature_ ?? transaction;
  const { v, yParity } = signature;
  if (typeof signature.r === "undefined")
    return [];
  if (typeof signature.s === "undefined")
    return [];
  if (typeof v === "undefined" && typeof yParity === "undefined")
    return [];
  const r = trim(signature.r);
  const s2 = trim(signature.s);
  const yParity_ = (() => {
    if (typeof yParity === "number")
      return yParity ? numberToHex(1) : "0x";
    if (v === 0n)
      return "0x";
    if (v === 1n)
      return numberToHex(1);
    return v === 27n ? "0x" : numberToHex(1);
  })();
  return [yParity_, r === "0x00" ? "0x" : r, s2 === "0x00" ? "0x" : s2];
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/authorization/serializeAuthorizationList.js
function serializeAuthorizationList(authorizationList) {
  if (!authorizationList || authorizationList.length === 0)
    return [];
  const serializedAuthorizationList = [];
  for (const authorization of authorizationList) {
    const { chainId, nonce, ...signature } = authorization;
    const contractAddress = authorization.address;
    serializedAuthorizationList.push([
      chainId ? toHex(chainId) : "0x",
      contractAddress,
      nonce ? toHex(nonce) : "0x",
      ...toYParitySignatureArray({}, signature)
    ]);
  }
  return serializedAuthorizationList;
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/authorization/verifyAuthorization.js
async function verifyAuthorization({ address, authorization, signature }) {
  return isAddressEqual(getAddress(address), await recoverAuthorizationAddress({
    authorization,
    signature
  }));
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/promise/withDedupe.js
var promiseCache2 = /* @__PURE__ */ new LruMap(8192);
function withDedupe(fn, { enabled = true, id }) {
  if (!enabled || !id)
    return fn();
  if (promiseCache2.get(id))
    return promiseCache2.get(id);
  const promise = fn().finally(() => promiseCache2.delete(id));
  promiseCache2.set(id, promise);
  return promise;
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/buildRequest.js
function buildRequest(request, options = {}) {
  return async (args, overrideOptions = {}) => {
    const { dedupe = false, methods, retryDelay = 150, retryCount = 3, signal, uid: uid2 } = {
      ...options,
      ...overrideOptions
    };
    const { method } = args;
    if (methods?.exclude?.includes(method))
      throw new MethodNotSupportedRpcError(new Error("method not supported"), {
        method
      });
    if (methods?.include && !methods.include.includes(method))
      throw new MethodNotSupportedRpcError(new Error("method not supported"), {
        method
      });
    if (signal?.aborted)
      throw getAbortError(signal);
    const requestId = dedupe ? hashString(`${uid2}.${stringify(args)}`) : void 0;
    return withDedupe(() => withRetry(async () => {
      try {
        return await request(args, signal ? { signal } : void 0);
      } catch (err_) {
        if (signal?.aborted)
          throw getAbortError(signal);
        if (isAbortError(err_))
          throw err_;
        const err = err_;
        switch (err.code) {
          // -32700
          case ParseRpcError.code:
            throw new ParseRpcError(err);
          // -32600
          case InvalidRequestRpcError.code:
            throw new InvalidRequestRpcError(err);
          // -32601
          case MethodNotFoundRpcError.code:
            throw new MethodNotFoundRpcError(err, { method: args.method });
          // -32602
          case InvalidParamsRpcError.code:
            throw new InvalidParamsRpcError(err);
          // -32603
          case InternalRpcError.code:
            throw new InternalRpcError(err);
          // -32000
          case InvalidInputRpcError.code:
            throw new InvalidInputRpcError(err);
          // -32001
          case ResourceNotFoundRpcError.code:
            throw new ResourceNotFoundRpcError(err);
          // -32002
          case ResourceUnavailableRpcError.code:
            throw new ResourceUnavailableRpcError(err);
          // -32003
          case TransactionRejectedRpcError.code:
            throw new TransactionRejectedRpcError(err);
          // -32004
          case MethodNotSupportedRpcError.code:
            throw new MethodNotSupportedRpcError(err, {
              method: args.method
            });
          // -32005
          case LimitExceededRpcError.code:
            throw new LimitExceededRpcError(err);
          // -32006
          case JsonRpcVersionUnsupportedError.code:
            throw new JsonRpcVersionUnsupportedError(err);
          // 4001
          case UserRejectedRequestError.code:
            throw new UserRejectedRequestError(err);
          // 4100
          case UnauthorizedProviderError.code:
            throw new UnauthorizedProviderError(err);
          // 4200
          case UnsupportedProviderMethodError.code:
            throw new UnsupportedProviderMethodError(err);
          // 4900
          case ProviderDisconnectedError.code:
            throw new ProviderDisconnectedError(err);
          // 4901
          case ChainDisconnectedError.code:
            throw new ChainDisconnectedError(err);
          // 4902
          case SwitchChainError.code:
            throw new SwitchChainError(err);
          // 5700
          case UnsupportedNonOptionalCapabilityError.code:
            throw new UnsupportedNonOptionalCapabilityError(err);
          // 5710
          case UnsupportedChainIdError.code:
            throw new UnsupportedChainIdError(err);
          // 5720
          case DuplicateIdError.code:
            throw new DuplicateIdError(err);
          // 5730
          case UnknownBundleIdError.code:
            throw new UnknownBundleIdError(err);
          // 5740
          case BundleTooLargeError.code:
            throw new BundleTooLargeError(err);
          // 5750
          case AtomicReadyWalletRejectedUpgradeError.code:
            throw new AtomicReadyWalletRejectedUpgradeError(err);
          // 5760
          case AtomicityNotSupportedError.code:
            throw new AtomicityNotSupportedError(err);
          // CAIP-25: User Rejected Error
          // https://docs.walletconnect.com/2.0/specs/clients/sign/error-codes#rejected-caip-25
          case 5e3:
            throw new UserRejectedRequestError(err);
          // WalletConnect: Session Settlement Failed
          // https://docs.walletconnect.com/2.0/specs/clients/sign/error-codes
          case WalletConnectSessionSettlementError.code:
            throw new WalletConnectSessionSettlementError(err);
          default:
            if (err_ instanceof BaseError)
              throw err_;
            throw new UnknownRpcError(err);
        }
      }
    }, {
      delay: ({ count, error }) => {
        if (error && error instanceof HttpRequestError) {
          const retryAfter = error?.headers?.get("Retry-After");
          if (retryAfter?.match(/\d/))
            return Number.parseInt(retryAfter, 10) * 1e3;
        }
        return ~~(1 << count) * retryDelay;
      },
      retryCount,
      signal,
      shouldRetry: ({ error }) => shouldRetry(error)
    }), { enabled: dedupe, id: requestId });
  };
}
function shouldRetry(error) {
  if (isAbortError(error))
    return false;
  if ("code" in error && typeof error.code === "number") {
    if (error.code === -1)
      return true;
    if (error.code === LimitExceededRpcError.code)
      return true;
    if (error.code === InternalRpcError.code)
      return true;
    if (error.code === 429)
      return true;
    return false;
  }
  if (error instanceof HttpRequestError && error.status) {
    if (error.status === 403)
      return true;
    if (error.status === 408)
      return true;
    if (error.status === 413)
      return true;
    if (error.status === 429)
      return true;
    if (error.status === 500)
      return true;
    if (error.status === 502)
      return true;
    if (error.status === 503)
      return true;
    if (error.status === 504)
      return true;
    return false;
  }
  return true;
}
function hashString(str, seed = 0) {
  let h1 = 3735928559 ^ seed;
  let h22 = 1103547991 ^ seed;
  for (let i2 = 0; i2 < str.length; i2++) {
    const ch = str.charCodeAt(i2);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h22 = Math.imul(h22 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507);
  h1 ^= Math.imul(h22 ^ h22 >>> 16, 3266489909);
  h22 = Math.imul(h22 ^ h22 >>> 16, 2246822507);
  h22 ^= Math.imul(h1 ^ h1 >>> 16, 3266489909);
  return (4294967296 * (2097151 & h22) + (h1 >>> 0)).toString(36);
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/encoding/fromRlp.js
function fromRlp(value, to = "hex") {
  const bytes = (() => {
    if (typeof value === "string") {
      if (value.length > 3 && value.length % 2 !== 0)
        throw new InvalidHexValueError(value);
      return hexToBytes(value);
    }
    return value;
  })();
  const cursor = createCursor(bytes, {
    recursiveReadLimit: Number.POSITIVE_INFINITY
  });
  const result = fromRlpCursor(cursor, to);
  return result;
}
function fromRlpCursor(cursor, to = "hex") {
  if (cursor.bytes.length === 0)
    return to === "hex" ? bytesToHex(cursor.bytes) : cursor.bytes;
  const prefix = cursor.readByte();
  if (prefix < 128)
    cursor.decrementPosition(1);
  if (prefix < 192) {
    const length2 = readLength(cursor, prefix, 128);
    const bytes = cursor.readBytes(length2);
    return to === "hex" ? bytesToHex(bytes) : bytes;
  }
  const length = readLength(cursor, prefix, 192);
  return readList(cursor, length, to);
}
function readLength(cursor, prefix, offset) {
  if (offset === 128 && prefix < 128)
    return 1;
  if (prefix <= offset + 55)
    return prefix - offset;
  if (prefix === offset + 55 + 1)
    return cursor.readUint8();
  if (prefix === offset + 55 + 2)
    return cursor.readUint16();
  if (prefix === offset + 55 + 3)
    return cursor.readUint24();
  if (prefix === offset + 55 + 4)
    return cursor.readUint32();
  throw new BaseError("Invalid RLP prefix");
}
function readList(cursor, length, to) {
  const position = cursor.position;
  const value = [];
  while (cursor.position - position < length)
    value.push(fromRlpCursor(cursor, to));
  return value;
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/hash/isHash.js
function isHash(hash2) {
  return isHex(hash2) && size(hash2) === 32;
}

// node_modules/@noble/hashes/esm/legacy.js
var Rho160 = /* @__PURE__ */ Uint8Array.from([
  7,
  4,
  13,
  1,
  10,
  6,
  15,
  3,
  12,
  0,
  9,
  5,
  2,
  14,
  11,
  8
]);
var Id160 = /* @__PURE__ */ (() => Uint8Array.from(new Array(16).fill(0).map((_2, i2) => i2)))();
var Pi160 = /* @__PURE__ */ (() => Id160.map((i2) => (9 * i2 + 5) % 16))();
var idxLR = /* @__PURE__ */ (() => {
  const L3 = [Id160];
  const R3 = [Pi160];
  const res = [L3, R3];
  for (let i2 = 0; i2 < 4; i2++)
    for (let j2 of res)
      j2.push(j2[i2].map((k3) => Rho160[k3]));
  return res;
})();
var idxL = /* @__PURE__ */ (() => idxLR[0])();
var idxR = /* @__PURE__ */ (() => idxLR[1])();
var shifts160 = /* @__PURE__ */ [
  [11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8],
  [12, 13, 11, 15, 6, 9, 9, 7, 12, 15, 11, 13, 7, 8, 7, 7],
  [13, 15, 14, 11, 7, 7, 6, 8, 13, 14, 13, 12, 5, 5, 6, 9],
  [14, 11, 12, 14, 8, 6, 5, 5, 15, 12, 15, 14, 9, 9, 8, 6],
  [15, 12, 13, 13, 9, 5, 8, 6, 14, 11, 12, 11, 8, 6, 5, 5]
].map((i2) => Uint8Array.from(i2));
var shiftsL160 = /* @__PURE__ */ idxL.map((idx, i2) => idx.map((j2) => shifts160[i2][j2]));
var shiftsR160 = /* @__PURE__ */ idxR.map((idx, i2) => idx.map((j2) => shifts160[i2][j2]));
var Kl160 = /* @__PURE__ */ Uint32Array.from([
  0,
  1518500249,
  1859775393,
  2400959708,
  2840853838
]);
var Kr160 = /* @__PURE__ */ Uint32Array.from([
  1352829926,
  1548603684,
  1836072691,
  2053994217,
  0
]);
function ripemd_f(group, x2, y2, z3) {
  if (group === 0)
    return x2 ^ y2 ^ z3;
  if (group === 1)
    return x2 & y2 | ~x2 & z3;
  if (group === 2)
    return (x2 | ~y2) ^ z3;
  if (group === 3)
    return x2 & z3 | y2 & ~z3;
  return x2 ^ (y2 | ~z3);
}
var BUF_160 = /* @__PURE__ */ new Uint32Array(16);
var RIPEMD160 = class extends HashMD {
  constructor() {
    super(64, 20, 8, true);
    this.h0 = 1732584193 | 0;
    this.h1 = 4023233417 | 0;
    this.h2 = 2562383102 | 0;
    this.h3 = 271733878 | 0;
    this.h4 = 3285377520 | 0;
  }
  get() {
    const { h0, h1, h2: h22, h3, h4 } = this;
    return [h0, h1, h22, h3, h4];
  }
  set(h0, h1, h22, h3, h4) {
    this.h0 = h0 | 0;
    this.h1 = h1 | 0;
    this.h2 = h22 | 0;
    this.h3 = h3 | 0;
    this.h4 = h4 | 0;
  }
  process(view, offset) {
    for (let i2 = 0; i2 < 16; i2++, offset += 4)
      BUF_160[i2] = view.getUint32(offset, true);
    let al = this.h0 | 0, ar = al, bl = this.h1 | 0, br = bl, cl = this.h2 | 0, cr = cl, dl = this.h3 | 0, dr = dl, el = this.h4 | 0, er = el;
    for (let group = 0; group < 5; group++) {
      const rGroup = 4 - group;
      const hbl = Kl160[group], hbr = Kr160[group];
      const rl = idxL[group], rr = idxR[group];
      const sl = shiftsL160[group], sr = shiftsR160[group];
      for (let i2 = 0; i2 < 16; i2++) {
        const tl = rotl(al + ripemd_f(group, bl, cl, dl) + BUF_160[rl[i2]] + hbl, sl[i2]) + el | 0;
        al = el, el = dl, dl = rotl(cl, 10) | 0, cl = bl, bl = tl;
      }
      for (let i2 = 0; i2 < 16; i2++) {
        const tr = rotl(ar + ripemd_f(rGroup, br, cr, dr) + BUF_160[rr[i2]] + hbr, sr[i2]) + er | 0;
        ar = er, er = dr, dr = rotl(cr, 10) | 0, cr = br, br = tr;
      }
    }
    this.set(this.h1 + cl + dr | 0, this.h2 + dl + er | 0, this.h3 + el + ar | 0, this.h4 + al + br | 0, this.h0 + bl + cr | 0);
  }
  roundClean() {
    clean(BUF_160);
  }
  destroy() {
    this.destroyed = true;
    clean(this.buffer);
    this.set(0, 0, 0, 0, 0);
  }
};
var ripemd160 = /* @__PURE__ */ createHasher(() => new RIPEMD160());

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/constants/strings.js
var presignMessagePrefix = "Ethereum Signed Message:\n";

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/signature/toPrefixedMessage.js
function toPrefixedMessage(message_) {
  const message = (() => {
    if (typeof message_ === "string")
      return stringToHex(message_);
    if (typeof message_.raw === "string")
      return message_.raw;
    return bytesToHex(message_.raw);
  })();
  const prefix = stringToHex(`${presignMessagePrefix}${size(message)}`);
  return concat([prefix, message]);
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/signature/hashMessage.js
function hashMessage(message, to_) {
  return keccak256(toPrefixedMessage(message), to_);
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/errors/typedData.js
var InvalidDomainError = class extends BaseError {
  constructor({ domain }) {
    super(`Invalid domain "${stringify(domain)}".`, {
      metaMessages: ["Must be a valid EIP-712 domain."]
    });
  }
};
var InvalidPrimaryTypeError = class extends BaseError {
  constructor({ primaryType, types }) {
    super(`Invalid primary type \`${primaryType}\` must be one of \`${JSON.stringify(Object.keys(types))}\`.`, {
      docsPath: "/api/glossary/Errors#typeddatainvalidprimarytypeerror",
      metaMessages: ["Check that the primary type is a key in `types`."]
    });
  }
};
var InvalidStructTypeError = class extends BaseError {
  constructor({ type }) {
    super(`Struct type "${type}" is invalid.`, {
      metaMessages: ["Struct type must not be a Solidity type."],
      name: "InvalidStructTypeError"
    });
  }
};

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/typedData.js
function validateTypedData(parameters) {
  const { domain, message, primaryType, types } = parameters;
  const validateData = (struct, data) => {
    for (const param of struct) {
      const { name, type } = param;
      const value = data[name];
      const integerMatch = type.match(integerRegex);
      if (integerMatch && (typeof value === "number" || typeof value === "bigint")) {
        const [_type, base, size_] = integerMatch;
        numberToHex(value, {
          signed: base === "int",
          size: Number.parseInt(size_, 10) / 8
        });
      }
      if (type === "address" && typeof value === "string" && !isAddress(value))
        throw new InvalidAddressError({ address: value });
      const bytesMatch = type.match(bytesRegex);
      if (bytesMatch) {
        const [_type, size_] = bytesMatch;
        if (size_ && size(value) !== Number.parseInt(size_, 10))
          throw new BytesSizeMismatchError({
            expectedSize: Number.parseInt(size_, 10),
            givenSize: size(value)
          });
      }
      const struct2 = types[type];
      if (struct2) {
        validateReference(type);
        validateData(struct2, value);
      }
    }
  };
  if (types.EIP712Domain && domain) {
    if (typeof domain !== "object")
      throw new InvalidDomainError({ domain });
    validateData(types.EIP712Domain, domain);
  }
  if (primaryType !== "EIP712Domain") {
    if (types[primaryType])
      validateData(types[primaryType], message);
    else
      throw new InvalidPrimaryTypeError({ primaryType, types });
  }
}
function getTypesForEIP712Domain({ domain }) {
  return [
    typeof domain?.name === "string" && { name: "name", type: "string" },
    domain?.version && { name: "version", type: "string" },
    (typeof domain?.chainId === "number" || typeof domain?.chainId === "bigint") && {
      name: "chainId",
      type: "uint256"
    },
    domain?.verifyingContract && {
      name: "verifyingContract",
      type: "address"
    },
    domain?.salt && { name: "salt", type: "bytes32" }
  ].filter(Boolean);
}
function validateReference(type) {
  if (type === "address" || type === "bool" || type === "string" || type.startsWith("bytes") || type.startsWith("uint") || type.startsWith("int"))
    throw new InvalidStructTypeError({ type });
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/signature/hashTypedData.js
function hashTypedData(parameters) {
  const { domain = {}, message, primaryType } = parameters;
  const types = {
    EIP712Domain: getTypesForEIP712Domain({ domain }),
    ...parameters.types
  };
  validateTypedData({
    domain,
    message,
    primaryType,
    types
  });
  const parts = ["0x1901"];
  if (domain)
    parts.push(hashDomain({
      domain,
      types
    }));
  if (primaryType !== "EIP712Domain")
    parts.push(hashStruct({
      data: message,
      primaryType,
      types
    }));
  return keccak256(concat(parts));
}
function hashDomain({ domain, types }) {
  return hashStruct({
    data: domain,
    primaryType: "EIP712Domain",
    types
  });
}
function hashStruct({ data, primaryType, types }) {
  const encoded = encodeData({
    data,
    primaryType,
    types
  });
  return keccak256(encoded);
}
function encodeData({ data, primaryType, types }) {
  const encodedTypes = [{ type: "bytes32" }];
  const encodedValues = [hashType({ primaryType, types })];
  for (const field of types[primaryType]) {
    const [type, value] = encodeField({
      types,
      name: field.name,
      type: field.type,
      value: data[field.name]
    });
    encodedTypes.push(type);
    encodedValues.push(value);
  }
  return encodeAbiParameters(encodedTypes, encodedValues);
}
function hashType({ primaryType, types }) {
  const encodedHashType = toHex(encodeType({ primaryType, types }));
  return keccak256(encodedHashType);
}
function encodeType({ primaryType, types }) {
  let result = "";
  const unsortedDeps = findTypeDependencies({ primaryType, types });
  unsortedDeps.delete(primaryType);
  const deps = [primaryType, ...Array.from(unsortedDeps).sort()];
  for (const type of deps) {
    result += `${type}(${types[type].map(({ name, type: t }) => `${t} ${name}`).join(",")})`;
  }
  return result;
}
function findTypeDependencies({ primaryType: primaryType_, types }, results = /* @__PURE__ */ new Set()) {
  const match = primaryType_.match(/^\w*/u);
  const primaryType = match?.[0];
  if (results.has(primaryType) || types[primaryType] === void 0) {
    return results;
  }
  results.add(primaryType);
  for (const field of types[primaryType]) {
    findTypeDependencies({ primaryType: field.type, types }, results);
  }
  return results;
}
function encodeField({ types, name, type, value }) {
  if (types[type] !== void 0) {
    return [
      { type: "bytes32" },
      keccak256(encodeData({ data: value, primaryType: type, types }))
    ];
  }
  if (type === "bytes")
    return [{ type: "bytes32" }, keccak256(value)];
  if (type === "string")
    return [{ type: "bytes32" }, keccak256(toHex(value))];
  if (type.lastIndexOf("]") === type.length - 1) {
    const parsedType = type.slice(0, type.lastIndexOf("["));
    const typeValuePairs = value.map((item) => encodeField({
      name,
      type: parsedType,
      types,
      value: item
    }));
    return [
      { type: "bytes32" },
      keccak256(encodeAbiParameters(typeValuePairs.map(([t]) => t), typeValuePairs.map(([, v]) => v)))
    ];
  }
  return [{ type }, value];
}

// node_modules/@metamask/fox-sdk/node_modules/ox/_esm/erc8010/SignatureErc8010.js
var SignatureErc8010_exports = {};
__export(SignatureErc8010_exports, {
  InvalidWrappedSignatureError: () => InvalidWrappedSignatureError,
  assert: () => assert4,
  from: () => from9,
  magicBytes: () => magicBytes,
  suffixParameters: () => suffixParameters,
  unwrap: () => unwrap,
  validate: () => validate4,
  wrap: () => wrap
});

// node_modules/@metamask/fox-sdk/node_modules/abitype/dist/esm/version.js
var version = "1.3.0";

// node_modules/@metamask/fox-sdk/node_modules/abitype/dist/esm/errors.js
var BaseError3 = class _BaseError extends Error {
  constructor(shortMessage, args = {}) {
    const details = args.cause instanceof _BaseError ? args.cause.details : args.cause?.message ? args.cause.message : args.details;
    const docsPath3 = args.cause instanceof _BaseError ? args.cause.docsPath || args.docsPath : args.docsPath;
    const message = [
      shortMessage || "An error occurred.",
      "",
      ...args.metaMessages ? [...args.metaMessages, ""] : [],
      ...docsPath3 ? [`Docs: https://abitype.dev${docsPath3}`] : [],
      ...details ? [`Details: ${details}`] : [],
      `Version: abitype@${version}`
    ].join("\n");
    super(message);
    Object.defineProperty(this, "details", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "docsPath", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "metaMessages", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "shortMessage", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "AbiTypeError"
    });
    if (args.cause)
      this.cause = args.cause;
    this.details = details;
    this.docsPath = docsPath3;
    this.metaMessages = args.metaMessages;
    this.shortMessage = shortMessage;
  }
};

// node_modules/@metamask/fox-sdk/node_modules/abitype/dist/esm/regex.js
function execTyped(regex, string) {
  const match = regex.exec(string);
  return match?.groups;
}
var bytesRegex2 = /^bytes([1-9]|1[0-9]|2[0-9]|3[0-2])?$/;
var integerRegex2 = /^u?int(8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)?$/;
var isTupleRegex = /^\(.+?\).*?$/;

// node_modules/@metamask/fox-sdk/node_modules/abitype/dist/esm/human-readable/formatAbiParameter.js
var tupleRegex = /^tuple(?<array>(\[(\d*)\])*)$/;
function formatAbiParameter(abiParameter) {
  let type = abiParameter.type;
  if (tupleRegex.test(abiParameter.type) && "components" in abiParameter) {
    type = "(";
    const length = abiParameter.components.length;
    for (let i2 = 0; i2 < length; i2++) {
      const component = abiParameter.components[i2];
      type += formatAbiParameter(component);
      if (i2 < length - 1)
        type += ", ";
    }
    const result = execTyped(tupleRegex, abiParameter.type);
    type += `)${result?.array || ""}`;
    return formatAbiParameter({
      ...abiParameter,
      type
    });
  }
  if ("indexed" in abiParameter && abiParameter.indexed)
    type = `${type} indexed`;
  if (abiParameter.name)
    return `${type} ${abiParameter.name}`;
  return type;
}

// node_modules/@metamask/fox-sdk/node_modules/abitype/dist/esm/human-readable/formatAbiParameters.js
function formatAbiParameters(abiParameters) {
  let params = "";
  const length = abiParameters.length;
  for (let i2 = 0; i2 < length; i2++) {
    const abiParameter = abiParameters[i2];
    params += formatAbiParameter(abiParameter);
    if (i2 !== length - 1)
      params += ", ";
  }
  return params;
}

// node_modules/@metamask/fox-sdk/node_modules/abitype/dist/esm/human-readable/formatAbiItem.js
function formatAbiItem2(abiItem) {
  if (abiItem.type === "function")
    return `function ${abiItem.name}(${formatAbiParameters(abiItem.inputs)})${abiItem.stateMutability && abiItem.stateMutability !== "nonpayable" ? ` ${abiItem.stateMutability}` : ""}${abiItem.outputs?.length ? ` returns (${formatAbiParameters(abiItem.outputs)})` : ""}`;
  if (abiItem.type === "event")
    return `event ${abiItem.name}(${formatAbiParameters(abiItem.inputs)})`;
  if (abiItem.type === "error")
    return `error ${abiItem.name}(${formatAbiParameters(abiItem.inputs)})`;
  if (abiItem.type === "constructor")
    return `constructor(${formatAbiParameters(abiItem.inputs)})${abiItem.stateMutability === "payable" ? " payable" : ""}`;
  if (abiItem.type === "fallback")
    return `fallback() external${abiItem.stateMutability === "payable" ? " payable" : ""}`;
  return "receive() external payable";
}

// node_modules/@metamask/fox-sdk/node_modules/abitype/dist/esm/human-readable/runtime/signatures.js
var errorSignatureRegex = /^error (?<name>[a-zA-Z$_][a-zA-Z0-9$_]*)\((?<parameters>.*?)\)$/;
function isErrorSignature(signature) {
  return errorSignatureRegex.test(signature);
}
function execErrorSignature(signature) {
  return execTyped(errorSignatureRegex, signature);
}
var eventSignatureRegex = /^event (?<name>[a-zA-Z$_][a-zA-Z0-9$_]*)\((?<parameters>.*?)\)$/;
function isEventSignature(signature) {
  return eventSignatureRegex.test(signature);
}
function execEventSignature(signature) {
  return execTyped(eventSignatureRegex, signature);
}
var functionSignatureRegex = /^function (?<name>[a-zA-Z$_][a-zA-Z0-9$_]*)\((?<parameters>.*?)\)(?: (?<scope>external|public{1}))?(?: (?<stateMutability>pure|view|nonpayable|payable{1}))?(?: returns\s?\((?<returns>.*?)\))?$/;
function isFunctionSignature(signature) {
  return functionSignatureRegex.test(signature);
}
function execFunctionSignature(signature) {
  return execTyped(functionSignatureRegex, signature);
}
var structSignatureRegex = /^struct (?<name>[a-zA-Z$_][a-zA-Z0-9$_]*) \{(?<properties>.*?)\}$/;
function isStructSignature(signature) {
  return structSignatureRegex.test(signature);
}
function execStructSignature(signature) {
  return execTyped(structSignatureRegex, signature);
}
var constructorSignatureRegex = /^constructor\((?<parameters>.*?)\)(?:\s(?<stateMutability>payable{1}))?$/;
function isConstructorSignature(signature) {
  return constructorSignatureRegex.test(signature);
}
function execConstructorSignature(signature) {
  return execTyped(constructorSignatureRegex, signature);
}
var fallbackSignatureRegex = /^fallback\(\) external(?:\s(?<stateMutability>payable{1}))?$/;
function isFallbackSignature(signature) {
  return fallbackSignatureRegex.test(signature);
}
function execFallbackSignature(signature) {
  return execTyped(fallbackSignatureRegex, signature);
}
var receiveSignatureRegex = /^receive\(\) external payable$/;
function isReceiveSignature(signature) {
  return receiveSignatureRegex.test(signature);
}
var modifiers = /* @__PURE__ */ new Set([
  "memory",
  "indexed",
  "storage",
  "calldata"
]);
var eventModifiers = /* @__PURE__ */ new Set(["indexed"]);
var functionModifiers = /* @__PURE__ */ new Set([
  "calldata",
  "memory",
  "storage"
]);

// node_modules/@metamask/fox-sdk/node_modules/abitype/dist/esm/human-readable/errors/abiItem.js
var InvalidAbiItemError = class extends BaseError3 {
  constructor({ signature }) {
    super("Failed to parse ABI item.", {
      details: `parseAbiItem(${JSON.stringify(signature, null, 2)})`,
      docsPath: "/api/human#parseabiitem-1"
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "InvalidAbiItemError"
    });
  }
};
var UnknownTypeError = class extends BaseError3 {
  constructor({ type }) {
    super("Unknown type.", {
      metaMessages: [
        `Type "${type}" is not a valid ABI type. Perhaps you forgot to include a struct signature?`
      ]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "UnknownTypeError"
    });
  }
};
var UnknownSolidityTypeError = class extends BaseError3 {
  constructor({ type }) {
    super("Unknown type.", {
      metaMessages: [`Type "${type}" is not a valid ABI type.`]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "UnknownSolidityTypeError"
    });
  }
};

// node_modules/@metamask/fox-sdk/node_modules/abitype/dist/esm/human-readable/errors/abiParameter.js
var InvalidAbiParametersError = class extends BaseError3 {
  constructor({ params }) {
    super("Failed to parse ABI parameters.", {
      details: `parseAbiParameters(${JSON.stringify(params, null, 2)})`,
      docsPath: "/api/human#parseabiparameters-1"
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "InvalidAbiParametersError"
    });
  }
};
var InvalidParameterError = class extends BaseError3 {
  constructor({ param }) {
    super("Invalid ABI parameter.", {
      details: param
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "InvalidParameterError"
    });
  }
};
var SolidityProtectedKeywordError = class extends BaseError3 {
  constructor({ param, name }) {
    super("Invalid ABI parameter.", {
      details: param,
      metaMessages: [
        `"${name}" is a protected Solidity keyword. More info: https://docs.soliditylang.org/en/latest/cheatsheet.html`
      ]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "SolidityProtectedKeywordError"
    });
  }
};
var InvalidModifierError = class extends BaseError3 {
  constructor({ param, type, modifier }) {
    super("Invalid ABI parameter.", {
      details: param,
      metaMessages: [
        `Modifier "${modifier}" not allowed${type ? ` in "${type}" type` : ""}.`
      ]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "InvalidModifierError"
    });
  }
};
var InvalidFunctionModifierError = class extends BaseError3 {
  constructor({ param, type, modifier }) {
    super("Invalid ABI parameter.", {
      details: param,
      metaMessages: [
        `Modifier "${modifier}" not allowed${type ? ` in "${type}" type` : ""}.`,
        `Data location can only be specified for array, struct, or mapping types, but "${modifier}" was given.`
      ]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "InvalidFunctionModifierError"
    });
  }
};
var InvalidAbiTypeParameterError = class extends BaseError3 {
  constructor({ abiParameter }) {
    super("Invalid ABI parameter.", {
      details: JSON.stringify(abiParameter, null, 2),
      metaMessages: ["ABI parameter type is invalid."]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "InvalidAbiTypeParameterError"
    });
  }
};

// node_modules/@metamask/fox-sdk/node_modules/abitype/dist/esm/human-readable/errors/signature.js
var InvalidSignatureError = class extends BaseError3 {
  constructor({ signature, type }) {
    super(`Invalid ${type} signature.`, {
      details: signature
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "InvalidSignatureError"
    });
  }
};
var UnknownSignatureError = class extends BaseError3 {
  constructor({ signature }) {
    super("Unknown signature.", {
      details: signature
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "UnknownSignatureError"
    });
  }
};
var InvalidStructSignatureError = class extends BaseError3 {
  constructor({ signature }) {
    super("Invalid struct signature.", {
      details: signature,
      metaMessages: ["No properties exist."]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "InvalidStructSignatureError"
    });
  }
};

// node_modules/@metamask/fox-sdk/node_modules/abitype/dist/esm/human-readable/errors/struct.js
var CircularReferenceError = class extends BaseError3 {
  constructor({ type }) {
    super("Circular reference detected.", {
      metaMessages: [`Struct "${type}" is a circular reference.`]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "CircularReferenceError"
    });
  }
};

// node_modules/@metamask/fox-sdk/node_modules/abitype/dist/esm/human-readable/errors/splitParameters.js
var InvalidParenthesisError = class extends BaseError3 {
  constructor({ current, depth }) {
    super("Unbalanced parentheses.", {
      metaMessages: [
        `"${current.trim()}" has too many ${depth > 0 ? "opening" : "closing"} parentheses.`
      ],
      details: `Depth "${depth}"`
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "InvalidParenthesisError"
    });
  }
};

// node_modules/@metamask/fox-sdk/node_modules/abitype/dist/esm/human-readable/runtime/cache.js
function getParameterCacheKey(param, type, structs) {
  let structKey = "";
  if (structs)
    for (const struct of Object.entries(structs)) {
      if (!struct)
        continue;
      let propertyKey = "";
      for (const property of struct[1]) {
        propertyKey += `[${property.type}${property.name ? `:${property.name}` : ""}]`;
      }
      structKey += `(${struct[0]}{${propertyKey}})`;
    }
  if (type)
    return `${type}:${param}${structKey}`;
  return `${param}${structKey}`;
}
var parameterCache = /* @__PURE__ */ new Map([
  // Unnamed
  ["address", { type: "address" }],
  ["bool", { type: "bool" }],
  ["bytes", { type: "bytes" }],
  ["bytes32", { type: "bytes32" }],
  ["int", { type: "int256" }],
  ["int256", { type: "int256" }],
  ["string", { type: "string" }],
  ["uint", { type: "uint256" }],
  ["uint8", { type: "uint8" }],
  ["uint16", { type: "uint16" }],
  ["uint24", { type: "uint24" }],
  ["uint32", { type: "uint32" }],
  ["uint64", { type: "uint64" }],
  ["uint96", { type: "uint96" }],
  ["uint112", { type: "uint112" }],
  ["uint160", { type: "uint160" }],
  ["uint192", { type: "uint192" }],
  ["uint256", { type: "uint256" }],
  // Named
  ["address owner", { type: "address", name: "owner" }],
  ["address to", { type: "address", name: "to" }],
  ["bool approved", { type: "bool", name: "approved" }],
  ["bytes _data", { type: "bytes", name: "_data" }],
  ["bytes data", { type: "bytes", name: "data" }],
  ["bytes signature", { type: "bytes", name: "signature" }],
  ["bytes32 hash", { type: "bytes32", name: "hash" }],
  ["bytes32 r", { type: "bytes32", name: "r" }],
  ["bytes32 root", { type: "bytes32", name: "root" }],
  ["bytes32 s", { type: "bytes32", name: "s" }],
  ["string name", { type: "string", name: "name" }],
  ["string symbol", { type: "string", name: "symbol" }],
  ["string tokenURI", { type: "string", name: "tokenURI" }],
  ["uint tokenId", { type: "uint256", name: "tokenId" }],
  ["uint8 v", { type: "uint8", name: "v" }],
  ["uint256 balance", { type: "uint256", name: "balance" }],
  ["uint256 tokenId", { type: "uint256", name: "tokenId" }],
  ["uint256 value", { type: "uint256", name: "value" }],
  // Indexed
  [
    "event:address indexed from",
    { type: "address", name: "from", indexed: true }
  ],
  ["event:address indexed to", { type: "address", name: "to", indexed: true }],
  [
    "event:uint indexed tokenId",
    { type: "uint256", name: "tokenId", indexed: true }
  ],
  [
    "event:uint256 indexed tokenId",
    { type: "uint256", name: "tokenId", indexed: true }
  ]
]);

// node_modules/@metamask/fox-sdk/node_modules/abitype/dist/esm/human-readable/runtime/utils.js
function parseSignature(signature, structs = {}) {
  if (isFunctionSignature(signature))
    return parseFunctionSignature(signature, structs);
  if (isEventSignature(signature))
    return parseEventSignature(signature, structs);
  if (isErrorSignature(signature))
    return parseErrorSignature(signature, structs);
  if (isConstructorSignature(signature))
    return parseConstructorSignature(signature, structs);
  if (isFallbackSignature(signature))
    return parseFallbackSignature(signature);
  if (isReceiveSignature(signature))
    return {
      type: "receive",
      stateMutability: "payable"
    };
  throw new UnknownSignatureError({ signature });
}
function parseFunctionSignature(signature, structs = {}) {
  const match = execFunctionSignature(signature);
  if (!match)
    throw new InvalidSignatureError({ signature, type: "function" });
  const inputParams = splitParameters(match.parameters);
  const inputs = [];
  const inputLength = inputParams.length;
  for (let i2 = 0; i2 < inputLength; i2++) {
    inputs.push(parseAbiParameter(inputParams[i2], {
      modifiers: functionModifiers,
      structs,
      type: "function"
    }));
  }
  const outputs = [];
  if (match.returns) {
    const outputParams = splitParameters(match.returns);
    const outputLength = outputParams.length;
    for (let i2 = 0; i2 < outputLength; i2++) {
      outputs.push(parseAbiParameter(outputParams[i2], {
        modifiers: functionModifiers,
        structs,
        type: "function"
      }));
    }
  }
  return {
    name: match.name,
    type: "function",
    stateMutability: match.stateMutability ?? "nonpayable",
    inputs,
    outputs
  };
}
function parseEventSignature(signature, structs = {}) {
  const match = execEventSignature(signature);
  if (!match)
    throw new InvalidSignatureError({ signature, type: "event" });
  const params = splitParameters(match.parameters);
  const abiParameters = [];
  const length = params.length;
  for (let i2 = 0; i2 < length; i2++)
    abiParameters.push(parseAbiParameter(params[i2], {
      modifiers: eventModifiers,
      structs,
      type: "event"
    }));
  return { name: match.name, type: "event", inputs: abiParameters };
}
function parseErrorSignature(signature, structs = {}) {
  const match = execErrorSignature(signature);
  if (!match)
    throw new InvalidSignatureError({ signature, type: "error" });
  const params = splitParameters(match.parameters);
  const abiParameters = [];
  const length = params.length;
  for (let i2 = 0; i2 < length; i2++)
    abiParameters.push(parseAbiParameter(params[i2], { structs, type: "error" }));
  return { name: match.name, type: "error", inputs: abiParameters };
}
function parseConstructorSignature(signature, structs = {}) {
  const match = execConstructorSignature(signature);
  if (!match)
    throw new InvalidSignatureError({ signature, type: "constructor" });
  const params = splitParameters(match.parameters);
  const abiParameters = [];
  const length = params.length;
  for (let i2 = 0; i2 < length; i2++)
    abiParameters.push(parseAbiParameter(params[i2], { structs, type: "constructor" }));
  return {
    type: "constructor",
    stateMutability: match.stateMutability ?? "nonpayable",
    inputs: abiParameters
  };
}
function parseFallbackSignature(signature) {
  const match = execFallbackSignature(signature);
  if (!match)
    throw new InvalidSignatureError({ signature, type: "fallback" });
  return {
    type: "fallback",
    stateMutability: match.stateMutability ?? "nonpayable"
  };
}
var abiParameterWithoutTupleRegex = /^(?<type>[a-zA-Z$_][a-zA-Z0-9$_]*(?:\spayable)?)(?<array>(?:\[\d*?\])+?)?(?:\s(?<modifier>calldata|indexed|memory|storage{1}))?(?:\s(?<name>[a-zA-Z$_][a-zA-Z0-9$_]*))?$/;
var abiParameterWithTupleRegex = /^\((?<type>.+?)\)(?<array>(?:\[\d*?\])+?)?(?:\s(?<modifier>calldata|indexed|memory|storage{1}))?(?:\s(?<name>[a-zA-Z$_][a-zA-Z0-9$_]*))?$/;
var dynamicIntegerRegex = /^u?int$/;
function parseAbiParameter(param, options) {
  const parameterCacheKey = getParameterCacheKey(param, options?.type, options?.structs);
  if (parameterCache.has(parameterCacheKey))
    return parameterCache.get(parameterCacheKey);
  const isTuple = isTupleRegex.test(param);
  const match = execTyped(isTuple ? abiParameterWithTupleRegex : abiParameterWithoutTupleRegex, param);
  if (!match)
    throw new InvalidParameterError({ param });
  if (match.name && isSolidityKeyword(match.name))
    throw new SolidityProtectedKeywordError({ param, name: match.name });
  const name = match.name ? { name: match.name } : {};
  const indexed = match.modifier === "indexed" ? { indexed: true } : {};
  const structs = options?.structs ?? {};
  let type;
  let components = {};
  if (isTuple) {
    type = "tuple";
    const params = splitParameters(match.type);
    const components_ = [];
    const length = params.length;
    for (let i2 = 0; i2 < length; i2++) {
      components_.push(parseAbiParameter(params[i2], { structs }));
    }
    components = { components: components_ };
  } else if (match.type in structs) {
    type = "tuple";
    components = { components: structs[match.type] };
  } else if (dynamicIntegerRegex.test(match.type)) {
    type = `${match.type}256`;
  } else if (match.type === "address payable") {
    type = "address";
  } else {
    type = match.type;
    if (!(options?.type === "struct") && !isSolidityType(type))
      throw new UnknownSolidityTypeError({ type });
  }
  if (match.modifier) {
    if (!options?.modifiers?.has?.(match.modifier))
      throw new InvalidModifierError({
        param,
        type: options?.type,
        modifier: match.modifier
      });
    if (functionModifiers.has(match.modifier) && !isValidDataLocation(type, !!match.array))
      throw new InvalidFunctionModifierError({
        param,
        type: options?.type,
        modifier: match.modifier
      });
  }
  const abiParameter = {
    type: `${type}${match.array ?? ""}`,
    ...name,
    ...indexed,
    ...components
  };
  parameterCache.set(parameterCacheKey, abiParameter);
  return abiParameter;
}
function splitParameters(params, result = [], current = "", depth = 0) {
  const length = params.trim().length;
  for (let i2 = 0; i2 < length; i2++) {
    const char = params[i2];
    const tail = params.slice(i2 + 1);
    switch (char) {
      case ",":
        return depth === 0 ? splitParameters(tail, [...result, current.trim()]) : splitParameters(tail, result, `${current}${char}`, depth);
      case "(":
        return splitParameters(tail, result, `${current}${char}`, depth + 1);
      case ")":
        return splitParameters(tail, result, `${current}${char}`, depth - 1);
      default:
        return splitParameters(tail, result, `${current}${char}`, depth);
    }
  }
  if (current === "")
    return result;
  if (depth !== 0)
    throw new InvalidParenthesisError({ current, depth });
  result.push(current.trim());
  return result;
}
function isSolidityType(type) {
  return type === "address" || type === "bool" || type === "function" || type === "string" || bytesRegex2.test(type) || integerRegex2.test(type);
}
var protectedKeywordsRegex = /^(?:after|alias|anonymous|apply|auto|byte|calldata|case|catch|constant|copyof|default|defined|error|event|external|false|final|function|immutable|implements|in|indexed|inline|internal|let|mapping|match|memory|mutable|null|of|override|partial|private|promise|public|pure|reference|relocatable|return|returns|sizeof|static|storage|struct|super|supports|switch|this|true|try|typedef|typeof|var|view|virtual)$/;
function isSolidityKeyword(name) {
  return name === "address" || name === "bool" || name === "function" || name === "string" || name === "tuple" || bytesRegex2.test(name) || integerRegex2.test(name) || protectedKeywordsRegex.test(name);
}
function isValidDataLocation(type, isArray) {
  return isArray || type === "bytes" || type === "string" || type === "tuple";
}

// node_modules/@metamask/fox-sdk/node_modules/abitype/dist/esm/human-readable/runtime/structs.js
function parseStructs(signatures) {
  const shallowStructs = {};
  const signaturesLength = signatures.length;
  for (let i2 = 0; i2 < signaturesLength; i2++) {
    const signature = signatures[i2];
    if (!isStructSignature(signature))
      continue;
    const match = execStructSignature(signature);
    if (!match)
      throw new InvalidSignatureError({ signature, type: "struct" });
    const properties = match.properties.split(";");
    const components = [];
    const propertiesLength = properties.length;
    for (let k3 = 0; k3 < propertiesLength; k3++) {
      const property = properties[k3];
      const trimmed = property.trim();
      if (!trimmed)
        continue;
      const abiParameter = parseAbiParameter(trimmed, {
        type: "struct"
      });
      components.push(abiParameter);
    }
    if (!components.length)
      throw new InvalidStructSignatureError({ signature });
    shallowStructs[match.name] = components;
  }
  const resolvedStructs = {};
  const entries = Object.entries(shallowStructs);
  const entriesLength = entries.length;
  for (let i2 = 0; i2 < entriesLength; i2++) {
    const [name, parameters] = entries[i2];
    resolvedStructs[name] = resolveStructs(parameters, shallowStructs);
  }
  return resolvedStructs;
}
var typeWithoutTupleRegex = /^(?<type>[a-zA-Z$_][a-zA-Z0-9$_]*)(?<array>(?:\[\d*?\])+?)?$/;
function resolveStructs(abiParameters = [], structs = {}, ancestors = /* @__PURE__ */ new Set()) {
  const components = [];
  const length = abiParameters.length;
  for (let i2 = 0; i2 < length; i2++) {
    const abiParameter = abiParameters[i2];
    const isTuple = isTupleRegex.test(abiParameter.type);
    if (isTuple)
      components.push(abiParameter);
    else {
      const match = execTyped(typeWithoutTupleRegex, abiParameter.type);
      if (!match?.type)
        throw new InvalidAbiTypeParameterError({ abiParameter });
      const { array, type } = match;
      if (type in structs) {
        if (ancestors.has(type))
          throw new CircularReferenceError({ type });
        components.push({
          ...abiParameter,
          type: `tuple${array ?? ""}`,
          components: resolveStructs(structs[type], structs, /* @__PURE__ */ new Set([...ancestors, type]))
        });
      } else {
        if (isSolidityType(type))
          components.push(abiParameter);
        else
          throw new UnknownTypeError({ type });
      }
    }
  }
  return components;
}

// node_modules/@metamask/fox-sdk/node_modules/abitype/dist/esm/human-readable/parseAbiItem.js
function parseAbiItem(signature) {
  let abiItem;
  if (typeof signature === "string")
    abiItem = parseSignature(signature);
  else {
    const structs = parseStructs(signature);
    const length = signature.length;
    for (let i2 = 0; i2 < length; i2++) {
      const signature_ = signature[i2];
      if (isStructSignature(signature_))
        continue;
      abiItem = parseSignature(signature_, structs);
      break;
    }
  }
  if (!abiItem)
    throw new InvalidAbiItemError({ signature });
  return abiItem;
}

// node_modules/@metamask/fox-sdk/node_modules/abitype/dist/esm/human-readable/parseAbiParameters.js
function parseAbiParameters(params) {
  const abiParameters = [];
  if (typeof params === "string") {
    const parameters = splitParameters(params);
    const length = parameters.length;
    for (let i2 = 0; i2 < length; i2++) {
      abiParameters.push(parseAbiParameter(parameters[i2], { modifiers }));
    }
  } else {
    const structs = parseStructs(params);
    const length = params.length;
    for (let i2 = 0; i2 < length; i2++) {
      const signature = params[i2];
      if (isStructSignature(signature))
        continue;
      const parameters = splitParameters(signature);
      const length2 = parameters.length;
      for (let k3 = 0; k3 < length2; k3++) {
        abiParameters.push(parseAbiParameter(parameters[k3], { modifiers, structs }));
      }
    }
  }
  if (abiParameters.length === 0)
    throw new InvalidAbiParametersError({ params });
  return abiParameters;
}

// node_modules/@metamask/fox-sdk/node_modules/ox/_esm/core/internal/lru.js
var LruMap2 = class extends Map {
  constructor(size5) {
    super();
    Object.defineProperty(this, "maxSize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    this.maxSize = size5;
  }
  get(key) {
    const value = super.get(key);
    if (super.has(key) && value !== void 0) {
      this.delete(key);
      super.set(key, value);
    }
    return value;
  }
  set(key, value) {
    super.set(key, value);
    if (this.maxSize && this.size > this.maxSize) {
      const firstKey = this.keys().next().value;
      if (firstKey)
        this.delete(firstKey);
    }
    return this;
  }
};

// node_modules/@metamask/fox-sdk/node_modules/ox/_esm/core/Caches.js
var caches = {
  checksum: /* @__PURE__ */ new LruMap2(8192)
};
var checksum = caches.checksum;

// node_modules/@metamask/fox-sdk/node_modules/ox/_esm/core/Hash.js
function keccak2562(value, options = {}) {
  const { as = typeof value === "string" ? "Hex" : "Bytes" } = options;
  const bytes = keccak_256(from(value));
  if (as === "Bytes")
    return bytes;
  return fromBytes(bytes);
}

// node_modules/@metamask/fox-sdk/node_modules/ox/_esm/core/PublicKey.js
function assert(publicKey, options = {}) {
  const { compressed } = options;
  const { prefix, x: x2, y: y2 } = publicKey;
  if (compressed === false || typeof x2 === "bigint" && typeof y2 === "bigint") {
    if (prefix !== 4)
      throw new InvalidPrefixError({
        prefix,
        cause: new InvalidUncompressedPrefixError()
      });
    return;
  }
  if (compressed === true || typeof x2 === "bigint" && typeof y2 === "undefined") {
    if (prefix !== 3 && prefix !== 2)
      throw new InvalidPrefixError({
        prefix,
        cause: new InvalidCompressedPrefixError()
      });
    return;
  }
  throw new InvalidError({ publicKey });
}
function from3(value) {
  const publicKey = (() => {
    if (validate2(value))
      return fromHex2(value);
    if (validate(value))
      return fromBytes2(value);
    const { prefix, x: x2, y: y2 } = value;
    if (typeof x2 === "bigint" && typeof y2 === "bigint")
      return { prefix: prefix ?? 4, x: x2, y: y2 };
    return { prefix, x: x2 };
  })();
  assert(publicKey);
  return publicKey;
}
function fromBytes2(publicKey) {
  return fromHex2(fromBytes(publicKey));
}
function fromHex2(publicKey) {
  if (publicKey.length !== 132 && publicKey.length !== 130 && publicKey.length !== 68)
    throw new InvalidSerializedSizeError({ publicKey });
  if (publicKey.length === 130) {
    const x3 = BigInt(slice3(publicKey, 0, 32));
    const y2 = BigInt(slice3(publicKey, 32, 64));
    return {
      prefix: 4,
      x: x3,
      y: y2
    };
  }
  if (publicKey.length === 132) {
    const prefix2 = Number(slice3(publicKey, 0, 1));
    const x3 = BigInt(slice3(publicKey, 1, 33));
    const y2 = BigInt(slice3(publicKey, 33, 65));
    return {
      prefix: prefix2,
      x: x3,
      y: y2
    };
  }
  const prefix = Number(slice3(publicKey, 0, 1));
  const x2 = BigInt(slice3(publicKey, 1, 33));
  return {
    prefix,
    x: x2
  };
}
function toHex2(publicKey, options = {}) {
  assert(publicKey);
  const { prefix, x: x2, y: y2 } = publicKey;
  const { includePrefix = true } = options;
  const publicKey_ = concat2(
    includePrefix ? fromNumber(prefix, { size: 1 }) : "0x",
    fromNumber(x2, { size: 32 }),
    // If the public key is not compressed, add the y coordinate.
    typeof y2 === "bigint" ? fromNumber(y2, { size: 32 }) : "0x"
  );
  return publicKey_;
}
var InvalidError = class extends BaseError2 {
  constructor({ publicKey }) {
    super(`Value \`${stringify2(publicKey)}\` is not a valid public key.`, {
      metaMessages: [
        "Public key must contain:",
        "- an `x` and `prefix` value (compressed)",
        "- an `x`, `y`, and `prefix` value (uncompressed)"
      ]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "PublicKey.InvalidError"
    });
  }
};
var InvalidPrefixError = class extends BaseError2 {
  constructor({ prefix, cause }) {
    super(`Prefix "${prefix}" is invalid.`, {
      cause
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "PublicKey.InvalidPrefixError"
    });
  }
};
var InvalidCompressedPrefixError = class extends BaseError2 {
  constructor() {
    super("Prefix must be 2 or 3 for compressed public keys.");
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "PublicKey.InvalidCompressedPrefixError"
    });
  }
};
var InvalidUncompressedPrefixError = class extends BaseError2 {
  constructor() {
    super("Prefix must be 4 for uncompressed public keys.");
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "PublicKey.InvalidUncompressedPrefixError"
    });
  }
};
var InvalidSerializedSizeError = class extends BaseError2 {
  constructor({ publicKey }) {
    super(`Value \`${publicKey}\` is an invalid public key size.`, {
      metaMessages: [
        "Expected: 33 bytes (compressed + prefix), 64 bytes (uncompressed) or 65 bytes (uncompressed + prefix).",
        `Received ${size3(from2(publicKey))} bytes.`
      ]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "PublicKey.InvalidSerializedSizeError"
    });
  }
};

// node_modules/@metamask/fox-sdk/node_modules/ox/_esm/core/Address.js
var addressRegex = /^0x[a-fA-F0-9]{40}$/;
function assert2(value, options = {}) {
  const { strict = true } = options;
  if (!addressRegex.test(value))
    throw new InvalidAddressError2({
      address: value,
      cause: new InvalidInputError()
    });
  if (strict) {
    if (value.toLowerCase() === value)
      return;
    if (checksum2(value) !== value)
      throw new InvalidAddressError2({
        address: value,
        cause: new InvalidChecksumError()
      });
  }
}
function checksum2(address) {
  if (checksum.has(address))
    return checksum.get(address);
  assert2(address, { strict: false });
  const hexAddress = address.substring(2).toLowerCase();
  const hash2 = keccak2562(fromString(hexAddress), { as: "Bytes" });
  const characters = hexAddress.split("");
  for (let i2 = 0; i2 < 40; i2 += 2) {
    if (hash2[i2 >> 1] >> 4 >= 8 && characters[i2]) {
      characters[i2] = characters[i2].toUpperCase();
    }
    if ((hash2[i2 >> 1] & 15) >= 8 && characters[i2 + 1]) {
      characters[i2 + 1] = characters[i2 + 1].toUpperCase();
    }
  }
  const result = `0x${characters.join("")}`;
  checksum.set(address, result);
  return result;
}
function from4(address, options = {}) {
  const { checksum: checksumVal = false } = options;
  assert2(address);
  if (checksumVal)
    return checksum2(address);
  return address;
}
function fromPublicKey(publicKey, options = {}) {
  const address = keccak2562(`0x${toHex2(publicKey).slice(4)}`).substring(26);
  return from4(`0x${address}`, options);
}
function validate3(address, options = {}) {
  const { strict = true } = options ?? {};
  try {
    assert2(address, { strict });
    return true;
  } catch {
    return false;
  }
}
var InvalidAddressError2 = class extends BaseError2 {
  constructor({ address, cause }) {
    super(`Address "${address}" is invalid.`, {
      cause
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Address.InvalidAddressError"
    });
  }
};
var InvalidInputError = class extends BaseError2 {
  constructor() {
    super("Address is not a 20 byte (40 hexadecimal character) value.");
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Address.InvalidInputError"
    });
  }
};
var InvalidChecksumError = class extends BaseError2 {
  constructor() {
    super("Address does not match its checksum counterpart.");
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Address.InvalidChecksumError"
    });
  }
};

// node_modules/@metamask/fox-sdk/node_modules/ox/_esm/core/Solidity.js
var arrayRegex = /^(.*)\[([0-9]*)\]$/;
var bytesRegex3 = /^bytes([1-9]|1[0-9]|2[0-9]|3[0-2])?$/;
var integerRegex3 = /^(u?int)(8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)?$/;
var maxInt8 = 2n ** (8n - 1n) - 1n;
var maxInt16 = 2n ** (16n - 1n) - 1n;
var maxInt24 = 2n ** (24n - 1n) - 1n;
var maxInt32 = 2n ** (32n - 1n) - 1n;
var maxInt40 = 2n ** (40n - 1n) - 1n;
var maxInt48 = 2n ** (48n - 1n) - 1n;
var maxInt56 = 2n ** (56n - 1n) - 1n;
var maxInt64 = 2n ** (64n - 1n) - 1n;
var maxInt72 = 2n ** (72n - 1n) - 1n;
var maxInt80 = 2n ** (80n - 1n) - 1n;
var maxInt88 = 2n ** (88n - 1n) - 1n;
var maxInt96 = 2n ** (96n - 1n) - 1n;
var maxInt104 = 2n ** (104n - 1n) - 1n;
var maxInt112 = 2n ** (112n - 1n) - 1n;
var maxInt120 = 2n ** (120n - 1n) - 1n;
var maxInt128 = 2n ** (128n - 1n) - 1n;
var maxInt136 = 2n ** (136n - 1n) - 1n;
var maxInt144 = 2n ** (144n - 1n) - 1n;
var maxInt152 = 2n ** (152n - 1n) - 1n;
var maxInt160 = 2n ** (160n - 1n) - 1n;
var maxInt168 = 2n ** (168n - 1n) - 1n;
var maxInt176 = 2n ** (176n - 1n) - 1n;
var maxInt184 = 2n ** (184n - 1n) - 1n;
var maxInt192 = 2n ** (192n - 1n) - 1n;
var maxInt200 = 2n ** (200n - 1n) - 1n;
var maxInt208 = 2n ** (208n - 1n) - 1n;
var maxInt216 = 2n ** (216n - 1n) - 1n;
var maxInt224 = 2n ** (224n - 1n) - 1n;
var maxInt232 = 2n ** (232n - 1n) - 1n;
var maxInt240 = 2n ** (240n - 1n) - 1n;
var maxInt248 = 2n ** (248n - 1n) - 1n;
var maxInt256 = 2n ** (256n - 1n) - 1n;
var minInt8 = -(2n ** (8n - 1n));
var minInt16 = -(2n ** (16n - 1n));
var minInt24 = -(2n ** (24n - 1n));
var minInt32 = -(2n ** (32n - 1n));
var minInt40 = -(2n ** (40n - 1n));
var minInt48 = -(2n ** (48n - 1n));
var minInt56 = -(2n ** (56n - 1n));
var minInt64 = -(2n ** (64n - 1n));
var minInt72 = -(2n ** (72n - 1n));
var minInt80 = -(2n ** (80n - 1n));
var minInt88 = -(2n ** (88n - 1n));
var minInt96 = -(2n ** (96n - 1n));
var minInt104 = -(2n ** (104n - 1n));
var minInt112 = -(2n ** (112n - 1n));
var minInt120 = -(2n ** (120n - 1n));
var minInt128 = -(2n ** (128n - 1n));
var minInt136 = -(2n ** (136n - 1n));
var minInt144 = -(2n ** (144n - 1n));
var minInt152 = -(2n ** (152n - 1n));
var minInt160 = -(2n ** (160n - 1n));
var minInt168 = -(2n ** (168n - 1n));
var minInt176 = -(2n ** (176n - 1n));
var minInt184 = -(2n ** (184n - 1n));
var minInt192 = -(2n ** (192n - 1n));
var minInt200 = -(2n ** (200n - 1n));
var minInt208 = -(2n ** (208n - 1n));
var minInt216 = -(2n ** (216n - 1n));
var minInt224 = -(2n ** (224n - 1n));
var minInt232 = -(2n ** (232n - 1n));
var minInt240 = -(2n ** (240n - 1n));
var minInt248 = -(2n ** (248n - 1n));
var minInt256 = -(2n ** (256n - 1n));
var maxUint8 = 2n ** 8n - 1n;
var maxUint16 = 2n ** 16n - 1n;
var maxUint24 = 2n ** 24n - 1n;
var maxUint32 = 2n ** 32n - 1n;
var maxUint40 = 2n ** 40n - 1n;
var maxUint48 = 2n ** 48n - 1n;
var maxUint56 = 2n ** 56n - 1n;
var maxUint64 = 2n ** 64n - 1n;
var maxUint72 = 2n ** 72n - 1n;
var maxUint80 = 2n ** 80n - 1n;
var maxUint88 = 2n ** 88n - 1n;
var maxUint96 = 2n ** 96n - 1n;
var maxUint104 = 2n ** 104n - 1n;
var maxUint112 = 2n ** 112n - 1n;
var maxUint120 = 2n ** 120n - 1n;
var maxUint128 = 2n ** 128n - 1n;
var maxUint136 = 2n ** 136n - 1n;
var maxUint144 = 2n ** 144n - 1n;
var maxUint152 = 2n ** 152n - 1n;
var maxUint160 = 2n ** 160n - 1n;
var maxUint168 = 2n ** 168n - 1n;
var maxUint176 = 2n ** 176n - 1n;
var maxUint184 = 2n ** 184n - 1n;
var maxUint192 = 2n ** 192n - 1n;
var maxUint200 = 2n ** 200n - 1n;
var maxUint208 = 2n ** 208n - 1n;
var maxUint216 = 2n ** 216n - 1n;
var maxUint224 = 2n ** 224n - 1n;
var maxUint232 = 2n ** 232n - 1n;
var maxUint240 = 2n ** 240n - 1n;
var maxUint248 = 2n ** 248n - 1n;
var maxUint2562 = 2n ** 256n - 1n;

// node_modules/@metamask/fox-sdk/node_modules/ox/_esm/core/internal/abiParameters.js
function decodeParameter(cursor, param, options) {
  const { checksumAddress: checksumAddress2, staticPosition } = options;
  const arrayComponents = getArrayComponents(param.type);
  if (arrayComponents) {
    const [length, type] = arrayComponents;
    return decodeArray(cursor, { ...param, type }, { checksumAddress: checksumAddress2, length, staticPosition });
  }
  if (param.type === "tuple")
    return decodeTuple(cursor, param, {
      checksumAddress: checksumAddress2,
      staticPosition
    });
  if (param.type === "address")
    return decodeAddress2(cursor, { checksum: checksumAddress2 });
  if (param.type === "bool")
    return decodeBool(cursor);
  if (param.type.startsWith("bytes"))
    return decodeBytes(cursor, param, { staticPosition });
  if (param.type.startsWith("uint") || param.type.startsWith("int"))
    return decodeNumber(cursor, param);
  if (param.type === "string")
    return decodeString(cursor, { staticPosition });
  throw new InvalidTypeError(param.type);
}
var sizeOfLength = 32;
var sizeOfOffset = 32;
function decodeAddress2(cursor, options = {}) {
  const { checksum: checksum4 = false } = options;
  const value = cursor.readBytes(32);
  const wrap3 = (address) => checksum4 ? checksum2(address) : address;
  return [wrap3(fromBytes(slice2(value, -20))), 32];
}
function decodeArray(cursor, param, options) {
  const { checksumAddress: checksumAddress2, length, staticPosition } = options;
  if (!length) {
    const offset = toNumber(cursor.readBytes(sizeOfOffset));
    const start = staticPosition + offset;
    const startOfData = start + sizeOfLength;
    cursor.setPosition(start);
    const length2 = toNumber(cursor.readBytes(sizeOfLength));
    const dynamicChild = hasDynamicChild(param);
    let consumed2 = 0;
    const value2 = [];
    for (let i2 = 0; i2 < length2; ++i2) {
      cursor.setPosition(startOfData + (dynamicChild ? i2 * 32 : consumed2));
      const [data, consumed_] = decodeParameter(cursor, param, {
        checksumAddress: checksumAddress2,
        staticPosition: startOfData
      });
      consumed2 += consumed_;
      value2.push(data);
    }
    cursor.setPosition(staticPosition + 32);
    return [value2, 32];
  }
  if (hasDynamicChild(param)) {
    const offset = toNumber(cursor.readBytes(sizeOfOffset));
    const start = staticPosition + offset;
    const value2 = [];
    for (let i2 = 0; i2 < length; ++i2) {
      cursor.setPosition(start + i2 * 32);
      const [data] = decodeParameter(cursor, param, {
        checksumAddress: checksumAddress2,
        staticPosition: start
      });
      value2.push(data);
    }
    cursor.setPosition(staticPosition + 32);
    return [value2, 32];
  }
  let consumed = 0;
  const value = [];
  for (let i2 = 0; i2 < length; ++i2) {
    const [data, consumed_] = decodeParameter(cursor, param, {
      checksumAddress: checksumAddress2,
      staticPosition: staticPosition + consumed
    });
    consumed += consumed_;
    value.push(data);
  }
  return [value, consumed];
}
function decodeBool(cursor) {
  return [toBoolean(cursor.readBytes(32), { size: 32 }), 32];
}
function decodeBytes(cursor, param, { staticPosition }) {
  const [_2, size5] = param.type.split("bytes");
  if (!size5) {
    const offset = toNumber(cursor.readBytes(32));
    cursor.setPosition(staticPosition + offset);
    const length = toNumber(cursor.readBytes(32));
    if (length === 0) {
      cursor.setPosition(staticPosition + 32);
      return ["0x", 32];
    }
    const data = cursor.readBytes(length);
    cursor.setPosition(staticPosition + 32);
    return [fromBytes(data), 32];
  }
  const value = fromBytes(cursor.readBytes(Number.parseInt(size5, 10), 32));
  return [value, 32];
}
function decodeNumber(cursor, param) {
  const signed = param.type.startsWith("int");
  const size5 = Number.parseInt(param.type.split("int")[1] || "256", 10);
  const value = cursor.readBytes(32);
  return [
    size5 > 48 ? toBigInt(value, { signed }) : toNumber(value, { signed }),
    32
  ];
}
function decodeTuple(cursor, param, options) {
  const { checksumAddress: checksumAddress2, staticPosition } = options;
  const hasUnnamedChild = param.components.length === 0 || param.components.some(({ name }) => !name);
  const value = hasUnnamedChild ? [] : {};
  let consumed = 0;
  if (hasDynamicChild(param)) {
    const offset = toNumber(cursor.readBytes(sizeOfOffset));
    const start = staticPosition + offset;
    for (let i2 = 0; i2 < param.components.length; ++i2) {
      const component = param.components[i2];
      cursor.setPosition(start + consumed);
      const [data, consumed_] = decodeParameter(cursor, component, {
        checksumAddress: checksumAddress2,
        staticPosition: start
      });
      consumed += consumed_;
      value[hasUnnamedChild ? i2 : component?.name] = data;
    }
    cursor.setPosition(staticPosition + 32);
    return [value, 32];
  }
  for (let i2 = 0; i2 < param.components.length; ++i2) {
    const component = param.components[i2];
    const [data, consumed_] = decodeParameter(cursor, component, {
      checksumAddress: checksumAddress2,
      staticPosition
    });
    value[hasUnnamedChild ? i2 : component?.name] = data;
    consumed += consumed_;
  }
  return [value, consumed];
}
function decodeString(cursor, { staticPosition }) {
  const offset = toNumber(cursor.readBytes(32));
  const start = staticPosition + offset;
  cursor.setPosition(start);
  const length = toNumber(cursor.readBytes(32));
  if (length === 0) {
    cursor.setPosition(staticPosition + 32);
    return ["", 32];
  }
  const data = cursor.readBytes(length, 32);
  const value = toString(trimLeft(data));
  cursor.setPosition(staticPosition + 32);
  return [value, 32];
}
function prepareParameters({ checksumAddress: checksumAddress2, parameters, values }) {
  const preparedParameters = [];
  for (let i2 = 0; i2 < parameters.length; i2++) {
    preparedParameters.push(prepareParameter({
      checksumAddress: checksumAddress2,
      parameter: parameters[i2],
      value: values[i2]
    }));
  }
  return preparedParameters;
}
function prepareParameter({ checksumAddress: checksumAddress2 = false, parameter: parameter_, value }) {
  const parameter = parameter_;
  const arrayComponents = getArrayComponents(parameter.type);
  if (arrayComponents) {
    const [length, type] = arrayComponents;
    return encodeArray(value, {
      checksumAddress: checksumAddress2,
      length,
      parameter: {
        ...parameter,
        type
      }
    });
  }
  if (parameter.type === "tuple") {
    return encodeTuple(value, {
      checksumAddress: checksumAddress2,
      parameter
    });
  }
  if (parameter.type === "address") {
    return encodeAddress(value, {
      checksum: checksumAddress2
    });
  }
  if (parameter.type === "bool") {
    return encodeBoolean(value);
  }
  if (parameter.type.startsWith("uint") || parameter.type.startsWith("int")) {
    const signed = parameter.type.startsWith("int");
    const [, , size5 = "256"] = integerRegex3.exec(parameter.type) ?? [];
    return encodeNumber(value, {
      signed,
      size: Number(size5)
    });
  }
  if (parameter.type.startsWith("bytes")) {
    return encodeBytes(value, { type: parameter.type });
  }
  if (parameter.type === "string") {
    return encodeString(value);
  }
  throw new InvalidTypeError(parameter.type);
}
function encode(preparedParameters) {
  let staticSize = 0;
  for (let i2 = 0; i2 < preparedParameters.length; i2++) {
    const { dynamic, encoded } = preparedParameters[i2];
    if (dynamic)
      staticSize += 32;
    else
      staticSize += size3(encoded);
  }
  const staticParameters = [];
  const dynamicParameters = [];
  let dynamicSize = 0;
  for (let i2 = 0; i2 < preparedParameters.length; i2++) {
    const { dynamic, encoded } = preparedParameters[i2];
    if (dynamic) {
      staticParameters.push(fromNumber(staticSize + dynamicSize, { size: 32 }));
      dynamicParameters.push(encoded);
      dynamicSize += size3(encoded);
    } else {
      staticParameters.push(encoded);
    }
  }
  return concat2(...staticParameters, ...dynamicParameters);
}
function encodeAddress(value, options) {
  const { checksum: checksum4 = false } = options;
  assert2(value, { strict: checksum4 });
  return {
    dynamic: false,
    encoded: padLeft(value.toLowerCase())
  };
}
function encodeArray(value, options) {
  const { checksumAddress: checksumAddress2, length, parameter } = options;
  const dynamic = length === null;
  if (!Array.isArray(value))
    throw new InvalidArrayError(value);
  if (!dynamic && value.length !== length)
    throw new ArrayLengthMismatchError({
      expectedLength: length,
      givenLength: value.length,
      type: `${parameter.type}[${length}]`
    });
  let dynamicChild = false;
  const preparedParameters = [];
  for (let i2 = 0; i2 < value.length; i2++) {
    const preparedParam = prepareParameter({
      checksumAddress: checksumAddress2,
      parameter,
      value: value[i2]
    });
    if (preparedParam.dynamic)
      dynamicChild = true;
    preparedParameters.push(preparedParam);
  }
  if (dynamic || dynamicChild) {
    const data = encode(preparedParameters);
    if (dynamic) {
      const length2 = fromNumber(preparedParameters.length, { size: 32 });
      return {
        dynamic: true,
        encoded: preparedParameters.length > 0 ? concat2(length2, data) : length2
      };
    }
    if (dynamicChild)
      return { dynamic: true, encoded: data };
  }
  return {
    dynamic: false,
    encoded: concat2(...preparedParameters.map(({ encoded }) => encoded))
  };
}
function encodeBytes(value, { type }) {
  const [, parametersize] = type.split("bytes");
  const bytesSize = size3(value);
  if (!parametersize) {
    let value_ = value;
    if (bytesSize % 32 !== 0)
      value_ = padRight(value_, Math.ceil((value.length - 2) / 2 / 32) * 32);
    return {
      dynamic: true,
      encoded: concat2(padLeft(fromNumber(bytesSize, { size: 32 })), value_)
    };
  }
  if (bytesSize !== Number.parseInt(parametersize, 10))
    throw new BytesSizeMismatchError2({
      expectedSize: Number.parseInt(parametersize, 10),
      value
    });
  return { dynamic: false, encoded: padRight(value) };
}
function encodeBoolean(value) {
  if (typeof value !== "boolean")
    throw new BaseError2(`Invalid boolean value: "${value}" (type: ${typeof value}). Expected: \`true\` or \`false\`.`);
  return { dynamic: false, encoded: padLeft(fromBoolean(value)) };
}
function encodeNumber(value, { signed, size: size5 }) {
  if (typeof size5 === "number") {
    const max = 2n ** (BigInt(size5) - (signed ? 1n : 0n)) - 1n;
    const min = signed ? -max - 1n : 0n;
    if (value > max || value < min)
      throw new IntegerOutOfRangeError({
        max: max.toString(),
        min: min.toString(),
        signed,
        size: size5 / 8,
        value: value.toString()
      });
  }
  return {
    dynamic: false,
    encoded: fromNumber(value, {
      size: 32,
      signed
    })
  };
}
function encodeString(value) {
  const hexValue = fromString2(value);
  const partsLength = Math.ceil(size3(hexValue) / 32);
  const parts = [];
  for (let i2 = 0; i2 < partsLength; i2++) {
    parts.push(padRight(slice3(hexValue, i2 * 32, (i2 + 1) * 32)));
  }
  return {
    dynamic: true,
    encoded: concat2(padRight(fromNumber(size3(hexValue), { size: 32 })), ...parts)
  };
}
function encodeTuple(value, options) {
  const { checksumAddress: checksumAddress2, parameter } = options;
  let dynamic = false;
  const preparedParameters = [];
  for (let i2 = 0; i2 < parameter.components.length; i2++) {
    const param_ = parameter.components[i2];
    const index2 = Array.isArray(value) ? i2 : param_.name;
    const preparedParam = prepareParameter({
      checksumAddress: checksumAddress2,
      parameter: param_,
      value: value[index2]
    });
    preparedParameters.push(preparedParam);
    if (preparedParam.dynamic)
      dynamic = true;
  }
  return {
    dynamic,
    encoded: dynamic ? encode(preparedParameters) : concat2(...preparedParameters.map(({ encoded }) => encoded))
  };
}
function getArrayComponents(type) {
  const matches = type.match(/^(.*)\[(\d+)?\]$/);
  return matches ? (
    // Return `null` if the array is dynamic.
    [matches[2] ? Number(matches[2]) : null, matches[1]]
  ) : void 0;
}
function hasDynamicChild(param) {
  const { type } = param;
  if (type === "string")
    return true;
  if (type === "bytes")
    return true;
  if (type.endsWith("[]"))
    return true;
  if (type === "tuple")
    return param.components?.some(hasDynamicChild);
  const arrayComponents = getArrayComponents(param.type);
  if (arrayComponents && hasDynamicChild({
    ...param,
    type: arrayComponents[1]
  }))
    return true;
  return false;
}

// node_modules/@metamask/fox-sdk/node_modules/ox/_esm/core/internal/cursor.js
var staticCursor = {
  bytes: new Uint8Array(),
  dataView: new DataView(new ArrayBuffer(0)),
  position: 0,
  positionReadCount: /* @__PURE__ */ new Map(),
  recursiveReadCount: 0,
  recursiveReadLimit: Number.POSITIVE_INFINITY,
  assertReadLimit() {
    if (this.recursiveReadCount >= this.recursiveReadLimit)
      throw new RecursiveReadLimitExceededError({
        count: this.recursiveReadCount + 1,
        limit: this.recursiveReadLimit
      });
  },
  assertPosition(position) {
    if (position < 0 || position > this.bytes.length - 1)
      throw new PositionOutOfBoundsError2({
        length: this.bytes.length,
        position
      });
  },
  decrementPosition(offset) {
    if (offset < 0)
      throw new NegativeOffsetError({ offset });
    const position = this.position - offset;
    this.assertPosition(position);
    this.position = position;
  },
  getReadCount(position) {
    return this.positionReadCount.get(position || this.position) || 0;
  },
  incrementPosition(offset) {
    if (offset < 0)
      throw new NegativeOffsetError({ offset });
    const position = this.position + offset;
    this.assertPosition(position);
    this.position = position;
  },
  inspectByte(position_) {
    const position = position_ ?? this.position;
    this.assertPosition(position);
    return this.bytes[position];
  },
  inspectBytes(length, position_) {
    const position = position_ ?? this.position;
    this.assertPosition(position + length - 1);
    return this.bytes.subarray(position, position + length);
  },
  inspectUint8(position_) {
    const position = position_ ?? this.position;
    this.assertPosition(position);
    return this.bytes[position];
  },
  inspectUint16(position_) {
    const position = position_ ?? this.position;
    this.assertPosition(position + 1);
    return this.dataView.getUint16(position);
  },
  inspectUint24(position_) {
    const position = position_ ?? this.position;
    this.assertPosition(position + 2);
    return (this.dataView.getUint16(position) << 8) + this.dataView.getUint8(position + 2);
  },
  inspectUint32(position_) {
    const position = position_ ?? this.position;
    this.assertPosition(position + 3);
    return this.dataView.getUint32(position);
  },
  pushByte(byte) {
    this.assertPosition(this.position);
    this.bytes[this.position] = byte;
    this.position++;
  },
  pushBytes(bytes) {
    this.assertPosition(this.position + bytes.length - 1);
    this.bytes.set(bytes, this.position);
    this.position += bytes.length;
  },
  pushUint8(value) {
    this.assertPosition(this.position);
    this.bytes[this.position] = value;
    this.position++;
  },
  pushUint16(value) {
    this.assertPosition(this.position + 1);
    this.dataView.setUint16(this.position, value);
    this.position += 2;
  },
  pushUint24(value) {
    this.assertPosition(this.position + 2);
    this.dataView.setUint16(this.position, value >> 8);
    this.dataView.setUint8(this.position + 2, value & ~4294967040);
    this.position += 3;
  },
  pushUint32(value) {
    this.assertPosition(this.position + 3);
    this.dataView.setUint32(this.position, value);
    this.position += 4;
  },
  readByte() {
    this.assertReadLimit();
    this._touch();
    const value = this.inspectByte();
    this.position++;
    return value;
  },
  readBytes(length, size5) {
    this.assertReadLimit();
    this._touch();
    const value = this.inspectBytes(length);
    this.position += size5 ?? length;
    return value;
  },
  readUint8() {
    this.assertReadLimit();
    this._touch();
    const value = this.inspectUint8();
    this.position += 1;
    return value;
  },
  readUint16() {
    this.assertReadLimit();
    this._touch();
    const value = this.inspectUint16();
    this.position += 2;
    return value;
  },
  readUint24() {
    this.assertReadLimit();
    this._touch();
    const value = this.inspectUint24();
    this.position += 3;
    return value;
  },
  readUint32() {
    this.assertReadLimit();
    this._touch();
    const value = this.inspectUint32();
    this.position += 4;
    return value;
  },
  get remaining() {
    return this.bytes.length - this.position;
  },
  setPosition(position) {
    const oldPosition = this.position;
    this.assertPosition(position);
    this.position = position;
    return () => this.position = oldPosition;
  },
  _touch() {
    if (this.recursiveReadLimit === Number.POSITIVE_INFINITY)
      return;
    const count = this.getReadCount();
    this.positionReadCount.set(this.position, count + 1);
    if (count > 0)
      this.recursiveReadCount++;
  }
};
function create(bytes, { recursiveReadLimit = 8192 } = {}) {
  const cursor = Object.create(staticCursor);
  cursor.bytes = bytes;
  cursor.dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  cursor.positionReadCount = /* @__PURE__ */ new Map();
  cursor.recursiveReadLimit = recursiveReadLimit;
  return cursor;
}
var NegativeOffsetError = class extends BaseError2 {
  constructor({ offset }) {
    super(`Offset \`${offset}\` cannot be negative.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Cursor.NegativeOffsetError"
    });
  }
};
var PositionOutOfBoundsError2 = class extends BaseError2 {
  constructor({ length, position }) {
    super(`Position \`${position}\` is out of bounds (\`0 < position < ${length}\`).`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Cursor.PositionOutOfBoundsError"
    });
  }
};
var RecursiveReadLimitExceededError = class extends BaseError2 {
  constructor({ count, limit }) {
    super(`Recursive read limit of \`${limit}\` exceeded (recursive read count: \`${count}\`).`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Cursor.RecursiveReadLimitExceededError"
    });
  }
};

// node_modules/@metamask/fox-sdk/node_modules/ox/_esm/core/AbiParameters.js
function decode(parameters, data, options = {}) {
  const { as = "Array", checksumAddress: checksumAddress2 = false } = options;
  const bytes = typeof data === "string" ? fromHex(data) : data;
  const cursor = create(bytes);
  if (size2(bytes) === 0 && parameters.length > 0)
    throw new ZeroDataError();
  if (size2(bytes) && size2(bytes) < 32)
    throw new DataSizeTooSmallError({
      data: typeof data === "string" ? data : fromBytes(data),
      parameters,
      size: size2(bytes)
    });
  let consumed = 0;
  const values = as === "Array" ? [] : {};
  for (let i2 = 0; i2 < parameters.length; ++i2) {
    const param = parameters[i2];
    cursor.setPosition(consumed);
    const [data2, consumed_] = decodeParameter(cursor, param, {
      checksumAddress: checksumAddress2,
      staticPosition: 0
    });
    consumed += consumed_;
    if (as === "Array")
      values.push(data2);
    else
      values[param.name ?? i2] = data2;
  }
  return values;
}
function encode2(parameters, values, options) {
  const { checksumAddress: checksumAddress2 = false } = options ?? {};
  if (parameters.length !== values.length)
    throw new LengthMismatchError({
      expectedLength: parameters.length,
      givenLength: values.length
    });
  const preparedParameters = prepareParameters({
    checksumAddress: checksumAddress2,
    parameters,
    values
  });
  const data = encode(preparedParameters);
  if (data.length === 0)
    return "0x";
  return data;
}
function encodePacked(types, values) {
  if (types.length !== values.length)
    throw new LengthMismatchError({
      expectedLength: types.length,
      givenLength: values.length
    });
  const data = [];
  for (let i2 = 0; i2 < types.length; i2++) {
    const type = types[i2];
    const value = values[i2];
    data.push(encodePacked.encode(type, value));
  }
  return concat2(...data);
}
(function(encodePacked2) {
  function encode4(type, value, isArray = false) {
    if (type === "address") {
      const address = value;
      assert2(address);
      return padLeft(address.toLowerCase(), isArray ? 32 : 0);
    }
    if (type === "string")
      return fromString2(value);
    if (type === "bytes")
      return value;
    if (type === "bool")
      return padLeft(fromBoolean(value), isArray ? 32 : 1);
    const intMatch = type.match(integerRegex3);
    if (intMatch) {
      const [_type, baseType, bits = "256"] = intMatch;
      const size5 = Number.parseInt(bits, 10) / 8;
      return fromNumber(value, {
        size: isArray ? 32 : size5,
        signed: baseType === "int"
      });
    }
    const bytesMatch = type.match(bytesRegex3);
    if (bytesMatch) {
      const [_type, size5] = bytesMatch;
      if (Number.parseInt(size5, 10) !== (value.length - 2) / 2)
        throw new BytesSizeMismatchError2({
          expectedSize: Number.parseInt(size5, 10),
          value
        });
      return padRight(value, isArray ? 32 : 0);
    }
    const arrayMatch = type.match(arrayRegex);
    if (arrayMatch && Array.isArray(value)) {
      const [_type, childType] = arrayMatch;
      const data = [];
      for (let i2 = 0; i2 < value.length; i2++) {
        data.push(encode4(childType, value[i2], true));
      }
      if (data.length === 0)
        return "0x";
      return concat2(...data);
    }
    throw new InvalidTypeError(type);
  }
  encodePacked2.encode = encode4;
})(encodePacked || (encodePacked = {}));
function from5(parameters) {
  if (Array.isArray(parameters) && typeof parameters[0] === "string")
    return parseAbiParameters(parameters);
  if (typeof parameters === "string")
    return parseAbiParameters(parameters);
  return parameters;
}
var DataSizeTooSmallError = class extends BaseError2 {
  constructor({ data, parameters, size: size5 }) {
    super(`Data size of ${size5} bytes is too small for given parameters.`, {
      metaMessages: [
        `Params: (${formatAbiParameters(parameters)})`,
        `Data:   ${data} (${size5} bytes)`
      ]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "AbiParameters.DataSizeTooSmallError"
    });
  }
};
var ZeroDataError = class extends BaseError2 {
  constructor() {
    super('Cannot decode zero data ("0x") with ABI parameters.');
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "AbiParameters.ZeroDataError"
    });
  }
};
var ArrayLengthMismatchError = class extends BaseError2 {
  constructor({ expectedLength, givenLength, type }) {
    super(`Array length mismatch for type \`${type}\`. Expected: \`${expectedLength}\`. Given: \`${givenLength}\`.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "AbiParameters.ArrayLengthMismatchError"
    });
  }
};
var BytesSizeMismatchError2 = class extends BaseError2 {
  constructor({ expectedSize, value }) {
    super(`Size of bytes "${value}" (bytes${size3(value)}) does not match expected size (bytes${expectedSize}).`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "AbiParameters.BytesSizeMismatchError"
    });
  }
};
var LengthMismatchError = class extends BaseError2 {
  constructor({ expectedLength, givenLength }) {
    super([
      "ABI encoding parameters/values length mismatch.",
      `Expected length (parameters): ${expectedLength}`,
      `Given length (values): ${givenLength}`
    ].join("\n"));
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "AbiParameters.LengthMismatchError"
    });
  }
};
var InvalidArrayError = class extends BaseError2 {
  constructor(value) {
    super(`Value \`${value}\` is not a valid array.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "AbiParameters.InvalidArrayError"
    });
  }
};
var InvalidTypeError = class extends BaseError2 {
  constructor(type) {
    super(`Type \`${type}\` is not a valid ABI Type.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "AbiParameters.InvalidTypeError"
    });
  }
};

// node_modules/@metamask/fox-sdk/node_modules/ox/_esm/core/Rlp.js
function from6(value, options) {
  const { as } = options;
  const encodable = getEncodable2(value);
  const cursor = create(new Uint8Array(encodable.length));
  encodable.encode(cursor);
  if (as === "Hex")
    return fromBytes(cursor.bytes);
  return cursor.bytes;
}
function fromHex3(hex, options = {}) {
  const { as = "Hex" } = options;
  return from6(hex, { as });
}
function getEncodable2(bytes) {
  if (Array.isArray(bytes))
    return getEncodableList2(bytes.map((x2) => getEncodable2(x2)));
  return getEncodableBytes2(bytes);
}
function getEncodableList2(list) {
  const bodyLength = list.reduce((acc, x2) => acc + x2.length, 0);
  const sizeOfBodyLength = getSizeOfLength2(bodyLength);
  const length = (() => {
    if (bodyLength <= 55)
      return 1 + bodyLength;
    return 1 + sizeOfBodyLength + bodyLength;
  })();
  return {
    length,
    encode(cursor) {
      if (bodyLength <= 55) {
        cursor.pushByte(192 + bodyLength);
      } else {
        cursor.pushByte(192 + 55 + sizeOfBodyLength);
        if (sizeOfBodyLength === 1)
          cursor.pushUint8(bodyLength);
        else if (sizeOfBodyLength === 2)
          cursor.pushUint16(bodyLength);
        else if (sizeOfBodyLength === 3)
          cursor.pushUint24(bodyLength);
        else
          cursor.pushUint32(bodyLength);
      }
      for (const { encode: encode4 } of list) {
        encode4(cursor);
      }
    }
  };
}
function getEncodableBytes2(bytesOrHex) {
  const bytes = typeof bytesOrHex === "string" ? fromHex(bytesOrHex) : bytesOrHex;
  const sizeOfBytesLength = getSizeOfLength2(bytes.length);
  const length = (() => {
    if (bytes.length === 1 && bytes[0] < 128)
      return 1;
    if (bytes.length <= 55)
      return 1 + bytes.length;
    return 1 + sizeOfBytesLength + bytes.length;
  })();
  return {
    length,
    encode(cursor) {
      if (bytes.length === 1 && bytes[0] < 128) {
        cursor.pushBytes(bytes);
      } else if (bytes.length <= 55) {
        cursor.pushByte(128 + bytes.length);
        cursor.pushBytes(bytes);
      } else {
        cursor.pushByte(128 + 55 + sizeOfBytesLength);
        if (sizeOfBytesLength === 1)
          cursor.pushUint8(bytes.length);
        else if (sizeOfBytesLength === 2)
          cursor.pushUint16(bytes.length);
        else if (sizeOfBytesLength === 3)
          cursor.pushUint24(bytes.length);
        else
          cursor.pushUint32(bytes.length);
        cursor.pushBytes(bytes);
      }
    }
  };
}
function getSizeOfLength2(length) {
  if (length <= 255)
    return 1;
  if (length <= 65535)
    return 2;
  if (length <= 16777215)
    return 3;
  if (length <= 4294967295)
    return 4;
  throw new BaseError2("Length is too large.");
}

// node_modules/@metamask/fox-sdk/node_modules/ox/_esm/core/Signature.js
function assert3(signature, options = {}) {
  const { recovered } = options;
  if (typeof signature.r === "undefined")
    throw new MissingPropertiesError({ signature });
  if (typeof signature.s === "undefined")
    throw new MissingPropertiesError({ signature });
  if (recovered && typeof signature.yParity === "undefined")
    throw new MissingPropertiesError({ signature });
  if (signature.r < 0n || signature.r > maxUint2562)
    throw new InvalidRError({ value: signature.r });
  if (signature.s < 0n || signature.s > maxUint2562)
    throw new InvalidSError({ value: signature.s });
  if (typeof signature.yParity === "number" && signature.yParity !== 0 && signature.yParity !== 1)
    throw new InvalidYParityError({ value: signature.yParity });
}
function fromBytes3(signature) {
  return fromHex4(fromBytes(signature));
}
function fromHex4(signature) {
  if (signature.length !== 130 && signature.length !== 132)
    throw new InvalidSerializedSizeError2({ signature });
  const r = BigInt(slice3(signature, 0, 32));
  const s2 = BigInt(slice3(signature, 32, 64));
  const yParity = (() => {
    const yParity2 = Number(`0x${signature.slice(130)}`);
    if (Number.isNaN(yParity2))
      return void 0;
    try {
      return vToYParity(yParity2);
    } catch {
      throw new InvalidYParityError({ value: yParity2 });
    }
  })();
  if (typeof yParity === "undefined")
    return {
      r,
      s: s2
    };
  return {
    r,
    s: s2,
    yParity
  };
}
function extract2(value) {
  if (typeof value.r === "undefined")
    return void 0;
  if (typeof value.s === "undefined")
    return void 0;
  return from7(value);
}
function from7(signature) {
  const signature_ = (() => {
    if (typeof signature === "string")
      return fromHex4(signature);
    if (signature instanceof Uint8Array)
      return fromBytes3(signature);
    if (typeof signature.r === "string")
      return fromRpc(signature);
    if (signature.v)
      return fromLegacy(signature);
    return {
      r: signature.r,
      s: signature.s,
      ...typeof signature.yParity !== "undefined" ? { yParity: signature.yParity } : {}
    };
  })();
  assert3(signature_);
  return signature_;
}
function fromLegacy(signature) {
  return {
    r: signature.r,
    s: signature.s,
    yParity: vToYParity(signature.v)
  };
}
function fromRpc(signature) {
  const yParity = (() => {
    const v = signature.v ? Number(signature.v) : void 0;
    let yParity2 = signature.yParity ? Number(signature.yParity) : void 0;
    if (typeof v === "number" && typeof yParity2 !== "number")
      yParity2 = vToYParity(v);
    if (typeof yParity2 !== "number")
      throw new InvalidYParityError({ value: signature.yParity });
    return yParity2;
  })();
  return {
    r: BigInt(signature.r),
    s: BigInt(signature.s),
    yParity
  };
}
function toTuple(signature) {
  const { r, s: s2, yParity } = signature;
  return [
    yParity ? "0x01" : "0x",
    r === 0n ? "0x" : trimLeft2(fromNumber(r)),
    s2 === 0n ? "0x" : trimLeft2(fromNumber(s2))
  ];
}
function vToYParity(v) {
  if (v === 0 || v === 27)
    return 0;
  if (v === 1 || v === 28)
    return 1;
  if (v >= 35)
    return v % 2 === 0 ? 1 : 0;
  throw new InvalidVError({ value: v });
}
var InvalidSerializedSizeError2 = class extends BaseError2 {
  constructor({ signature }) {
    super(`Value \`${signature}\` is an invalid signature size.`, {
      metaMessages: [
        "Expected: 64 bytes or 65 bytes.",
        `Received ${size3(from2(signature))} bytes.`
      ]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Signature.InvalidSerializedSizeError"
    });
  }
};
var MissingPropertiesError = class extends BaseError2 {
  constructor({ signature }) {
    super(`Signature \`${stringify2(signature)}\` is missing either an \`r\`, \`s\`, or \`yParity\` property.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Signature.MissingPropertiesError"
    });
  }
};
var InvalidRError = class extends BaseError2 {
  constructor({ value }) {
    super(`Value \`${value}\` is an invalid r value. r must be a positive integer less than 2^256.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Signature.InvalidRError"
    });
  }
};
var InvalidSError = class extends BaseError2 {
  constructor({ value }) {
    super(`Value \`${value}\` is an invalid s value. s must be a positive integer less than 2^256.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Signature.InvalidSError"
    });
  }
};
var InvalidYParityError = class extends BaseError2 {
  constructor({ value }) {
    super(`Value \`${value}\` is an invalid y-parity value. Y-parity must be 0 or 1.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Signature.InvalidYParityError"
    });
  }
};
var InvalidVError = class extends BaseError2 {
  constructor({ value }) {
    super(`Value \`${value}\` is an invalid v value. v must be 27, 28 or >=35.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Signature.InvalidVError"
    });
  }
};

// node_modules/@metamask/fox-sdk/node_modules/ox/_esm/core/Authorization.js
function from8(authorization, options = {}) {
  if (typeof authorization.chainId === "string")
    return fromRpc2(authorization);
  return { ...authorization, ...options.signature };
}
function fromRpc2(authorization) {
  const { address, chainId, nonce } = authorization;
  const signature = extract2(authorization);
  return {
    address,
    chainId: Number(chainId),
    nonce: BigInt(nonce),
    ...signature
  };
}
function getSignPayload(authorization) {
  return hash(authorization, { presign: true });
}
function hash(authorization, options = {}) {
  const { presign } = options;
  return keccak2562(concat2("0x05", fromHex3(toTuple2(presign ? {
    address: authorization.address,
    chainId: authorization.chainId,
    nonce: authorization.nonce
  } : authorization))));
}
function toTuple2(authorization) {
  const { address, chainId, nonce } = authorization;
  const signature = extract2(authorization);
  return [
    chainId ? fromNumber(chainId) : "0x",
    address,
    nonce ? fromNumber(nonce) : "0x",
    ...signature ? toTuple(signature) : []
  ];
}

// node_modules/@metamask/fox-sdk/node_modules/ox/_esm/core/Secp256k1.js
function recoverAddress2(options) {
  return fromPublicKey(recoverPublicKey2(options));
}
function recoverPublicKey2(options) {
  const { payload, signature } = options;
  const { r, s: s2, yParity } = signature;
  const signature_ = new secp256k1.Signature(BigInt(r), BigInt(s2)).addRecoveryBit(yParity);
  const point = signature_.recoverPublicKey(from2(payload).substring(2));
  return from3(point);
}

// node_modules/@metamask/fox-sdk/node_modules/ox/_esm/erc8010/SignatureErc8010.js
var magicBytes = "0x8010801080108010801080108010801080108010801080108010801080108010";
var suffixParameters = from5("(uint256 chainId, address delegation, uint256 nonce, uint8 yParity, uint256 r, uint256 s), address to, bytes data");
function assert4(value) {
  if (typeof value === "string") {
    if (slice3(value, -32) !== magicBytes)
      throw new InvalidWrappedSignatureError(value);
  } else
    assert3(value.authorization);
}
function from9(value) {
  if (typeof value === "string")
    return unwrap(value);
  return value;
}
function unwrap(wrapped) {
  assert4(wrapped);
  const suffixLength = toNumber2(slice3(wrapped, -64, -32));
  const suffix = slice3(wrapped, -suffixLength - 64, -64);
  const signature = slice3(wrapped, 0, -suffixLength - 64);
  const [auth, to, data] = decode(suffixParameters, suffix);
  const authorization = from8({
    address: auth.delegation,
    chainId: Number(auth.chainId),
    nonce: auth.nonce,
    yParity: auth.yParity,
    r: auth.r,
    s: auth.s
  });
  return {
    authorization,
    signature,
    ...data && data !== "0x" ? { data, to } : {}
  };
}
function wrap(value) {
  const { data, signature } = value;
  assert4(value);
  const self = recoverAddress2({
    payload: getSignPayload(value.authorization),
    signature: from7(value.authorization)
  });
  const suffix = encode2(suffixParameters, [
    {
      ...value.authorization,
      delegation: value.authorization.address,
      chainId: BigInt(value.authorization.chainId)
    },
    value.to ?? self,
    data ?? "0x"
  ]);
  const suffixLength = fromNumber(size3(suffix), { size: 32 });
  return concat2(signature, suffix, suffixLength, magicBytes);
}
function validate4(value) {
  try {
    assert4(value);
    return true;
  } catch {
    return false;
  }
}
var InvalidWrappedSignatureError = class extends BaseError2 {
  constructor(wrapped) {
    super(`Value \`${wrapped}\` is an invalid ERC-8010 wrapped signature.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "SignatureErc8010.InvalidWrappedSignatureError"
    });
  }
};

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/transaction/getSerializedTransactionType.js
function getSerializedTransactionType(serializedTransaction) {
  const serializedType = sliceHex(serializedTransaction, 0, 1);
  if (serializedType === "0x04")
    return "eip7702";
  if (serializedType === "0x03")
    return "eip4844";
  if (serializedType === "0x02")
    return "eip1559";
  if (serializedType === "0x01")
    return "eip2930";
  if (serializedType !== "0x" && hexToNumber(serializedType) >= 192)
    return "legacy";
  throw new InvalidSerializedTransactionTypeError({ serializedType });
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/transaction/parseTransaction.js
function parseTransaction(serializedTransaction) {
  const type = getSerializedTransactionType(serializedTransaction);
  if (type === "eip1559")
    return parseTransactionEIP1559(serializedTransaction);
  if (type === "eip2930")
    return parseTransactionEIP2930(serializedTransaction);
  if (type === "eip4844")
    return parseTransactionEIP4844(serializedTransaction);
  if (type === "eip7702")
    return parseTransactionEIP7702(serializedTransaction);
  return parseTransactionLegacy(serializedTransaction);
}
function parseTransactionEIP7702(serializedTransaction) {
  const transactionArray = toTransactionArray(serializedTransaction);
  const [chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gas, to, value, data, accessList, authorizationList, v, r, s2] = transactionArray;
  if (transactionArray.length !== 10 && transactionArray.length !== 13)
    throw new InvalidSerializedTransactionError({
      attributes: {
        chainId,
        nonce,
        maxPriorityFeePerGas,
        maxFeePerGas,
        gas,
        to,
        value,
        data,
        accessList,
        authorizationList,
        ...transactionArray.length > 9 ? {
          v,
          r,
          s: s2
        } : {}
      },
      serializedTransaction,
      type: "eip7702"
    });
  const transaction = {
    chainId: hexToNumber(chainId),
    type: "eip7702"
  };
  if (isHex(to) && to !== "0x")
    transaction.to = to;
  if (isHex(gas) && gas !== "0x")
    transaction.gas = hexToBigInt(gas);
  if (isHex(data) && data !== "0x")
    transaction.data = data;
  if (isHex(nonce))
    transaction.nonce = nonce === "0x" ? 0 : hexToNumber(nonce);
  if (isHex(value) && value !== "0x")
    transaction.value = hexToBigInt(value);
  if (isHex(maxFeePerGas) && maxFeePerGas !== "0x")
    transaction.maxFeePerGas = hexToBigInt(maxFeePerGas);
  if (isHex(maxPriorityFeePerGas) && maxPriorityFeePerGas !== "0x")
    transaction.maxPriorityFeePerGas = hexToBigInt(maxPriorityFeePerGas);
  if (accessList.length !== 0 && accessList !== "0x")
    transaction.accessList = parseAccessList(accessList);
  if (authorizationList.length !== 0 && authorizationList !== "0x")
    transaction.authorizationList = parseAuthorizationList(authorizationList);
  assertTransactionEIP7702(transaction);
  const signature = transactionArray.length === 13 ? parseEIP155Signature(transactionArray) : void 0;
  return { ...signature, ...transaction };
}
function parseTransactionEIP4844(serializedTransaction) {
  const transactionOrWrapperArray = toTransactionArray(serializedTransaction);
  const hasNetworkWrapper = transactionOrWrapperArray.length === 4;
  const transactionArray = hasNetworkWrapper ? transactionOrWrapperArray[0] : transactionOrWrapperArray;
  const wrapperArray = hasNetworkWrapper ? transactionOrWrapperArray.slice(1) : [];
  const [chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gas, to, value, data, accessList, maxFeePerBlobGas, blobVersionedHashes, v, r, s2] = transactionArray;
  const [blobs, commitments, proofs] = wrapperArray;
  if (!(transactionArray.length === 11 || transactionArray.length === 14))
    throw new InvalidSerializedTransactionError({
      attributes: {
        chainId,
        nonce,
        maxPriorityFeePerGas,
        maxFeePerGas,
        gas,
        to,
        value,
        data,
        accessList,
        ...transactionArray.length > 9 ? {
          v,
          r,
          s: s2
        } : {}
      },
      serializedTransaction,
      type: "eip4844"
    });
  const transaction = {
    blobVersionedHashes,
    chainId: hexToNumber(chainId),
    to,
    type: "eip4844"
  };
  if (isHex(gas) && gas !== "0x")
    transaction.gas = hexToBigInt(gas);
  if (isHex(data) && data !== "0x")
    transaction.data = data;
  if (isHex(nonce))
    transaction.nonce = nonce === "0x" ? 0 : hexToNumber(nonce);
  if (isHex(value) && value !== "0x")
    transaction.value = hexToBigInt(value);
  if (isHex(maxFeePerBlobGas) && maxFeePerBlobGas !== "0x")
    transaction.maxFeePerBlobGas = hexToBigInt(maxFeePerBlobGas);
  if (isHex(maxFeePerGas) && maxFeePerGas !== "0x")
    transaction.maxFeePerGas = hexToBigInt(maxFeePerGas);
  if (isHex(maxPriorityFeePerGas) && maxPriorityFeePerGas !== "0x")
    transaction.maxPriorityFeePerGas = hexToBigInt(maxPriorityFeePerGas);
  if (accessList.length !== 0 && accessList !== "0x")
    transaction.accessList = parseAccessList(accessList);
  if (blobs && commitments && proofs)
    transaction.sidecars = toBlobSidecars({
      blobs,
      commitments,
      proofs
    });
  assertTransactionEIP4844(transaction);
  const signature = transactionArray.length === 14 ? parseEIP155Signature(transactionArray) : void 0;
  return { ...signature, ...transaction };
}
function parseTransactionEIP1559(serializedTransaction) {
  const transactionArray = toTransactionArray(serializedTransaction);
  const [chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gas, to, value, data, accessList, v, r, s2] = transactionArray;
  if (!(transactionArray.length === 9 || transactionArray.length === 12))
    throw new InvalidSerializedTransactionError({
      attributes: {
        chainId,
        nonce,
        maxPriorityFeePerGas,
        maxFeePerGas,
        gas,
        to,
        value,
        data,
        accessList,
        ...transactionArray.length > 9 ? {
          v,
          r,
          s: s2
        } : {}
      },
      serializedTransaction,
      type: "eip1559"
    });
  const transaction = {
    chainId: hexToNumber(chainId),
    type: "eip1559"
  };
  if (isHex(to) && to !== "0x")
    transaction.to = to;
  if (isHex(gas) && gas !== "0x")
    transaction.gas = hexToBigInt(gas);
  if (isHex(data) && data !== "0x")
    transaction.data = data;
  if (isHex(nonce))
    transaction.nonce = nonce === "0x" ? 0 : hexToNumber(nonce);
  if (isHex(value) && value !== "0x")
    transaction.value = hexToBigInt(value);
  if (isHex(maxFeePerGas) && maxFeePerGas !== "0x")
    transaction.maxFeePerGas = hexToBigInt(maxFeePerGas);
  if (isHex(maxPriorityFeePerGas) && maxPriorityFeePerGas !== "0x")
    transaction.maxPriorityFeePerGas = hexToBigInt(maxPriorityFeePerGas);
  if (accessList.length !== 0 && accessList !== "0x")
    transaction.accessList = parseAccessList(accessList);
  assertTransactionEIP1559(transaction);
  const signature = transactionArray.length === 12 ? parseEIP155Signature(transactionArray) : void 0;
  return { ...signature, ...transaction };
}
function parseTransactionEIP2930(serializedTransaction) {
  const transactionArray = toTransactionArray(serializedTransaction);
  const [chainId, nonce, gasPrice, gas, to, value, data, accessList, v, r, s2] = transactionArray;
  if (!(transactionArray.length === 8 || transactionArray.length === 11))
    throw new InvalidSerializedTransactionError({
      attributes: {
        chainId,
        nonce,
        gasPrice,
        gas,
        to,
        value,
        data,
        accessList,
        ...transactionArray.length > 8 ? {
          v,
          r,
          s: s2
        } : {}
      },
      serializedTransaction,
      type: "eip2930"
    });
  const transaction = {
    chainId: hexToNumber(chainId),
    type: "eip2930"
  };
  if (isHex(to) && to !== "0x")
    transaction.to = to;
  if (isHex(gas) && gas !== "0x")
    transaction.gas = hexToBigInt(gas);
  if (isHex(data) && data !== "0x")
    transaction.data = data;
  if (isHex(nonce))
    transaction.nonce = nonce === "0x" ? 0 : hexToNumber(nonce);
  if (isHex(value) && value !== "0x")
    transaction.value = hexToBigInt(value);
  if (isHex(gasPrice) && gasPrice !== "0x")
    transaction.gasPrice = hexToBigInt(gasPrice);
  if (accessList.length !== 0 && accessList !== "0x")
    transaction.accessList = parseAccessList(accessList);
  assertTransactionEIP2930(transaction);
  const signature = transactionArray.length === 11 ? parseEIP155Signature(transactionArray) : void 0;
  return { ...signature, ...transaction };
}
function parseTransactionLegacy(serializedTransaction) {
  const transactionArray = fromRlp(serializedTransaction, "hex");
  const [nonce, gasPrice, gas, to, value, data, chainIdOrV_, r, s2] = transactionArray;
  if (!(transactionArray.length === 6 || transactionArray.length === 9))
    throw new InvalidSerializedTransactionError({
      attributes: {
        nonce,
        gasPrice,
        gas,
        to,
        value,
        data,
        ...transactionArray.length > 6 ? {
          v: chainIdOrV_,
          r,
          s: s2
        } : {}
      },
      serializedTransaction,
      type: "legacy"
    });
  const transaction = {
    type: "legacy"
  };
  if (isHex(to) && to !== "0x")
    transaction.to = to;
  if (isHex(gas) && gas !== "0x")
    transaction.gas = hexToBigInt(gas);
  if (isHex(data) && data !== "0x")
    transaction.data = data;
  if (isHex(nonce))
    transaction.nonce = nonce === "0x" ? 0 : hexToNumber(nonce);
  if (isHex(value) && value !== "0x")
    transaction.value = hexToBigInt(value);
  if (isHex(gasPrice) && gasPrice !== "0x")
    transaction.gasPrice = hexToBigInt(gasPrice);
  assertTransactionLegacy(transaction);
  if (transactionArray.length === 6)
    return transaction;
  const chainIdOrV = isHex(chainIdOrV_) && chainIdOrV_ !== "0x" ? hexToBigInt(chainIdOrV_) : 0n;
  if (s2 === "0x" && r === "0x") {
    if (chainIdOrV > 0)
      transaction.chainId = Number(chainIdOrV);
    return transaction;
  }
  const v = chainIdOrV;
  const chainId = Number((v - 35n) / 2n);
  if (chainId > 0)
    transaction.chainId = chainId;
  else if (v !== 27n && v !== 28n)
    throw new InvalidLegacyVError({ v });
  transaction.v = v;
  transaction.s = s2;
  transaction.r = r;
  transaction.yParity = v % 2n === 0n ? 1 : 0;
  return transaction;
}
function toTransactionArray(serializedTransaction) {
  return fromRlp(`0x${serializedTransaction.slice(4)}`, "hex");
}
function parseAccessList(accessList_) {
  const accessList = [];
  for (let i2 = 0; i2 < accessList_.length; i2++) {
    const [address, storageKeys] = accessList_[i2];
    if (!isAddress(address, { strict: false }))
      throw new InvalidAddressError({ address });
    accessList.push({
      address,
      storageKeys: storageKeys.map((key) => isHash(key) ? key : trim(key))
    });
  }
  return accessList;
}
function parseAuthorizationList(serializedAuthorizationList) {
  const authorizationList = [];
  for (let i2 = 0; i2 < serializedAuthorizationList.length; i2++) {
    const [chainId, address, nonce, yParity, r, s2] = serializedAuthorizationList[i2];
    authorizationList.push({
      address,
      chainId: chainId === "0x" ? 0 : hexToNumber(chainId),
      nonce: nonce === "0x" ? 0 : hexToNumber(nonce),
      ...parseEIP155Signature([yParity, r, s2])
    });
  }
  return authorizationList;
}
function parseEIP155Signature(transactionArray) {
  const signature = transactionArray.slice(-3);
  const v = signature[0] === "0x" || hexToBigInt(signature[0]) === 0n ? 27n : 28n;
  return {
    r: padHex(signature[1], { size: 32 }),
    s: padHex(signature[2], { size: 32 }),
    v,
    yParity: v === 27n ? 0 : 1
  };
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/errors/unit.js
var InvalidDecimalNumberError = class extends BaseError {
  constructor({ value }) {
    super(`Number \`${value}\` is not a valid decimal number.`, {
      name: "InvalidDecimalNumberError"
    });
  }
};

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/unit/parseUnits.js
function parseUnits(value, decimals) {
  if (!/^(-?)([0-9]*)\.?([0-9]*)$/.test(value))
    throw new InvalidDecimalNumberError({ value });
  let [integer, fraction = "0"] = value.split(".");
  const negative = integer.startsWith("-");
  if (negative)
    integer = integer.slice(1);
  fraction = fraction.replace(/(0+)$/, "");
  if (decimals === 0) {
    if (Math.round(Number(`.${fraction}`)) === 1)
      integer = `${BigInt(integer) + 1n}`;
    fraction = "";
  } else if (fraction.length > decimals) {
    const [left, unit, right] = [
      fraction.slice(0, decimals - 1),
      fraction.slice(decimals - 1, decimals),
      fraction.slice(decimals)
    ];
    const rounded = Math.round(Number(`${unit}.${right}`));
    if (rounded > 9)
      fraction = `${BigInt(left) + BigInt(1)}0`.padStart(left.length + 1, "0");
    else
      fraction = `${left}${rounded}`;
    if (fraction.length > decimals) {
      fraction = fraction.slice(1);
      integer = `${BigInt(integer) + 1n}`;
    }
    fraction = fraction.slice(0, decimals);
  } else {
    fraction = fraction.padEnd(decimals, "0");
  }
  return BigInt(`${negative ? "-" : ""}${integer}${fraction}`);
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/formatters/proof.js
function formatStorageProof(storageProof) {
  return storageProof.map((proof) => ({
    ...proof,
    value: BigInt(proof.value)
  }));
}
function formatProof(proof) {
  return {
    ...proof,
    balance: proof.balance ? BigInt(proof.balance) : void 0,
    nonce: proof.nonce ? hexToNumber(proof.nonce) : void 0,
    storageProof: proof.storageProof ? formatStorageProof(proof.storageProof) : void 0
  };
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/getProof.js
async function getProof(client, { address, blockHash, blockNumber, blockTag = "latest", requireCanonical, storageKeys }) {
  const block = formatBlockParameter({
    blockHash,
    blockNumber,
    blockTag,
    requireCanonical
  });
  const proof = await client.request({
    method: "eth_getProof",
    params: [address, storageKeys, block]
  });
  return formatProof(proof);
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/getStorageAt.js
async function getStorageAt(client, { address, blockHash, blockNumber, blockTag = "latest", requireCanonical, slot }) {
  const block = formatBlockParameter({
    blockHash,
    blockNumber,
    blockTag,
    requireCanonical
  });
  const data = await client.request({
    method: "eth_getStorageAt",
    params: [address, slot, block]
  });
  return data;
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/getTransaction.js
async function getTransaction(client, { blockHash, blockNumber, blockTag: blockTag_, hash: hash2, index: index2, sender, nonce }) {
  const blockTag = blockTag_ || "latest";
  const blockNumberHex = blockNumber !== void 0 ? numberToHex(blockNumber) : void 0;
  let transaction = null;
  if (hash2) {
    transaction = await client.request({
      method: "eth_getTransactionByHash",
      params: [hash2]
    }, { dedupe: true });
  } else if (blockHash) {
    transaction = await client.request({
      method: "eth_getTransactionByBlockHashAndIndex",
      params: [blockHash, numberToHex(index2)]
    }, { dedupe: true });
  } else if ((blockNumberHex || blockTag) && typeof index2 === "number") {
    transaction = await client.request({
      method: "eth_getTransactionByBlockNumberAndIndex",
      params: [blockNumberHex || blockTag, numberToHex(index2)]
    }, { dedupe: Boolean(blockNumberHex) });
  } else if (sender && typeof nonce === "number") {
    transaction = await client.request({
      method: "eth_getTransactionBySenderAndNonce",
      params: [sender, numberToHex(nonce)]
    }, { dedupe: true });
  }
  if (!transaction)
    throw new TransactionNotFoundError({
      blockHash,
      blockNumber,
      blockTag,
      hash: hash2,
      index: index2
    });
  const format = client.chain?.formatters?.transaction?.format || formatTransaction;
  return format(transaction, "getTransaction");
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/getTransactionConfirmations.js
async function getTransactionConfirmations(client, { hash: hash2, transactionReceipt }) {
  const [blockNumber, transaction] = await Promise.all([
    getAction(client, getBlockNumber, "getBlockNumber")({}),
    hash2 ? getAction(client, getTransaction, "getTransaction")({ hash: hash2 }) : void 0
  ]);
  const transactionBlockNumber = transactionReceipt?.blockNumber || transaction?.blockNumber;
  if (!transactionBlockNumber)
    return 0n;
  return blockNumber - transactionBlockNumber + 1n;
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/getTransactionReceipt.js
async function getTransactionReceipt(client, { hash: hash2 }) {
  const receipt = await client.request({
    method: "eth_getTransactionReceipt",
    params: [hash2]
  }, { dedupe: true });
  if (!receipt)
    throw new TransactionReceiptNotFoundError({ hash: hash2 });
  const format = client.chain?.formatters?.transactionReceipt?.format || formatTransactionReceipt;
  return format(receipt, "getTransactionReceipt");
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/multicall.js
async function multicall(client, parameters) {
  const { account, authorizationList, allowFailure = true, blockHash, blockNumber, blockOverrides, blockTag, requireCanonical, stateOverride } = parameters;
  const contracts = parameters.contracts;
  const { batchSize = parameters.batchSize ?? 1024, deployless = parameters.deployless ?? false } = typeof client.batch?.multicall === "object" ? client.batch.multicall : {};
  const multicallAddress = (() => {
    if (parameters.multicallAddress)
      return parameters.multicallAddress;
    if (deployless)
      return null;
    if (client.chain) {
      return getChainContractAddress({
        blockNumber,
        chain: client.chain,
        contract: "multicall3"
      });
    }
    throw new Error("client chain not configured. multicallAddress is required.");
  })();
  const chunkedCalls = [[]];
  let currentChunk = 0;
  let currentChunkSize = 0;
  for (let i2 = 0; i2 < contracts.length; i2++) {
    const { abi: abi2, address, args, functionName } = contracts[i2];
    try {
      const callData = encodeFunctionData({ abi: abi2, args, functionName });
      currentChunkSize += (callData.length - 2) / 2;
      if (
        // Check if batching is enabled.
        batchSize > 0 && // Check if the current size of the batch exceeds the size limit.
        currentChunkSize > batchSize && // Check if the current chunk is not already empty.
        chunkedCalls[currentChunk].length > 0
      ) {
        currentChunk++;
        currentChunkSize = (callData.length - 2) / 2;
        chunkedCalls[currentChunk] = [];
      }
      chunkedCalls[currentChunk] = [
        ...chunkedCalls[currentChunk],
        {
          allowFailure: true,
          callData,
          target: address
        }
      ];
    } catch (err) {
      const error = getContractError(err, {
        abi: abi2,
        address,
        args,
        docsPath: "/docs/contract/multicall",
        functionName,
        sender: account
      });
      if (!allowFailure)
        throw error;
      chunkedCalls[currentChunk] = [
        ...chunkedCalls[currentChunk],
        {
          allowFailure: true,
          callData: "0x",
          target: address
        }
      ];
    }
  }
  const aggregate3Results = await Promise.allSettled(chunkedCalls.map((calls) => getAction(client, readContract, "readContract")({
    ...multicallAddress === null ? { code: multicall3Bytecode } : { address: multicallAddress },
    abi: multicall3Abi,
    account,
    args: [calls],
    authorizationList,
    blockHash,
    blockNumber,
    blockOverrides,
    blockTag,
    functionName: "aggregate3",
    requireCanonical,
    stateOverride
  })));
  const results = [];
  for (let i2 = 0; i2 < aggregate3Results.length; i2++) {
    const result = aggregate3Results[i2];
    if (result.status === "rejected") {
      if (!allowFailure)
        throw result.reason;
      for (let j2 = 0; j2 < chunkedCalls[i2].length; j2++) {
        results.push({
          status: "failure",
          error: result.reason,
          result: void 0
        });
      }
      continue;
    }
    const aggregate3Result = result.value;
    for (let j2 = 0; j2 < aggregate3Result.length; j2++) {
      const { returnData, success } = aggregate3Result[j2];
      const { callData } = chunkedCalls[i2][j2];
      const { abi: abi2, address, functionName, args } = contracts[results.length];
      try {
        if (callData === "0x")
          throw new AbiDecodingZeroDataError();
        if (!success)
          throw new RawContractError({ data: returnData });
        const result2 = decodeFunctionResult({
          abi: abi2,
          args,
          data: returnData,
          functionName
        });
        results.push(allowFailure ? { result: result2, status: "success" } : result2);
      } catch (err) {
        const error = getContractError(err, {
          abi: abi2,
          address,
          args,
          docsPath: "/docs/contract/multicall",
          functionName
        });
        if (!allowFailure)
          throw error;
        results.push({ error, result: void 0, status: "failure" });
      }
    }
  }
  if (results.length !== contracts.length)
    throw new BaseError("multicall results mismatch");
  return results;
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/simulateBlocks.js
async function simulateBlocks(client, parameters) {
  const { blockNumber, blockTag = client.experimental_blockTag ?? "latest", blocks, returnFullTransactions, traceTransfers, validation } = parameters;
  try {
    const blockStateCalls = [];
    for (const block2 of blocks) {
      const blockOverrides = block2.blockOverrides ? toRpc(block2.blockOverrides) : void 0;
      const calls = block2.calls.map((call_) => {
        const call2 = call_;
        const account = call2.account ? parseAccount(call2.account) : void 0;
        const data = call2.abi ? encodeFunctionData(call2) : call2.data;
        const request = {
          ...call2,
          account,
          data: call2.dataSuffix ? concat([data || "0x", call2.dataSuffix]) : data,
          from: call2.from ?? account?.address
        };
        assertRequest(request);
        return formatTransactionRequest(request);
      });
      const stateOverrides = block2.stateOverrides ? serializeStateOverride(block2.stateOverrides) : void 0;
      blockStateCalls.push({
        blockOverrides,
        calls,
        stateOverrides
      });
    }
    const blockNumberHex = typeof blockNumber === "bigint" ? numberToHex(blockNumber) : void 0;
    const block = blockNumberHex || blockTag;
    const result = await client.request({
      method: "eth_simulateV1",
      params: [
        { blockStateCalls, returnFullTransactions, traceTransfers, validation },
        block
      ]
    });
    return result.map((block2, i2) => ({
      ...formatBlock(block2),
      calls: block2.calls.map((call2, j2) => {
        const { abi: abi2, args, functionName, to } = blocks[i2].calls[j2];
        const data = call2.error?.data ?? call2.returnData;
        const gasUsed = BigInt(call2.gasUsed);
        const logs = call2.logs?.map((log2) => formatLog(log2));
        const status = call2.status === "0x1" ? "success" : "failure";
        const result2 = abi2 && status === "success" && data !== "0x" ? decodeFunctionResult({
          abi: abi2,
          data,
          functionName
        }) : null;
        const error = (() => {
          if (status === "success")
            return void 0;
          let error2;
          if (data === "0x")
            error2 = new AbiDecodingZeroDataError();
          else if (data)
            error2 = new RawContractError({ data });
          if (!error2)
            return void 0;
          return getContractError(error2, {
            abi: abi2 ?? [],
            address: to ?? "0x",
            args,
            functionName: functionName ?? "<unknown>"
          });
        })();
        return {
          data,
          gasUsed,
          logs,
          status,
          ...status === "success" ? {
            result: result2
          } : {
            error
          }
        };
      })
    }));
  } catch (e) {
    const cause = e;
    const error = getNodeError(cause, {});
    if (error instanceof UnknownNodeError)
      throw cause;
    throw error;
  }
}

// node_modules/@metamask/fox-sdk/node_modules/ox/_esm/core/internal/abiItem.js
function normalizeSignature(signature) {
  let active = true;
  let current = "";
  let level = 0;
  let result = "";
  let valid = false;
  for (let i2 = 0; i2 < signature.length; i2++) {
    const char = signature[i2];
    if (["(", ")", ","].includes(char))
      active = true;
    if (char === "(")
      level++;
    if (char === ")")
      level--;
    if (!active)
      continue;
    if (level === 0) {
      if (char === " " && ["event", "function", "error", ""].includes(result))
        result = "";
      else {
        result += char;
        if (char === ")") {
          valid = true;
          break;
        }
      }
      continue;
    }
    if (char === " ") {
      if (signature[i2 - 1] !== "," && current !== "," && current !== ",(") {
        current = "";
        active = false;
      }
      continue;
    }
    result += char;
    current += char;
  }
  if (!valid)
    throw new BaseError2("Unable to normalize signature.");
  return result;
}
function isArgOfType(arg, abiParameter) {
  const argType = typeof arg;
  const abiParameterType = abiParameter.type;
  switch (abiParameterType) {
    case "address":
      return validate3(arg, { strict: false });
    case "bool":
      return argType === "boolean";
    case "function":
      return argType === "string";
    case "string":
      return argType === "string";
    default: {
      if (abiParameterType === "tuple" && "components" in abiParameter)
        return Object.values(abiParameter.components).every((component, index2) => {
          return isArgOfType(Object.values(arg)[index2], component);
        });
      if (/^u?int(8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)?$/.test(abiParameterType))
        return argType === "number" || argType === "bigint";
      if (/^bytes([1-9]|1[0-9]|2[0-9]|3[0-2])?$/.test(abiParameterType))
        return argType === "string" || arg instanceof Uint8Array;
      if (/[a-z]+[1-9]{0,3}(\[[0-9]{0,}\])+$/.test(abiParameterType)) {
        return Array.isArray(arg) && arg.every((x2) => isArgOfType(x2, {
          ...abiParameter,
          // Pop off `[]` or `[M]` from end of type
          type: abiParameterType.replace(/(\[[0-9]{0,}\])$/, "")
        }));
      }
      return false;
    }
  }
}
function getAmbiguousTypes(sourceParameters, targetParameters, args) {
  for (const parameterIndex in sourceParameters) {
    const sourceParameter = sourceParameters[parameterIndex];
    const targetParameter = targetParameters[parameterIndex];
    if (sourceParameter.type === "tuple" && targetParameter.type === "tuple" && "components" in sourceParameter && "components" in targetParameter)
      return getAmbiguousTypes(sourceParameter.components, targetParameter.components, args[parameterIndex]);
    const types = [sourceParameter.type, targetParameter.type];
    const ambiguous = (() => {
      if (types.includes("address") && types.includes("bytes20"))
        return true;
      if (types.includes("address") && types.includes("string"))
        return validate3(args[parameterIndex], {
          strict: false
        });
      if (types.includes("address") && types.includes("bytes"))
        return validate3(args[parameterIndex], {
          strict: false
        });
      return false;
    })();
    if (ambiguous)
      return types;
  }
  return;
}

// node_modules/@metamask/fox-sdk/node_modules/ox/_esm/core/AbiItem.js
function from10(abiItem, options = {}) {
  const { prepare = true } = options;
  const item = (() => {
    if (Array.isArray(abiItem))
      return parseAbiItem(abiItem);
    if (typeof abiItem === "string")
      return parseAbiItem(abiItem);
    return abiItem;
  })();
  return {
    ...item,
    ...prepare ? { hash: getSignatureHash(item) } : {}
  };
}
function fromAbi(abi2, name, options) {
  const { args = [], prepare = true } = options ?? {};
  const isSelector = validate2(name, { strict: false });
  const abiItems = abi2.filter((abiItem2) => {
    if (isSelector) {
      if (abiItem2.type === "function" || abiItem2.type === "error")
        return getSelector(abiItem2) === slice3(name, 0, 4);
      if (abiItem2.type === "event")
        return getSignatureHash(abiItem2) === name;
      return false;
    }
    return "name" in abiItem2 && abiItem2.name === name;
  });
  if (abiItems.length === 0)
    throw new NotFoundError({ name });
  if (abiItems.length === 1)
    return {
      ...abiItems[0],
      ...prepare ? { hash: getSignatureHash(abiItems[0]) } : {}
    };
  let matchedAbiItem;
  for (const abiItem2 of abiItems) {
    if (!("inputs" in abiItem2))
      continue;
    if (!args || args.length === 0) {
      if (!abiItem2.inputs || abiItem2.inputs.length === 0)
        return {
          ...abiItem2,
          ...prepare ? { hash: getSignatureHash(abiItem2) } : {}
        };
      continue;
    }
    if (!abiItem2.inputs)
      continue;
    if (abiItem2.inputs.length === 0)
      continue;
    if (abiItem2.inputs.length !== args.length)
      continue;
    const matched = args.every((arg, index2) => {
      const abiParameter = "inputs" in abiItem2 && abiItem2.inputs[index2];
      if (!abiParameter)
        return false;
      return isArgOfType(arg, abiParameter);
    });
    if (matched) {
      if (matchedAbiItem && "inputs" in matchedAbiItem && matchedAbiItem.inputs) {
        const ambiguousTypes = getAmbiguousTypes(abiItem2.inputs, matchedAbiItem.inputs, args);
        if (ambiguousTypes)
          throw new AmbiguityError({
            abiItem: abiItem2,
            type: ambiguousTypes[0]
          }, {
            abiItem: matchedAbiItem,
            type: ambiguousTypes[1]
          });
      }
      matchedAbiItem = abiItem2;
    }
  }
  const abiItem = (() => {
    if (matchedAbiItem)
      return matchedAbiItem;
    const [abiItem2, ...overloads] = abiItems;
    return { ...abiItem2, overloads };
  })();
  if (!abiItem)
    throw new NotFoundError({ name });
  return {
    ...abiItem,
    ...prepare ? { hash: getSignatureHash(abiItem) } : {}
  };
}
function getSelector(...parameters) {
  const abiItem = (() => {
    if (Array.isArray(parameters[0])) {
      const [abi2, name] = parameters;
      return fromAbi(abi2, name);
    }
    return parameters[0];
  })();
  return slice3(getSignatureHash(abiItem), 0, 4);
}
function getSignature(...parameters) {
  const abiItem = (() => {
    if (Array.isArray(parameters[0])) {
      const [abi2, name] = parameters;
      return fromAbi(abi2, name);
    }
    return parameters[0];
  })();
  const signature = (() => {
    if (typeof abiItem === "string")
      return abiItem;
    return formatAbiItem2(abiItem);
  })();
  return normalizeSignature(signature);
}
function getSignatureHash(...parameters) {
  const abiItem = (() => {
    if (Array.isArray(parameters[0])) {
      const [abi2, name] = parameters;
      return fromAbi(abi2, name);
    }
    return parameters[0];
  })();
  if (typeof abiItem !== "string" && "hash" in abiItem && abiItem.hash)
    return abiItem.hash;
  return keccak2562(fromString2(getSignature(abiItem)));
}
var AmbiguityError = class extends BaseError2 {
  constructor(x2, y2) {
    super("Found ambiguous types in overloaded ABI Items.", {
      metaMessages: [
        // TODO: abitype to add support for signature-formatted ABI items.
        `\`${x2.type}\` in \`${normalizeSignature(formatAbiItem2(x2.abiItem))}\`, and`,
        `\`${y2.type}\` in \`${normalizeSignature(formatAbiItem2(y2.abiItem))}\``,
        "",
        "These types encode differently and cannot be distinguished at runtime.",
        "Remove one of the ambiguous items in the ABI."
      ]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "AbiItem.AmbiguityError"
    });
  }
};
var NotFoundError = class extends BaseError2 {
  constructor({ name, data, type = "item" }) {
    const selector = (() => {
      if (name)
        return ` with name "${name}"`;
      if (data)
        return ` with data "${data}"`;
      return "";
    })();
    super(`ABI ${type}${selector} not found.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "AbiItem.NotFoundError"
    });
  }
};

// node_modules/@metamask/fox-sdk/node_modules/ox/_esm/core/AbiConstructor.js
function encode3(...parameters) {
  const [abiConstructor, options] = (() => {
    if (Array.isArray(parameters[0])) {
      const [abi2, options2] = parameters;
      return [fromAbi2(abi2), options2];
    }
    return parameters;
  })();
  const { bytecode, args } = options;
  return concat2(bytecode, abiConstructor.inputs?.length && args?.length ? encode2(abiConstructor.inputs, args) : "0x");
}
function from11(abiConstructor) {
  return from10(abiConstructor);
}
function fromAbi2(abi2) {
  const item = abi2.find((item2) => item2.type === "constructor");
  if (!item)
    throw new NotFoundError({ name: "constructor" });
  return item;
}

// node_modules/@metamask/fox-sdk/node_modules/ox/_esm/core/AbiFunction.js
function encodeData2(...parameters) {
  const [abiFunction, args = []] = (() => {
    if (Array.isArray(parameters[0])) {
      const [abi2, name, args3] = parameters;
      return [fromAbi3(abi2, name, { args: args3 }), args3];
    }
    const [abiFunction2, args2] = parameters;
    return [abiFunction2, args2];
  })();
  const { overloads } = abiFunction;
  const item = overloads ? fromAbi3([abiFunction, ...overloads], abiFunction.name, {
    args
  }) : abiFunction;
  const selector = getSelector2(item);
  const data = args.length > 0 ? encode2(item.inputs, args) : void 0;
  return data ? concat2(selector, data) : selector;
}
function from12(abiFunction, options = {}) {
  return from10(abiFunction, options);
}
function fromAbi3(abi2, name, options) {
  const item = fromAbi(abi2, name, options);
  if (item.type !== "function")
    throw new NotFoundError({ name, type: "function" });
  return item;
}
function getSelector2(abiItem) {
  return getSelector(abiItem);
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/constants/address.js
var ethAddress = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
var zeroAddress = "0x0000000000000000000000000000000000000000";

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/simulateCalls.js
var getBalanceCode = "0x6080604052348015600e575f80fd5b5061016d8061001c5f395ff3fe608060405234801561000f575f80fd5b5060043610610029575f3560e01c8063f8b2cb4f1461002d575b5f80fd5b610047600480360381019061004291906100db565b61005d565b604051610054919061011e565b60405180910390f35b5f8173ffffffffffffffffffffffffffffffffffffffff16319050919050565b5f80fd5b5f73ffffffffffffffffffffffffffffffffffffffff82169050919050565b5f6100aa82610081565b9050919050565b6100ba816100a0565b81146100c4575f80fd5b50565b5f813590506100d5816100b1565b92915050565b5f602082840312156100f0576100ef61007d565b5b5f6100fd848285016100c7565b91505092915050565b5f819050919050565b61011881610106565b82525050565b5f6020820190506101315f83018461010f565b9291505056fea26469706673582212203b9fe929fe995c7cf9887f0bdba8a36dd78e8b73f149b17d2d9ad7cd09d2dc6264736f6c634300081a0033";
async function simulateCalls(client, parameters) {
  const { blockNumber, blockTag, calls, stateOverrides, traceAssetChanges, traceTransfers, validation } = parameters;
  const account = parameters.account ? parseAccount(parameters.account) : void 0;
  if (traceAssetChanges && !account)
    throw new BaseError("`account` is required when `traceAssetChanges` is true");
  const getBalanceData = account ? encode3(from11("constructor(bytes, bytes)"), {
    bytecode: deploylessCallViaBytecodeBytecode,
    args: [
      getBalanceCode,
      encodeData2(from12("function getBalance(address)"), [account.address])
    ]
  }) : void 0;
  const assetAddresses = traceAssetChanges ? await Promise.all(parameters.calls.map(async (call2) => {
    if (!call2.data && !call2.abi)
      return;
    const { accessList } = await createAccessList(client, {
      account: account.address,
      ...call2,
      data: call2.abi ? encodeFunctionData(call2) : call2.data
    });
    return accessList.map(({ address, storageKeys }) => storageKeys.length > 0 ? address : null);
  })).then((x2) => x2.flat().filter(Boolean)) : [];
  const blocks = await simulateBlocks(client, {
    blockNumber,
    blockTag,
    blocks: [
      ...traceAssetChanges ? [
        // ETH pre balances
        {
          calls: [{ data: getBalanceData }],
          stateOverrides
        },
        // Asset pre balances
        {
          calls: assetAddresses.map((address, i2) => ({
            abi: [
              from12("function balanceOf(address) returns (uint256)")
            ],
            functionName: "balanceOf",
            args: [account.address],
            to: address,
            from: zeroAddress,
            nonce: i2
          })),
          stateOverrides: [
            {
              address: zeroAddress,
              nonce: 0
            }
          ]
        }
      ] : [],
      {
        calls: [...calls, { to: zeroAddress }].map((call2) => ({
          ...call2,
          from: account?.address
        })),
        stateOverrides
      },
      ...traceAssetChanges ? [
        // ETH post balances
        {
          calls: [{ data: getBalanceData }]
        },
        // Asset post balances
        {
          calls: assetAddresses.map((address, i2) => ({
            abi: [
              from12("function balanceOf(address) returns (uint256)")
            ],
            functionName: "balanceOf",
            args: [account.address],
            to: address,
            from: zeroAddress,
            nonce: i2
          })),
          stateOverrides: [
            {
              address: zeroAddress,
              nonce: 0
            }
          ]
        },
        // Decimals
        {
          calls: assetAddresses.map((address, i2) => ({
            to: address,
            abi: [
              from12("function decimals() returns (uint256)")
            ],
            functionName: "decimals",
            from: zeroAddress,
            nonce: i2
          })),
          stateOverrides: [
            {
              address: zeroAddress,
              nonce: 0
            }
          ]
        },
        // Token URI
        {
          calls: assetAddresses.map((address, i2) => ({
            to: address,
            abi: [
              from12("function tokenURI(uint256) returns (string)")
            ],
            functionName: "tokenURI",
            args: [0n],
            from: zeroAddress,
            nonce: i2
          })),
          stateOverrides: [
            {
              address: zeroAddress,
              nonce: 0
            }
          ]
        },
        // Symbols
        {
          calls: assetAddresses.map((address, i2) => ({
            to: address,
            abi: [from12("function symbol() returns (string)")],
            functionName: "symbol",
            from: zeroAddress,
            nonce: i2
          })),
          stateOverrides: [
            {
              address: zeroAddress,
              nonce: 0
            }
          ]
        }
      ] : []
    ],
    traceTransfers,
    validation
  });
  const block_results = traceAssetChanges ? blocks[2] : blocks[0];
  const [block_ethPre, block_assetsPre, , block_ethPost, block_assetsPost, block_decimals, block_tokenURI, block_symbols] = traceAssetChanges ? blocks : [];
  const { calls: block_calls, ...block } = block_results;
  const results = block_calls.slice(0, -1) ?? [];
  const ethPre = block_ethPre?.calls ?? [];
  const assetsPre = block_assetsPre?.calls ?? [];
  const balancesPre = [...ethPre, ...assetsPre].map((call2) => call2.status === "success" ? hexToBigInt(call2.data) : null);
  const ethPost = block_ethPost?.calls ?? [];
  const assetsPost = block_assetsPost?.calls ?? [];
  const balancesPost = [...ethPost, ...assetsPost].map((call2) => call2.status === "success" ? hexToBigInt(call2.data) : null);
  const decimals = (block_decimals?.calls ?? []).map((x2) => x2.status === "success" ? x2.result : null);
  const symbols = (block_symbols?.calls ?? []).map((x2) => x2.status === "success" ? x2.result : null);
  const tokenURI = (block_tokenURI?.calls ?? []).map((x2) => x2.status === "success" ? x2.result : null);
  const changes = [];
  for (const [i2, balancePost] of balancesPost.entries()) {
    const balancePre = balancesPre[i2];
    if (typeof balancePost !== "bigint")
      continue;
    if (typeof balancePre !== "bigint")
      continue;
    const decimals_ = decimals[i2 - 1];
    const symbol_ = symbols[i2 - 1];
    const tokenURI_ = tokenURI[i2 - 1];
    const token = (() => {
      if (i2 === 0)
        return {
          address: ethAddress,
          decimals: 18,
          symbol: "ETH"
        };
      return {
        address: assetAddresses[i2 - 1],
        decimals: tokenURI_ || decimals_ ? Number(decimals_ ?? 1) : void 0,
        symbol: symbol_ ?? void 0
      };
    })();
    if (changes.some((change) => change.token.address === token.address))
      continue;
    changes.push({
      token,
      value: {
        pre: balancePre,
        post: balancePost,
        diff: balancePost - balancePre
      }
    });
  }
  return {
    assetChanges: changes,
    block,
    results
  };
}

// node_modules/@metamask/fox-sdk/node_modules/ox/_esm/erc6492/SignatureErc6492.js
var SignatureErc6492_exports = {};
__export(SignatureErc6492_exports, {
  InvalidWrappedSignatureError: () => InvalidWrappedSignatureError2,
  assert: () => assert5,
  from: () => from13,
  magicBytes: () => magicBytes2,
  universalSignatureValidatorAbi: () => universalSignatureValidatorAbi,
  universalSignatureValidatorBytecode: () => universalSignatureValidatorBytecode,
  unwrap: () => unwrap2,
  validate: () => validate5,
  wrap: () => wrap2
});
var magicBytes2 = "0x6492649264926492649264926492649264926492649264926492649264926492";
var universalSignatureValidatorBytecode = "0x608060405234801561001057600080fd5b5060405161069438038061069483398101604081905261002f9161051e565b600061003c848484610048565b9050806000526001601ff35b60007f64926492649264926492649264926492649264926492649264926492649264926100748361040c565b036101e7576000606080848060200190518101906100929190610577565b60405192955090935091506000906001600160a01b038516906100b69085906105dd565b6000604051808303816000865af19150503d80600081146100f3576040519150601f19603f3d011682016040523d82523d6000602084013e6100f8565b606091505b50509050876001600160a01b03163b60000361016057806101605760405162461bcd60e51b815260206004820152601e60248201527f5369676e617475726556616c696461746f723a206465706c6f796d656e74000060448201526064015b60405180910390fd5b604051630b135d3f60e11b808252906001600160a01b038a1690631626ba7e90610190908b9087906004016105f9565b602060405180830381865afa1580156101ad573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906101d19190610633565b6001600160e01b03191614945050505050610405565b6001600160a01b0384163b1561027a57604051630b135d3f60e11b808252906001600160a01b03861690631626ba7e9061022790879087906004016105f9565b602060405180830381865afa158015610244573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906102689190610633565b6001600160e01b031916149050610405565b81516041146102df5760405162461bcd60e51b815260206004820152603a602482015260008051602061067483398151915260448201527f3a20696e76616c6964207369676e6174757265206c656e6774680000000000006064820152608401610157565b6102e7610425565b5060208201516040808401518451859392600091859190811061030c5761030c61065d565b016020015160f81c9050601b811480159061032b57508060ff16601c14155b1561038c5760405162461bcd60e51b815260206004820152603b602482015260008051602061067483398151915260448201527f3a20696e76616c6964207369676e617475726520762076616c756500000000006064820152608401610157565b60408051600081526020810180835289905260ff83169181019190915260608101849052608081018390526001600160a01b0389169060019060a0016020604051602081039080840390855afa1580156103ea573d6000803e3d6000fd5b505050602060405103516001600160a01b0316149450505050505b9392505050565b600060208251101561041d57600080fd5b508051015190565b60405180606001604052806003906020820280368337509192915050565b6001600160a01b038116811461045857600080fd5b50565b634e487b7160e01b600052604160045260246000fd5b60005b8381101561048c578181015183820152602001610474565b50506000910152565b600082601f8301126104a657600080fd5b81516001600160401b038111156104bf576104bf61045b565b604051601f8201601f19908116603f011681016001600160401b03811182821017156104ed576104ed61045b565b60405281815283820160200185101561050557600080fd5b610516826020830160208701610471565b949350505050565b60008060006060848603121561053357600080fd5b835161053e81610443565b6020850151604086015191945092506001600160401b0381111561056157600080fd5b61056d86828701610495565b9150509250925092565b60008060006060848603121561058c57600080fd5b835161059781610443565b60208501519093506001600160401b038111156105b357600080fd5b6105bf86828701610495565b604086015190935090506001600160401b0381111561056157600080fd5b600082516105ef818460208701610471565b9190910192915050565b828152604060208201526000825180604084015261061e816060850160208701610471565b601f01601f1916919091016060019392505050565b60006020828403121561064557600080fd5b81516001600160e01b03198116811461040557600080fd5b634e487b7160e01b600052603260045260246000fdfe5369676e617475726556616c696461746f72237265636f7665725369676e6572";
var universalSignatureValidatorAbi = [
  {
    inputs: [
      {
        name: "_signer",
        type: "address"
      },
      {
        name: "_hash",
        type: "bytes32"
      },
      {
        name: "_signature",
        type: "bytes"
      }
    ],
    stateMutability: "nonpayable",
    type: "constructor"
  },
  {
    inputs: [
      {
        name: "_signer",
        type: "address"
      },
      {
        name: "_hash",
        type: "bytes32"
      },
      {
        name: "_signature",
        type: "bytes"
      }
    ],
    outputs: [
      {
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function",
    name: "isValidSig"
  }
];
function assert5(wrapped) {
  if (slice3(wrapped, -32) !== magicBytes2)
    throw new InvalidWrappedSignatureError2(wrapped);
}
function from13(wrapped) {
  if (typeof wrapped === "string")
    return unwrap2(wrapped);
  return wrapped;
}
function unwrap2(wrapped) {
  assert5(wrapped);
  const [to, data, signature] = decode(from5("address, bytes, bytes"), wrapped);
  return { data, signature, to };
}
function wrap2(value) {
  const { data, signature, to } = value;
  return concat2(encode2(from5("address, bytes, bytes"), [
    to,
    data,
    signature
  ]), magicBytes2);
}
function validate5(wrapped) {
  try {
    assert5(wrapped);
    return true;
  } catch {
    return false;
  }
}
var InvalidWrappedSignatureError2 = class extends BaseError2 {
  constructor(wrapped) {
    super(`Value \`${wrapped}\` is an invalid ERC-6492 wrapped signature.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "SignatureErc6492.InvalidWrappedSignatureError"
    });
  }
};

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/signature/serializeSignature.js
function serializeSignature({ r, s: s2, to = "hex", v, yParity }) {
  const yParity_ = (() => {
    if (yParity === 0 || yParity === 1)
      return yParity;
    if (v && (v === 27n || v === 28n || v >= 35n))
      return v % 2n === 0n ? 1 : 0;
    throw new Error("Invalid `v` or `yParity` value");
  })();
  const signature = `0x${new secp256k1.Signature(hexToBigInt(r), hexToBigInt(s2)).toCompactHex()}${yParity_ === 0 ? "1b" : "1c"}`;
  if (to === "hex")
    return signature;
  return hexToBytes(signature);
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/verifyHash.js
async function verifyHash(client, parameters) {
  const { address, chain: chain2 = client.chain, hash: hash2, erc6492VerifierAddress: verifierAddress = parameters.universalSignatureVerifierAddress ?? chain2?.contracts?.erc6492Verifier?.address, multicallAddress = parameters.multicallAddress ?? chain2?.contracts?.multicall3?.address, mode = "auto" } = parameters;
  if (chain2?.verifyHash)
    return await chain2.verifyHash(client, parameters);
  const signature = (() => {
    const signature2 = parameters.signature;
    if (isHex(signature2))
      return signature2;
    if (typeof signature2 === "object" && "r" in signature2 && "s" in signature2)
      return serializeSignature(signature2);
    return bytesToHex(signature2);
  })();
  try {
    if (mode === "eoa") {
      try {
        const verified = isAddressEqual(getAddress(address), await recoverAddress({ hash: hash2, signature }));
        if (verified)
          return true;
      } catch {
      }
    }
    if (SignatureErc8010_exports.validate(signature))
      return await verifyErc8010(client, {
        ...parameters,
        multicallAddress,
        signature
      });
    return await verifyErc6492(client, {
      ...parameters,
      verifierAddress,
      signature
    });
  } catch (error) {
    if (mode !== "eoa") {
      try {
        const verified = isAddressEqual(getAddress(address), await recoverAddress({ hash: hash2, signature }));
        if (verified)
          return true;
      } catch {
      }
    }
    if (error instanceof VerificationError) {
      return false;
    }
    throw error;
  }
}
async function verifyErc8010(client, parameters) {
  const { address, blockNumber, blockTag, hash: hash2, multicallAddress } = parameters;
  const { authorization: authorization_ox, data: initData, signature, to } = SignatureErc8010_exports.unwrap(parameters.signature);
  const code = await getCode(client, {
    address,
    blockNumber,
    blockTag
  });
  if (code === concatHex(["0xef0100", authorization_ox.address]))
    return await verifyErc1271(client, {
      address,
      blockNumber,
      blockTag,
      hash: hash2,
      signature
    });
  const authorization = {
    address: authorization_ox.address,
    chainId: Number(authorization_ox.chainId),
    nonce: Number(authorization_ox.nonce),
    r: numberToHex(authorization_ox.r, { size: 32 }),
    s: numberToHex(authorization_ox.s, { size: 32 }),
    yParity: authorization_ox.yParity
  };
  const valid = await verifyAuthorization({
    address,
    authorization
  });
  if (!valid)
    throw new VerificationError();
  const results = await getAction(client, readContract, "readContract")({
    ...multicallAddress ? { address: multicallAddress } : { code: multicall3Bytecode },
    authorizationList: [authorization],
    abi: multicall3Abi,
    blockNumber,
    blockTag: "pending",
    functionName: "aggregate3",
    args: [
      [
        ...initData ? [
          {
            allowFailure: true,
            target: to ?? address,
            callData: initData
          }
        ] : [],
        {
          allowFailure: true,
          target: address,
          callData: encodeFunctionData({
            abi: erc1271Abi,
            functionName: "isValidSignature",
            args: [hash2, signature]
          })
        }
      ]
    ]
  });
  const data = results[results.length - 1]?.returnData;
  if (data?.startsWith("0x1626ba7e"))
    return true;
  throw new VerificationError();
}
async function verifyErc6492(client, parameters) {
  const { address, factory, factoryData, hash: hash2, signature, verifierAddress, ...rest } = parameters;
  const wrappedSignature = await (async () => {
    if (!factory && !factoryData)
      return signature;
    if (SignatureErc6492_exports.validate(signature))
      return signature;
    return SignatureErc6492_exports.wrap({
      data: factoryData,
      signature,
      to: factory
    });
  })();
  const args = verifierAddress ? {
    to: verifierAddress,
    data: encodeFunctionData({
      abi: erc6492SignatureValidatorAbi,
      functionName: "isValidSig",
      args: [address, hash2, wrappedSignature]
    }),
    ...rest
  } : {
    data: encodeDeployData({
      abi: erc6492SignatureValidatorAbi,
      args: [address, hash2, wrappedSignature],
      bytecode: erc6492SignatureValidatorByteCode
    }),
    ...rest
  };
  const { data } = await getAction(client, call, "call")(args).catch((error) => {
    if (error instanceof CallExecutionError)
      throw new VerificationError();
    throw error;
  });
  if (hexToBool(data ?? "0x0"))
    return true;
  throw new VerificationError();
}
async function verifyErc1271(client, parameters) {
  const { address, blockNumber, blockTag, hash: hash2, signature } = parameters;
  const result = await getAction(client, readContract, "readContract")({
    address,
    abi: erc1271Abi,
    args: [hash2, signature],
    blockNumber,
    blockTag,
    functionName: "isValidSignature"
  }).catch((error) => {
    if (error instanceof ContractFunctionExecutionError)
      throw new VerificationError();
    throw error;
  });
  if (result.startsWith("0x1626ba7e"))
    return true;
  throw new VerificationError();
}
var VerificationError = class extends Error {
};

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/verifyMessage.js
async function verifyMessage(client, { address, message, factory, factoryData, signature, ...callRequest }) {
  const hash2 = hashMessage(message);
  return getAction(client, verifyHash, "verifyHash")({
    address,
    factory,
    factoryData,
    hash: hash2,
    signature,
    ...callRequest
  });
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/verifyTypedData.js
async function verifyTypedData(client, parameters) {
  const { address, factory, factoryData, signature, message, primaryType, types, domain, ...callRequest } = parameters;
  const hash2 = hashTypedData({ message, primaryType, types, domain });
  return getAction(client, verifyHash, "verifyHash")({
    address,
    factory,
    factoryData,
    hash: hash2,
    signature,
    ...callRequest
  });
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/watchBlockNumber.js
function watchBlockNumber(client, { emitOnBegin = false, emitMissed = false, onBlockNumber, onError, poll: poll_, pollingInterval = client.pollingInterval }) {
  const enablePolling = (() => {
    if (typeof poll_ !== "undefined")
      return poll_;
    if (client.transport.type === "webSocket" || client.transport.type === "ipc")
      return false;
    if (client.transport.type === "fallback" && (client.transport.transports[0].config.type === "webSocket" || client.transport.transports[0].config.type === "ipc"))
      return false;
    return true;
  })();
  let prevBlockNumber;
  const pollBlockNumber = () => {
    const observerId = stringify([
      "watchBlockNumber",
      client.uid,
      emitOnBegin,
      emitMissed,
      pollingInterval
    ]);
    return observe(observerId, { onBlockNumber, onError }, (emit) => poll(async () => {
      try {
        const blockNumber = await getAction(client, getBlockNumber, "getBlockNumber")({ cacheTime: 0 });
        if (prevBlockNumber !== void 0) {
          if (blockNumber === prevBlockNumber)
            return;
          if (blockNumber - prevBlockNumber > 1 && emitMissed) {
            for (let i2 = prevBlockNumber + 1n; i2 < blockNumber; i2++) {
              emit.onBlockNumber(i2, prevBlockNumber);
              prevBlockNumber = i2;
            }
          }
        }
        if (prevBlockNumber === void 0 || blockNumber > prevBlockNumber) {
          emit.onBlockNumber(blockNumber, prevBlockNumber);
          prevBlockNumber = blockNumber;
        }
      } catch (err) {
        emit.onError?.(err);
      }
    }, {
      emitOnBegin,
      interval: pollingInterval
    }));
  };
  const subscribeBlockNumber = () => {
    const observerId = stringify([
      "watchBlockNumber",
      client.uid,
      emitOnBegin,
      emitMissed
    ]);
    return observe(observerId, { onBlockNumber, onError }, (emit) => {
      let active = true;
      let unsubscribe = () => active = false;
      (async () => {
        try {
          const transport = (() => {
            if (client.transport.type === "fallback") {
              const transport2 = client.transport.transports.find((transport3) => transport3.config.type === "webSocket" || transport3.config.type === "ipc");
              if (!transport2)
                return client.transport;
              return transport2.value;
            }
            return client.transport;
          })();
          const { unsubscribe: unsubscribe_ } = await transport.subscribe({
            params: ["newHeads"],
            onData(data) {
              if (!active)
                return;
              const blockNumber = hexToBigInt(data.result?.number);
              emit.onBlockNumber(blockNumber, prevBlockNumber);
              prevBlockNumber = blockNumber;
            },
            onError(error) {
              emit.onError?.(error);
            }
          });
          unsubscribe = unsubscribe_;
          if (!active)
            unsubscribe();
        } catch (err) {
          onError?.(err);
        }
      })();
      return () => unsubscribe();
    });
  };
  return enablePolling ? pollBlockNumber() : subscribeBlockNumber();
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/waitForTransactionReceipt.js
async function waitForTransactionReceipt(client, parameters) {
  const {
    checkReplacement = true,
    confirmations = 1,
    hash: hash2,
    onReplaced,
    retryCount = 6,
    retryDelay = ({ count }) => ~~(1 << count) * 200,
    // exponential backoff
    timeout = 18e4
  } = parameters;
  const observerId = stringify(["waitForTransactionReceipt", client.uid, hash2]);
  const pollingInterval = (() => {
    if (parameters.pollingInterval)
      return parameters.pollingInterval;
    if (client.chain?.experimental_preconfirmationTime)
      return client.chain.experimental_preconfirmationTime;
    return client.pollingInterval;
  })();
  let transaction;
  let replacedTransaction;
  let receipt;
  let retrying = false;
  let _unobserve;
  let _unwatch;
  const { promise, resolve, reject } = withResolvers();
  const timer = timeout ? setTimeout(() => {
    _unwatch?.();
    _unobserve?.();
    reject(new WaitForTransactionReceiptTimeoutError({ hash: hash2 }));
  }, timeout) : void 0;
  _unobserve = observe(observerId, { onReplaced, resolve, reject }, async (emit) => {
    receipt = await getAction(client, getTransactionReceipt, "getTransactionReceipt")({ hash: hash2 }).catch(() => void 0);
    if (receipt && confirmations <= 1) {
      clearTimeout(timer);
      emit.resolve(receipt);
      _unobserve?.();
      return;
    }
    _unwatch = getAction(client, watchBlockNumber, "watchBlockNumber")({
      emitMissed: true,
      emitOnBegin: true,
      poll: true,
      pollingInterval,
      async onBlockNumber(blockNumber_) {
        const done = (fn) => {
          clearTimeout(timer);
          _unwatch?.();
          fn();
          _unobserve?.();
        };
        let blockNumber = blockNumber_;
        if (retrying)
          return;
        try {
          if (receipt) {
            if (confirmations > 1 && (!receipt.blockNumber || blockNumber - receipt.blockNumber + 1n < confirmations))
              return;
            done(() => emit.resolve(receipt));
            return;
          }
          if (checkReplacement && !transaction) {
            retrying = true;
            await withRetry(async () => {
              transaction = await getAction(client, getTransaction, "getTransaction")({ hash: hash2 });
              if (transaction.blockNumber)
                blockNumber = transaction.blockNumber;
            }, {
              delay: retryDelay,
              retryCount
            });
            retrying = false;
          }
          receipt = await getAction(client, getTransactionReceipt, "getTransactionReceipt")({ hash: hash2 });
          if (confirmations > 1 && (!receipt.blockNumber || blockNumber - receipt.blockNumber + 1n < confirmations))
            return;
          done(() => emit.resolve(receipt));
        } catch (err) {
          if (err instanceof TransactionNotFoundError || err instanceof TransactionReceiptNotFoundError) {
            if (!transaction) {
              retrying = false;
              return;
            }
            try {
              replacedTransaction = transaction;
              retrying = true;
              const block = await withRetry(() => getAction(client, getBlock, "getBlock")({
                blockNumber,
                includeTransactions: true
              }), {
                delay: retryDelay,
                retryCount,
                shouldRetry: ({ error }) => error instanceof BlockNotFoundError
              });
              retrying = false;
              const replacementTransaction = block.transactions.find(({ from: from14, nonce }) => from14 === replacedTransaction.from && nonce === replacedTransaction.nonce);
              if (!replacementTransaction)
                return;
              receipt = await getAction(client, getTransactionReceipt, "getTransactionReceipt")({
                hash: replacementTransaction.hash
              });
              if (confirmations > 1 && (!receipt.blockNumber || blockNumber - receipt.blockNumber + 1n < confirmations))
                return;
              let reason = "replaced";
              if (replacementTransaction.to === replacedTransaction.to && replacementTransaction.value === replacedTransaction.value && replacementTransaction.input === replacedTransaction.input) {
                reason = "repriced";
              } else if (replacementTransaction.from === replacementTransaction.to && replacementTransaction.value === 0n) {
                reason = "cancelled";
              }
              done(() => {
                emit.onReplaced?.({
                  reason,
                  replacedTransaction,
                  transaction: replacementTransaction,
                  transactionReceipt: receipt
                });
                emit.resolve(receipt);
              });
            } catch (err_) {
              done(() => emit.reject(err_));
            }
          } else {
            done(() => emit.reject(err));
          }
        }
      }
    });
  });
  return promise;
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/watchBlocks.js
function watchBlocks(client, { blockTag = client.experimental_blockTag ?? "latest", emitMissed = false, emitOnBegin = false, onBlock, onError, includeTransactions: includeTransactions_, poll: poll_, pollingInterval = client.pollingInterval }) {
  const enablePolling = (() => {
    if (typeof poll_ !== "undefined")
      return poll_;
    if (client.transport.type === "webSocket" || client.transport.type === "ipc")
      return false;
    if (client.transport.type === "fallback" && (client.transport.transports[0].config.type === "webSocket" || client.transport.transports[0].config.type === "ipc"))
      return false;
    return true;
  })();
  const includeTransactions = includeTransactions_ ?? false;
  let prevBlock;
  const pollBlocks = () => {
    const observerId = stringify([
      "watchBlocks",
      client.uid,
      blockTag,
      emitMissed,
      emitOnBegin,
      includeTransactions,
      pollingInterval
    ]);
    return observe(observerId, { onBlock, onError }, (emit) => poll(async () => {
      try {
        const block = await getAction(client, getBlock, "getBlock")({
          blockTag,
          includeTransactions
        });
        if (block.number !== null && prevBlock?.number != null) {
          if (block.number === prevBlock.number)
            return;
          if (block.number - prevBlock.number > 1 && emitMissed) {
            for (let i2 = prevBlock?.number + 1n; i2 < block.number; i2++) {
              const block2 = await getAction(client, getBlock, "getBlock")({
                blockNumber: i2,
                includeTransactions
              });
              emit.onBlock(block2, prevBlock);
              prevBlock = block2;
            }
          }
        }
        if (
          // If no previous block exists, emit.
          prevBlock?.number == null || // If the block tag is "pending" with no block number, emit.
          blockTag === "pending" && block?.number == null || // If the next block number is greater than the previous block number, emit.
          // We don't want to emit blocks in the past.
          block.number !== null && block.number > prevBlock.number
        ) {
          emit.onBlock(block, prevBlock);
          prevBlock = block;
        }
      } catch (err) {
        emit.onError?.(err);
      }
    }, {
      emitOnBegin,
      interval: pollingInterval
    }));
  };
  const subscribeBlocks = () => {
    let active = true;
    let emitFetched = true;
    let unsubscribe = () => active = false;
    (async () => {
      try {
        if (emitOnBegin) {
          getAction(client, getBlock, "getBlock")({
            blockTag,
            includeTransactions
          }).then((block) => {
            if (!active)
              return;
            if (!emitFetched)
              return;
            onBlock(block, void 0);
            emitFetched = false;
          }).catch(onError);
        }
        const transport = (() => {
          if (client.transport.type === "fallback") {
            const transport2 = client.transport.transports.find((transport3) => transport3.config.type === "webSocket" || transport3.config.type === "ipc");
            if (!transport2)
              return client.transport;
            return transport2.value;
          }
          return client.transport;
        })();
        const { unsubscribe: unsubscribe_ } = await transport.subscribe({
          params: ["newHeads"],
          async onData(data) {
            if (!active)
              return;
            const block = await getAction(client, getBlock, "getBlock")({
              blockNumber: data.result?.number,
              includeTransactions
            }).catch(() => {
            });
            if (!active)
              return;
            onBlock(block, prevBlock);
            emitFetched = false;
            prevBlock = block;
          },
          onError(error) {
            onError?.(error);
          }
        });
        unsubscribe = unsubscribe_;
        if (!active)
          unsubscribe();
      } catch (err) {
        onError?.(err);
      }
    })();
    return () => unsubscribe();
  };
  return enablePolling ? pollBlocks() : subscribeBlocks();
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/watchEvent.js
function watchEvent(client, { address, args, batch = true, event, events, fromBlock, onError, onLogs, poll: poll_, pollingInterval = client.pollingInterval, strict: strict_ }) {
  const enablePolling = (() => {
    if (typeof poll_ !== "undefined")
      return poll_;
    if (typeof fromBlock === "bigint")
      return true;
    if (client.transport.type === "webSocket" || client.transport.type === "ipc")
      return false;
    if (client.transport.type === "fallback" && (client.transport.transports[0].config.type === "webSocket" || client.transport.transports[0].config.type === "ipc"))
      return false;
    return true;
  })();
  const strict = strict_ ?? false;
  const pollEvent = () => {
    const observerId = stringify([
      "watchEvent",
      address,
      args,
      batch,
      client.uid,
      event,
      pollingInterval,
      fromBlock
    ]);
    return observe(observerId, { onLogs, onError }, (emit) => {
      let previousBlockNumber;
      if (fromBlock !== void 0)
        previousBlockNumber = fromBlock - 1n;
      let filter;
      let initialized = false;
      const unwatch = poll(async () => {
        if (!initialized) {
          try {
            filter = await getAction(client, createEventFilter, "createEventFilter")({
              address,
              args,
              event,
              events,
              strict,
              fromBlock
            });
          } catch {
          }
          initialized = true;
          return;
        }
        try {
          let logs;
          if (filter) {
            logs = await getAction(client, getFilterChanges, "getFilterChanges")({ filter });
          } else {
            const blockNumber = await getAction(client, getBlockNumber, "getBlockNumber")({});
            if (previousBlockNumber && previousBlockNumber !== blockNumber) {
              logs = await getAction(client, getLogs, "getLogs")({
                address,
                args,
                event,
                events,
                fromBlock: previousBlockNumber + 1n,
                toBlock: blockNumber
              });
            } else {
              logs = [];
            }
            previousBlockNumber = blockNumber;
          }
          if (logs.length === 0)
            return;
          if (batch)
            emit.onLogs(logs);
          else
            for (const log2 of logs)
              emit.onLogs([log2]);
        } catch (err) {
          if (filter && err instanceof InvalidInputRpcError)
            initialized = false;
          emit.onError?.(err);
        }
      }, {
        emitOnBegin: true,
        interval: pollingInterval
      });
      return async () => {
        if (filter)
          await getAction(client, uninstallFilter, "uninstallFilter")({ filter });
        unwatch();
      };
    });
  };
  const subscribeEvent = () => {
    let active = true;
    let unsubscribe = () => active = false;
    (async () => {
      try {
        const transport = (() => {
          if (client.transport.type === "fallback") {
            const transport2 = client.transport.transports.find((transport3) => transport3.config.type === "webSocket" || transport3.config.type === "ipc");
            if (!transport2)
              return client.transport;
            return transport2.value;
          }
          return client.transport;
        })();
        const events_ = events ?? (event ? [event] : void 0);
        let topics = [];
        if (events_) {
          const encoded = events_.flatMap((event2) => encodeEventTopics({
            abi: [event2],
            eventName: event2.name,
            args
          }));
          topics = [encoded];
          if (event)
            topics = topics[0];
        }
        const { unsubscribe: unsubscribe_ } = await transport.subscribe({
          params: ["logs", { address, topics }],
          onData(data) {
            if (!active)
              return;
            const log2 = data.result;
            try {
              const { eventName, args: args2 } = decodeEventLog({
                abi: events_ ?? [],
                data: log2.data,
                topics: log2.topics,
                strict
              });
              const formatted = formatLog(log2, { args: args2, eventName });
              onLogs([formatted]);
            } catch (err) {
              let eventName;
              let isUnnamed;
              if (err instanceof DecodeLogDataMismatch || err instanceof DecodeLogTopicsMismatch) {
                if (strict_)
                  return;
                eventName = err.abiItem.name;
                isUnnamed = err.abiItem.inputs?.some((x2) => !("name" in x2 && x2.name));
              }
              const formatted = formatLog(log2, {
                args: isUnnamed ? [] : {},
                eventName
              });
              onLogs([formatted]);
            }
          },
          onError(error) {
            onError?.(error);
          }
        });
        unsubscribe = unsubscribe_;
        if (!active)
          unsubscribe();
      } catch (err) {
        onError?.(err);
      }
    })();
    return () => unsubscribe();
  };
  return enablePolling ? pollEvent() : subscribeEvent();
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/public/watchPendingTransactions.js
function watchPendingTransactions(client, { batch = true, onError, onTransactions, poll: poll_, pollingInterval = client.pollingInterval }) {
  const enablePolling = typeof poll_ !== "undefined" ? poll_ : client.transport.type !== "webSocket" && client.transport.type !== "ipc";
  const pollPendingTransactions = () => {
    const observerId = stringify([
      "watchPendingTransactions",
      client.uid,
      batch,
      pollingInterval
    ]);
    return observe(observerId, { onTransactions, onError }, (emit) => {
      let filter;
      const unwatch = poll(async () => {
        try {
          if (!filter) {
            try {
              filter = await getAction(client, createPendingTransactionFilter, "createPendingTransactionFilter")({});
              return;
            } catch (err) {
              unwatch();
              throw err;
            }
          }
          const hashes = await getAction(client, getFilterChanges, "getFilterChanges")({ filter });
          if (hashes.length === 0)
            return;
          if (batch)
            emit.onTransactions(hashes);
          else
            for (const hash2 of hashes)
              emit.onTransactions([hash2]);
        } catch (err) {
          emit.onError?.(err);
        }
      }, {
        emitOnBegin: true,
        interval: pollingInterval
      });
      return async () => {
        if (filter)
          await getAction(client, uninstallFilter, "uninstallFilter")({ filter });
        unwatch();
      };
    });
  };
  const subscribePendingTransactions = () => {
    let active = true;
    let unsubscribe = () => active = false;
    (async () => {
      try {
        const { unsubscribe: unsubscribe_ } = await client.transport.subscribe({
          params: ["newPendingTransactions"],
          onData(data) {
            if (!active)
              return;
            const transaction = data.result;
            onTransactions([transaction]);
          },
          onError(error) {
            onError?.(error);
          }
        });
        unsubscribe = unsubscribe_;
        if (!active)
          unsubscribe();
      } catch (err) {
        onError?.(err);
      }
    })();
    return () => unsubscribe();
  };
  return enablePolling ? pollPendingTransactions() : subscribePendingTransactions();
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/siwe/parseSiweMessage.js
function parseSiweMessage(message) {
  const { scheme, statement, ...prefix } = message.match(prefixRegex)?.groups ?? {};
  const { chainId, expirationTime, issuedAt, notBefore, requestId, ...suffix } = message.match(suffixRegex)?.groups ?? {};
  const resources = message.split("Resources:")[1]?.split("\n- ").slice(1);
  return {
    ...prefix,
    ...suffix,
    ...chainId ? { chainId: Number(chainId) } : {},
    ...expirationTime ? { expirationTime: new Date(expirationTime) } : {},
    ...issuedAt ? { issuedAt: new Date(issuedAt) } : {},
    ...notBefore ? { notBefore: new Date(notBefore) } : {},
    ...requestId ? { requestId } : {},
    ...resources ? { resources } : {},
    ...scheme ? { scheme } : {},
    ...statement ? { statement } : {}
  };
}
var prefixRegex = /^(?:(?<scheme>[a-zA-Z][a-zA-Z0-9+-.]*):\/\/)?(?<domain>[a-zA-Z0-9+-.]*(?::[0-9]{1,5})?) (?:wants you to sign in with your Ethereum account:\n)(?<address>0x[a-fA-F0-9]{40})\n\n(?:(?<statement>.*)\n\n)?/;
var suffixRegex = /(?:URI: (?<uri>.+))\n(?:Version: (?<version>.+))\n(?:Chain ID: (?<chainId>\d+))\n(?:Nonce: (?<nonce>[a-zA-Z0-9]+))\n(?:Issued At: (?<issuedAt>.+))(?:\nExpiration Time: (?<expirationTime>.+))?(?:\nNot Before: (?<notBefore>.+))?(?:\nRequest ID: (?<requestId>.+))?/;

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/utils/siwe/validateSiweMessage.js
function validateSiweMessage(parameters) {
  const { address, domain, message, nonce, scheme, time = /* @__PURE__ */ new Date() } = parameters;
  if (domain && message.domain !== domain)
    return false;
  if (nonce && message.nonce !== nonce)
    return false;
  if (scheme && message.scheme !== scheme)
    return false;
  if (message.expirationTime && time >= message.expirationTime)
    return false;
  if (message.notBefore && time < message.notBefore)
    return false;
  try {
    if (!message.address)
      return false;
    if (!isAddress(message.address, { strict: false }))
      return false;
    if (address && !isAddressEqual(message.address, address))
      return false;
  } catch {
    return false;
  }
  return true;
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/siwe/verifySiweMessage.js
async function verifySiweMessage(client, parameters) {
  const { address, domain, message, nonce, scheme, signature, time = /* @__PURE__ */ new Date(), ...callRequest } = parameters;
  const parsed = parseSiweMessage(message);
  if (!parsed.address)
    return false;
  const isValid = validateSiweMessage({
    address,
    domain,
    message: parsed,
    nonce,
    scheme,
    time
  });
  if (!isValid)
    return false;
  const hash2 = hashMessage(message);
  return verifyHash(client, {
    address: parsed.address,
    hash: hash2,
    signature,
    ...callRequest
  });
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/actions/wallet/sendRawTransactionSync.js
async function sendRawTransactionSync(client, { serializedTransaction, throwOnReceiptRevert, timeout }) {
  const receipt = await client.request({
    method: "eth_sendRawTransactionSync",
    params: timeout ? [serializedTransaction, timeout] : [serializedTransaction]
  }, { retryCount: 0 });
  const format = client.chain?.formatters?.transactionReceipt?.format || formatTransactionReceipt;
  const formatted = format(receipt);
  if (formatted.status === "reverted" && throwOnReceiptRevert)
    throw new TransactionReceiptRevertedError({ receipt: formatted });
  return formatted;
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/clients/decorators/public.js
function publicActions(client) {
  return {
    call: (args) => call(client, args),
    createAccessList: (args) => createAccessList(client, args),
    createBlockFilter: () => createBlockFilter(client),
    createContractEventFilter: (args) => createContractEventFilter(client, args),
    createEventFilter: (args) => createEventFilter(client, args),
    createPendingTransactionFilter: () => createPendingTransactionFilter(client),
    estimateContractGas: (args) => estimateContractGas(client, args),
    estimateGas: (args) => estimateGas(client, args),
    getBalance: (args) => getBalance(client, args),
    getBlobBaseFee: () => getBlobBaseFee(client),
    getBlock: (args) => getBlock(client, args),
    getBlockNumber: (args) => getBlockNumber(client, args),
    getBlockReceipts: (args) => getBlockReceipts(client, args),
    getBlockTransactionCount: (args) => getBlockTransactionCount(client, args),
    getBytecode: (args) => getCode(client, args),
    getChainId: () => getChainId(client),
    getCode: (args) => getCode(client, args),
    getContractEvents: (args) => getContractEvents(client, args),
    getDelegation: (args) => getDelegation(client, args),
    getEip712Domain: (args) => getEip712Domain(client, args),
    getEnsAddress: (args) => getEnsAddress(client, args),
    getEnsAvatar: (args) => getEnsAvatar(client, args),
    getEnsName: (args) => getEnsName(client, args),
    getEnsResolver: (args) => getEnsResolver(client, args),
    getEnsText: (args) => getEnsText(client, args),
    getFeeHistory: (args) => getFeeHistory(client, args),
    estimateFeesPerGas: (args) => estimateFeesPerGas(client, args),
    getFilterChanges: (args) => getFilterChanges(client, args),
    getFilterLogs: (args) => getFilterLogs(client, args),
    getGasPrice: () => getGasPrice(client),
    getLogs: (args) => getLogs(client, args),
    getProof: (args) => getProof(client, args),
    estimateMaxPriorityFeePerGas: (args) => estimateMaxPriorityFeePerGas(client, args),
    fillTransaction: (args) => fillTransaction(client, args),
    getStorageAt: (args) => getStorageAt(client, args),
    getTransaction: (args) => getTransaction(client, args),
    getTransactionConfirmations: (args) => getTransactionConfirmations(client, args),
    getTransactionCount: (args) => getTransactionCount(client, args),
    getTransactionReceipt: (args) => getTransactionReceipt(client, args),
    multicall: (args) => multicall(client, args),
    prepareTransactionRequest: (args) => prepareTransactionRequest(client, args),
    readContract: (args) => readContract(client, args),
    sendRawTransaction: (args) => sendRawTransaction(client, args),
    sendRawTransactionSync: (args) => sendRawTransactionSync(client, args),
    simulate: (args) => simulateBlocks(client, args),
    simulateBlocks: (args) => simulateBlocks(client, args),
    simulateCalls: (args) => simulateCalls(client, args),
    simulateContract: (args) => simulateContract(client, args),
    verifyHash: (args) => verifyHash(client, args),
    verifyMessage: (args) => verifyMessage(client, args),
    verifySiweMessage: (args) => verifySiweMessage(client, args),
    verifyTypedData: (args) => verifyTypedData(client, args),
    uninstallFilter: (args) => uninstallFilter(client, args),
    waitForTransactionReceipt: (args) => waitForTransactionReceipt(client, args),
    watchBlocks: (args) => watchBlocks(client, args),
    watchBlockNumber: (args) => watchBlockNumber(client, args),
    watchContractEvent: (args) => watchContractEvent(client, args),
    watchEvent: (args) => watchEvent(client, args),
    watchPendingTransactions: (args) => watchPendingTransactions(client, args)
  };
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/clients/createPublicClient.js
function createPublicClient(parameters) {
  const { key = "public", name = "Public Client" } = parameters;
  const client = createClient({
    ...parameters,
    key,
    name,
    type: "publicClient"
  });
  return client.extend(publicActions);
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/clients/transports/createTransport.js
function createTransport({ key, methods, name, request, retryCount = 3, retryDelay = 150, timeout, type }, value) {
  const uid2 = uid();
  return {
    config: {
      key,
      methods,
      name,
      request,
      retryCount,
      retryDelay,
      timeout,
      type
    },
    request: buildRequest(request, { methods, retryCount, retryDelay, uid: uid2 }),
    value
  };
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/clients/transports/custom.js
function custom(provider, config = {}) {
  const { key = "custom", methods, name = "Custom Provider", retryDelay } = config;
  return ({ retryCount: defaultRetryCount }) => createTransport({
    key,
    methods,
    name,
    request: provider.request.bind(provider),
    retryCount: config.retryCount ?? defaultRetryCount,
    retryDelay,
    type: "custom"
  });
}

// node_modules/@scure/base/lib/esm/index.js
function isBytes(a2) {
  return a2 instanceof Uint8Array || ArrayBuffer.isView(a2) && a2.constructor.name === "Uint8Array";
}
function isArrayOf(isString, arr) {
  if (!Array.isArray(arr))
    return false;
  if (arr.length === 0)
    return true;
  if (isString) {
    return arr.every((item) => typeof item === "string");
  } else {
    return arr.every((item) => Number.isSafeInteger(item));
  }
}
function afn(input) {
  if (typeof input !== "function")
    throw new Error("function expected");
  return true;
}
function astr(label, input) {
  if (typeof input !== "string")
    throw new Error(`${label}: string expected`);
  return true;
}
function anumber2(n) {
  if (!Number.isSafeInteger(n))
    throw new Error(`invalid integer: ${n}`);
}
function aArr(input) {
  if (!Array.isArray(input))
    throw new Error("array expected");
}
function astrArr(label, input) {
  if (!isArrayOf(true, input))
    throw new Error(`${label}: array of strings expected`);
}
function anumArr(label, input) {
  if (!isArrayOf(false, input))
    throw new Error(`${label}: array of numbers expected`);
}
// @__NO_SIDE_EFFECTS__
function chain(...args) {
  const id = (a2) => a2;
  const wrap3 = (a2, b2) => (c3) => a2(b2(c3));
  const encode4 = args.map((x2) => x2.encode).reduceRight(wrap3, id);
  const decode2 = args.map((x2) => x2.decode).reduce(wrap3, id);
  return { encode: encode4, decode: decode2 };
}
// @__NO_SIDE_EFFECTS__
function alphabet(letters) {
  const lettersA = typeof letters === "string" ? letters.split("") : letters;
  const len = lettersA.length;
  astrArr("alphabet", lettersA);
  const indexes = new Map(lettersA.map((l2, i2) => [l2, i2]));
  return {
    encode: (digits) => {
      aArr(digits);
      return digits.map((i2) => {
        if (!Number.isSafeInteger(i2) || i2 < 0 || i2 >= len)
          throw new Error(`alphabet.encode: digit index outside alphabet "${i2}". Allowed: ${letters}`);
        return lettersA[i2];
      });
    },
    decode: (input) => {
      aArr(input);
      return input.map((letter) => {
        astr("alphabet.decode", letter);
        const i2 = indexes.get(letter);
        if (i2 === void 0)
          throw new Error(`Unknown letter: "${letter}". Allowed: ${letters}`);
        return i2;
      });
    }
  };
}
// @__NO_SIDE_EFFECTS__
function join(separator = "") {
  astr("join", separator);
  return {
    encode: (from14) => {
      astrArr("join.decode", from14);
      return from14.join(separator);
    },
    decode: (to) => {
      astr("join.decode", to);
      return to.split(separator);
    }
  };
}
function convertRadix(data, from14, to) {
  if (from14 < 2)
    throw new Error(`convertRadix: invalid from=${from14}, base cannot be less than 2`);
  if (to < 2)
    throw new Error(`convertRadix: invalid to=${to}, base cannot be less than 2`);
  aArr(data);
  if (!data.length)
    return [];
  let pos = 0;
  const res = [];
  const digits = Array.from(data, (d3) => {
    anumber2(d3);
    if (d3 < 0 || d3 >= from14)
      throw new Error(`invalid integer: ${d3}`);
    return d3;
  });
  const dlen = digits.length;
  while (true) {
    let carry = 0;
    let done = true;
    for (let i2 = pos; i2 < dlen; i2++) {
      const digit = digits[i2];
      const fromCarry = from14 * carry;
      const digitBase = fromCarry + digit;
      if (!Number.isSafeInteger(digitBase) || fromCarry / from14 !== carry || digitBase - digit !== fromCarry) {
        throw new Error("convertRadix: carry overflow");
      }
      const div = digitBase / to;
      carry = digitBase % to;
      const rounded = Math.floor(div);
      digits[i2] = rounded;
      if (!Number.isSafeInteger(rounded) || rounded * to + carry !== digitBase)
        throw new Error("convertRadix: carry overflow");
      if (!done)
        continue;
      else if (!rounded)
        pos = i2;
      else
        done = false;
    }
    res.push(carry);
    if (done)
      break;
  }
  for (let i2 = 0; i2 < data.length - 1 && data[i2] === 0; i2++)
    res.push(0);
  return res.reverse();
}
// @__NO_SIDE_EFFECTS__
function radix(num) {
  anumber2(num);
  const _256 = 2 ** 8;
  return {
    encode: (bytes) => {
      if (!isBytes(bytes))
        throw new Error("radix.encode input should be Uint8Array");
      return convertRadix(Array.from(bytes), _256, num);
    },
    decode: (digits) => {
      anumArr("radix.decode", digits);
      return Uint8Array.from(convertRadix(digits, num, _256));
    }
  };
}
function checksum3(len, fn) {
  anumber2(len);
  afn(fn);
  return {
    encode(data) {
      if (!isBytes(data))
        throw new Error("checksum.encode: input should be Uint8Array");
      const sum = fn(data).slice(0, len);
      const res = new Uint8Array(data.length + len);
      res.set(data);
      res.set(sum, data.length);
      return res;
    },
    decode(data) {
      if (!isBytes(data))
        throw new Error("checksum.decode: input should be Uint8Array");
      const payload = data.slice(0, -len);
      const oldChecksum = data.slice(-len);
      const newChecksum = fn(payload).slice(0, len);
      for (let i2 = 0; i2 < len; i2++)
        if (newChecksum[i2] !== oldChecksum[i2])
          throw new Error("Invalid checksum");
      return payload;
    }
  };
}
var genBase58 = /* @__NO_SIDE_EFFECTS__ */ (abc) => /* @__PURE__ */ chain(/* @__PURE__ */ radix(58), /* @__PURE__ */ alphabet(abc), /* @__PURE__ */ join(""));
var base58 = /* @__PURE__ */ genBase58("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz");
var createBase58check = (sha2564) => /* @__PURE__ */ chain(checksum3(4, (data) => sha2564(sha2564(data))), base58);

// node_modules/@scure/bip32/lib/esm/index.js
var Point = secp256k1.ProjectivePoint;
var base58check = createBase58check(sha256);
function bytesToNumber(bytes) {
  abytes(bytes);
  const h3 = bytes.length === 0 ? "0" : bytesToHex2(bytes);
  return BigInt("0x" + h3);
}
function numberToBytes(num) {
  if (typeof num !== "bigint")
    throw new Error("bigint expected");
  return hexToBytes2(num.toString(16).padStart(64, "0"));
}
var MASTER_SECRET = utf8ToBytes("Bitcoin seed");
var BITCOIN_VERSIONS = { private: 76066276, public: 76067358 };
var HARDENED_OFFSET = 2147483648;
var hash160 = (data) => ripemd160(sha256(data));
var fromU32 = (data) => createView(data).getUint32(0, false);
var toU32 = (n) => {
  if (!Number.isSafeInteger(n) || n < 0 || n > 2 ** 32 - 1) {
    throw new Error("invalid number, should be from 0 to 2**32-1, got " + n);
  }
  const buf = new Uint8Array(4);
  createView(buf).setUint32(0, n, false);
  return buf;
};
var HDKey = class _HDKey {
  get fingerprint() {
    if (!this.pubHash) {
      throw new Error("No publicKey set!");
    }
    return fromU32(this.pubHash);
  }
  get identifier() {
    return this.pubHash;
  }
  get pubKeyHash() {
    return this.pubHash;
  }
  get privateKey() {
    return this.privKeyBytes || null;
  }
  get publicKey() {
    return this.pubKey || null;
  }
  get privateExtendedKey() {
    const priv = this.privateKey;
    if (!priv) {
      throw new Error("No private key");
    }
    return base58check.encode(this.serialize(this.versions.private, concatBytes(new Uint8Array([0]), priv)));
  }
  get publicExtendedKey() {
    if (!this.pubKey) {
      throw new Error("No public key");
    }
    return base58check.encode(this.serialize(this.versions.public, this.pubKey));
  }
  static fromMasterSeed(seed, versions = BITCOIN_VERSIONS) {
    abytes(seed);
    if (8 * seed.length < 128 || 8 * seed.length > 512) {
      throw new Error("HDKey: seed length must be between 128 and 512 bits; 256 bits is advised, got " + seed.length);
    }
    const I2 = hmac(sha512, MASTER_SECRET, seed);
    return new _HDKey({
      versions,
      chainCode: I2.slice(32),
      privateKey: I2.slice(0, 32)
    });
  }
  static fromExtendedKey(base58key, versions = BITCOIN_VERSIONS) {
    const keyBuffer = base58check.decode(base58key);
    const keyView = createView(keyBuffer);
    const version3 = keyView.getUint32(0, false);
    const opt = {
      versions,
      depth: keyBuffer[4],
      parentFingerprint: keyView.getUint32(5, false),
      index: keyView.getUint32(9, false),
      chainCode: keyBuffer.slice(13, 45)
    };
    const key = keyBuffer.slice(45);
    const isPriv = key[0] === 0;
    if (version3 !== versions[isPriv ? "private" : "public"]) {
      throw new Error("Version mismatch");
    }
    if (isPriv) {
      return new _HDKey({ ...opt, privateKey: key.slice(1) });
    } else {
      return new _HDKey({ ...opt, publicKey: key });
    }
  }
  static fromJSON(json) {
    return _HDKey.fromExtendedKey(json.xpriv);
  }
  constructor(opt) {
    this.depth = 0;
    this.index = 0;
    this.chainCode = null;
    this.parentFingerprint = 0;
    if (!opt || typeof opt !== "object") {
      throw new Error("HDKey.constructor must not be called directly");
    }
    this.versions = opt.versions || BITCOIN_VERSIONS;
    this.depth = opt.depth || 0;
    this.chainCode = opt.chainCode || null;
    this.index = opt.index || 0;
    this.parentFingerprint = opt.parentFingerprint || 0;
    if (!this.depth) {
      if (this.parentFingerprint || this.index) {
        throw new Error("HDKey: zero depth with non-zero index/parent fingerprint");
      }
    }
    if (opt.publicKey && opt.privateKey) {
      throw new Error("HDKey: publicKey and privateKey at same time.");
    }
    if (opt.privateKey) {
      if (!secp256k1.utils.isValidPrivateKey(opt.privateKey)) {
        throw new Error("Invalid private key");
      }
      this.privKey = typeof opt.privateKey === "bigint" ? opt.privateKey : bytesToNumber(opt.privateKey);
      this.privKeyBytes = numberToBytes(this.privKey);
      this.pubKey = secp256k1.getPublicKey(opt.privateKey, true);
    } else if (opt.publicKey) {
      this.pubKey = Point.fromHex(opt.publicKey).toRawBytes(true);
    } else {
      throw new Error("HDKey: no public or private key provided");
    }
    this.pubHash = hash160(this.pubKey);
  }
  derive(path) {
    if (!/^[mM]'?/.test(path)) {
      throw new Error('Path must start with "m" or "M"');
    }
    if (/^[mM]'?$/.test(path)) {
      return this;
    }
    const parts = path.replace(/^[mM]'?\//, "").split("/");
    let child = this;
    for (const c3 of parts) {
      const m2 = /^(\d+)('?)$/.exec(c3);
      const m1 = m2 && m2[1];
      if (!m2 || m2.length !== 3 || typeof m1 !== "string")
        throw new Error("invalid child index: " + c3);
      let idx = +m1;
      if (!Number.isSafeInteger(idx) || idx >= HARDENED_OFFSET) {
        throw new Error("Invalid index");
      }
      if (m2[2] === "'") {
        idx += HARDENED_OFFSET;
      }
      child = child.deriveChild(idx);
    }
    return child;
  }
  deriveChild(index2) {
    if (!this.pubKey || !this.chainCode) {
      throw new Error("No publicKey or chainCode set");
    }
    let data = toU32(index2);
    if (index2 >= HARDENED_OFFSET) {
      const priv = this.privateKey;
      if (!priv) {
        throw new Error("Could not derive hardened child key");
      }
      data = concatBytes(new Uint8Array([0]), priv, data);
    } else {
      data = concatBytes(this.pubKey, data);
    }
    const I2 = hmac(sha512, this.chainCode, data);
    const childTweak = bytesToNumber(I2.slice(0, 32));
    const chainCode = I2.slice(32);
    if (!secp256k1.utils.isValidPrivateKey(childTweak)) {
      throw new Error("Tweak bigger than curve order");
    }
    const opt = {
      versions: this.versions,
      chainCode,
      depth: this.depth + 1,
      parentFingerprint: this.fingerprint,
      index: index2
    };
    try {
      if (this.privateKey) {
        const added = mod(this.privKey + childTweak, secp256k1.CURVE.n);
        if (!secp256k1.utils.isValidPrivateKey(added)) {
          throw new Error("The tweak was out of range or the resulted private key is invalid");
        }
        opt.privateKey = added;
      } else {
        const added = Point.fromHex(this.pubKey).add(Point.fromPrivateKey(childTweak));
        if (added.equals(Point.ZERO)) {
          throw new Error("The tweak was equal to negative P, which made the result key invalid");
        }
        opt.publicKey = added.toRawBytes(true);
      }
      return new _HDKey(opt);
    } catch (err) {
      return this.deriveChild(index2 + 1);
    }
  }
  sign(hash2) {
    if (!this.privateKey) {
      throw new Error("No privateKey set!");
    }
    abytes(hash2, 32);
    return secp256k1.sign(hash2, this.privKey).toCompactRawBytes();
  }
  verify(hash2, signature) {
    abytes(hash2, 32);
    abytes(signature, 64);
    if (!this.publicKey) {
      throw new Error("No publicKey set!");
    }
    let sig;
    try {
      sig = secp256k1.Signature.fromCompact(signature);
    } catch (error) {
      return false;
    }
    return secp256k1.verify(sig, hash2, this.publicKey);
  }
  wipePrivateData() {
    this.privKey = void 0;
    if (this.privKeyBytes) {
      this.privKeyBytes.fill(0);
      this.privKeyBytes = void 0;
    }
    return this;
  }
  toJSON() {
    return {
      xpriv: this.privateExtendedKey,
      xpub: this.publicExtendedKey
    };
  }
  serialize(version3, key) {
    if (!this.chainCode) {
      throw new Error("No chainCode set");
    }
    abytes(key, 33);
    return concatBytes(toU32(version3), new Uint8Array([this.depth]), toU32(this.parentFingerprint), toU32(this.index), this.chainCode, key);
  }
};

// node_modules/@noble/hashes/esm/pbkdf2.js
function pbkdf2Init(hash2, _password, _salt, _opts) {
  ahash(hash2);
  const opts = checkOpts({ dkLen: 32, asyncTick: 10 }, _opts);
  const { c: c3, dkLen, asyncTick } = opts;
  anumber(c3);
  anumber(dkLen);
  anumber(asyncTick);
  if (c3 < 1)
    throw new Error("iterations (c) should be >= 1");
  const password = kdfInputToBytes(_password);
  const salt = kdfInputToBytes(_salt);
  const DK = new Uint8Array(dkLen);
  const PRF = hmac.create(hash2, password);
  const PRFSalt = PRF._cloneInto().update(salt);
  return { c: c3, dkLen, asyncTick, DK, PRF, PRFSalt };
}
function pbkdf2Output(PRF, PRFSalt, DK, prfW, u2) {
  PRF.destroy();
  PRFSalt.destroy();
  if (prfW)
    prfW.destroy();
  clean(u2);
  return DK;
}
function pbkdf2(hash2, password, salt, opts) {
  const { c: c3, dkLen, DK, PRF, PRFSalt } = pbkdf2Init(hash2, password, salt, opts);
  let prfW;
  const arr = new Uint8Array(4);
  const view = createView(arr);
  const u2 = new Uint8Array(PRF.outputLen);
  for (let ti = 1, pos = 0; pos < dkLen; ti++, pos += PRF.outputLen) {
    const Ti = DK.subarray(pos, pos + PRF.outputLen);
    view.setInt32(0, ti, false);
    (prfW = PRFSalt._cloneInto(prfW)).update(arr).digestInto(u2);
    Ti.set(u2.subarray(0, Ti.length));
    for (let ui = 1; ui < c3; ui++) {
      PRF._cloneInto(prfW).update(u2).digestInto(u2);
      for (let i2 = 0; i2 < Ti.length; i2++)
        Ti[i2] ^= u2[i2];
    }
  }
  return pbkdf2Output(PRF, PRFSalt, DK, prfW, u2);
}

// node_modules/@metamask/fox-sdk/node_modules/viem/node_modules/@scure/bip39/esm/index.js
function nfkd(str) {
  if (typeof str !== "string")
    throw new TypeError("invalid mnemonic type: " + typeof str);
  return str.normalize("NFKD");
}
function normalize(str) {
  const norm = nfkd(str);
  const words = norm.split(" ");
  if (![12, 15, 18, 21, 24].includes(words.length))
    throw new Error("Invalid mnemonic");
  return { nfkd: norm, words };
}
var psalt = (passphrase) => nfkd("mnemonic" + passphrase);
function mnemonicToSeedSync(mnemonic, passphrase = "") {
  return pbkdf2(sha512, normalize(mnemonic).nfkd, psalt(passphrase), { c: 2048, dkLen: 64 });
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/accounts/toAccount.js
function toAccount(source) {
  if (typeof source === "string") {
    if (!isAddress(source, { strict: false }))
      throw new InvalidAddressError({ address: source });
    return {
      address: source,
      type: "json-rpc"
    };
  }
  if (!isAddress(source.address, { strict: false }))
    throw new InvalidAddressError({ address: source.address });
  return {
    address: source.address,
    nonceManager: source.nonceManager,
    sign: source.sign,
    signAuthorization: source.signAuthorization,
    signMessage: source.signMessage,
    signTransaction: source.signTransaction,
    signTypedData: source.signTypedData,
    source: "custom",
    type: "local"
  };
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/accounts/utils/sign.js
var extraEntropy = false;
async function sign({ hash: hash2, privateKey, to = "object" }) {
  const { r, s: s2, recovery } = secp256k1.sign(hash2.slice(2), privateKey.slice(2), {
    lowS: true,
    extraEntropy: isHex(extraEntropy, { strict: false }) ? hexToBytes(extraEntropy) : extraEntropy
  });
  const signature = {
    r: numberToHex(r, { size: 32 }),
    s: numberToHex(s2, { size: 32 }),
    v: recovery ? 28n : 27n,
    yParity: recovery
  };
  return (() => {
    if (to === "bytes" || to === "hex")
      return serializeSignature({ ...signature, to });
    return signature;
  })();
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/accounts/utils/signAuthorization.js
async function signAuthorization(parameters) {
  const { chainId, nonce, privateKey, to = "object" } = parameters;
  const address = parameters.contractAddress ?? parameters.address;
  const signature = await sign({
    hash: hashAuthorization({ address, chainId, nonce }),
    privateKey,
    to
  });
  if (to === "object")
    return {
      address,
      chainId,
      nonce,
      ...signature
    };
  return signature;
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/accounts/utils/signMessage.js
async function signMessage({ message, privateKey }) {
  return await sign({ hash: hashMessage(message), privateKey, to: "hex" });
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/accounts/utils/signTransaction.js
async function signTransaction(parameters) {
  const { privateKey, transaction, serializer = serializeTransaction } = parameters;
  const signableTransaction = (() => {
    if (transaction.type === "eip4844")
      return {
        ...transaction,
        sidecars: false
      };
    return transaction;
  })();
  const signature = await sign({
    hash: keccak256(await serializer(signableTransaction)),
    privateKey
  });
  return await serializer(transaction, signature);
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/accounts/utils/signTypedData.js
async function signTypedData(parameters) {
  const { privateKey, ...typedData } = parameters;
  return await sign({
    hash: hashTypedData(typedData),
    privateKey,
    to: "hex"
  });
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/accounts/privateKeyToAccount.js
function privateKeyToAccount(privateKey, options = {}) {
  const { nonceManager } = options;
  const publicKey = toHex(secp256k1.getPublicKey(privateKey.slice(2), false));
  const address = publicKeyToAddress(publicKey);
  const account = toAccount({
    address,
    nonceManager,
    async sign({ hash: hash2 }) {
      return sign({ hash: hash2, privateKey, to: "hex" });
    },
    async signAuthorization(authorization) {
      return signAuthorization({ ...authorization, privateKey });
    },
    async signMessage({ message }) {
      return signMessage({ message, privateKey });
    },
    async signTransaction(transaction, { serializer } = {}) {
      return signTransaction({ privateKey, transaction, serializer });
    },
    async signTypedData(typedData) {
      return signTypedData({ ...typedData, privateKey });
    }
  });
  return {
    ...account,
    publicKey,
    source: "privateKey"
  };
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/accounts/hdKeyToAccount.js
function hdKeyToAccount(hdKey_, { accountIndex = 0, addressIndex = 0, changeIndex = 0, path, ...options } = {}) {
  const hdKey = hdKey_.derive(path || `m/44'/60'/${accountIndex}'/${changeIndex}/${addressIndex}`);
  const account = privateKeyToAccount(toHex(hdKey.privateKey), options);
  return {
    ...account,
    getHdKey: () => hdKey,
    source: "hd"
  };
}

// node_modules/@metamask/fox-sdk/node_modules/viem/_esm/accounts/mnemonicToAccount.js
function mnemonicToAccount(mnemonic, { passphrase, ...hdKeyOpts } = {}) {
  const seed = mnemonicToSeedSync(mnemonic, passphrase);
  return hdKeyToAccount(HDKey.fromMasterSeed(seed), hdKeyOpts);
}

// node_modules/uuid/dist/esm/stringify.js
var byteToHex = [];
for (let i2 = 0; i2 < 256; ++i2) {
  byteToHex.push((i2 + 256).toString(16).slice(1));
}
function unsafeStringify(arr, offset = 0) {
  return (byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]]).toLowerCase();
}

// node_modules/uuid/dist/esm/rng.js
import { randomFillSync } from "crypto";
var rnds8Pool = new Uint8Array(256);
var poolPtr = rnds8Pool.length;
function rng() {
  if (poolPtr > rnds8Pool.length - 16) {
    randomFillSync(rnds8Pool);
    poolPtr = 0;
  }
  return rnds8Pool.slice(poolPtr, poolPtr += 16);
}

// node_modules/uuid/dist/esm/native.js
import { randomUUID } from "crypto";
var native_default = { randomUUID };

// node_modules/uuid/dist/esm/v4.js
function v4(options, buf, offset) {
  if (native_default.randomUUID && !buf && !options) {
    return native_default.randomUUID();
  }
  options = options || {};
  const rnds = options.random ?? options.rng?.() ?? rng();
  if (rnds.length < 16) {
    throw new Error("Random bytes length must be >= 16");
  }
  rnds[6] = rnds[6] & 15 | 64;
  rnds[8] = rnds[8] & 63 | 128;
  if (buf) {
    offset = offset || 0;
    if (offset < 0 || offset + 16 > buf.length) {
      throw new RangeError(`UUID byte range ${offset}:${offset + 15} is out of buffer bounds`);
    }
    for (let i2 = 0; i2 < 16; ++i2) {
      buf[offset + i2] = rnds[i2];
    }
    return buf;
  }
  return unsafeStringify(rnds);
}
var v4_default = v4;

// node_modules/@metamask/fox-sdk/dist/wallets/evm/index.mjs
var import_ethereum_controllers = __toESM(require_lib7(), 1);
var import_base_controllers = __toESM(require_lib6(), 1);

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/index.js
var lib_exports = {};
__export(lib_exports, {
  AUTH_ACTIONS: () => AUTH_ACTIONS,
  AUTH_DASHBOARD_DEVELOPMENT_URL: () => AUTH_DASHBOARD_DEVELOPMENT_URL,
  AUTH_DASHBOARD_PRODUCTION_URL: () => AUTH_DASHBOARD_PRODUCTION_URL,
  AUTH_DASHBOARD_STAGING_URL: () => AUTH_DASHBOARD_STAGING_URL,
  AUTH_DASHBOARD_TESTING_URL: () => AUTH_DASHBOARD_TESTING_URL,
  AUTH_SERVICE_DEVELOPMENT_URL: () => AUTH_SERVICE_DEVELOPMENT_URL,
  AUTH_SERVICE_PRODUCTION_URL: () => AUTH_SERVICE_PRODUCTION_URL,
  AUTH_SERVICE_STAGING_URL: () => AUTH_SERVICE_STAGING_URL,
  AUTH_SERVICE_TESTING_URL: () => AUTH_SERVICE_TESTING_URL,
  Auth: () => Auth,
  AuthError: () => import_session_manager2.AuthError,
  BUILD_ENV: () => BUILD_ENV2,
  BasePostMessageStream: () => BasePostMessageStream,
  CookieStorage: () => import_session_manager2.CookieStorage,
  DEFAULT_SESSION_TIME: () => DEFAULT_SESSION_TIME,
  EthereumProviderError: () => EthereumProviderError,
  HttpClient: () => import_session_manager2.HttpClient,
  IFRAME_MODAL_ID: () => IFRAME_MODAL_ID,
  IGNORE_SUBSTREAM: () => IGNORE_SUBSTREAM,
  InitializationError: () => InitializationError,
  JRPCEngine: () => JRPCEngine,
  JRPCEngineV2: () => JRPCEngineV2,
  JRPCServer: () => JRPCServer,
  JRPC_METHODS: () => JRPC_METHODS,
  JSON_RPC_SERVER_ERROR_MESSAGE: () => JSON_RPC_SERVER_ERROR_MESSAGE,
  JsonRpcEngineError: () => JsonRpcEngineError,
  JsonRpcError: () => JsonRpcError,
  LANGUAGES: () => LANGUAGES,
  LANGUAGE_MAP: () => LANGUAGE_MAP,
  LocalStorageAdapter: () => import_session_manager2.LocalStorageAdapter,
  LoginError: () => LoginError,
  MFA_FACTOR: () => MFA_FACTOR,
  MFA_LEVELS: () => MFA_LEVELS,
  MemoryStorage: () => import_session_manager2.MemoryStorage,
  MiddlewareContext: () => MiddlewareContext,
  ObjectMultiplex: () => ObjectMultiplex,
  POPUP_TIMEOUT: () => POPUP_TIMEOUT,
  PostMessageStream: () => PostMessageStream,
  SDK_MODE: () => SDK_MODE,
  SUPPORTED_KEY_CURVES: () => SUPPORTED_KEY_CURVES,
  SafeEventEmitter: () => SafeEventEmitter,
  SerializableError: () => SerializableError,
  SessionStorageAdapter: () => import_session_manager2.SessionStorageAdapter,
  Substream: () => Substream,
  THEME_MODES: () => THEME_MODES,
  WEB3AUTH_LEGACY_NETWORK: () => WEB3AUTH_LEGACY_NETWORK,
  WEB3AUTH_NETWORK: () => WEB3AUTH_NETWORK,
  WEB3AUTH_SAPPHIRE_NETWORK: () => WEB3AUTH_SAPPHIRE_NETWORK,
  applyWhiteLabelTheme: () => applyWhiteLabelTheme,
  asLegacyMiddleware: () => asLegacyMiddleware,
  base64toJSON: () => base64toJSON,
  cloneDeep: () => cloneDeep,
  createAsyncMiddleware: () => createAsyncMiddleware,
  createClientStreamMiddlewareV2: () => createClientStreamMiddlewareV2,
  createEngineStream: () => createEngineStream,
  createEngineStreamV2: () => createEngineStreamV2,
  createErrorMiddleware: () => createErrorMiddleware,
  createIdRemapMiddleware: () => createIdRemapMiddleware,
  createLoggerMiddleware: () => createLoggerMiddleware,
  createScaffoldMiddleware: () => createScaffoldMiddleware,
  createScaffoldMiddlewareV2: () => createScaffoldMiddleware2,
  createStreamMiddleware: () => createStreamMiddleware,
  dataHasCause: () => dataHasCause,
  deepClone: () => deepClone,
  entriesFromKeyValues: () => entriesFromKeyValues,
  errorCodes: () => errorCodes,
  errorValues: () => errorValues,
  fromLegacyRequest: () => fromLegacyRequest,
  generateRecordId: () => generateRecordId,
  generateWhiteLabelTheme: () => generateWhiteLabelTheme,
  getColorsList: () => getColorsList,
  getED25519Key: () => getED25519Key,
  getHashQueryParams: () => getHashQueryParams,
  getMessageFromCode: () => getMessageFromCode,
  getRpcPromiseCallback: () => getRpcPromiseCallback,
  getUniqueId: () => getUniqueId,
  hasProperty: () => hasProperty,
  htmlToElement: () => htmlToElement,
  isAuthFlowError: () => isAuthFlowError,
  isInstance: () => isInstance,
  isIterable: () => isIterable,
  isJRPCFailure: () => isJRPCFailure,
  isJRPCNotification: () => isJRPCNotification,
  isJRPCRequest: () => isJRPCRequest,
  isJRPCSuccess: () => isJRPCSuccess,
  isNotification: () => isNotification,
  isObject: () => isObject,
  isPlainObject: () => isPlainObject,
  isRequest: () => isRequest,
  isValidCode: () => isValidCode,
  isValidJson: () => isValidJson2,
  isValidMethod: () => isValidMethod,
  isValidNumber: () => isValidNumber,
  isValidStreamMessage: () => isValidStreamMessage,
  isValidString: () => isValidString,
  jsonToBase64: () => jsonToBase64,
  log: () => log,
  makeContext: () => makeContext,
  mergeMiddleware: () => mergeMiddleware,
  mimcGetConstants: () => mimcGetConstants,
  mimcHash: () => mimcHash,
  mimcMultiHash: () => mimcMultiHash,
  mimgGetIV: () => mimgGetIV,
  propagateToContext: () => propagateToContext,
  propagateToMutableRequest: () => propagateToMutableRequest,
  propagateToRequest: () => propagateToRequest,
  providerAsMiddleware: () => providerAsMiddleware,
  providerAsMiddlewareV2: () => providerAsMiddleware2,
  providerErrors: () => providerErrors,
  providerFromEngine: () => providerFromEngine,
  providerFromEngineV2: () => providerFromEngine2,
  providerFromMiddleware: () => providerFromMiddleware,
  providerFromMiddlewareV2: () => providerFromMiddleware2,
  rpcErrors: () => rpcErrors,
  serializeCause: () => serializeCause,
  serializeJrpcError: () => serializeJrpcError,
  setupMultiplex: () => setupMultiplex,
  storeKey: () => storeKey,
  stringify: () => stringify4,
  subkey: () => subkey,
  version: () => version2
});
__reExport(lib_exports, __toESM(require_lib3()));
var import_session_manager2 = __toESM(require_lib2());

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/utils/constants.js
var import_objectSpread2 = __toESM(require_objectSpread2());

// node_modules/@toruslabs/constants/dist/lib.esm/constants.js
var TORUS_LEGACY_NETWORK = {
  MAINNET: "mainnet",
  TESTNET: "testnet",
  CYAN: "cyan",
  AQUA: "aqua",
  CELESTE: "celeste"
};
var TORUS_SAPPHIRE_NETWORK = {
  SAPPHIRE_DEVNET: "sapphire_devnet",
  SAPPHIRE_MAINNET: "sapphire_mainnet"
};
var BUILD_ENV = {
  PRODUCTION: "production",
  DEVELOPMENT: "development",
  STAGING: "staging",
  TESTING: "testing"
};
var LEGACY_NETWORKS_ROUTE_MAP = {
  [TORUS_LEGACY_NETWORK.AQUA]: {
    networkIdentifier: "aqua",
    networkMigratedTo: TORUS_SAPPHIRE_NETWORK.SAPPHIRE_MAINNET
  },
  [TORUS_LEGACY_NETWORK.CELESTE]: {
    networkIdentifier: "celeste",
    networkMigratedTo: TORUS_SAPPHIRE_NETWORK.SAPPHIRE_MAINNET
  },
  [TORUS_LEGACY_NETWORK.CYAN]: {
    networkIdentifier: "cyan",
    networkMigratedTo: TORUS_SAPPHIRE_NETWORK.SAPPHIRE_MAINNET
  },
  [TORUS_LEGACY_NETWORK.MAINNET]: {
    networkIdentifier: "mainnet",
    networkMigratedTo: TORUS_SAPPHIRE_NETWORK.SAPPHIRE_MAINNET
  },
  [TORUS_LEGACY_NETWORK.TESTNET]: {
    networkIdentifier: "teal",
    networkMigratedTo: TORUS_SAPPHIRE_NETWORK.SAPPHIRE_DEVNET
  }
};
var CITADEL_SERVER_MAP = {
  [BUILD_ENV.PRODUCTION]: "https://api.web3auth.io/citadel-service",
  [BUILD_ENV.DEVELOPMENT]: "https://api-develop.web3auth.io/citadel-service",
  [BUILD_ENV.STAGING]: "https://api.web3auth.io/citadel-service",
  [BUILD_ENV.TESTING]: "https://api-develop.web3auth.io/citadel-service"
};
var DASHBOARD_PUBLIC_API_MAP = {
  [BUILD_ENV.PRODUCTION]: "https://api.web3auth.io/signer-service",
  [BUILD_ENV.DEVELOPMENT]: "https://api-develop.web3auth.io/signer-service",
  [BUILD_ENV.STAGING]: "https://api.web3auth.io/signer-service",
  [BUILD_ENV.TESTING]: "https://api-develop.web3auth.io/signer-service"
};
var LEGACY_METADATA_MAP = {
  [BUILD_ENV.PRODUCTION]: "https://api.web3auth.io/metadata-service",
  [BUILD_ENV.DEVELOPMENT]: "https://api-develop.web3auth.io/metadata-service",
  [BUILD_ENV.STAGING]: "https://api.web3auth.io/metadata-service",
  [BUILD_ENV.TESTING]: "https://api-develop.web3auth.io/metadata-service"
};
var FND_SERVER_MAP = {
  [BUILD_ENV.PRODUCTION]: "https://api.web3auth.io/fnd-service",
  [BUILD_ENV.DEVELOPMENT]: "https://api-develop.web3auth.io/fnd-service",
  [BUILD_ENV.STAGING]: "https://api.web3auth.io/fnd-service",
  [BUILD_ENV.TESTING]: "https://api-develop.web3auth.io/fnd-service"
};
var STORAGE_SERVER_MAP = {
  [BUILD_ENV.PRODUCTION]: "https://api.web3auth.io/session-service",
  [BUILD_ENV.DEVELOPMENT]: "https://api-develop.web3auth.io/session-service",
  [BUILD_ENV.STAGING]: "https://api.web3auth.io/session-service",
  [BUILD_ENV.TESTING]: "https://api-develop.web3auth.io/session-service"
};
var STORAGE_SERVER_SOCKET_URL_MAP = {
  [BUILD_ENV.PRODUCTION]: "https://session.web3auth.io",
  [BUILD_ENV.DEVELOPMENT]: "https://develop-session.web3auth.io",
  [BUILD_ENV.STAGING]: "https://session.web3auth.io",
  [BUILD_ENV.TESTING]: "https://develop-session.web3auth.io"
};

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/utils/constants.js
var storeKey = "auth_store";
var WEB3AUTH_LEGACY_NETWORK = TORUS_LEGACY_NETWORK;
var WEB3AUTH_SAPPHIRE_NETWORK = TORUS_SAPPHIRE_NETWORK;
var WEB3AUTH_NETWORK = (0, import_objectSpread2.default)((0, import_objectSpread2.default)({}, WEB3AUTH_SAPPHIRE_NETWORK), WEB3AUTH_LEGACY_NETWORK);
var SUPPORTED_KEY_CURVES = {
  SECP256K1: "secp256k1",
  ED25519: "ed25519",
  OTHER: "other"
};
var MFA_LEVELS = {
  OPTIONAL: "optional",
  MANDATORY: "mandatory",
  NONE: "none"
};
var AUTH_ACTIONS = {
  LOGIN: "login",
  ENABLE_MFA: "enable_mfa",
  MANAGE_MFA: "manage_mfa",
  ADD_SOCIAL_FACTOR: "add_social_factor",
  MODIFY_SOCIAL_FACTOR: "modify_social_factor",
  ADD_AUTHENTICATOR_FACTOR: "add_authenticator_factor",
  ADD_PASSKEY_FACTOR: "add_passkey_factor"
};
var BUILD_ENV2 = {
  PRODUCTION: "production",
  DEVELOPMENT: "development",
  STAGING: "staging",
  TESTING: "testing"
};
var SDK_MODE = {
  DEFAULT: "default",
  IFRAME: "iframe"
};
var JRPC_METHODS = {
  SETUP_COMPLETE: "setup_complete",
  INIT_DAPP: "init_dapp",
  LOGIN_INITIATED: "login_initiated",
  LOGIN_CANCELLED: "login_cancelled",
  LOGIN_FAILED: "login_failed",
  LOGIN_SUCCESS: "login_success",
  DISPLAY_IFRAME: "display_iframe",
  HIDE_IFRAME: "hide_iframe"
};
var IFRAME_MODAL_ID = "auth-iframe";
var DEFAULT_SESSION_TIME = 30 * 24 * 60 * 60;
var AUTH_SERVICE_DEVELOPMENT_URL = "http://localhost:3000";
var AUTH_SERVICE_STAGING_URL = "https://staging-auth.web3auth.io";
var AUTH_SERVICE_TESTING_URL = "https://develop-auth.web3auth.io";
var AUTH_SERVICE_PRODUCTION_URL = "https://auth.web3auth.io";
var AUTH_DASHBOARD_DEVELOPMENT_URL = "http://localhost:5173";
var AUTH_DASHBOARD_STAGING_URL = "https://staging-account.web3auth.io";
var AUTH_DASHBOARD_TESTING_URL = "https://develop-account.web3auth.io";
var AUTH_DASHBOARD_PRODUCTION_URL = "https://account.web3auth.io";
var POPUP_TIMEOUT = 1e3 * 10;

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/core/auth.js
var import_objectSpread23 = __toESM(require_objectSpread2());
var import_defineProperty4 = __toESM(require_defineProperty());
var import_customauth3 = __toESM(require_lib3());
var import_metadata_helpers3 = __toESM(require_lib());
var import_session_manager = __toESM(require_lib2());

// node_modules/klona/json/index.mjs
function klona(val) {
  var k3, out, tmp;
  if (Array.isArray(val)) {
    out = Array(k3 = val.length);
    while (k3--) out[k3] = (tmp = val[k3]) && typeof tmp === "object" ? klona(tmp) : tmp;
    return out;
  }
  if (Object.prototype.toString.call(val) === "[object Object]") {
    out = {};
    for (k3 in val) {
      if (k3 === "__proto__") {
        Object.defineProperty(out, k3, {
          value: klona(val[k3]),
          configurable: true,
          enumerable: true,
          writable: true
        });
      } else {
        out[k3] = (tmp = val[k3]) && typeof tmp === "object" ? klona(tmp) : tmp;
      }
    }
    return out;
  }
  return val;
}

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/utils/logger.js
var import_loglevel = __toESM(require_loglevel());
var log = import_loglevel.default.getLogger("auth");
log.setLevel("error");

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/core/AuthProvider.js
var import_defineProperty = __toESM(require_defineProperty());
var import_customauth = __toESM(require_lib3());

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/utils/interfaces.js
var LANGUAGES = {
  en: "en",
  ja: "ja",
  ko: "ko",
  de: "de",
  zh: "zh",
  es: "es",
  fr: "fr",
  pt: "pt",
  nl: "nl",
  tr: "tr",
  am: "am"
};
var LANGUAGE_MAP = {
  en: "english",
  ja: "japanese",
  ko: "korean",
  de: "german",
  zh: "mandarin",
  es: "spanish",
  fr: "french",
  pt: "portuguese",
  nl: "dutch",
  tr: "turkish",
  am: "amharic"
};
var THEME_MODES = {
  light: "light",
  dark: "dark",
  auto: "auto"
};
var MFA_FACTOR = {
  DEVICE: "deviceShareFactor",
  BACKUP_SHARE: "backUpShareFactor",
  SOCIAL_BACKUP: "socialBackupFactor",
  PASSWORD: "passwordFactor",
  PASSKEYS: "passkeysFactor",
  AUTHENTICATOR: "authenticatorFactor"
};

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/utils/utils.js
var import_metadata_helpers = __toESM(require_lib());
function base64toJSON(b64str) {
  return JSON.parse((0, import_metadata_helpers.decodeBase64Url)(b64str));
}
function jsonToBase64(json) {
  return (0, import_metadata_helpers.encodeBase64Url)(JSON.stringify(json));
}
var htmlToElement = (html) => {
  const template = window.document.createElement("template");
  const trimmedHtml = html.trim();
  template.innerHTML = trimmedHtml;
  return template.content.firstChild;
};
function cloneDeep(object) {
  try {
    return klona(object);
  } catch {
    return JSON.parse(JSON.stringify(object));
  }
}
function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function hasProperty(value, key) {
  return isObject(value) && key in value;
}
function generateRecordId() {
  const cr = typeof globalThis === "object" ? globalThis.crypto : null;
  if (typeof (cr === null || cr === void 0 ? void 0 : cr.randomUUID) !== "function") throw new Error("crypto.randomUUID must be defined");
  return cr.randomUUID();
}

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/core/utils.js
var import_objectSpread22 = __toESM(require_objectSpread2());
var import_metadata_helpers2 = __toESM(require_lib());
var version2 = "11.8.1";
function getHashQueryParams(replaceUrl = false) {
  const result = {};
  const queryUrlParams = new URLSearchParams(window.location.search.slice(1));
  queryUrlParams.forEach((value, key) => {
    if (key !== "b64Params") {
      result[key] = value;
    }
  });
  const queryResult = queryUrlParams.get("b64Params");
  if (queryResult) {
    try {
      const queryParams = JSON.parse((0, import_metadata_helpers2.decodeBase64Url)(queryResult));
      Object.keys(queryParams).forEach((key) => {
        result[key] = queryParams[key];
      });
    } catch (error) {
      log.error(error);
    }
  }
  const hashUrlParams = new URLSearchParams(window.location.hash.substring(1));
  hashUrlParams.forEach((value, key) => {
    if (key !== "b64Params") {
      result[key] = value;
    }
  });
  const hashResult = hashUrlParams.get("b64Params");
  if (hashResult) {
    try {
      const hashParams = JSON.parse((0, import_metadata_helpers2.decodeBase64Url)(hashResult));
      Object.keys(hashParams).forEach((key) => {
        result[key] = hashParams[key];
      });
    } catch (error) {
      log.error(error);
    }
  }
  if (replaceUrl) {
    const cleanUrl = new URL(window.location.origin + window.location.pathname);
    if (queryUrlParams.size !== 0) {
      queryUrlParams.delete("error");
      queryUrlParams.delete("state");
      queryUrlParams.delete("b64Params");
      queryUrlParams.delete("sessionNamespace");
      cleanUrl.search = queryUrlParams.toString();
    }
    if (hashUrlParams.size !== 0) {
      hashUrlParams.delete("error");
      hashUrlParams.delete("state");
      hashUrlParams.delete("b64Params");
      hashUrlParams.delete("sessionNamespace");
      cleanUrl.hash = hashUrlParams.toString();
    }
    window.history.replaceState((0, import_objectSpread22.default)((0, import_objectSpread22.default)({}, window.history.state), {}, {
      as: cleanUrl.href,
      url: cleanUrl.href
    }), "", cleanUrl.href);
  }
  return result;
}
function isAuthFlowError(result) {
  return "error" in result;
}

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/core/AuthProvider.js
var authServiceIframeMap = /* @__PURE__ */ new Map();
function getTheme(theme) {
  if (theme === THEME_MODES.light) return "light";
  if (theme === THEME_MODES.dark) return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
var AuthProvider = class {
  constructor({
    sdkUrl,
    whiteLabel
  }) {
    (0, import_defineProperty.default)(this, "sdkUrl", void 0);
    (0, import_defineProperty.default)(this, "whiteLabel", void 0);
    (0, import_defineProperty.default)(this, "initialized", false);
    (0, import_defineProperty.default)(this, "loginCallbackSuccess", null);
    (0, import_defineProperty.default)(this, "loginCallbackFailed", null);
    (0, import_defineProperty.default)(this, "messageHandler", null);
    (0, import_defineProperty.default)(this, "embedNonce", (0, import_customauth.randomId)());
    this.sdkUrl = sdkUrl;
    this.whiteLabel = whiteLabel;
  }
  get targetOrigin() {
    return new URL(this.sdkUrl).origin;
  }
  getAuthServiceIframe() {
    return authServiceIframeMap.get(this.embedNonce);
  }
  registerAuthServiceIframe(iframe) {
    authServiceIframeMap.set(this.embedNonce, iframe);
  }
  cleanup() {
    if (this.messageHandler) {
      window.removeEventListener("message", this.messageHandler);
      this.messageHandler = null;
    }
    const iframe = authServiceIframeMap.get(this.embedNonce);
    if (iframe && iframe.parentNode) {
      iframe.parentNode.removeChild(iframe);
      authServiceIframeMap.delete(this.embedNonce);
    }
    this.initialized = false;
  }
  async init({
    network,
    clientId
  }) {
    if (typeof window === "undefined" || typeof document === "undefined") throw new Error("window or document is not available");
    if (this.initialized) throw new Error("AuthProvider already initialized");
    const authIframeUrl = new URL(this.sdkUrl);
    if (authIframeUrl.pathname.endsWith("/")) authIframeUrl.pathname += "frame";
    else authIframeUrl.pathname += "/frame";
    const hashParams = new URLSearchParams();
    hashParams.append("origin", window.location.origin);
    hashParams.append("nonce", this.embedNonce);
    authIframeUrl.hash = hashParams.toString();
    const colorScheme = getTheme(this.whiteLabel.mode || THEME_MODES.light);
    const authServiceIframe = htmlToElement(`<iframe
        id="${IFRAME_MODAL_ID}-${this.embedNonce}"
        class="${IFRAME_MODAL_ID}-${this.embedNonce}"
        sandbox="allow-popups allow-scripts allow-same-origin allow-forms allow-modals allow-downloads"
        src="${authIframeUrl.href}"
        style="display: none; position: fixed; top: 0; right: 0; width: 100%; z-index: 10000000;
        height: 100%; border: none; border-radius: 0; color-scheme: ${colorScheme};"
        allow="clipboard-write"
      ></iframe>`);
    this.registerAuthServiceIframe(authServiceIframe);
    return new Promise((resolve, reject) => {
      try {
        window.document.body.appendChild(authServiceIframe);
        this.messageHandler = (event) => {
          var _this$getAuthServiceI, _this$loginCallbackFa, _this$loginCallbackSu;
          if (event.origin !== this.targetOrigin) return;
          const {
            data
          } = event;
          const {
            type,
            nonce
          } = data;
          if (nonce !== this.embedNonce) return;
          const messageData = data.data;
          switch (type) {
            case JRPC_METHODS.SETUP_COMPLETE:
              (_this$getAuthServiceI = this.getAuthServiceIframe()) === null || _this$getAuthServiceI === void 0 || (_this$getAuthServiceI = _this$getAuthServiceI.contentWindow) === null || _this$getAuthServiceI === void 0 || _this$getAuthServiceI.postMessage({
                type: JRPC_METHODS.INIT_DAPP,
                data: {
                  network,
                  clientId
                }
              }, this.targetOrigin);
              this.initialized = true;
              resolve();
              break;
            case JRPC_METHODS.LOGIN_FAILED:
              (_this$loginCallbackFa = this.loginCallbackFailed) === null || _this$loginCallbackFa === void 0 || _this$loginCallbackFa.call(this, isAuthFlowError(messageData) ? messageData.error : "Login failed, reason: unknown");
              break;
            case JRPC_METHODS.DISPLAY_IFRAME:
              this.getAuthServiceIframe().style.display = "block";
              break;
            case JRPC_METHODS.HIDE_IFRAME:
              this.getAuthServiceIframe().style.display = "none";
              break;
            case JRPC_METHODS.LOGIN_SUCCESS:
              log.info("LOGIN_SUCCESS", messageData);
              this.getAuthServiceIframe().style.display = "none";
              if (messageData && !isAuthFlowError(messageData)) (_this$loginCallbackSu = this.loginCallbackSuccess) === null || _this$loginCallbackSu === void 0 || _this$loginCallbackSu.call(this, messageData);
              break;
            default:
              log.warn(`Unknown message type: ${type}`);
              break;
          }
        };
        window.addEventListener("message", this.messageHandler);
      } catch (error) {
        reject(error);
      }
    });
  }
  postLoginInitiatedMessage(loginConfig, nonce) {
    var _this$getAuthServiceI2;
    if (!this.initialized) throw new Error("Iframe not initialized");
    (_this$getAuthServiceI2 = this.getAuthServiceIframe().contentWindow) === null || _this$getAuthServiceI2 === void 0 || _this$getAuthServiceI2.postMessage({
      type: JRPC_METHODS.LOGIN_INITIATED,
      data: {
        loginConfig,
        nonce
      }
    }, this.targetOrigin);
    return new Promise((resolve, reject) => {
      this.loginCallbackSuccess = resolve;
      this.loginCallbackFailed = reject;
    });
  }
  postLoginCancelledMessage(nonce) {
    var _this$getAuthServiceI3;
    if (!this.initialized) throw new Error("Iframe not initialized");
    (_this$getAuthServiceI3 = this.getAuthServiceIframe().contentWindow) === null || _this$getAuthServiceI3 === void 0 || _this$getAuthServiceI3.postMessage({
      type: JRPC_METHODS.LOGIN_CANCELLED,
      data: {
        nonce
      }
    }, this.targetOrigin);
  }
};

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/core/errors.js
var import_defineProperty2 = __toESM(require_defineProperty());
var AuthError = class extends Error {
  constructor(code, message) {
    super(message);
    (0, import_defineProperty2.default)(this, "code", void 0);
    (0, import_defineProperty2.default)(this, "message", void 0);
    this.code = code;
    this.message = message || "";
    Object.defineProperty(this, "name", {
      value: "AuthError",
      configurable: true
    });
  }
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message
    };
  }
  toString() {
    return JSON.stringify(this.toJSON());
  }
};
var InitializationError = class _InitializationError extends AuthError {
  constructor(code, message) {
    super(code, message);
    Object.defineProperty(this, "name", {
      value: "InitializationError",
      configurable: true
    });
  }
  static fromCode(code, extraMessage = "") {
    return new _InitializationError(code, `${_InitializationError.messages[code]}, ${extraMessage}`);
  }
  static invalidParams(extraMessage = "") {
    return _InitializationError.fromCode(5001, extraMessage);
  }
  static notInitialized(extraMessage = "") {
    return _InitializationError.fromCode(5002, extraMessage);
  }
};
(0, import_defineProperty2.default)(InitializationError, "messages", {
  5e3: "Custom",
  5001: "Invalid constructor params",
  5002: "SDK not initialized. please call init first"
});
var LoginError = class _LoginError extends AuthError {
  constructor(code, message) {
    super(code, message);
    Object.defineProperty(this, "name", {
      value: "LoginError",
      configurable: true
    });
  }
  static fromCode(code, extraMessage = "") {
    return new _LoginError(code, `${_LoginError.messages[code]}, ${extraMessage}`);
  }
  static invalidLoginParams(extraMessage = "") {
    return _LoginError.fromCode(5111, extraMessage);
  }
  static userNotLoggedIn(extraMessage = "") {
    return _LoginError.fromCode(5112, extraMessage);
  }
  static popupClosed(extraMessage = "") {
    return _LoginError.fromCode(5113, extraMessage);
  }
  static loginFailed(extraMessage = "") {
    return _LoginError.fromCode(5114, extraMessage);
  }
  static popupBlocked(extraMessage = "") {
    return _LoginError.fromCode(5115, extraMessage);
  }
  static mfaAlreadyEnabled(extraMessage = "") {
    return _LoginError.fromCode(5116, extraMessage);
  }
  static mfaNotEnabled(extraMessage = "") {
    return _LoginError.fromCode(5117, extraMessage);
  }
};
(0, import_defineProperty2.default)(LoginError, "messages", {
  5e3: "Custom",
  5111: "Invalid login params",
  5112: "User not logged in.",
  5113: "login popup has been closed by the user",
  5114: "Login failed",
  5115: "Popup was blocked. Please call this function as soon as user clicks button or use redirect mode",
  5116: "MFA already enabled",
  5117: "MFA not yet enabled. Please call `enableMFA` first"
});

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/core/PopupHandler.js
var import_defineProperty3 = __toESM(require_defineProperty());
var import_customauth2 = __toESM(require_lib3());
var import_secure_pub_sub = __toESM(require_lib4());
import { EventEmitter } from "events";
var PopupHandler = class extends EventEmitter {
  constructor({
    url,
    target,
    features,
    timeout = 3e4,
    socketUrl,
    serverUrl
  }) {
    super();
    (0, import_defineProperty3.default)(this, "url", void 0);
    (0, import_defineProperty3.default)(this, "target", void 0);
    (0, import_defineProperty3.default)(this, "features", void 0);
    (0, import_defineProperty3.default)(this, "window", void 0);
    (0, import_defineProperty3.default)(this, "windowTimer", void 0);
    (0, import_defineProperty3.default)(this, "iClosedWindow", void 0);
    (0, import_defineProperty3.default)(this, "timeout", void 0);
    (0, import_defineProperty3.default)(this, "socketUrl", void 0);
    (0, import_defineProperty3.default)(this, "serverUrl", void 0);
    (0, import_defineProperty3.default)(this, "securePubSub", null);
    this.url = url;
    this.target = target || "_blank";
    this.features = features || (0, import_customauth2.getPopupFeatures)();
    this.window = void 0;
    this.windowTimer = void 0;
    this.iClosedWindow = false;
    this.timeout = timeout;
    this.serverUrl = serverUrl;
    this.socketUrl = socketUrl;
    this._setupTimer();
  }
  _setupTimer() {
    this.windowTimer = Number(setInterval(() => {
      if (this.window && this.window.closed) {
        clearInterval(this.windowTimer);
        setTimeout(() => {
          if (!this.iClosedWindow) {
            this.emit("close");
          }
          this.iClosedWindow = false;
          this.window = void 0;
          if (this.securePubSub) {
            this.securePubSub.cleanup();
            this.securePubSub = null;
          }
        }, this.timeout);
      }
      if (this.window === void 0) clearInterval(this.windowTimer);
    }, 500));
  }
  open() {
    var _this$window;
    this.window = window.open(this.url, this.target, this.features);
    if (!this.window) throw LoginError.popupBlocked();
    if ((_this$window = this.window) !== null && _this$window !== void 0 && _this$window.focus) this.window.focus();
  }
  close() {
    this.iClosedWindow = true;
    if (this.window) this.window.close();
    if (this.securePubSub) {
      this.securePubSub.cleanup();
      this.securePubSub = null;
    }
  }
  redirect(locationReplaceOnRedirect) {
    if (locationReplaceOnRedirect) {
      window.location.replace(this.url);
    } else {
      window.location.href = this.url;
    }
  }
  async listenOnChannel(loginId) {
    this.securePubSub = new import_secure_pub_sub.SecurePubSub({
      serverUrl: this.serverUrl,
      socketUrl: this.socketUrl,
      sameIpCheck: true,
      allowedOrigin: true
    });
    const data = await this.securePubSub.subscribe(loginId);
    this.close();
    const parsedData = JSON.parse(data);
    if (parsedData.error) {
      return {
        error: parsedData.error,
        state: parsedData.state
      };
    }
    return parsedData.data;
  }
};

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/core/auth.js
var Auth = class {
  constructor(options) {
    (0, import_defineProperty4.default)(this, "state", {});
    (0, import_defineProperty4.default)(this, "options", void 0);
    (0, import_defineProperty4.default)(this, "sessionManager", void 0);
    (0, import_defineProperty4.default)(this, "_storageBaseKey", "auth_store");
    (0, import_defineProperty4.default)(this, "dappState", void 0);
    (0, import_defineProperty4.default)(this, "addVersionInUrls", true);
    (0, import_defineProperty4.default)(this, "authProvider", void 0);
    (0, import_defineProperty4.default)(this, "authProviderPromise", void 0);
    if (!options.clientId) throw InitializationError.invalidParams("clientId is required");
    if (!options.network) options.network = WEB3AUTH_NETWORK.SAPPHIRE_MAINNET;
    if (!options.buildEnv) options.buildEnv = BUILD_ENV2.PRODUCTION;
    if (!options.sdkMode) options.sdkMode = SDK_MODE.DEFAULT;
    if (options.buildEnv === BUILD_ENV2.DEVELOPMENT || options.buildEnv === BUILD_ENV2.TESTING || options.sdkUrl) this.addVersionInUrls = false;
    if (!options.sdkUrl) {
      if (options.buildEnv === BUILD_ENV2.DEVELOPMENT) {
        options.sdkUrl = AUTH_SERVICE_DEVELOPMENT_URL;
        options.dashboardUrl = AUTH_DASHBOARD_DEVELOPMENT_URL;
      } else if (options.buildEnv === BUILD_ENV2.STAGING) {
        options.sdkUrl = AUTH_SERVICE_STAGING_URL;
        options.dashboardUrl = AUTH_DASHBOARD_STAGING_URL;
      } else if (options.buildEnv === BUILD_ENV2.TESTING) {
        options.sdkUrl = AUTH_SERVICE_TESTING_URL;
        options.dashboardUrl = AUTH_DASHBOARD_TESTING_URL;
      } else {
        options.sdkUrl = AUTH_SERVICE_PRODUCTION_URL;
        options.dashboardUrl = AUTH_DASHBOARD_PRODUCTION_URL;
      }
    }
    if (!options.redirectUrl && typeof window !== "undefined") {
      options.redirectUrl = `${window.location.protocol}//${window.location.host}${window.location.pathname}`;
    }
    if (!options.uxMode) options.uxMode = import_customauth3.UX_MODE.REDIRECT;
    if (typeof options.replaceUrlOnRedirect !== "boolean") options.replaceUrlOnRedirect = true;
    if (typeof options.includeUserDataInToken !== "boolean") options.includeUserDataInToken = true;
    if (!options.originData) options.originData = {};
    if (!options.whiteLabel) options.whiteLabel = {};
    if (!options.authConnectionConfig) options.authConnectionConfig = [];
    if (!options.mfaSettings) options.mfaSettings = {};
    if (!options.citadelServerUrl) options.citadelServerUrl = CITADEL_SERVER_MAP[options.buildEnv];
    if (!options.storageServerUrl) options.storageServerUrl = STORAGE_SERVER_MAP[options.buildEnv];
    if (!options.sessionSocketUrl) options.sessionSocketUrl = STORAGE_SERVER_SOCKET_URL_MAP[options.buildEnv];
    if (!options.sessionTime) options.sessionTime = DEFAULT_SESSION_TIME;
    this.options = options;
  }
  get privKey() {
    return this.state.privKey ? this.state.privKey.padStart(64, "0") : "";
  }
  get coreKitKey() {
    return this.state.coreKitKey ? this.state.coreKitKey.padStart(64, "0") : "";
  }
  get ed25519PrivKey() {
    return this.state.ed25519PrivKey ? this.state.ed25519PrivKey.padStart(128, "0") : "";
  }
  get coreKitEd25519Key() {
    return this.state.coreKitEd25519PrivKey ? this.state.coreKitEd25519PrivKey.padStart(128, "0") : "";
  }
  get authSessionManager() {
    return this.sessionManager;
  }
  get sessionId() {
    return this.state.sessionId || "";
  }
  get sessionNamespace() {
    return this.options.sessionNamespace || "";
  }
  get appState() {
    var _this$state;
    return ((_this$state = this.state) === null || _this$state === void 0 || (_this$state = _this$state.userInfo) === null || _this$state === void 0 ? void 0 : _this$state.appState) || this.dappState || "";
  }
  get baseUrl() {
    if (!this.addVersionInUrls) return this.options.sdkUrl;
    return `${this.options.sdkUrl}/v${version2.split(".")[0]}`;
  }
  get dashboardUrl() {
    if (!this.addVersionInUrls) return `${this.options.dashboardUrl}`;
    return `${this.options.dashboardUrl}/v${version2.split(".")[0]}`;
  }
  async init() {
    const params = getHashQueryParams(this.options.replaceUrlOnRedirect);
    if (params.sessionNamespace) this.options.sessionNamespace = params.sessionNamespace;
    const storageKey = this.options.sessionKey || (this.options.sessionNamespace ? `${this._storageBaseKey}_${this.options.sessionNamespace}` : this._storageBaseKey);
    this.sessionManager = new import_session_manager.AuthSessionManager({
      storageKeyPrefix: storageKey,
      apiClientConfig: {
        baseURL: this.options.citadelServerUrl
      },
      storage: this.options.storage,
      accessTokenProvider: this.options.accessTokenProvider,
      cookieOptions: this.options.cookieOptions
    });
    if (this.options.network === WEB3AUTH_NETWORK.TESTNET || this.options.network === WEB3AUTH_NETWORK.SAPPHIRE_DEVNET) {
      console.log(`%c WARNING! You are on ${this.options.network}. Please set network: 'mainnet' or 'sapphire_mainnet' in production`, "color: #FF0000");
    }
    if (this.options.buildEnv !== BUILD_ENV2.PRODUCTION) {
      console.log(`%c WARNING! You are using build env ${this.options.buildEnv}. Please set buildEnv: 'production' in production`, "color: #FF0000");
    }
    if (params.error) {
      this.dappState = params.state;
      throw LoginError.loginFailed(params.error);
    }
    if (params.sessionId) {
      await this.sessionManager.setTokens({
        sessionId: (0, import_metadata_helpers3.add0x)(params.sessionId),
        accessToken: params.accessToken || "",
        refreshToken: params.refreshToken || "",
        idToken: params.idToken || ""
      });
    }
    const sessionId = await this.sessionManager.getSessionId();
    if (sessionId) {
      const data = await this._authorizeSession();
      if (data && Object.keys(data).length > 0) {
        this.updateState(data);
      }
    }
    if (this.options.sdkMode === SDK_MODE.IFRAME) {
      this.authProvider = new AuthProvider({
        sdkUrl: this.baseUrl,
        whiteLabel: this.options.whiteLabel
      });
      if (!this.state.sessionId) {
        this.authProviderPromise = this.authProvider.init({
          network: this.options.network,
          clientId: this.options.clientId
        });
        if (params.nonce) {
          await this.authProviderPromise;
          await this.postLoginInitiatedMessage(JSON.parse(params.loginParams), params.nonce);
        }
      }
    }
  }
  async login(params) {
    if (!params.authConnection && (!params.authConnectionId || !params.groupedAuthConnectionId)) throw LoginError.invalidLoginParams(`AuthConnection is required`);
    const loginParams = (0, import_objectSpread23.default)({}, params);
    const dataObject = {
      actionType: AUTH_ACTIONS.LOGIN,
      options: this.options,
      params: loginParams
    };
    const result = await this.authHandler(`${this.baseUrl}/start`, dataObject, (0, import_customauth3.getTimeout)(params.authConnection));
    if (!result) return null;
    if (isAuthFlowError(result)) {
      this.dappState = result.state;
      throw LoginError.loginFailed(result.error);
    }
    await this.sessionManager.setTokens({
      sessionId: (0, import_metadata_helpers3.add0x)(result.sessionId),
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      idToken: result.idToken
    });
    await this.refreshSession();
    return {
      privKey: this.privKey
    };
  }
  async postLoginInitiatedMessage(params, nonce) {
    var _this$authProvider;
    if (this.options.sdkMode !== SDK_MODE.IFRAME) throw LoginError.invalidLoginParams("Cannot perform this action in default mode.");
    if (this.authProviderPromise) await this.authProviderPromise;
    if (!((_this$authProvider = this.authProvider) !== null && _this$authProvider !== void 0 && _this$authProvider.initialized)) {
      await this.authProvider.init({
        network: this.options.network,
        clientId: this.options.clientId
      });
    }
    const result = await this.authProvider.postLoginInitiatedMessage({
      actionType: AUTH_ACTIONS.LOGIN,
      params,
      options: this.options
    }, nonce);
    await this.sessionManager.setTokens({
      sessionId: (0, import_metadata_helpers3.add0x)(result.sessionId),
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      idToken: result.idToken
    });
    this.options.sessionNamespace = result.sessionNamespace;
    await this.refreshSession();
  }
  async postLoginCancelledMessage(nonce) {
    var _this$authProvider2;
    if (this.options.sdkMode !== SDK_MODE.IFRAME) throw LoginError.invalidLoginParams("Cannot perform this action in default mode.");
    if (this.authProviderPromise) await this.authProviderPromise;
    if (!((_this$authProvider2 = this.authProvider) !== null && _this$authProvider2 !== void 0 && _this$authProvider2.initialized)) throw InitializationError.notInitialized();
    this.authProvider.postLoginCancelledMessage(nonce);
  }
  async logout() {
    if (!this.sessionId) throw LoginError.userNotLoggedIn();
    await this.sessionManager.logout();
    this.clearState();
  }
  async enableMFA(params) {
    var _this$state$userInfo;
    if (!this.sessionId) throw LoginError.userNotLoggedIn();
    await this.refreshSession();
    if (this.state.userInfo.isMfaEnabled) throw LoginError.mfaAlreadyEnabled();
    const dataObject = {
      actionType: AUTH_ACTIONS.ENABLE_MFA,
      options: (0, import_objectSpread23.default)((0, import_objectSpread23.default)({}, this.options), {}, {
        sdkMode: SDK_MODE.DEFAULT
      }),
      params: (0, import_objectSpread23.default)((0, import_objectSpread23.default)({}, params), {}, {
        authConnection: this.state.userInfo.authConnection,
        authConnectionId: this.state.userInfo.authConnectionId,
        groupedAuthConnectionId: this.state.userInfo.groupedAuthConnectionId,
        extraLoginOptions: {
          login_hint: this.state.userInfo.userId
        },
        mfaLevel: "mandatory"
      }),
      sessionId: this.sessionId,
      accessToken: await this.getAccessToken()
    };
    const result = await this.authHandler(`${this.baseUrl}/start`, dataObject, POPUP_TIMEOUT);
    if (!result) return false;
    if (isAuthFlowError(result)) {
      this.dappState = result.state;
      throw LoginError.loginFailed(result.error);
    }
    await this.sessionManager.setTokens({
      sessionId: (0, import_metadata_helpers3.add0x)(result.sessionId),
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      idToken: result.idToken
    });
    await this.refreshSession();
    return Boolean((_this$state$userInfo = this.state.userInfo) === null || _this$state$userInfo === void 0 ? void 0 : _this$state$userInfo.isMfaEnabled);
  }
  async manageMFA(params) {
    if (!this.sessionId) throw LoginError.userNotLoggedIn();
    await this.refreshSession();
    if (!this.state.userInfo.isMfaEnabled) throw LoginError.mfaNotEnabled();
    const defaultParams = {
      dappUrl: `${window.location.origin}${window.location.pathname}`
    };
    const loginId = import_session_manager.StorageManager.generateRandomSessionKey();
    const recordId = generateRecordId();
    const dataObject = {
      actionType: AUTH_ACTIONS.MANAGE_MFA,
      // manage mfa always opens in a new tab, so need to fix the uxMode to redirect.
      options: (0, import_objectSpread23.default)((0, import_objectSpread23.default)({}, this.options), {}, {
        uxMode: import_customauth3.UX_MODE.REDIRECT,
        sdkMode: SDK_MODE.DEFAULT,
        redirectUrl: `${this.dashboardUrl}/wallet/account`
      }),
      params: (0, import_objectSpread23.default)((0, import_objectSpread23.default)((0, import_objectSpread23.default)({}, defaultParams), params), {}, {
        authConnection: this.state.userInfo.authConnection,
        authConnectionId: this.state.userInfo.authConnectionId,
        groupedAuthConnectionId: this.state.userInfo.groupedAuthConnectionId,
        extraLoginOptions: {
          login_hint: this.state.userInfo.userId
        },
        appState: jsonToBase64({
          loginId,
          recordId
        })
      }),
      sessionId: this.sessionId,
      accessToken: await this.getAccessToken()
    };
    this.storeAuthPayload(loginId, dataObject, dataObject.options.sessionTime, true);
    const configParams = {
      loginId,
      recordId,
      sessionNamespace: this.options.sessionNamespace,
      storageServerUrl: this.options.storageServerUrl,
      loginSource: params.loginSource
    };
    const loginUrl = (0, import_customauth3.constructURL)({
      baseURL: `${this.baseUrl}/start`,
      hash: {
        b64Params: jsonToBase64(configParams)
      }
    });
    window.open(loginUrl, "_blank");
  }
  async manageSocialFactor(actionType, params) {
    if (!this.sessionId) throw LoginError.userNotLoggedIn();
    await this.refreshSession();
    const dataObject = {
      actionType,
      options: (0, import_objectSpread23.default)((0, import_objectSpread23.default)({}, this.options), {}, {
        sdkMode: SDK_MODE.DEFAULT
      }),
      params: (0, import_objectSpread23.default)({}, params),
      sessionId: this.sessionId,
      accessToken: await this.getAccessToken()
    };
    const result = await this.authHandler(`${this.baseUrl}/start`, dataObject);
    if (!result) return false;
    if (isAuthFlowError(result)) return false;
    return true;
  }
  async addAuthenticatorFactor(params) {
    if (!this.sessionId) throw LoginError.userNotLoggedIn();
    await this.refreshSession();
    const dataObject = {
      actionType: AUTH_ACTIONS.ADD_AUTHENTICATOR_FACTOR,
      options: (0, import_objectSpread23.default)((0, import_objectSpread23.default)({}, this.options), {}, {
        sdkMode: SDK_MODE.DEFAULT
      }),
      params: (0, import_objectSpread23.default)((0, import_objectSpread23.default)({}, params), {}, {
        authConnection: import_customauth3.AUTH_CONNECTION.AUTHENTICATOR
      }),
      sessionId: this.sessionId,
      accessToken: await this.getAccessToken()
    };
    const result = await this.authHandler(`${this.baseUrl}/start`, dataObject);
    if (!result) return false;
    if (isAuthFlowError(result)) return false;
    return true;
  }
  async addPasskeyFactor(params) {
    if (!this.sessionId) throw LoginError.userNotLoggedIn();
    await this.refreshSession();
    const dataObject = {
      actionType: AUTH_ACTIONS.ADD_PASSKEY_FACTOR,
      options: (0, import_objectSpread23.default)((0, import_objectSpread23.default)({}, this.options), {}, {
        sdkMode: SDK_MODE.DEFAULT
      }),
      params: (0, import_objectSpread23.default)((0, import_objectSpread23.default)({}, params), {}, {
        authConnection: import_customauth3.AUTH_CONNECTION.PASSKEYS
      }),
      sessionId: this.sessionId,
      accessToken: await this.getAccessToken()
    };
    const result = await this.authHandler(`${this.baseUrl}/start`, dataObject);
    if (!result) return false;
    if (isAuthFlowError(result)) return false;
    return true;
  }
  async cleanup() {
    if (this.authProvider) this.authProvider.cleanup();
  }
  async getUserInfo() {
    if (!this.sessionId) {
      throw LoginError.userNotLoggedIn();
    }
    return (0, import_objectSpread23.default)((0, import_objectSpread23.default)({}, this.state.userInfo), {}, {
      idToken: await this.sessionManager.getIdToken()
    });
  }
  async getAccessToken() {
    if (!this.sessionId) {
      throw LoginError.userNotLoggedIn();
    }
    const token = await this.sessionManager.getAccessToken();
    if (!token) throw LoginError.userNotLoggedIn();
    return token;
  }
  async refreshSession() {
    const data = await this._authorizeSession();
    if (!data || Object.keys(data).length === 0) {
      try {
        await this.sessionManager.logout();
      } catch {
      }
      this.clearState();
      throw LoginError.userNotLoggedIn();
    }
    this.updateState(data);
  }
  async storeAuthPayload(loginId, payload, timeout = 600, skipAwait = false) {
    if (!this.sessionManager) throw InitializationError.notInitialized();
    const authRequestStorageManager = new import_session_manager.StorageManager({
      sessionServerBaseUrl: payload.options.storageServerUrl,
      sessionNamespace: payload.options.sessionNamespace,
      sessionTime: timeout,
      // each login key must be used with 10 mins (might be used at the end of popup redirect)
      sessionId: loginId,
      allowedOrigin: this.options.sdkUrl
    });
    const promise = authRequestStorageManager.createSession(klona(payload));
    if (payload.options.uxMode === import_customauth3.UX_MODE.REDIRECT && !skipAwait) {
      await promise;
    }
  }
  async _authorizeSession() {
    try {
      const result = await this.sessionManager.authorize();
      return result;
    } catch (err) {
      log.error("authorization failed", err);
      return null;
    }
  }
  clearState() {
    this.updateState({
      privKey: "",
      coreKitKey: "",
      coreKitEd25519PrivKey: "",
      ed25519PrivKey: "",
      walletKey: "",
      oAuthPrivateKey: "",
      tKey: "",
      metadataNonce: "",
      keyMode: void 0,
      userInfo: {
        name: "",
        profileImage: "",
        dappShare: "",
        idToken: "",
        oAuthIdToken: "",
        oAuthAccessToken: "",
        appState: "",
        email: "",
        authConnectionId: "",
        userId: "",
        groupedAuthConnectionId: "",
        authConnection: "",
        isMfaEnabled: false
      },
      authToken: "",
      sessionId: "",
      signatures: []
    });
  }
  updateState(data) {
    this.state = (0, import_objectSpread23.default)((0, import_objectSpread23.default)({}, this.state), data);
  }
  async authHandler(url, dataObject, popupTimeout = 1e3 * 10) {
    const loginId = import_session_manager.StorageManager.generateRandomSessionKey();
    const recordId = generateRecordId();
    await this.storeAuthPayload(loginId, dataObject);
    const configParams = {
      loginId,
      recordId,
      sessionNamespace: this.options.sessionNamespace,
      storageServerUrl: this.options.storageServerUrl,
      loginSource: dataObject.params.loginSource
    };
    if (this.options.uxMode === import_customauth3.UX_MODE.REDIRECT) {
      const loginUrl2 = (0, import_customauth3.constructURL)({
        baseURL: url,
        hash: {
          b64Params: jsonToBase64(configParams)
        }
      });
      window.location.href = loginUrl2;
      return null;
    }
    const loginUrl = (0, import_customauth3.constructURL)({
      baseURL: url,
      hash: {
        b64Params: jsonToBase64(configParams)
      }
    });
    const currentWindow = new PopupHandler({
      url: loginUrl,
      timeout: popupTimeout,
      serverUrl: this.options.storageServerUrl,
      socketUrl: this.options.sessionSocketUrl
    });
    return new Promise((resolve, reject) => {
      currentWindow.on("close", () => {
        reject(LoginError.popupClosed());
      });
      currentWindow.listenOnChannel(loginId).then(resolve).catch(reject);
      try {
        currentWindow.open();
      } catch (error) {
        reject(error);
      }
    });
  }
};

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/jrpc/basePostMessageStream.js
var import_objectSpread24 = __toESM(require_objectSpread2());
var import_defineProperty5 = __toESM(require_defineProperty());
var import_readable_stream = __toESM(require_ours());
function noop() {
  return void 0;
}
var SYN = "SYN";
var ACK = "ACK";
function isValidStreamMessage(message) {
  return typeof message === "object" && message !== null && Boolean(message.data) && (typeof message.data === "number" || typeof message.data === "object" || typeof message.data === "string");
}
var BasePostMessageStream = class extends import_readable_stream.Duplex {
  constructor(streamOptions) {
    super((0, import_objectSpread24.default)({
      objectMode: true
    }, streamOptions));
    (0, import_defineProperty5.default)(this, "_init", void 0);
    (0, import_defineProperty5.default)(this, "_haveSyn", void 0);
    (0, import_defineProperty5.default)(this, "_log", void 0);
    this._init = false;
    this._haveSyn = false;
    this._log = () => null;
  }
  _read() {
    return void 0;
  }
  _write(data, _encoding, cb) {
    if (data !== ACK && data !== SYN) {
      this._log(data, true);
    }
    this._postMessage(data);
    cb();
  }
  _setLogger(log2) {
    this._log = log2;
  }
  _handshake() {
    this._write(SYN, null, noop);
    this.cork();
  }
  _onData(data) {
    if (this._init) {
      try {
        this.push(data);
        this._log(data, false);
      } catch (err) {
        this.emit("error", err);
      }
    } else if (data === SYN) {
      this._haveSyn = true;
      this._write(ACK, null, noop);
    } else if (data === ACK) {
      this._init = true;
      if (!this._haveSyn) {
        this._write(ACK, null, noop);
      }
      this.uncork();
    }
  }
};

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/jrpc/errors/error-classes.js
var import_objectSpread26 = __toESM(require_objectSpread2());
var import_defineProperty6 = __toESM(require_defineProperty());
var import_json_stable_stringify = __toESM(require_json_stable_stringify());

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/jrpc/errors/utils.js
var import_objectSpread25 = __toESM(require_objectSpread2());

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/jrpc/errors/error-constants.js
var errorCodes = {
  rpc: {
    invalidInput: -32e3,
    resourceNotFound: -32001,
    resourceUnavailable: -32002,
    transactionRejected: -32003,
    methodNotSupported: -32004,
    limitExceeded: -32005,
    parse: -32700,
    invalidRequest: -32600,
    methodNotFound: -32601,
    invalidParams: -32602,
    internal: -32603
  },
  provider: {
    userRejectedRequest: 4001,
    unauthorized: 4100,
    unsupportedMethod: 4200,
    disconnected: 4900,
    chainDisconnected: 4901
  }
};
var errorValues = {
  "-32700": {
    standard: "JSON RPC 2.0",
    message: "Invalid JSON was received by the server. An error occurred on the server while parsing the JSON text."
  },
  "-32600": {
    standard: "JSON RPC 2.0",
    message: "The JSON sent is not a valid Request object."
  },
  "-32601": {
    standard: "JSON RPC 2.0",
    message: "The method does not exist / is not available."
  },
  "-32602": {
    standard: "JSON RPC 2.0",
    message: "Invalid method parameter(s)."
  },
  "-32603": {
    standard: "JSON RPC 2.0",
    message: "Internal JSON-RPC error."
  },
  "-32000": {
    standard: "EIP-1474",
    message: "Invalid input."
  },
  "-32001": {
    standard: "EIP-1474",
    message: "Resource not found."
  },
  "-32002": {
    standard: "EIP-1474",
    message: "Resource unavailable."
  },
  "-32003": {
    standard: "EIP-1474",
    message: "Transaction rejected."
  },
  "-32004": {
    standard: "EIP-1474",
    message: "Method not supported."
  },
  "-32005": {
    standard: "EIP-1474",
    message: "Request limit exceeded."
  },
  "4001": {
    standard: "EIP-1193",
    message: "User rejected the request."
  },
  "4100": {
    standard: "EIP-1193",
    message: "The requested account and/or method has not been authorized by the user."
  },
  "4200": {
    standard: "EIP-1193",
    message: "The requested method is not supported by this Ethereum provider."
  },
  "4900": {
    standard: "EIP-1193",
    message: "The provider is disconnected from all chains."
  },
  "4901": {
    standard: "EIP-1193",
    message: "The provider is disconnected from the specified chain."
  }
};

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/jrpc/errors/utils.js
var _objectHasOwn = function(object, property) {
  if (typeof object === "undefined" || object === null) {
    throw new TypeError("Cannot convert undefined or null to object");
  }
  return Object.prototype.hasOwnProperty.call(Object(object), property);
};
var FALLBACK_ERROR_CODE = errorCodes.rpc.internal;
var FALLBACK_MESSAGE = "Unspecified error message. This is a bug, please report it.";
var JSON_RPC_SERVER_ERROR_MESSAGE = "Unspecified server error.";
function isValidNumber(value) {
  try {
    if (typeof value === "number" && Number.isInteger(value)) {
      return true;
    }
    const parsedValue = Number(value.toString());
    return Number.isInteger(parsedValue);
  } catch {
    return false;
  }
}
function isValidCode(code) {
  return Number.isInteger(code);
}
function isValidString(value) {
  return typeof value === "string" && value.length > 0;
}
function isPlainObject(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  try {
    let proto = value;
    while (Object.getPrototypeOf(proto) !== null) {
      proto = Object.getPrototypeOf(proto);
    }
    return Object.getPrototypeOf(value) === proto;
  } catch {
    return false;
  }
}
function isJsonRpcServerError(code) {
  return code >= -32099 && code <= -32e3;
}
function isJsonRpcError(value) {
  const castValue = value;
  if (!castValue) return false;
  if (!isValidCode(castValue.code) || !isValidString(castValue.message)) return false;
  if (castValue.stack && !isValidString(castValue.stack)) return false;
  return true;
}
function getMessageFromCode(code, fallbackMessage = FALLBACK_MESSAGE) {
  if (isValidCode(code)) {
    const codeString = code.toString();
    if (_objectHasOwn(errorValues, codeString)) {
      return errorValues[codeString].message;
    }
    if (isJsonRpcServerError(code)) {
      return JSON_RPC_SERVER_ERROR_MESSAGE;
    }
  }
  return fallbackMessage;
}
var FALLBACK_ERROR = {
  code: FALLBACK_ERROR_CODE,
  message: getMessageFromCode(FALLBACK_ERROR_CODE)
};
function isValidJson(str) {
  try {
    JSON.parse(JSON.stringify(str, (strKey, strVal) => {
      if (strKey === "__proto__" || strKey === "constructor") {
        throw new Error("Not valid json");
      }
      if (typeof strVal === "function" || typeof strVal === "symbol") {
        throw new Error("Not valid json");
      }
      return strVal;
    }), (propKey, propValue) => {
      if (propKey === "__proto__" || propKey === "constructor") {
        return void 0;
      }
      return propValue;
    });
  } catch {
    return false;
  }
  return true;
}
function serializeObject(object) {
  return Object.getOwnPropertyNames(object).reduce((acc, key) => {
    const value = object[key];
    if (isValidJson(value)) {
      acc[key] = value;
    }
    return acc;
  }, {});
}
function serializeCause(error) {
  if (Array.isArray(error)) {
    return error.map((entry) => {
      if (isValidJson(entry)) {
        return entry;
      } else if (isObject(entry)) {
        return serializeObject(entry);
      }
      return null;
    });
  } else if (isObject(error)) {
    return serializeObject(error);
  }
  if (isValidJson(error)) {
    return error;
  }
  return null;
}
function getOriginalMessage(error) {
  if (isObject(error) && hasProperty(error, "message") && typeof error.message === "string" && error.message.length > 0) {
    return error.message;
  }
  return void 0;
}
function buildError(error, fallbackError, shouldPreserveMessage) {
  if (error && typeof error === "object" && "serialize" in error && typeof error.serialize === "function") {
    return error.serialize();
  }
  if (isJsonRpcError(error)) {
    return error;
  }
  const originalMessage = getOriginalMessage(error);
  const cause = serializeCause(error);
  const fallbackWithCause = (0, import_objectSpread25.default)((0, import_objectSpread25.default)((0, import_objectSpread25.default)({}, fallbackError), shouldPreserveMessage && originalMessage && {
    message: originalMessage
  }), {}, {
    data: {
      cause
    }
  });
  return fallbackWithCause;
}
function serializeJrpcError(error, {
  fallbackError = FALLBACK_ERROR,
  shouldIncludeStack = true,
  shouldPreserveMessage = true
} = {}) {
  if (!isJsonRpcError(fallbackError)) {
    throw new Error("Must provide fallback error with integer number code and string message.");
  }
  const serialized = buildError(error, fallbackError, shouldPreserveMessage);
  if (!shouldIncludeStack) {
    delete serialized.stack;
  }
  return serialized;
}
function dataHasCause(data) {
  return isObject(data) && _objectHasOwn(data, "cause") && isObject(data.cause);
}

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/jrpc/errors/error-classes.js
var _objectHasOwn2 = function(object, property) {
  if (typeof object === "undefined" || object === null) {
    throw new TypeError("Cannot convert undefined or null to object");
  }
  return Object.prototype.hasOwnProperty.call(Object(object), property);
};
function isValidEthProviderCode(code) {
  return Number.isInteger(code) && code >= 1e3 && code <= 4999;
}
function stringifyReplacer(_2, value) {
  if (value === "[Circular]") {
    return void 0;
  }
  return value;
}
var JsonRpcError = class extends Error {
  constructor(code, message, data) {
    if (!Number.isInteger(code)) {
      throw new Error('"code" must be an integer.');
    }
    if (!message || typeof message !== "string") {
      throw new Error('"message" must be a non-empty string.');
    }
    if (dataHasCause(data)) {
      super(message, {
        cause: data.cause
      });
      (0, import_defineProperty6.default)(this, "cause", void 0);
      (0, import_defineProperty6.default)(this, "code", void 0);
      (0, import_defineProperty6.default)(this, "data", void 0);
      if (!_objectHasOwn2(this, "cause")) {
        Object.assign(this, {
          cause: data.cause
        });
      }
    } else {
      super(message);
      (0, import_defineProperty6.default)(this, "cause", void 0);
      (0, import_defineProperty6.default)(this, "code", void 0);
      (0, import_defineProperty6.default)(this, "data", void 0);
    }
    if (data !== void 0) {
      this.data = data;
    }
    this.code = code;
    this.cause = data === null || data === void 0 ? void 0 : data.cause;
  }
  /**
   * Get the error as JSON-serializable object.
   *
   * @returns A plain object with all public class properties.
   */
  serialize() {
    const serialized = {
      code: this.code,
      message: this.message
    };
    if (this.data !== void 0) {
      if (isPlainObject(this.data)) {
        serialized.data = (0, import_objectSpread26.default)((0, import_objectSpread26.default)({}, this.data), {}, {
          cause: serializeCause(this.data.cause)
        });
      } else {
        serialized.data = this.data;
      }
    }
    if (this.stack) {
      serialized.stack = this.stack;
    }
    return serialized;
  }
  /**
   * Get a string representation of the serialized error, omitting any circular
   * references.
   *
   * @returns A string representation of the serialized error.
   */
  toString() {
    return (0, import_json_stable_stringify.default)(this.serialize(), {
      replacer: stringifyReplacer,
      space: 2
    });
  }
};
var EthereumProviderError = class extends JsonRpcError {
  /**
   * Create an Ethereum Provider JSON-RPC error.
   *
   * @param code - The JSON-RPC error code. Must be an integer in the
   * `1000 <= n <= 4999` range.
   * @param message - The JSON-RPC error message.
   * @param data - Optional data to include in the error.
   */
  constructor(code, message, data) {
    if (!isValidEthProviderCode(code)) {
      throw new Error('"code" must be an integer such that: 1000 <= code <= 4999');
    }
    super(code, message, data);
  }
};

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/jrpc/mux.js
var import_objectSpread28 = __toESM(require_objectSpread2());
var import_defineProperty8 = __toESM(require_defineProperty());
var import_once = __toESM(require_once());
var import_readable_stream3 = __toESM(require_ours());

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/jrpc/substream.js
var import_objectSpread27 = __toESM(require_objectSpread2());
var import_objectWithoutProperties = __toESM(require_objectWithoutProperties());
var import_defineProperty7 = __toESM(require_defineProperty());
var import_readable_stream2 = __toESM(require_ours());
var _excluded = ["parent", "name"];
var Substream = class extends import_readable_stream2.Duplex {
  constructor(_ref) {
    let {
      parent,
      name
    } = _ref, streamOptions = (0, import_objectWithoutProperties.default)(_ref, _excluded);
    super((0, import_objectSpread27.default)({
      objectMode: true
    }, streamOptions));
    (0, import_defineProperty7.default)(this, "_parent", void 0);
    (0, import_defineProperty7.default)(this, "_name", void 0);
    this._parent = parent;
    this._name = name;
  }
  /**
   * Explicitly sets read operations to a no-op.
   */
  _read() {
    return void 0;
  }
  /**
   * Called when data should be written to this writable stream.
   *
   * @param chunk - Arbitrary object to write
   * @param encoding - Encoding to use when writing payload
   * @param callback - Called when writing is complete or an error occurs
   */
  _write(chunk, _encoding, callback) {
    this._parent.push({
      name: this._name,
      data: chunk
    });
    callback();
  }
};

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/jrpc/mux.js
var IGNORE_SUBSTREAM = /* @__PURE__ */ Symbol("IGNORE_SUBSTREAM");
var ObjectMultiplex = class extends import_readable_stream3.Duplex {
  constructor(opts = {}) {
    super((0, import_objectSpread28.default)({
      objectMode: true
    }, opts));
    (0, import_defineProperty8.default)(this, "_substreams", void 0);
    this._substreams = {};
  }
  createStream(name, opts = {}) {
    if (this.destroyed) {
      throw new Error(`ObjectMultiplex - parent stream for name "${name}" already destroyed`);
    }
    if (this._readableState.ended || this._writableState.ended) {
      throw new Error(`ObjectMultiplex - parent stream for name "${name}" already ended`);
    }
    if (!name) {
      throw new Error("ObjectMultiplex - name must not be empty");
    }
    if (this._substreams[name]) {
      throw new Error(`ObjectMultiplex - Substream for name "${name}" already exists`);
    }
    const substream = new Substream((0, import_objectSpread28.default)({
      parent: this,
      name
    }, opts));
    this._substreams[name] = substream;
    anyStreamEnd(this, (_error) => substream.destroy(_error || void 0));
    return substream;
  }
  ignoreStream(name) {
    if (!name) {
      throw new Error("ObjectMultiplex - name must not be empty");
    }
    if (this._substreams[name]) {
      throw new Error(`ObjectMultiplex - Substream for name "${name}" already exists`);
    }
    this._substreams[name] = IGNORE_SUBSTREAM;
  }
  _read() {
    return void 0;
  }
  _write(chunk, _encoding, callback) {
    const {
      name,
      data
    } = chunk;
    if (!name) {
      console.warn(`ObjectMultiplex - malformed chunk without name "${chunk}"`);
      return callback();
    }
    const substream = this._substreams[name];
    if (!substream) {
      console.warn(`ObjectMultiplex - orphaned data for stream "${name}"`);
      return callback();
    }
    if (substream !== IGNORE_SUBSTREAM) {
      substream.push(data);
    }
    return callback();
  }
};
function anyStreamEnd(stream, _cb) {
  const cb = (0, import_once.default)(_cb);
  (0, import_readable_stream3.finished)(stream, {
    readable: false
  }, cb);
  (0, import_readable_stream3.finished)(stream, {
    writable: false
  }, cb);
}
function setupMultiplex(stream) {
  const mux = new ObjectMultiplex();
  (0, import_readable_stream3.pipeline)(stream, mux, stream, (err) => {
    var _err$message;
    if (err && !((_err$message = err.message) !== null && _err$message !== void 0 && _err$message.match("Premature close"))) {
      console.error(err);
    }
  });
  return mux;
}

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/jrpc/jrpcEngine.js
var import_objectSpread29 = __toESM(require_objectSpread2());
var import_defineProperty10 = __toESM(require_defineProperty());
var import_readable_stream4 = __toESM(require_ours());

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/utils/jrpc.js
var import_json_stable_stringify2 = __toESM(require_json_stable_stringify());
function isValidJson2(value) {
  if (value === null) {
    return true;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((entry) => isValidJson2(entry));
  }
  if (isObject(value)) {
    return Object.values(value).every((entry) => isValidJson2(entry));
  }
  return false;
}
function stringify4(value) {
  return (0, import_json_stable_stringify2.default)(value, {
    space: 2
  });
}
function isJRPCNotification(request) {
  return !hasProperty(request, "id") || request.id === void 0;
}
function isJRPCRequest(request) {
  return hasProperty(request, "id") && request.id !== void 0;
}
function isRequest(message) {
  return hasProperty(message, "id");
}
function isNotification(message) {
  return !isRequest(message);
}
function isValidMethod(request) {
  return typeof request.method === "string" && request.method.length > 0;
}
function isJRPCSuccess(response) {
  return "result" in response;
}
function isJRPCFailure(response) {
  return "error" in response;
}
function isInstance(value, symbol) {
  return isObject(value) && symbol in value && value[symbol] === true;
}
var MAX = 4294967295;
var idCounter = Math.floor(Math.random() * MAX);
function getUniqueId() {
  idCounter = (idCounter + 1) % MAX;
  return idCounter;
}
function isIterable(value) {
  return Symbol.iterator in value;
}
function entriesFromKeyValues(keyValues) {
  return Reflect.ownKeys(keyValues).map((key) => [key, keyValues[key]]);
}

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/jrpc/safeEventEmitter.js
import { EventEmitter as EventEmitter2 } from "events";
function safeApply(handler, context, args) {
  try {
    Reflect.apply(handler, context, args);
  } catch (err) {
    setTimeout(() => {
      throw err;
    });
  }
}
function arrayClone(arr) {
  const n = arr.length;
  const copy = new Array(n);
  for (let i2 = 0; i2 < n; i2 += 1) {
    copy[i2] = arr[i2];
  }
  return copy;
}
var SafeEventEmitter = class extends EventEmitter2 {
  emit(type, ...args) {
    let doError = type === "error";
    const events = this._events;
    if (events !== void 0) {
      doError = doError && events.error === void 0;
    } else if (!doError) {
      return false;
    }
    if (doError) {
      let er;
      if (args.length > 0) {
        [er] = args;
      }
      if (er instanceof Error) {
        throw er;
      }
      const err = new Error(`Unhandled error.${er ? ` (${er.message})` : ""}`);
      err.context = er;
      throw err;
    }
    const handler = events[type];
    if (handler === void 0) {
      return false;
    }
    if (typeof handler === "function") {
      safeApply(handler, this, args);
    } else {
      const len = handler.length;
      const listeners = arrayClone(handler);
      for (let i2 = 0; i2 < len; i2 += 1) {
        safeApply(listeners[i2], this, args);
      }
    }
    return true;
  }
};

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/jrpc/serializableError.js
var import_defineProperty9 = __toESM(require_defineProperty());
var import_json_stable_stringify3 = __toESM(require_json_stable_stringify());
var SerializableError = class extends Error {
  constructor({
    code,
    message,
    data
  }) {
    if (!Number.isInteger(code)) {
      throw new Error("code must be an integer");
    }
    if (!message || typeof message !== "string") {
      throw new Error("message must be string");
    }
    super(message);
    (0, import_defineProperty9.default)(this, "code", void 0);
    (0, import_defineProperty9.default)(this, "data", void 0);
    this.code = code;
    if (data !== void 0) {
      this.data = data;
    }
  }
  toString() {
    return (0, import_json_stable_stringify3.default)({
      code: this.code,
      message: this.message,
      data: this.data,
      stack: this.stack
    });
  }
};

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/jrpc/jrpcEngine.js
function constructFallbackError(error) {
  const {
    message = "",
    code = errorCodes.rpc.internal,
    stack = "Stack trace is not available.",
    data = ""
  } = error;
  const codeNumber = isValidNumber(code) ? parseInt(code.toString()) : errorCodes.rpc.internal;
  return {
    message: message || (error === null || error === void 0 ? void 0 : error.toString()) || getMessageFromCode(codeNumber),
    code: codeNumber,
    stack,
    data: data || message || (error === null || error === void 0 ? void 0 : error.toString())
  };
}
var JRPCEngine = class _JRPCEngine extends SafeEventEmitter {
  constructor() {
    super();
    (0, import_defineProperty10.default)(this, "_middleware", void 0);
    this._middleware = [];
  }
  /**
   * Serially executes the given stack of middleware.
   *
   * @returns An array of any error encountered during middleware execution,
   * a boolean indicating whether the request was completed, and an array of
   * middleware-defined return handlers.
   */
  static async _runAllMiddleware(req, res, middlewareStack) {
    const returnHandlers = [];
    let error = null;
    let isComplete = false;
    for (const middleware of middlewareStack) {
      [error, isComplete] = await _JRPCEngine._runMiddleware(req, res, middleware, returnHandlers);
      if (isComplete) {
        break;
      }
    }
    return [error, isComplete, returnHandlers.reverse()];
  }
  /**
   * Runs an individual middleware.
   *
   * @returns An array of any error encountered during middleware execution,
   * and a boolean indicating whether the request should end.
   */
  static _runMiddleware(req, res, middleware, returnHandlers) {
    return new Promise((resolve) => {
      const end = (err) => {
        const error = err || res.error;
        if (error) {
          if (typeof error === "object" && Object.keys(error).includes("stack") === false) error.stack = "Stack trace is not available.";
          log.error(error);
          res.error = serializeJrpcError(error, {
            shouldIncludeStack: true,
            fallbackError: constructFallbackError(error)
          });
        }
        resolve([error, true]);
      };
      const next = (returnHandler) => {
        if (res.error) {
          end(res.error);
        } else {
          if (returnHandler) {
            if (typeof returnHandler !== "function") {
              end(new SerializableError({
                code: errorCodes.rpc.internal,
                message: "JRPCEngine: 'next' return handlers must be functions"
              }));
            }
            returnHandlers.push(returnHandler);
          }
          resolve([null, false]);
        }
      };
      try {
        middleware(req, res, next, end);
      } catch (error) {
        end(error);
      }
    });
  }
  /**
   * Serially executes array of return handlers. The request and response are
   * assumed to be in their scope.
   */
  static async _runReturnHandlers(handlers) {
    for (const handler of handlers) {
      await new Promise((resolve, reject) => {
        handler((err) => err ? reject(err) : resolve());
      });
    }
  }
  /**
   * Throws an error if the response has neither a result nor an error, or if
   * the "isComplete" flag is falsy.
   */
  static _checkForCompletion(_req, res, isComplete) {
    if (!isJRPCSuccess(res) && !isJRPCFailure(res)) {
      throw new SerializableError({
        code: errorCodes.rpc.internal,
        message: "Response has no error or result for request"
      });
    }
    if (!isComplete) {
      throw new SerializableError({
        code: errorCodes.rpc.internal,
        message: "Nothing ended request"
      });
    }
  }
  /**
   * Add a middleware function to the engine's middleware stack.
   *
   * @param middleware - The middleware function to add.
   */
  push(middleware) {
    this._middleware.push(middleware);
  }
  /**
   * Handle a JSON-RPC request, and return a response.
   *
   * @param request - The request to handle.
   * @param callback - An error-first callback that will receive the response.
   */
  /**
   * Handle an array of JSON-RPC requests, and return an array of responses.
   *
   * @param request - The requests to handle.
   * @param callback - An error-first callback that will receive the array of
   * responses.
   */
  /**
   * Handle a JSON-RPC request, and return a response.
   *
   * @param request - The request to handle.
   * @returns A promise that resolves with the response, or rejects with an
   * error.
   */
  /**
   * Handle an array of JSON-RPC requests, and return an array of responses.
   *
   * @param request - The requests to handle.
   * @returns A promise that resolves with the array of responses, or rejects
   * with an error.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle(req, cb) {
    if (cb && typeof cb !== "function") {
      throw new Error('"callback" must be a function if provided.');
    }
    if (Array.isArray(req)) {
      if (cb) {
        return this._handleBatch(req, cb);
      }
      return this._handleBatch(req);
    }
    if (cb) {
      return this._handle(req, cb);
    }
    return this._promiseHandle(req);
  }
  /**
   * Returns this engine as a middleware function that can be pushed to other
   * engines.
   *
   * @returns This engine as a middleware function.
   */
  asMiddleware() {
    return async (req, res, next, end) => {
      try {
        const [middlewareError, isComplete, returnHandlers] = await _JRPCEngine._runAllMiddleware(req, res, this._middleware);
        if (isComplete) {
          await _JRPCEngine._runReturnHandlers(returnHandlers);
          return end(middlewareError);
        }
        return next(async (handlerCallback) => {
          try {
            await _JRPCEngine._runReturnHandlers(returnHandlers);
          } catch (error) {
            return handlerCallback(error);
          }
          return handlerCallback();
        });
      } catch (error) {
        return end(error);
      }
    };
  }
  /**
   * Like _handle, but for batch requests.
   */
  /**
   * Like _handle, but for batch requests.
   */
  async _handleBatch(reqs, cb) {
    try {
      if (reqs.length === 0) {
        const error = new SerializableError({
          code: errorCodes.rpc.invalidRequest,
          message: "Request batch must contain plain objects. Received an empty array"
        });
        const response = [{
          id: void 0,
          jsonrpc: "2.0",
          error
        }];
        if (cb) {
          return cb(error, response);
        }
        return response;
      }
      const responses = (await Promise.all(
        // 1. Begin executing each request in the order received
        reqs.map(this._promiseHandle.bind(this))
      )).filter((response) => response !== void 0);
      if (cb) {
        return cb(null, responses);
      }
      return responses;
    } catch (error) {
      if (cb) {
        return cb(error);
      }
      throw error;
    }
  }
  /**
   * A promise-wrapped _handle.
   */
  _promiseHandle(req) {
    return new Promise((resolve, reject) => {
      this._handle(req, (_err, res) => {
        if (_err && res === void 0) {
          reject(_err);
        } else resolve(res);
      }).catch(reject);
    });
  }
  /**
   * Ensures that the request object is valid, processes it, and passes any
   * error and the response object to the given callback.
   *
   * Does not reject.
   */
  async _handle(callerReq, cb) {
    if (!callerReq || Array.isArray(callerReq) || typeof callerReq !== "object") {
      const error2 = new SerializableError({
        code: errorCodes.rpc.invalidRequest,
        message: `Requests must be plain objects. Received: ${typeof callerReq}`
      });
      return cb(error2, {
        id: void 0,
        jsonrpc: "2.0",
        error: error2
      });
    }
    if (!isValidMethod(callerReq)) {
      const error2 = new SerializableError({
        code: errorCodes.rpc.invalidRequest,
        message: `Must specify a string method. Received: ${typeof callerReq.method}`
      });
      return cb(error2, {
        id: callerReq.id,
        jsonrpc: "2.0",
        error: error2
      });
    }
    const req = (0, import_objectSpread29.default)({}, callerReq);
    const res = {
      id: req.id,
      jsonrpc: req.jsonrpc
    };
    let error = null;
    try {
      await this._processRequest(req, res);
    } catch (_error) {
      error = _error;
    }
    if (error) {
      delete res.result;
      if (!res.error) {
        log.error(error);
        res.error = serializeJrpcError(error, {
          shouldIncludeStack: true,
          fallbackError: constructFallbackError(error)
        });
      }
    }
    return cb(error, res);
  }
  /**
   * For the given request and response, runs all middleware and their return
   * handlers, if any, and ensures that internal request processing semantics
   * are satisfied.
   */
  async _processRequest(req, res) {
    const [error, isComplete, returnHandlers] = await _JRPCEngine._runAllMiddleware(req, res, this._middleware);
    _JRPCEngine._checkForCompletion(req, res, isComplete);
    await _JRPCEngine._runReturnHandlers(returnHandlers);
    if (error) {
      throw error;
    }
  }
};
function mergeMiddleware(middlewareStack) {
  const engine = new JRPCEngine();
  middlewareStack.forEach((middleware) => {
    engine.push(middleware);
  });
  return engine.asMiddleware();
}
function createEngineStream(opts) {
  if (!opts || !opts.engine) {
    throw new Error("Missing engine parameter!");
  }
  const {
    engine
  } = opts;
  let stream;
  function read() {
    return void 0;
  }
  function write(req, _encoding, cb) {
    engine.handle(req, (_err, res) => {
      stream.push(res);
    });
    cb();
  }
  stream = new import_readable_stream4.Duplex({
    objectMode: true,
    read,
    write
  });
  if (engine.on) {
    const onNotification = (message) => {
      stream.push(message);
    };
    const cleanup = () => {
      engine.removeListener("notification", onNotification);
    };
    engine.on("notification", onNotification);
    stream.once("close", cleanup);
  }
  return stream;
}
function providerFromEngine(engine) {
  const provider = new SafeEventEmitter();
  provider.sendAsync = async (req) => {
    const res = await engine.handle(req);
    if (res.error) {
      var _err$code, _err$message;
      if (typeof res.error === "object" && Object.keys(res.error).includes("stack") === false) res.error.stack = "Stack trace is not available.";
      log.error(res.error);
      const err = serializeJrpcError(res.error, {
        fallbackError: constructFallbackError(res.error),
        shouldIncludeStack: true
      });
      const errorCode = (_err$code = err === null || err === void 0 ? void 0 : err.code) !== null && _err$code !== void 0 ? _err$code : errorCodes.rpc.internal;
      const error = new JsonRpcError(errorCode, (_err$message = err === null || err === void 0 ? void 0 : err.message) !== null && _err$message !== void 0 ? _err$message : getMessageFromCode(errorCode), err === null || err === void 0 ? void 0 : err.data);
      throw error;
    }
    return res.result;
  };
  provider.send = (req, callback) => {
    if (typeof callback !== "function") {
      throw new Error('Must provide callback to "send" method.');
    }
    engine.handle(req, callback);
  };
  if (engine.on) {
    engine.on("notification", (message) => {
      provider.emit("data", null, message);
    });
  }
  provider.request = async (args) => {
    const req = (0, import_objectSpread29.default)((0, import_objectSpread29.default)({}, args), {}, {
      id: Math.random().toString(36).slice(2),
      jsonrpc: "2.0"
    });
    const res = await provider.sendAsync(req);
    return res;
  };
  return provider;
}
function providerFromMiddleware(middleware) {
  const engine = new JRPCEngine();
  engine.push(middleware);
  const provider = providerFromEngine(engine);
  return provider;
}
function providerAsMiddleware(provider) {
  return async (req, res, _next, end) => {
    try {
      const providerRes = await provider.sendAsync(req);
      res.result = providerRes;
      return end();
    } catch (error) {
      return end(error);
    }
  };
}

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/jrpc/v2/jrpcEngineV2.js
var import_classPrivateFieldInitSpec = __toESM(require_classPrivateFieldInitSpec());
var import_deep_freeze_strict = __toESM(require_deep_freeze_strict());

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/jrpc/v2/MiddlewareContext.js
var import_defineProperty11 = __toESM(require_defineProperty());
var MiddlewareContextSymbol = /* @__PURE__ */ Symbol.for("json-rpc-engine#MiddlewareContext");
var MiddlewareContext = class extends Map {
  constructor(entries) {
    super(entries && isIterable(entries) ? entries : entriesFromKeyValues(entries !== null && entries !== void 0 ? entries : {}));
    (0, import_defineProperty11.default)(this, MiddlewareContextSymbol, true);
    Object.freeze(this);
  }
  /**
   * Check if a value is a {@link MiddlewareContext} instance.
   * Works across different package versions in the same realm.
   *
   * @param value - The value to check.
   * @returns Whether the value is a {@link MiddlewareContext} instance.
   */
  static isInstance(value) {
    return isInstance(value, MiddlewareContextSymbol);
  }
  get(key) {
    return super.get(key);
  }
  /**
   * Get a value from the context. Throws if the key is not found.
   *
   * @param key - The key to get the value for.
   * @returns The value.
   */
  assertGet(key) {
    if (!super.has(key)) {
      throw new Error(`Context key "${String(key)}" not found`);
    }
    return super.get(key);
  }
  /**
   * Set a value in the context. Throws if the key already exists.
   * {@link delete} an existing key before setting it to a new value.
   *
   * @throws If the key already exists.
   * @param key - The key to set the value for.
   * @param value - The value to set.
   * @returns The context.
   */
  set(key, value) {
    if (super.has(key)) {
      throw new Error(`MiddlewareContext key "${String(key)}" already exists`);
    }
    super.set(key, value);
    return this;
  }
};

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/jrpc/v2/v2utils.js
var import_defineProperty12 = __toESM(require_defineProperty());
var JsonRpcEngineErrorSymbol = /* @__PURE__ */ Symbol.for("json-rpc-engine#JsonRpcEngineError");
var JsonRpcEngineError = class extends Error {
  constructor(message) {
    super(message);
    (0, import_defineProperty12.default)(this, JsonRpcEngineErrorSymbol, true);
    this.name = "JsonRpcEngineError";
  }
  /**
   * Check if a value is a {@link JsonRpcEngineError} instance.
   * Works across different package versions in the same realm.
   *
   * @param value - The value to check.
   * @returns Whether the value is a {@link JsonRpcEngineError} instance.
   */
  static isInstance(value) {
    return isInstance(value, JsonRpcEngineErrorSymbol);
  }
};

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/jrpc/v2/jrpcEngineV2.js
function _classPrivateFieldGet(s2, a2) {
  return s2.get(_assertClassBrand(s2, a2));
}
function _classPrivateFieldSet(s2, a2, r) {
  return s2.set(_assertClassBrand(s2, a2), r), r;
}
function _assertClassBrand(e, t, n) {
  if ("function" == typeof e ? e === t : e.has(t)) return arguments.length < 3 ? t : n;
  throw new TypeError("Private element is not present on this object");
}
var _middleware = /* @__PURE__ */ new WeakMap();
var _isDestroyed = /* @__PURE__ */ new WeakMap();
var JRPCEngineV2 = class _JRPCEngineV2 {
  // See .create() for why this is private.
  constructor({
    middleware
  }) {
    (0, import_classPrivateFieldInitSpec.default)(this, _middleware, void 0);
    (0, import_classPrivateFieldInitSpec.default)(this, _isDestroyed, false);
    _classPrivateFieldSet(_middleware, this, [...middleware]);
  }
  // We use a static factory method in order to construct a supertype of all middleware contexts,
  // which enables us to instantiate an engine despite different middleware expecting different
  // context types.
  /**
   * Create a new JSON-RPC engine.
   *
   * @throws If the middleware array is empty.
   * @param options - The options for the engine.
   * @param middleware - The middleware to use.
   * @returns The JSON-RPC engine.
   */
  static create({
    middleware
  }) {
    if (middleware.length === 0) {
      throw new JsonRpcEngineError("Middleware array cannot be empty");
    }
    const mw = middleware;
    return new _JRPCEngineV2({
      middleware: mw
    });
  }
  /**
   * Handle a JSON-RPC request.
   *
   * @param request - The JSON-RPC request to handle.
   * @param options - The options for the handle operation.
   * @param options.context - The context to pass to the middleware.
   * @returns The JSON-RPC response.
   */
  /**
   * Handle a JSON-RPC notification. Notifications do not return a result.
   *
   * @param notification - The JSON-RPC notification to handle.
   * @param options - The options for the handle operation.
   * @param options.context - The context to pass to the middleware.
   */
  /**
   * Handle a JSON-RPC call, i.e. request or notification. Requests return a
   * result, notifications do not.
   *
   * @param call - The JSON-RPC call to handle.
   * @param options - The options for the handle operation.
   * @param options.context - The context to pass to the middleware.
   * @returns The JSON-RPC response, or `undefined` if the call is a notification.
   */
  async handle(request, {
    context
  } = {}) {
    const isReq = isRequest(request);
    const {
      result
    } = await this._handle(request, context);
    if (isReq && result === void 0) {
      throw new JsonRpcEngineError(`Nothing ended request: ${stringify4(request)}`);
    }
    return result;
  }
  /**
   * Convert the engine into a JSON-RPC middleware.
   *
   * @returns The JSON-RPC middleware.
   */
  asMiddleware() {
    this._assertIsNotDestroyed();
    return async ({
      request,
      context,
      next
    }) => {
      const {
        result,
        request: finalRequest
      } = await this._handle(request, context);
      return result === void 0 ? await next(finalRequest) : result;
    };
  }
  /**
   * Destroy the engine. Calls the `destroy()` method of any middleware that has
   * one. Attempting to use the engine after destroying it will throw an error.
   */
  async destroy() {
    if (_classPrivateFieldGet(_isDestroyed, this)) {
      return;
    }
    _classPrivateFieldSet(_isDestroyed, this, true);
    const destructionPromise = Promise.all(_classPrivateFieldGet(_middleware, this).map(async (middleware) => {
      if (
        // Intentionally using `in` to walk the prototype chain.
        "destroy" in middleware && typeof middleware.destroy === "function"
      ) {
        return middleware.destroy();
      }
      return void 0;
    }));
    _classPrivateFieldSet(_middleware, this, []);
    await destructionPromise;
  }
  /**
   * Handle a JSON-RPC request. Throws if a middleware performs an invalid
   * operation. Permits returning an `undefined` result.
   *
   * @param originalRequest - The JSON-RPC request to handle.
   * @param rawContext - The context to pass to the middleware.
   * @returns The result from the middleware.
   */
  async _handle(originalRequest, rawContext = new MiddlewareContext()) {
    this._assertIsNotDestroyed();
    (0, import_deep_freeze_strict.default)(originalRequest);
    const state = {
      request: originalRequest,
      result: void 0
    };
    const middlewareIterator = this._makeMiddlewareIterator();
    const firstMiddleware = middlewareIterator.next().value;
    const context = MiddlewareContext.isInstance(rawContext) ? rawContext : new MiddlewareContext(rawContext);
    const makeNext = this._makeNextFactory(middlewareIterator, state, context);
    const result = await firstMiddleware({
      request: originalRequest,
      context,
      next: makeNext()
    });
    this._updateResult(result, state);
    return state;
  }
  /**
   * Create a factory of `next()` functions for use with a particular request.
   * The factory is recursive, and a new `next()` is created for each middleware
   * invocation.
   *
   * @param middlewareIterator - The iterator of middleware for the current
   * request.
   * @param state - The current values of the request and result.
   * @param context - The context to pass to the middleware.
   * @returns The `next()` function factory.
   */
  _makeNextFactory(middlewareIterator, state, context) {
    const makeNext = () => {
      let wasCalled = false;
      const next = async (request = state.request) => {
        if (wasCalled) {
          throw new JsonRpcEngineError(`Middleware attempted to call next() multiple times for request: ${stringify4(request)}`);
        }
        wasCalled = true;
        if (request !== state.request) {
          this._assertValidNextRequest(state.request, request);
          state.request = (0, import_deep_freeze_strict.default)(request);
        }
        const {
          value: nextMiddleware,
          done
        } = middlewareIterator.next();
        if (done) {
          return void 0;
        }
        const result = await nextMiddleware({
          request,
          context,
          next: makeNext()
        });
        this._updateResult(result, state);
        return state.result;
      };
      return next;
    };
    return makeNext;
  }
  _makeMiddlewareIterator() {
    return _classPrivateFieldGet(_middleware, this)[Symbol.iterator]();
  }
  /**
   * Validate the result from a middleware and, if it's a new value, update the
   * current result.
   *
   * @param result - The result from the middleware.
   * @param state - The current values of the request and result.
   */
  _updateResult(result, state) {
    if (isNotification(state.request) && result !== void 0) {
      throw new JsonRpcEngineError(`Result returned for notification: ${stringify4(state.request)}`);
    }
    if (result !== void 0 && result !== state.result) {
      if (typeof result === "object" && result !== null) {
        (0, import_deep_freeze_strict.default)(result);
      }
      state.result = result;
    }
  }
  /**
   * Assert that a request modified by a middleware is valid.
   *
   * @param currentRequest - The current request.
   * @param nextRequest - The next request.
   */
  _assertValidNextRequest(currentRequest, nextRequest) {
    if (nextRequest.jsonrpc !== currentRequest.jsonrpc) {
      throw new JsonRpcEngineError(`Middleware attempted to modify readonly property "jsonrpc" for request: ${stringify4(currentRequest)}`);
    }
    if (hasProperty(nextRequest, "id") !== hasProperty(currentRequest, "id") || // "id" does not exist on notifications, but we can still
    // check the value of the property at runtime.
    nextRequest.id !== currentRequest.id) {
      throw new JsonRpcEngineError(`Middleware attempted to modify readonly property "id" for request: ${stringify4(currentRequest)}`);
    }
  }
  _assertIsNotDestroyed() {
    if (_classPrivateFieldGet(_isDestroyed, this)) {
      throw new JsonRpcEngineError("Engine is destroyed");
    }
  }
};

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/jrpc/v2/jrpcServer.js
var import_classPrivateFieldInitSpec2 = __toESM(require_classPrivateFieldInitSpec());

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/jrpc/errors/errors.js
function parseOpts(arg) {
  if (arg) {
    if (typeof arg === "string") {
      return [arg];
    } else if (typeof arg === "object" && !Array.isArray(arg)) {
      const {
        message,
        data
      } = arg;
      if (message && typeof message !== "string") {
        throw new Error("Must specify string message.");
      }
      return [message !== null && message !== void 0 ? message : void 0, data];
    }
  }
  return [];
}
function getJsonRpcError(code, arg) {
  const [message, data] = parseOpts(arg);
  return new JsonRpcError(code, message !== null && message !== void 0 ? message : getMessageFromCode(code), data);
}
function getEthProviderError(code, arg) {
  const [message, data] = parseOpts(arg);
  return new EthereumProviderError(code, message !== null && message !== void 0 ? message : getMessageFromCode(code), data);
}
var rpcErrors = {
  /**
   * Get a JSON RPC 2.0 Parse (-32700) error.
   *
   * @param arg - The error message or options bag.
   * @returns An instance of the {@link JsonRpcError} class.
   */
  parse: (arg) => getJsonRpcError(errorCodes.rpc.parse, arg),
  /**
   * Get a JSON RPC 2.0 Invalid Request (-32600) error.
   *
   * @param arg - The error message or options bag.
   * @returns An instance of the {@link JsonRpcError} class.
   */
  invalidRequest: (arg) => getJsonRpcError(errorCodes.rpc.invalidRequest, arg),
  /**
   * Get a JSON RPC 2.0 Invalid Params (-32602) error.
   *
   * @param arg - The error message or options bag.
   * @returns An instance of the {@link JsonRpcError} class.
   */
  invalidParams: (arg) => getJsonRpcError(errorCodes.rpc.invalidParams, arg),
  /**
   * Get a JSON RPC 2.0 Method Not Found (-32601) error.
   *
   * @param arg - The error message or options bag.
   * @returns An instance of the {@link JsonRpcError} class.
   */
  methodNotFound: (arg) => getJsonRpcError(errorCodes.rpc.methodNotFound, arg),
  /**
   * Get a JSON RPC 2.0 Internal (-32603) error.
   *
   * @param arg - The error message or options bag.
   * @returns An instance of the {@link JsonRpcError} class.
   */
  internal: (arg) => getJsonRpcError(errorCodes.rpc.internal, arg),
  /**
   * Get a JSON RPC 2.0 Server error.
   * Permits integer error codes in the [ -32099 <= -32005 ] range.
   * Codes -32000 through -32004 are reserved by EIP-1474.
   *
   * @param opts - The error options bag.
   * @returns An instance of the {@link JsonRpcError} class.
   */
  server: (opts) => {
    if (!opts || typeof opts !== "object" || Array.isArray(opts)) {
      throw new Error("Ethereum RPC Server errors must provide single object argument.");
    }
    const {
      code
    } = opts;
    if (!Number.isInteger(code) || code > -32005 || code < -32099) {
      throw new Error('"code" must be an integer such that: -32099 <= code <= -32005');
    }
    return getJsonRpcError(code, opts);
  },
  /**
   * Get an Ethereum JSON RPC Invalid Input (-32000) error.
   *
   * @param arg - The error message or options bag.
   * @returns An instance of the {@link JsonRpcError} class.
   */
  invalidInput: (arg) => getJsonRpcError(errorCodes.rpc.invalidInput, arg),
  /**
   * Get an Ethereum JSON RPC Resource Not Found (-32001) error.
   *
   * @param arg - The error message or options bag.
   * @returns An instance of the {@link JsonRpcError} class.
   */
  resourceNotFound: (arg) => getJsonRpcError(errorCodes.rpc.resourceNotFound, arg),
  /**
   * Get an Ethereum JSON RPC Resource Unavailable (-32002) error.
   *
   * @param arg - The error message or options bag.
   * @returns An instance of the {@link JsonRpcError} class.
   */
  resourceUnavailable: (arg) => getJsonRpcError(errorCodes.rpc.resourceUnavailable, arg),
  /**
   * Get an Ethereum JSON RPC Transaction Rejected (-32003) error.
   *
   * @param arg - The error message or options bag.
   * @returns An instance of the {@link JsonRpcError} class.
   */
  transactionRejected: (arg) => getJsonRpcError(errorCodes.rpc.transactionRejected, arg),
  /**
   * Get an Ethereum JSON RPC Method Not Supported (-32004) error.
   *
   * @param arg - The error message or options bag.
   * @returns An instance of the {@link JsonRpcError} class.
   */
  methodNotSupported: (arg) => getJsonRpcError(errorCodes.rpc.methodNotSupported, arg),
  /**
   * Get an Ethereum JSON RPC Limit Exceeded (-32005) error.
   *
   * @param arg - The error message or options bag.
   * @returns An instance of the {@link JsonRpcError} class.
   */
  limitExceeded: (arg) => getJsonRpcError(errorCodes.rpc.limitExceeded, arg)
};
var providerErrors = {
  /**
   * Get an Ethereum Provider User Rejected Request (4001) error.
   *
   * @param arg - The error message or options bag.
   * @returns An instance of the {@link EthereumProviderError} class.
   */
  userRejectedRequest: (arg) => {
    return getEthProviderError(errorCodes.provider.userRejectedRequest, arg);
  },
  /**
   * Get an Ethereum Provider Unauthorized (4100) error.
   *
   * @param arg - The error message or options bag.
   * @returns An instance of the {@link EthereumProviderError} class.
   */
  unauthorized: (arg) => {
    return getEthProviderError(errorCodes.provider.unauthorized, arg);
  },
  /**
   * Get an Ethereum Provider Unsupported Method (4200) error.
   *
   * @param arg - The error message or options bag.
   * @returns An instance of the {@link EthereumProviderError} class.
   */
  unsupportedMethod: (arg) => {
    return getEthProviderError(errorCodes.provider.unsupportedMethod, arg);
  },
  /**
   * Get an Ethereum Provider Not Connected (4900) error.
   *
   * @param arg - The error message or options bag.
   * @returns An instance of the {@link EthereumProviderError} class.
   */
  disconnected: (arg) => {
    return getEthProviderError(errorCodes.provider.disconnected, arg);
  },
  /**
   * Get an Ethereum Provider Chain Not Connected (4901) error.
   *
   * @param arg - The error message or options bag.
   * @returns An instance of the {@link EthereumProviderError} class.
   */
  chainDisconnected: (arg) => {
    return getEthProviderError(errorCodes.provider.chainDisconnected, arg);
  },
  /**
   * Get a custom Ethereum Provider error.
   *
   * @param opts - The error options bag.
   * @returns An instance of the {@link EthereumProviderError} class.
   */
  custom: (opts) => {
    if (!opts || typeof opts !== "object" || Array.isArray(opts)) {
      throw new Error("Ethereum Provider custom errors must provide single object argument.");
    }
    const {
      code,
      message,
      data
    } = opts;
    if (!message || typeof message !== "string") {
      throw new Error('"message" must be a nonempty string');
    }
    return new EthereumProviderError(code, message, data);
  }
};

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/jrpc/v2/jrpcServer.js
function _classPrivateFieldGet2(s2, a2) {
  return s2.get(_assertClassBrand2(s2, a2));
}
function _classPrivateFieldSet2(s2, a2, r) {
  return s2.set(_assertClassBrand2(s2, a2), r), r;
}
function _assertClassBrand2(e, t, n) {
  if ("function" == typeof e ? e === t : e.has(t)) return arguments.length < 3 ? t : n;
  throw new TypeError("Private element is not present on this object");
}
var jsonrpc = "2.0";
var _engine = /* @__PURE__ */ new WeakMap();
var _onError = /* @__PURE__ */ new WeakMap();
var JRPCServer = class _JRPCServer {
  /**
   * Construct a new JSON-RPC server.
   *
   * @param options - The options for the server.
   * @param options.onError - The callback to handle errors thrown by the
   * engine. Errors always result in a failed response object, containing a
   * JSON-RPC 2.0 serialized version of the original error. If you need to
   * access the original error, use the `onError` callback.
   * @param options.engine - The engine to use. Mutually exclusive with
   * `middleware`.
   * @param options.middleware - The middleware to use. Mutually exclusive with
   * `engine`.
   */
  constructor(options) {
    (0, import_classPrivateFieldInitSpec2.default)(this, _engine, void 0);
    (0, import_classPrivateFieldInitSpec2.default)(this, _onError, void 0);
    _classPrivateFieldSet2(_onError, this, options.onError);
    if (hasProperty(options, "engine")) {
      _classPrivateFieldSet2(_engine, this, options.engine);
    } else {
      _classPrivateFieldSet2(_engine, this, JRPCEngineV2.create({
        middleware: options.middleware
      }));
    }
  }
  static _coerceRequest(rawRequest, isRequest2) {
    if (!isMinimalRequest(rawRequest)) {
      throw rpcErrors.invalidRequest({
        data: {
          request: rawRequest
        }
      });
    }
    const request = {
      jsonrpc,
      method: rawRequest.method,
      params: rawRequest.params
    };
    if (hasProperty(rawRequest, "params")) {
      request.params = rawRequest.params;
    }
    if (isRequest2) {
      request.id = getUniqueId();
    }
    return request;
  }
  /**
   * Handle a JSON-RPC request.
   *
   * This method never throws. For requests, a response is always returned.
   * All errors are passed to the engine's `onError` callback.
   *
   * **WARNING**: This method is unaware of the request type of the underlying
   * engine. The request will fail if the engine can only handle notifications.
   *
   * @param request - The request to handle.
   * @param options - The options for the handle operation.
   * @param options.context - The context to pass to the middleware.
   * @returns The JSON-RPC response.
   */
  /**
   * Handle a JSON-RPC notification.
   *
   * This method never throws. For notifications, `undefined` is always returned.
   * All errors are passed to the engine's `onError` callback.
   *
   * **WARNING**: This method is unaware of the request type of the underlying
   * engine. The request will fail if the engine cannot handle notifications.
   *
   * @param notification - The notification to handle.
   * @param options - The options for the handle operation.
   * @param options.context - The context to pass to the middleware.
   */
  /**
   * Handle an alleged JSON-RPC request or notification. Permits any plain
   * object with `{ method: string }`, so long as any present JSON-RPC 2.0
   * properties are valid. If the object has an `id` property, it will be
   * treated as a request, otherwise it will be treated as a notification.
   *
   * This method never throws. All errors are passed to the engine's
   * `onError` callback. A JSON-RPC response is always returned for requests,
   * and `undefined` is returned for notifications.
   *
   * **WARNING**: The request will fail if its coerced type (i.e. request or
   * response) is not of the type expected by the underlying engine.
   *
   * @param rawRequest - The raw request to handle.
   * @param options - The options for the handle operation.
   * @param options.context - The context to pass to the middleware.
   * @returns The JSON-RPC response, or `undefined` if the request is a
   * notification.
   */
  async handle(rawRequest, options) {
    const [originalId, isRequest2] = getOriginalId(rawRequest);
    try {
      const request = _JRPCServer._coerceRequest(rawRequest, isRequest2);
      const result = await _classPrivateFieldGet2(_engine, this).handle(request, options);
      if (result !== void 0) {
        return {
          jsonrpc,
          id: originalId,
          result
        };
      }
    } catch (error) {
      var _classPrivateFieldGet22;
      (_classPrivateFieldGet22 = _classPrivateFieldGet2(_onError, this)) === null || _classPrivateFieldGet22 === void 0 || _classPrivateFieldGet22.call(this, error);
      if (isRequest2) {
        return {
          jsonrpc,
          id: originalId,
          error: serializeJrpcError(error, {
            shouldIncludeStack: false,
            shouldPreserveMessage: true
          })
        };
      }
    }
    return void 0;
  }
};
function isMinimalRequest(rawRequest) {
  return isObject(rawRequest) && hasProperty(rawRequest, "method") && typeof rawRequest.method === "string" && hasValidParams(rawRequest);
}
function hasValidParams(rawRequest) {
  if (hasProperty(rawRequest, "params")) {
    return Array.isArray(rawRequest.params) || isObject(rawRequest.params);
  }
  return true;
}
function getOriginalId(rawRequest) {
  if (isObject(rawRequest) && hasProperty(rawRequest, "id")) {
    return [rawRequest.id, true];
  }
  return [void 0, false];
}

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/jrpc/postMessageStream.js
var import_objectWithoutProperties2 = __toESM(require_objectWithoutProperties());
var import_defineProperty13 = __toESM(require_defineProperty());
var _excluded2 = ["name", "target", "targetOrigin", "targetWindow"];
var _Object$getOwnPropert;
var _Object$getOwnPropert2;
var getSource = (_Object$getOwnPropert = Object.getOwnPropertyDescriptor(MessageEvent.prototype, "source")) === null || _Object$getOwnPropert === void 0 ? void 0 : _Object$getOwnPropert.get;
var getOrigin = (_Object$getOwnPropert2 = Object.getOwnPropertyDescriptor(MessageEvent.prototype, "origin")) === null || _Object$getOwnPropert2 === void 0 ? void 0 : _Object$getOwnPropert2.get;
var PostMessageStream = class extends BasePostMessageStream {
  constructor(_ref) {
    let {
      name,
      target,
      targetOrigin = "*",
      targetWindow = window
    } = _ref, streamOptions = (0, import_objectWithoutProperties2.default)(_ref, _excluded2);
    super(streamOptions);
    (0, import_defineProperty13.default)(this, "_name", void 0);
    (0, import_defineProperty13.default)(this, "_target", void 0);
    (0, import_defineProperty13.default)(this, "_targetOrigin", void 0);
    (0, import_defineProperty13.default)(this, "_targetWindow", void 0);
    (0, import_defineProperty13.default)(this, "_onMessage", void 0);
    if (typeof window === "undefined" || typeof window.postMessage !== "function") {
      throw new Error("window.postMessage is not a function. This class should only be instantiated in a Window.");
    }
    this._name = name;
    this._target = target;
    this._targetOrigin = targetOrigin;
    this._targetWindow = targetWindow;
    this._onMessage = this._onMessageHandler.bind(this);
    window.addEventListener("message", this._onMessage, false);
    this._handshake();
  }
  _destroy() {
    window.removeEventListener("message", this._onMessage, false);
  }
  _postMessage(data) {
    const clonedData = cloneDeep(data);
    let originConstraint = this._targetOrigin;
    if (typeof clonedData === "object") {
      const dataObj = clonedData;
      if (typeof dataObj.data === "object") {
        const dataObjData = dataObj.data;
        if (Array.isArray(dataObjData.params) && dataObjData.params.length > 0) {
          const firstParam = dataObjData.params[0];
          if (typeof firstParam === "object" && firstParam !== null) {
            const dataObjDataParam = firstParam;
            if (dataObjDataParam._origin) {
              originConstraint = dataObjDataParam._origin;
            }
            dataObjDataParam._origin = window.location.origin;
          }
        }
      }
    }
    this._targetWindow.postMessage({
      target: this._target,
      data: clonedData
    }, originConstraint);
  }
  _onMessageHandler(event) {
    const message = event.data;
    if (this._targetOrigin !== "*" && (getOrigin ? getOrigin.call(event) : event.origin) !== this._targetOrigin || (getSource ? getSource.call(event) : event.source) !== this._targetWindow || !isValidStreamMessage(message) || message.target !== this._name) {
      return;
    }
    this._onData(message.data);
  }
};

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/utils/whitelabel.js
function getColorsList(colorPackage, colorsAmount = 3, colorsShiftAmount = 50, mixColor = "black", rotate = 0, saturation = 20, mainColor = "#0346ff") {
  const colorsList = [];
  let step;
  for (step = 0; step < colorsAmount; step += 1) {
    colorsList.push(colorPackage(mainColor).rotate((step + 1) / colorsAmount * -rotate).saturate((step + 1) / colorsAmount * (saturation / 100)).mix(colorPackage(mixColor), colorsShiftAmount / 100 * (step + 1) / colorsAmount).hex());
  }
  return colorsList;
}
function generateWhiteLabelTheme(colorPackage, primary) {
  const darkSet = getColorsList(colorPackage, 3, 50, "black", 0, 20, primary);
  const lightSet = getColorsList(colorPackage, 6, 85, "white", 0, 20, primary);
  return [...darkSet.reverse(), primary, ...lightSet];
}
function applyWhiteLabelTheme(colorPackage, rootElement, theme) {
  if (theme.primary) {
    const themeSet = generateWhiteLabelTheme(colorPackage, theme.primary);
    rootElement.style.setProperty("--app-primary-900", themeSet[0]);
    rootElement.style.setProperty("--app-primary-800", themeSet[1]);
    rootElement.style.setProperty("--app-primary-700", themeSet[2]);
    rootElement.style.setProperty("--app-primary-600", themeSet[3]);
    rootElement.style.setProperty("--app-primary-500", themeSet[4]);
    rootElement.style.setProperty("--app-primary-400", themeSet[5]);
    rootElement.style.setProperty("--app-primary-300", themeSet[6]);
    rootElement.style.setProperty("--app-primary-200", themeSet[7]);
    rootElement.style.setProperty("--app-primary-100", themeSet[8]);
    rootElement.style.setProperty("--app-primary-50", themeSet[9]);
  }
  if (theme.onPrimary) {
    rootElement.style.setProperty("--app-on-primary", theme.onPrimary);
  }
}

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/jrpc/jrpc.js
var import_readable_stream5 = __toESM(require_ours());
var getRpcPromiseCallback = (resolve, reject, unwrapResult = true) => (error, response) => {
  if (error || response.error) {
    reject(error || response.error);
  } else if (!unwrapResult || Array.isArray(response)) {
    resolve(response);
  } else {
    resolve(response.result);
  }
};
function createErrorMiddleware(log2) {
  return (req, res, next, end) => {
    try {
      if (!isValidMethod(req)) {
        res.error = new SerializableError({
          code: errorCodes.rpc.invalidRequest,
          message: "invalid method"
        });
        end();
        return;
      }
      next((done) => {
        const {
          error
        } = res;
        if (!error) {
          return done();
        }
        log2.error(`Auth - RPC Error: ${error.message}`, error);
        return done();
      });
    } catch (error) {
      log2.error(`Auth - RPC Error thrown: ${error.message}`, error);
      res.error = new SerializableError({
        code: errorCodes.rpc.internal,
        message: error.message
      });
      end();
    }
  };
}
function createStreamMiddleware() {
  const idMap = {};
  function readNoop() {
    return false;
  }
  const events = new SafeEventEmitter();
  function processResponse(res) {
    const context = idMap[res.id];
    if (!context) {
      throw new Error(`StreamMiddleware - Unknown response id "${res.id}"`);
    }
    delete idMap[res.id];
    Object.assign(context.res, res);
    setTimeout(context.end);
  }
  function processNotification(res) {
    events.emit("notification", res);
  }
  function processMessage(res, _encoding, cb) {
    let err;
    try {
      const isNotification2 = isJRPCNotification(res);
      if (isNotification2) {
        processNotification(res);
      } else {
        processResponse(res);
      }
    } catch (_err) {
      err = _err;
    }
    cb(err);
  }
  const stream = new import_readable_stream5.Duplex({
    objectMode: true,
    read: readNoop,
    write: processMessage
  });
  const middleware = (req, res, next, end) => {
    stream.push(req);
    idMap[req.id] = {
      req,
      res,
      next,
      end
    };
  };
  return {
    events,
    middleware,
    stream
  };
}
function createScaffoldMiddleware(handlers) {
  return (req, res, next, end) => {
    const handler = handlers[req.method];
    if (handler === void 0) {
      return next();
    }
    if (typeof handler === "function") {
      return handler(req, res, next, end);
    }
    res.result = handler;
    return end();
  };
}
function createIdRemapMiddleware() {
  return (req, res, next, _end) => {
    const originalId = req.id;
    const newId = Math.random().toString(36).slice(2);
    req.id = newId;
    res.id = newId;
    next((done) => {
      req.id = originalId;
      res.id = originalId;
      done();
    });
  };
}
function createLoggerMiddleware(logger) {
  return (req, res, next, _2) => {
    logger.debug("REQ", req, "RES", res);
    next();
  };
}
function createAsyncMiddleware(asyncMiddleware) {
  return async (req, res, next, end) => {
    let resolveNextPromise;
    const nextPromise = new Promise((resolve) => {
      resolveNextPromise = resolve;
    });
    let returnHandlerCallback = null;
    let nextWasCalled = false;
    const asyncNext = async () => {
      nextWasCalled = true;
      next((runReturnHandlersCallback) => {
        returnHandlerCallback = runReturnHandlersCallback;
        resolveNextPromise();
      });
      await nextPromise;
    };
    try {
      await asyncMiddleware(req, res, asyncNext);
      if (nextWasCalled) {
        await nextPromise;
        returnHandlerCallback(null);
      } else {
        end(null);
      }
    } catch (err) {
      const error = err;
      if (returnHandlerCallback) {
        returnHandlerCallback(error);
      } else {
        end(error);
      }
    }
  };
}

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/jrpc/v2/compatibility-utils.js
var import_objectSpread210 = __toESM(require_objectSpread2());

// node_modules/klona/dist/index.mjs
function klona2(x2) {
  if (typeof x2 !== "object") return x2;
  var k3, tmp, str = Object.prototype.toString.call(x2);
  if (str === "[object Object]") {
    if (x2.constructor !== Object && typeof x2.constructor === "function") {
      tmp = new x2.constructor();
      for (k3 in x2) {
        if (x2.hasOwnProperty(k3) && tmp[k3] !== x2[k3]) {
          tmp[k3] = klona2(x2[k3]);
        }
      }
    } else {
      tmp = {};
      for (k3 in x2) {
        if (k3 === "__proto__") {
          Object.defineProperty(tmp, k3, {
            value: klona2(x2[k3]),
            configurable: true,
            enumerable: true,
            writable: true
          });
        } else {
          tmp[k3] = klona2(x2[k3]);
        }
      }
    }
    return tmp;
  }
  if (str === "[object Array]") {
    k3 = x2.length;
    for (tmp = Array(k3); k3--; ) {
      tmp[k3] = klona2(x2[k3]);
    }
    return tmp;
  }
  if (str === "[object Set]") {
    tmp = /* @__PURE__ */ new Set();
    x2.forEach(function(val) {
      tmp.add(klona2(val));
    });
    return tmp;
  }
  if (str === "[object Map]") {
    tmp = /* @__PURE__ */ new Map();
    x2.forEach(function(val, key) {
      tmp.set(klona2(key), klona2(val));
    });
    return tmp;
  }
  if (str === "[object Date]") {
    return /* @__PURE__ */ new Date(+x2);
  }
  if (str === "[object RegExp]") {
    tmp = new RegExp(x2.source, x2.flags);
    tmp.lastIndex = x2.lastIndex;
    return tmp;
  }
  if (str === "[object DataView]") {
    return new x2.constructor(klona2(x2.buffer));
  }
  if (str === "[object ArrayBuffer]") {
    return x2.slice(0);
  }
  if (str.slice(-6) === "Array]") {
    return new x2.constructor(x2);
  }
  return x2;
}

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/jrpc/v2/compatibility-utils.js
var deepClone = (value) => klona2(value);
var requestProps = ["jsonrpc", "method", "params", "id"];
function fromLegacyRequest(req) {
  const request = {
    jsonrpc: "2.0",
    method: req.method
  };
  request.id = req.id;
  if (hasProperty(req, "params") && req.params !== void 0) {
    request.params = deepClone(req.params);
  }
  return request;
}
function makeContext(req) {
  const context = new MiddlewareContext();
  propagateToContext(req, context);
  return context;
}
function propagateToContext(req, context) {
  Object.keys(req).filter((key) => typeof key === "string" && !requestProps.includes(key) && !context.has(key)).forEach((key) => {
    context.set(key, req[key]);
  });
}
function propagateToRequest(req, context) {
  Array.from(context.keys()).filter((key) => typeof key === "string" && !requestProps.includes(key)).forEach((key) => {
    req[key] = context.get(key);
  });
}
function propagateToMutableRequest(req, context) {
  const clonedRequest = deepClone(req);
  propagateToRequest(clonedRequest, context);
  return clonedRequest;
}

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/jrpc/v2/asLegacyMiddleware.js
function asLegacyMiddleware(engineOrMiddleware, ...rest) {
  const v2Middleware = typeof engineOrMiddleware === "function" ? JRPCEngineV2.create({
    middleware: [engineOrMiddleware, ...rest]
  }).asMiddleware() : engineOrMiddleware.asMiddleware();
  return createAsyncMiddleware(async (req, res, next) => {
    const request = fromLegacyRequest(req);
    const context = makeContext(req);
    let modifiedRequest;
    const result = await v2Middleware({
      request,
      context,
      next: (finalRequest) => {
        modifiedRequest = finalRequest;
        return Promise.resolve(void 0);
      }
    });
    if (modifiedRequest !== void 0 && modifiedRequest !== request) {
      Object.assign(req, deepClone(modifiedRequest));
    }
    propagateToRequest(req, context);
    if (result !== void 0) {
      res.result = deepClone(result);
      return void 0;
    }
    return next();
  });
}

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/jrpc/v2/createStreamMiddlewareV2.js
var import_readable_stream6 = __toESM(require_ours());
function createClientStreamMiddlewareV2({
  notificationEmitter
} = {}) {
  const pendingRequests = /* @__PURE__ */ new Map();
  function noop2() {
  }
  function write(data, _encoding, cb) {
    if (data.method !== void 0) {
      notificationEmitter === null || notificationEmitter === void 0 || notificationEmitter.emit("notification", data);
    } else {
      const id = data.id;
      if (id !== void 0 && id !== null && pendingRequests.has(id)) {
        const pending = pendingRequests.get(id);
        pendingRequests.delete(id);
        if (data.error) {
          const errorObj = data.error;
          pending.reject(Object.assign(new Error(errorObj.message || "Internal JSON-RPC error"), {
            code: errorObj.code,
            data: errorObj.data
          }));
        } else {
          pending.resolve(data.result);
        }
      }
    }
    cb();
  }
  const stream = new import_readable_stream6.Duplex({
    objectMode: true,
    read: noop2,
    write
  });
  stream.once("close", () => {
    const error = new Error("Stream closed");
    pendingRequests.forEach(({
      reject
    }) => reject(error));
    pendingRequests.clear();
  });
  const middleware = ({
    request
  }) => {
    return new Promise((resolve, reject) => {
      pendingRequests.set(request.id, {
        resolve,
        reject
      });
      stream.push(request);
    });
  };
  return {
    middleware,
    stream
  };
}

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/jrpc/v2/messageStream.js
var import_loglevel2 = __toESM(require_loglevel());
var import_readable_stream7 = __toESM(require_ours());
function createEngineStreamV2({
  engine,
  notificationEmitter
}) {
  let stream = void 0;
  function noop2() {
  }
  function handleRequest(req) {
    return engine.handle(req).then((res) => {
      if (res !== void 0 && isRequest(req)) {
        var _stream;
        (_stream = stream) === null || _stream === void 0 || _stream.push({
          id: req.id,
          jsonrpc: "2.0",
          result: res
        });
      }
      return void 0;
    }).catch((err) => {
      if (isRequest(req)) {
        var _stream2;
        const message = err instanceof Error ? err.message : "Internal JSON-RPC error";
        (_stream2 = stream) === null || _stream2 === void 0 || _stream2.push({
          id: req.id,
          jsonrpc: "2.0",
          error: rpcErrors.internal({
            message
          })
        });
      }
      import_loglevel2.default.error(err);
    });
  }
  function write(req, _encoding, cb) {
    handleRequest(req);
    cb();
  }
  stream = new import_readable_stream7.Duplex({
    objectMode: true,
    read: noop2,
    write
  });
  if (notificationEmitter) {
    var _stream4;
    const onNotification = (message) => {
      var _stream3;
      (_stream3 = stream) === null || _stream3 === void 0 || _stream3.push(message);
    };
    notificationEmitter.on("notification", onNotification);
    (_stream4 = stream) === null || _stream4 === void 0 || _stream4.once("close", () => {
      notificationEmitter.removeListener("notification", onNotification);
    });
  }
  return stream;
}

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/jrpc/v2/createScaffoldMiddleware.js
function createScaffoldMiddleware2(handlers) {
  return ({
    request,
    context,
    next
  }) => {
    const handlerOrResult = handlers[request.method];
    if (handlerOrResult === void 0) {
      return next();
    }
    return typeof handlerOrResult === "function" ? handlerOrResult({
      request,
      context,
      next
    }) : handlerOrResult;
  };
}

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/ed25519/utils.js
var import_metadata_helpers4 = __toESM(require_lib());
var ed25519 = (0, import_metadata_helpers4.getEd25519)();
function getED25519Key(privateKey) {
  const privKey = typeof privateKey === "string" ? (0, import_metadata_helpers4.hexToBytes)(privateKey) : privateKey;
  const pk = ed25519.getPublicKey(privKey);
  const sk = new Uint8Array(64);
  sk.set(privKey, 0);
  sk.set(pk, 32);
  return {
    sk,
    pk
  };
}

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/subkey/mimcsponge.js
var import_ffjavascript = __toESM(require_lib5());
var import_metadata_helpers5 = __toESM(require_lib());
var F = new import_ffjavascript.ZqField(import_ffjavascript.Scalar.fromString("21888242871839275222246405745257275088548364400416034343698204186575808495617"));
var SEED = "mimcsponge";
var NROUNDS = 220;
function keccak256Padded(str) {
  let finalInput;
  if ((0, import_metadata_helpers5.isHexString)(str)) {
    finalInput = (0, import_metadata_helpers5.hexToBytes)(str);
  } else {
    finalInput = (0, import_metadata_helpers5.utf8ToBytes)(str);
  }
  const hashBytes = (0, import_metadata_helpers5.keccak256Bytes)(finalInput);
  return (0, import_metadata_helpers5.add0x)((0, import_metadata_helpers5.bytesToHex)(hashBytes).padStart(64, "0"));
}
function mimgGetIV(seed) {
  let _seed = seed;
  if (typeof _seed === "undefined") _seed = SEED;
  const c3 = keccak256Padded(`${_seed}_iv`);
  const cn = import_ffjavascript.Scalar.fromString(BigInt(c3).toString());
  const iv = import_ffjavascript.Scalar.mod(cn, F.p);
  return iv;
}
function mimcGetConstants(seed, nRounds) {
  let _nRounds = nRounds;
  if (typeof nRounds === "undefined") _nRounds = NROUNDS;
  const cts2 = new Array(_nRounds);
  let c3 = keccak256Padded(SEED);
  for (let i2 = 1; i2 < _nRounds; i2 += 1) {
    c3 = keccak256Padded(c3);
    const n1 = BigInt(c3) % F.p;
    const c22 = n1.toString(16).padStart(64, "0");
    cts2[i2] = F.e((0, import_metadata_helpers5.hexToBigInt)(c22).toString());
  }
  cts2[0] = F.e(0);
  cts2[cts2.length - 1] = F.e(0);
  return cts2;
}
var cts = mimcGetConstants(SEED, NROUNDS);
function mimcHash(_xL_in, _xR_in, _k) {
  let xL = F.e(_xL_in);
  let xR = F.e(_xR_in);
  const k3 = F.e(_k);
  for (let i2 = 0; i2 < NROUNDS; i2 += 1) {
    const c3 = cts[i2];
    const t = i2 === 0 ? F.add(xL, k3) : F.add(F.add(xL, k3), c3);
    const xR_tmp = F.e(xR);
    if (i2 < NROUNDS - 1) {
      xR = xL;
      xL = F.add(xR_tmp, F.pow(t, 5));
    } else {
      xR = F.add(xR_tmp, F.pow(t, 5));
    }
  }
  return {
    xL: F.normalize(xL),
    xR: F.normalize(xR)
  };
}
function mimcMultiHash(arr, key, numOutputs) {
  let _key = key;
  let _numOutputs = numOutputs;
  if (typeof _numOutputs === "undefined") {
    _numOutputs = 1;
  }
  if (typeof _key === "undefined") {
    _key = F.zero;
  }
  let R3 = F.zero;
  let C2 = F.zero;
  for (let i2 = 0; i2 < arr.length; i2 += 1) {
    R3 = F.add(R3, F.e(arr[i2]));
    const S2 = mimcHash(R3, C2, _key);
    R3 = S2.xL;
    C2 = S2.xR;
  }
  const outputs = [R3];
  for (let i2 = 1; i2 < _numOutputs; i2 += 1) {
    const S2 = mimcHash(R3, C2, _key);
    R3 = S2.xL;
    C2 = S2.xR;
    outputs.push(R3);
  }
  if (_numOutputs === 1) {
    return [F.normalize(outputs[0])];
  }
  return outputs.map((x2) => F.normalize(x2));
}

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/jrpc/v2/providerUtils.js
var import_objectSpread211 = __toESM(require_objectSpread2());
function providerFromEngine2(engine) {
  const provider = new SafeEventEmitter();
  provider.sendAsync = async (req) => {
    const result = await engine.handle(req);
    return result;
  };
  async function handleWithCallback(req, callback) {
    try {
      const result = await engine.handle(req);
      callback(null, {
        id: req.id,
        jsonrpc: "2.0",
        result
      });
    } catch (error) {
      const serializedError = serializeJrpcError(error, {
        shouldIncludeStack: false,
        shouldPreserveMessage: true
      });
      callback(serializedError, {
        id: req.id,
        jsonrpc: "2.0",
        error: serializedError
      });
    }
  }
  provider.send = (req, callback) => {
    if (typeof callback !== "function") {
      throw new Error('Must provide callback to "send" method.');
    }
    handleWithCallback(req, callback);
  };
  provider.request = async (args) => {
    const req = (0, import_objectSpread211.default)((0, import_objectSpread211.default)({}, args), {}, {
      id: getUniqueId(),
      jsonrpc: "2.0"
    });
    const res = await provider.sendAsync(req);
    return res;
  };
  return provider;
}
function providerFromMiddleware2(middleware) {
  const engine = JRPCEngineV2.create({
    middleware: [middleware]
  });
  return providerFromEngine2(engine);
}
function providerAsMiddleware2(provider) {
  return async ({
    request,
    context
  }) => {
    const providerRequest = deepClone(request);
    propagateToRequest(providerRequest, context);
    return await provider.sendAsync(providerRequest);
  };
}

// node_modules/@metamask/fox-sdk/node_modules/@web3auth/auth/dist/lib.esm/subkey/keyDerivation.js
var import_metadata_helpers6 = __toESM(require_lib());
function subkey(keyHex, input) {
  const privKeyBuf = (0, import_metadata_helpers6.hexToBigInt)((0, import_metadata_helpers6.add0x)(keyHex)).toString(10);
  const curveN = import_metadata_helpers6.secp256k1.Point.CURVE().n;
  const inputPath = (0, import_metadata_helpers6.mod)((0, import_metadata_helpers6.bytesToNumberBE)(input), curveN).toString(10);
  const output = mimcHash(1, privKeyBuf, inputPath);
  return output.xL.toString(16);
}

// node_modules/@metamask/fox-sdk/dist/wallets/evm/index.mjs
var qe = (function(e) {
  return e.EthSendRelayTransaction = `eth_sendRelayTransaction`, e.EthSendRawTransaction = `eth_sendRawTransaction`, e;
})({});
var Je = (function(e) {
  return e.Eip1559 = `eip1559`, e.Erc7821 = `erc7821`, e.RedeemDelegations = `redeemDelegations`, e;
})({});
var A = (e) => e.toLowerCase();
function Ye(e, t) {
  return { requestId: t, method: `eth_sendRelayTransaction`, encoding: `redeemDelegations`, tx: { from: A(e.from), chainId: e.chainId, ...e.authorizationList?.length ? { authorizationList: e.authorizationList.map((e2) => ({ address: A(e2.address), chainId: e2.chainId, nonce: e2.nonce, r: e2.r, s: e2.s, yParity: e2.yParity })) } : {} }, executions: e.executions.map((e2) => ({ target: A(e2.target), ...e2.value === void 0 ? {} : { value: e2.value }, ...e2.callData === void 0 ? {} : { callData: e2.callData } })), delegation: { delegator: A(e.delegation.delegator), delegate: A(e.delegation.delegate), authority: A(e.delegation.authority), salt: e.delegation.salt, ...e.delegation.caveats?.length ? { caveats: e.delegation.caveats.map((e2) => ({ enforcer: A(e2.enforcer), terms: e2.terms, ...e2.args === void 0 ? {} : { args: e2.args } })) } : {}, ...e.delegation.signature ? { signature: e.delegation.signature } : {} } };
}
var j = (e) => e.toLowerCase();
function M2(e) {
  return e.map((e2) => ({ target: j(e2.target), ...e2.value === 0n ? {} : { value: toHex(e2.value) }, callData: e2.callData }));
}
function Xe(e) {
  return { enforcer: j(e.enforcer), terms: e.terms, ...e.args === void 0 ? {} : { args: e.args } };
}
function N2(e) {
  return { delegator: j(e.delegator), delegate: j(e.delegate), authority: j(e.authority), salt: e.salt, ...e.caveats.length ? { caveats: e.caveats.map(Xe) } : {} };
}
function P(e) {
  return { ...N2(e), signature: e.signature };
}
function F3(e) {
  return e.map((e2) => ({ address: j(e2.address), chainId: I(e2.chainId), nonce: I(e2.nonce), r: e2.r, s: e2.s, yParity: I(e2.yParity) }));
}
function I(e) {
  return e === `0x` || e === `0x0` ? 0 : Number.parseInt(e, 16);
}
function L2(e) {
  let t;
  try {
    t = parseTransaction(e);
  } catch {
    return;
  }
  if (!(t.type !== `eip7702` || !t.authorizationList?.length)) return t.authorizationList.map((e2) => ({ address: j(e2.address), chainId: Number(e2.chainId), nonce: Number(e2.nonce), r: e2.r, s: e2.s, yParity: Number(e2.yParity ?? 0) }));
}
var R2 = (e) => `/v1/projects/${e}/transaction-requests`;
var Ze = (e, t) => `/v1/projects/${e}/transaction-requests/${t}`;
var Qe = (e) => `/v1/projects/${e}/signature-requests`;
var $e = (e, t) => `/v1/projects/${e}/signature-requests/${t}`;
var et = (e, t) => `/v1/projects/${e}/approval/${t}`;
var z2 = class {
  #e;
  #t;
  constructor(e) {
    this.#e = e.http, this.#t = e.projectId;
  }
  async submitSignatureRequest(e, t, n, r, i2, a2) {
    let o2 = i2.requestId ?? v4_default();
    return { ...await this.#e.request(`POST`, Qe(this.#t), { requestId: o2, namespace: e, chainId: i2.chainId, walletAddress: t, method: n, origin: i2.origin, payload: r, ...i2.intent ? { intent: i2.intent } : {}, ...a2 === void 0 ? {} : { signature: a2 } }), kind: i.SIGNATURE };
  }
  async submitTransaction(e, t, n, r) {
    let i2 = n.requestId ?? v4_default(), { encoding: a2, ...o2 } = t;
    return { ...await this.#e.request(`POST`, R2(this.#t), { requestId: i2, namespace: e, chainId: n.chainId, ...a2 === void 0 ? {} : { method: `eth_sendRawTransaction`, encoding: a2 }, tx: o2, ...n.intent ? { txIntent: n.intent } : {}, ...n.bridgeQuoteId ? { bridgeQuoteId: n.bridgeQuoteId } : {}, ...r === void 0 ? {} : { signedTransaction: r } }), kind: i.TRANSACTION };
  }
  async submitRelayTransaction(e, t) {
    let n = Ye(e, t.requestId ?? v4_default());
    return { ...await this.#e.request(`POST`, R2(this.#t), { ...n, ...t.intent ? { txIntent: t.intent } : {}, ...t.bridgeQuoteId ? { bridgeQuoteId: t.bridgeQuoteId } : {} }), kind: i.TRANSACTION };
  }
  async getJobStatus(e) {
    return e.kind === i.TRANSACTION ? { ...await this.#e.request(`GET`, Ze(this.#t, e.pollingId)), kind: i.TRANSACTION } : { ...await this.#e.request(`GET`, $e(this.#t, e.pollingId)), kind: i.SIGNATURE };
  }
  async awaitJob(e, t) {
    return T(() => this.getJobStatus(e), e.pollingId, t);
  }
  async getMfaApproval(e) {
    return this.#e.request(`GET`, `${et(this.#t, e)}?id_type=${m}`);
  }
  async awaitTxJob(e, t) {
    return await this.awaitJob(e, t);
  }
  async signAndAwait(e, t, n, r, i2, a2, s2) {
    let c3 = await this.submitSignatureRequest(e, t, n, r, i2, s2), l2 = B(c3) ? c3 : await this.awaitJob({ pollingId: c3.requestId, kind: c3.kind }, a2);
    if (l2.kind === i.SIGNATURE) {
      if (l2.status === c2.SIGNED && l2.signature) return l2.signature;
      if (l2.status === c2.APPROVED && s2) return s2;
    }
    throw new x(l2);
  }
};
function B(e) {
  return e.status === c2.SIGNED || e.status === c2.APPROVED || e.status === c2.DENIED || e.status === c2.EXPIRED || e.status === c2.FAILED;
}
function V2(e, t) {
  return { typedData: D(e), ...t?.protocol !== void 0 && { protocol: t.protocol }, ...t?.protocolPayload !== void 0 && { protocolPayload: t.protocolPayload } };
}
var H2 = `eip155`;
var U2 = class extends Error {
  constructor(e, t) {
    super(`Invalid CAIP-2 chain id "${e}": ${t}`), this.name = `InvalidCaip2Error`;
  }
};
function W(e) {
  if (!Number.isInteger(e) || e <= 0) throw new U2(String(e), `chainId must be a positive integer`);
  return `${H2}:${e}`;
}
var it = { "0x1": `ethereum`, "0x89": `polygon`, "0x38": `bsc`, "0xa86a": `avalanche`, "0xa": `optimism`, "0xa4ec": `celo`, "0xa4b1": `arbitrum`, "0x2105": `base`, "0xe708": `linea`, "0xaa36a7": `sepolia`, "0xe705": `linea-sepolia`, "0x13882": `polygon-amoy`, "0x61": `bsc-testnet`, "0xa869": `avalanche-fuji`, "0x66eee": `arbitrum-sepolia`, "0xaa37dc": `optimism-sepolia`, "0x14a34": `base-sepolia` };
var at = Object.values(import_ethereum_controllers.DEFAULT_SUPPORTED_NETWORKS).map((e) => ({ key: it[e.chainId] ?? e.chainId, chainId: Number.parseInt(e.chainId, 16), caip2: W(Number.parseInt(e.chainId, 16)), name: e.displayName, nativeCurrency: { name: e.tickerName, symbol: e.ticker ?? `ETH`, decimals: e.decimals ?? 18 }, ...e.blockExplorerUrl ? { blockExplorer: e.blockExplorerUrl } : {} }));
var G = class extends Error {
  account;
  balance;
  required;
  value;
  gas;
  feePerGas;
  constructor(e) {
    super(`Insufficient native balance on ${e.account}: have ${e.balance} wei, need ${e.required} wei (value=${e.value}, gas=${e.gas} * feePerGas=${e.feePerGas}).`), this.name = `InsufficientNativeFundsError`, this.account = e.account, this.balance = e.balance, this.required = e.required, this.value = e.value, this.gas = e.gas, this.feePerGas = e.feePerGas;
  }
};
var K2 = class extends Error {
  account;
  token;
  balance;
  required;
  constructor(e) {
    super(`Insufficient token balance on ${e.account} for ${e.token}: have ${e.balance} base units, need ${e.required} base units.`), this.name = `InsufficientTokenBalanceError`, this.account = e.account, this.token = e.token, this.balance = e.balance, this.required = e.required;
  }
};
var ct = class {
  namespace = K.Evm;
  #e = new import_ethereum_controllers.KeyringController({ config: {}, state: {} });
  #t;
  constructor(e) {
    this.#t = new z2(e);
  }
  derivationPath(e) {
    return U(e), `m/44'/60'/0'/0/${e}`;
  }
  normalizeAddress(e) {
    return e.toLowerCase();
  }
  async derive(e) {
    let t = V(e.mnemonic);
    H(t);
    let n = this.derivationPath(e.index), r = mnemonicToAccount(t, { path: n }), i2 = r.getHdKey().privateKey;
    if (!i2) throw Error(`Unable to derive private key for ${n}`);
    return { namespace: K.Evm, address: r.address, index: e.index, derivationPath: n, privateKey: toHex(i2) };
  }
  async importDerivedKey(e) {
    let t = await this.#e.importAccount(e.privateKey);
    if (t.toLowerCase() !== e.address.toLowerCase()) throw Error(`Imported address ${t} does not match derived address ${e.address}`);
    return { address: t };
  }
  signPersonalMessageLocal(e, t) {
    return this.#e.signPersonalMessage(e, t);
  }
  signTransaction(e, t) {
    return this.#e.signTransaction(e, t);
  }
  signEip7702Authorization(...e) {
    return this.#e.signEip7702Authorization(...e);
  }
  async signMessage(e, t, n, r) {
    if (n) throw new C(`signMessage (eth_sign)`);
    return this.#e.signMessage(e, t);
  }
  async signPersonalMessage(e, t, n, r) {
    let i2 = await this.#e.signPersonalMessage(e, t);
    return n ? this.#t.signAndAwait(this.namespace, t, a.PERSONAL_SIGN, { message: e }, n, r, i2) : i2;
  }
  async signTypedData(e, t, n, r) {
    let i2 = await this.#e.signTypedData(e, t);
    return n ? this.#t.signAndAwait(this.namespace, t, a.ETH_SIGN_TYPED_DATA_V4, V2(e, n), n, r, i2) : i2;
  }
  async submitSignedTransaction(e, t, n) {
    return this.#t.submitTransaction(this.namespace, t, n, e);
  }
  async submitErc7821Transaction(e, t, n) {
    return this.#t.submitTransaction(this.namespace, { ...t, encoding: `erc7821` }, n, e);
  }
  async awaitTx(e, t) {
    return this.#t.awaitTxJob(e, t);
  }
  async awaitJob(e, t) {
    return this.#t.awaitJob(e, t);
  }
  async getJobStatus(e) {
    return this.#t.getJobStatus(e);
  }
  async getMfaApproval(e) {
    return this.#t.getMfaApproval(e);
  }
  async submitPersonalSign(e, t, n) {
    let r = await this.#e.signPersonalMessage(t, e);
    return this.#t.submitSignatureRequest(this.namespace, e, a.PERSONAL_SIGN, { message: t }, n, r);
  }
  async submitSignTypedData(e, t, n) {
    let r = await this.#e.signTypedData(t, e);
    return this.#t.submitSignatureRequest(this.namespace, e, a.ETH_SIGN_TYPED_DATA_V4, V2(t, n), n, r);
  }
  async submitRelayTransaction(e, t) {
    if (!e.delegation.signature) throw Error(`EvmByokAdapter.submitRelayTransaction: BYOK relay requires a signed delegation.signature`);
    return this.#t.submitRelayTransaction(e, t);
  }
  async getRelayJobStatus(e) {
    return this.#t.getJobStatus(e);
  }
  async awaitRelayJob(e, t) {
    return this.#t.awaitTxJob(e, t);
  }
};
var q = { chainId: 0, origin: `fox-sdk` };
var lt = class {
  namespace = K.Evm;
  #e;
  constructor(e) {
    this.#e = new z2(e);
  }
  normalizeAddress(e) {
    return e.toLowerCase();
  }
  async signMessage(e, t, n, r) {
    return this.#e.signAndAwait(this.namespace, t, a.PERSONAL_SIGN, { message: e }, n ?? q, r);
  }
  async signPersonalMessage(e, t, n, r) {
    return this.#e.signAndAwait(this.namespace, t, a.PERSONAL_SIGN, { message: e }, n ?? q, r);
  }
  async signTypedData(e, t, n, r) {
    return this.#e.signAndAwait(this.namespace, t, a.ETH_SIGN_TYPED_DATA_V4, V2(e, n), n ?? q, r);
  }
  signEip7702Authorization() {
    throw Error(`signEip7702Authorization is not supported in server mode yet`);
  }
  signTransaction(e, t) {
    return Promise.reject(Error(`signTransaction is not supported in server mode; use submitTransaction or sendTransaction`));
  }
  async submitTransaction(e, t) {
    return this.#e.submitTransaction(this.namespace, e, t);
  }
  async submitErc7821Transaction(e, t) {
    if (e.authorizationList?.length) throw Error(`EvmServerAdapter.submitErc7821Transaction: server-wallet erc7821 must omit tx.authorizationList (Mimir injects the 7702 upgrade)`);
    return this.#e.submitTransaction(this.namespace, { ...e, encoding: `erc7821` }, t);
  }
  async submitRelayTransaction(e, t) {
    if (e.delegation.signature) throw Error(`EvmServerAdapter.submitRelayTransaction: server-wallet relay must omit delegation.signature (Mimir signs)`);
    if (e.authorizationList?.length) throw Error(`EvmServerAdapter.submitRelayTransaction: server-wallet relay must omit tx.authorizationList (Mimir injects the 7702 upgrade)`);
    return this.#e.submitRelayTransaction(e, t);
  }
  async submitPersonalSign(e, t, n) {
    return this.#e.submitSignatureRequest(this.namespace, e, a.PERSONAL_SIGN, { message: t }, n);
  }
  async submitSignTypedData(e, t, n) {
    return this.#e.submitSignatureRequest(this.namespace, e, a.ETH_SIGN_TYPED_DATA_V4, V2(t, n), n);
  }
  async getJobStatus(e) {
    return this.#e.getJobStatus(e);
  }
  async awaitJob(e, t) {
    return this.#e.awaitJob(e, t);
  }
  async getMfaApproval(e) {
    return this.#e.getMfaApproval(e);
  }
};
function J(e) {
  return e.getAdapter(K.Evm);
}
function Y(e) {
  if (e.kind !== N.BYOK) throw Error(`evmByokAdapter: requires a BYOK keyring`);
  return e.getAdapter(K.Evm);
}
function X(e) {
  if (e.kind !== N.SERVER) throw Error(`evmServerAdapter: requires a server-mode keyring`);
  return e.getAdapter(K.Evm);
}
function ut(e) {
  return (t, n) => e.getCode({ address: t }).then((e2) => e2 ?? `0x`);
}
var dt = z.object({ address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, `Invalid EVM address format`).describe(`The wallet address to check the balance for.`), tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, `Invalid EVM address format`).optional().describe(`Optional: The contract address of the ERC20 token. If omitted, the native currency balance is returned.`).transform((e) => e) });
var ft = z.object({ recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/, `Invalid EVM address format`).describe(`The recipient's EVM address.`).transform((e) => e), amountInBaseUnits: z.string().describe(`The amount of the token/native currency to send (in base units, e.g., '1000000000000000000').`), tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, `Invalid EVM address format`).optional().describe(`Optional: The contract address of the ERC20 token to send. If omitted, the native currency is sent.`).transform((e) => e) });
var pt = z.object({ ticker: z.string().describe(`The ticker symbol of the token (e.g., 'ETH', 'USDC').`) });
var mt = z.object({ amount: z.string().describe(`The amount to convert (in human-readable units).`), tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, `Invalid EVM address format`).optional().describe(`Optional: The contract address of the token. If omitted, native currency decimals are used.`).transform((e) => e) });
var ht = z.object({ amount: z.string().regex(/^\d+$/, `Amount must be a non-negative integer string (base units).`).describe(`The amount to convert (in base units, e.g., wei).`), tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, `Invalid EVM address format`).optional().describe(`Optional: The contract address of the token. If omitted, native currency decimals are used.`).transform((e) => e) });
var gt = z.object({ message: z.string(), intent: z.string().optional(), requestId: z.string().optional().describe(`Optional client correlation id for remote signing.`) });
var _t = z.object({ domain: z.object({}).passthrough(), types: z.object({}).passthrough(), primaryType: z.string(), message: z.object({}).passthrough(), intent: z.string().optional(), requestId: z.string().optional().describe(`Optional client correlation id for remote signing.`) }).passthrough().describe(`The EIP-712 typed data structure to sign.`);
var vt = z.object({ tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, `Invalid EVM address format`).describe(`The contract address of the ERC20 token.`).transform((e) => e), owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/, `Invalid EVM address format`).describe(`The address of the token owner.`).transform((e) => e), spender: z.string().regex(/^0x[a-fA-F0-9]{40}$/, `Invalid EVM address format`).describe(`The address of the potential spender.`).transform((e) => e) });
var yt = z.object({ tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, `Invalid EVM address format`).describe(`The contract address of the ERC20 token.`).transform((e) => e), spender: z.string().regex(/^0x[a-fA-F0-9]{40}$/, `Invalid EVM address format`).describe(`The address to grant approval to.`).transform((e) => e), amount: z.string().regex(/^\d+$/, `Amount must be a non-negative integer string (base units).`).describe(`The amount of tokens to approve (in base units).`) });
var bt = z.object({ tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, `Invalid EVM address format`).describe(`The contract address of the ERC20 token.`).transform((e) => e), spender: z.string().regex(/^0x[a-fA-F0-9]{40}$/, `Invalid EVM address format`).describe(`The address whose approval should be revoked.`).transform((e) => e) });
var Z = [{ constant: true, inputs: [], name: `name`, outputs: [{ name: ``, type: `string` }], stateMutability: `view`, type: `function` }, { constant: true, inputs: [], name: `symbol`, outputs: [{ name: ``, type: `string` }], stateMutability: `view`, type: `function` }, { constant: true, inputs: [], name: `decimals`, outputs: [{ name: ``, type: `uint8` }], stateMutability: `view`, type: `function` }, { constant: true, inputs: [{ name: `owner`, type: `address` }], name: `balanceOf`, outputs: [{ name: ``, type: `uint256` }], stateMutability: `view`, type: `function` }, { constant: false, inputs: [{ name: `to`, type: `address` }, { name: `value`, type: `uint256` }], name: `transfer`, outputs: [{ name: ``, type: `bool` }], stateMutability: `nonpayable`, type: `function` }, { constant: true, inputs: [{ name: `owner`, type: `address` }, { name: `spender`, type: `address` }], name: `allowance`, outputs: [{ name: ``, type: `uint256` }], stateMutability: `view`, type: `function` }, { constant: false, inputs: [{ name: `spender`, type: `address` }, { name: `value`, type: `uint256` }], name: `approve`, outputs: [{ name: ``, type: `bool` }], stateMutability: `nonpayable`, type: `function` }, { constant: false, inputs: [{ name: `from`, type: `address` }, { name: `to`, type: `address` }, { name: `value`, type: `uint256` }], name: `transferFrom`, outputs: [{ name: ``, type: `bool` }], stateMutability: `nonpayable`, type: `function` }, { constant: true, inputs: [], name: `totalSupply`, outputs: [{ type: `uint256`, name: `` }], stateMutability: `view`, type: `function` }];
async function xt(e, t) {
  let [n, r, i2] = await Promise.all([e.read({ address: t, abi: Z, functionName: `decimals` }), e.read({ address: t, abi: Z, functionName: `name` }), e.read({ address: t, abi: Z, functionName: `symbol` })]);
  if (n.value === void 0 || r.value === void 0 || i2.value === void 0) throw Error(`getErc20Metadata: incomplete metadata for ${t} (missing decimals/name/symbol)`);
  return { address: t, decimals: Number(n.value), name: String(r.value), symbol: String(i2.value) };
}
var St = class extends h {
  tokens;
  enableSend;
  constructor({ tokens: e = [], enableSend: t = true, logLevel: n } = {}) {
    super(), d({ logLevel: n }), this.tokens = e, this.enableSend = t;
  }
  async balanceOf(e, t) {
    let n = this.getChain();
    if (t) try {
      let [n2, r] = await Promise.all([this.read({ address: t, abi: Z, functionName: `balanceOf`, args: [e] }), xt(this, t)]);
      if (n2.value === void 0) throw Error(`Incomplete token information received.`);
      let i2 = String(n2.value), a2 = formatUnits(BigInt(i2), r.decimals);
      return { decimals: r.decimals, symbol: r.symbol, name: r.name, value: a2, inBaseUnits: i2 };
    } catch (e2) {
      throw Error(`Failed to fetch balance for token ${t}: ${e2 instanceof Error ? e2.message : String(e2)}`);
    }
    try {
      let e2 = await this.getNativeBalance(), t2 = formatUnits(e2, 18);
      return { decimals: 18, symbol: n.nativeCurrency.symbol, name: n.nativeCurrency.name, value: t2, inBaseUnits: String(e2) };
    } catch (e2) {
      throw Error(`Failed to fetch native balance: ${e2 instanceof Error ? e2.message : String(e2)}`);
    }
  }
  addToken(e) {
    let t = e.symbol.toUpperCase();
    this.tokens = this.tokens.filter((e2) => e2.symbol.toUpperCase() !== t).concat(e);
  }
  removeToken(e) {
    let t = e.toUpperCase(), n = this.tokens.length;
    return this.tokens = this.tokens.filter((e2) => e2.symbol.toUpperCase() !== t), this.tokens.length !== n;
  }
  getTokens() {
    return [...this.tokens];
  }
  async getTokenInfoByTicker(e) {
    let t = this.getChain(), n = e.toUpperCase(), r = this.tokens.find((e2) => e2.symbol.toUpperCase() === n);
    if (r) {
      let n2 = r.chains[t.id]?.contractAddress;
      if (!n2) throw Error(`Token ${e} configured but not found on chain ${t.id}`);
      return { symbol: r.symbol, contractAddress: n2, decimals: r.decimals, name: r.name };
    }
    if (n === t.nativeCurrency.symbol.toUpperCase() || n === `ETH`) return { symbol: t.nativeCurrency.symbol, contractAddress: ``, decimals: 18, name: t.nativeCurrency.name };
    throw Error(`Token with ticker ${e} not found or not configured for chain ${t.id}`);
  }
  async getTokenMetadata(e) {
    let [t, n, r] = await Promise.all([this.read({ address: e, abi: Z, functionName: `name` }), this.read({ address: e, abi: Z, functionName: `symbol` }), this.read({ address: e, abi: Z, functionName: `decimals` })]);
    if (t.value === void 0 || n.value === void 0 || r.value === void 0) throw Error(`Failed to fetch ERC-20 metadata for ${e}: incomplete on-chain response`);
    return { name: String(t.value), symbol: String(n.value), decimals: Number(r.value) };
  }
  async _getTokenDecimals(e) {
    if (e) try {
      let t = await this.read({ address: e, abi: Z, functionName: `decimals` });
      if (t.value === void 0) throw Error(`Could not retrieve decimals.`);
      return Number(t.value);
    } catch (t) {
      throw Error(`Failed to fetch decimals for token ${e}: ${t instanceof Error ? t.message : String(t)}`);
    }
    return 18;
  }
  async convertToBaseUnits(e) {
    let { amount: t, tokenAddress: n } = e, r = await this._getTokenDecimals(n);
    try {
      let e2 = Number.parseFloat(t);
      if (Number.isNaN(e2) || !Number.isFinite(e2)) throw Error(`Invalid amount format: ${t}`);
      let n2 = parseUnits(t, r);
      return String(n2);
    } catch (e2) {
      throw Error(`Failed to convert amount to base units: ${e2 instanceof Error ? e2.message : String(e2)}`);
    }
  }
  async convertFromBaseUnits(e) {
    let { amount: t, tokenAddress: n } = e;
    if (!/^\d+$/.test(t)) throw Error(`Invalid base unit amount format: ${t}`);
    let r = await this._getTokenDecimals(n);
    try {
      return formatUnits(BigInt(t), r);
    } catch (e2) {
      throw Error(`Failed to convert amount from base units: ${e2 instanceof Error ? e2.message : String(e2)}`);
    }
  }
  async sendToken(e) {
    if (!this.enableSend) throw Error(`Sending tokens is disabled for this wallet instance.`);
    let { recipient: t, amountInBaseUnits: n, tokenAddress: r } = e;
    try {
      return r ? (await this.assertSufficientErc20Balance(r, n), this.sendTransaction({ to: r, abi: Z, functionName: `transfer`, args: [t, BigInt(n)] })) : this.sendTransaction({ to: t, value: BigInt(n) });
    } catch (e2) {
      throw e2 instanceof K2 || e2 instanceof G ? e2 : Error(`Failed to send token: ${e2 instanceof Error ? e2.message : String(e2)}`);
    }
  }
  async getTokenAllowance(e) {
    try {
      let { tokenAddress: t, owner: n, spender: r } = e, i2 = await this.read({ address: t, abi: Z, functionName: `allowance`, args: [n, r] });
      if (i2.value === void 0) throw Error(`Could not retrieve allowance.`);
      return String(i2.value);
    } catch (e2) {
      throw Error(`Failed to fetch allowance: ${e2 instanceof Error ? e2.message : String(e2)}`);
    }
  }
  async approve(e) {
    if (!this.enableSend) throw Error(`Approval operations are disabled for this wallet instance.`);
    try {
      let { tokenAddress: t, spender: n, amount: r } = e;
      if (!/^\d+$/.test(r)) throw Error(`Invalid base unit amount format for approval: ${r}`);
      return this.sendTransaction({ to: t, abi: Z, functionName: `approve`, args: [n, BigInt(r)] });
    } catch (e2) {
      throw Error(`Failed to approve: ${e2 instanceof Error ? e2.message : String(e2)}`);
    }
  }
  async revokeApproval(e) {
    if (!this.enableSend) throw Error(`Approval operations are disabled for this wallet instance.`);
    return this.approve({ ...e, amount: `0` });
  }
  getCoreTools() {
    let e = super.getCoreTools().filter((e2) => e2.name !== `get_balance` && e2.name !== `sign_message`), n = [p({ name: `get_balance`, description: `Get the balance of the wallet for native currency or a specific ERC20 token.`, parameters: dt }, (e2) => this.balanceOf(e2.address, e2.tokenAddress)), p({ name: `sign_message`, description: `Sign a message with the wallet`, parameters: gt }, (e2) => this.signMessage(e2.message, e2.intent, { requestId: e2.requestId })), p({ name: `get_token_info_by_ticker`, description: `Get information about a configured token (like contract address and decimals) by its ticker symbol.`, parameters: pt }, (e2) => this.getTokenInfoByTicker(e2.ticker)), p({ name: `convert_to_base_units`, description: `Convert a token amount from human-readable units to its smallest unit (e.g., wei).`, parameters: mt }, (e2) => this.convertToBaseUnits(e2)), p({ name: `convert_from_base_units`, description: `Convert a token amount from its smallest unit (e.g., wei) to human-readable units.`, parameters: ht }, (e2) => this.convertFromBaseUnits(e2)), p({ name: `sign_typed_data_evm`, description: `Sign an EIP-712 typed data structure (EVM)`, parameters: _t }, (e2) => {
      let { requestId: t, intent: n2, ...r2 } = e2;
      return this.signTypedData(r2, { ...t === void 0 ? {} : { requestId: t }, ...n2 === void 0 ? {} : { intent: n2 } });
    }), p({ name: `get_token_allowance_evm`, description: `Get the allowance of an ERC20 token for a spender (returns amount in base units)`, parameters: vt }, (e2) => this.getTokenAllowance(e2))], r = [];
    return this.enableSend && r.push(p({ name: `send_token`, description: `Send native currency or an ERC20 token to a recipient, in base units.`, parameters: ft }, (e2) => {
      if (!this.enableSend) throw Error(`Sending transactions is disabled for this wallet.`);
      return this.sendToken(e2);
    }), p({ name: `approve_token_evm`, description: `Approve an amount (specified in base units) of an ERC20 token for a spender`, parameters: yt }, (e2) => {
      if (!this.enableSend) throw Error(`Approval operations are disabled for this wallet instance.`);
      return this.approve(e2);
    }), p({ name: `revoke_token_approval_evm`, description: `Revoke approval for an ERC20 token from a spender (sets allowance to 0)`, parameters: bt }, (e2) => {
      if (!this.enableSend) throw Error(`Approval operations are disabled for this wallet instance.`);
      return this.revokeApproval(e2);
    })), [...e, ...n, ...r];
  }
  async assertSufficientErc20Balance(e, t) {
    let n = BigInt(t);
    if (n === 0n) return;
    let r = this.getAddress(), i2 = await this.read({ address: e, abi: Z, functionName: `balanceOf`, args: [r] });
    if (i2.value === void 0) throw Error(`Could not retrieve ERC-20 balance for ${e} on ${r}.`);
    let a2 = BigInt(i2.value);
    if (a2 < n) throw new K2({ account: r, token: e, balance: a2, required: n });
  }
};
var Q = `metamask`;
function $2() {
  return { id: (0, import_base_controllers.randomId)(), method: `eth_sendTransaction`, origin: Q, isSignOnly: true };
}
var Ct = class extends St {
  stack;
  chain;
  publicClient;
  pollOpts;
  autoApproveHandler;
  constructor(e) {
    super({ tokens: e.tokens, enableSend: e.enableSend, logLevel: e.logLevel }), this.stack = e.stack, this.chain = e.chain, this.pollOpts = e.pollOpts, this.publicClient = createPublicClient({ transport: custom({ request: (t) => e.stack.provider.request(t) }) }), this.stack.keyring.kind === N.BYOK && (this.autoApproveHandler = ({ txMeta: e2, req: t }) => {
      if (t?.origin !== Q) return;
      let { id: r } = e2;
      this.stack.transaction.approveTransaction(r).catch((e3) => {
        c.error(`approveTransaction failed for ${r}:`, e3);
      });
    }, this.stack.transaction.on(import_base_controllers.TX_EVENTS.TX_UNAPPROVED, this.autoApproveHandler));
  }
  getAddress() {
    return this.stack.address;
  }
  getChain() {
    return this.chain;
  }
  async signMessage(e, t, n) {
    return { signature: await J(this.stack.keyring).signPersonalMessage(e, this.stack.address, this.signatureCtx(t, n?.requestId), this.resolvePollOpts(n)) };
  }
  async signTypedData(e, t, n) {
    return { signature: await J(this.stack.keyring).signTypedData(e, this.stack.address, this.typedDataSignatureCtx(t), this.resolvePollOpts(n)) };
  }
  async read(e) {
    return { value: await this.publicClient.readContract({ address: e.address, abi: e.abi, functionName: e.functionName, args: e.args ?? [] }) };
  }
  getEthCode() {
    return ut(this.publicClient);
  }
  async getNativeBalance() {
    return this.publicClient.getBalance({ address: this.stack.address });
  }
  async waitForReceipt(e, t) {
    return this.publicClient.waitForTransactionReceipt({ hash: e, confirmations: t?.confirmations, timeout: t?.timeout, pollingInterval: t?.pollingInterval });
  }
  async sendTransaction(e, t, n) {
    if (this.stack.keyring.kind === N.SERVER) {
      let r = await this.submitTransaction(e, t, n?.requestId, n?.bridgeQuoteId), i2 = X(this.stack.keyring);
      return this.awaitTerminalTxHash(r, () => i2.awaitJob({ pollingId: r.requestId, kind: i.TRANSACTION }, this.resolvePollOpts(n)));
    }
    if (this.stack.keyring.kind === N.BYOK) {
      let r = await this.submitTransaction(e, t, n?.requestId, n?.bridgeQuoteId), i2 = Y(this.stack.keyring);
      return this.awaitTerminalTxHash(r, () => i2.awaitTx({ pollingId: r.requestId, kind: i.TRANSACTION }, this.resolvePollOpts(n)));
    }
    throw Error(`sendTransaction requires BYOK or server keyring mode`);
  }
  async submitTransaction(e, t, n, r) {
    ne(e);
    let i2 = await this.prepareViaController(e, { fillNonce: true });
    if (i2.gasPrice !== void 0) throw Error(`Remote signing service requires EIP-1559; prepareTransaction returned a legacy tx`);
    if (this.stack.keyring.kind === N.BYOK) {
      let e2 = await this.stack.transaction.addNewUnapprovedTransaction(this.preparedToByokTxParams(i2), $2());
      return Y(this.stack.keyring).submitSignedTransaction(e2, this.preparedToRemoteTx(i2), this.signatureCtx(t, n, r));
    }
    return X(this.stack.keyring).submitTransaction(this.preparedToRemoteTx(i2), this.signatureCtx(t, n, r));
  }
  async submitPersonalSign(e, t, n) {
    return this.remoteJobAdapter().submitPersonalSign(this.stack.address, e, this.signatureCtx(t, n));
  }
  async submitSignTypedData(e, t) {
    return this.remoteJobAdapter().submitSignTypedData(this.stack.address, e, this.typedDataSignatureCtx(t));
  }
  async getJobStatus(e) {
    return this.remoteJobAdapter().getJobStatus(e);
  }
  async awaitJob(e, t) {
    return this.remoteJobAdapter().awaitJob(e, t);
  }
  async getMfaApproval(e) {
    return this.remoteJobAdapter().getMfaApproval(e);
  }
  async isNativeBalanceSufficient(e) {
    try {
      return await this.prepareViaController(e, { fillNonce: false }), true;
    } catch (e2) {
      return !(e2 instanceof G);
    }
  }
  async signTransactionOnly(e) {
    if (this.stack.keyring.kind === N.SERVER) throw new C(`signTransactionOnly`);
    let t = await this.prepareViaController(e, { fillNonce: false });
    return { signedTx: await this.stack.transaction.addNewUnapprovedTransaction(this.preparedToByokTxParams(t), $2()) };
  }
  async getUpgradeStatus() {
    return this.assertByok(`getUpgradeStatus`), this.resolveUpgradeStatus();
  }
  async sign7702Authorization() {
    this.assertByok(`sign7702Authorization`);
    let e = this.getAddress(), { isSupported: t } = await (0, import_ethereum_controllers.getIsEip7702UpgradeSupported)(e, toHex(this.chain.id), this.getEthCode());
    if (!t) throw Error(`EIP-7702 upgrade to the MetaMask delegator is not supported on chain ${this.chain.id}`);
    let n = await this.publicClient.getTransactionCount({ address: e, blockTag: `pending` }), r = await J(this.stack.keyring).signEip7702Authorization({ address: import_ethereum_controllers.MetaMask_EIP7702_Stateless_Delegator, chainId: toHex(this.chain.id), nonce: toHex(n) }, e);
    return { authorization: r, relay: r };
  }
  buildGaslessBatch(e) {
    return this.assertByok(`buildGaslessBatch`), (0, import_ethereum_controllers.prepareDelegation)({ delegator: this.getAddress(), chainId: this.chain.id, executions: e });
  }
  async signDelegation(e, t) {
    this.assertByok(`signDelegation`);
    let { signature: n } = await this.signTypedData(t);
    return { ...e, signature: n };
  }
  dispose() {
    this.autoApproveHandler && this.stack.transaction.removeListener(import_base_controllers.TX_EVENTS.TX_UNAPPROVED, this.autoApproveHandler), this.stack.dispose();
  }
  async submitErc7821Batch(e, t) {
    if (e.length === 0) throw Error(`submitErc7821Batch: at least one execution is required`);
    let n = (0, import_ethereum_controllers.generateEIP7702BatchTransaction)(this.getAddress(), (0, import_ethereum_controllers.executionsToBatchTransactionParams)(e));
    if (!n.to || !n.data) throw Error(`submitErc7821Batch: generateEIP7702BatchTransaction returned an incomplete batch`);
    let r = this.stack.keyring.kind === N.SERVER, i2 = r || t?.autoUpgrade !== false, a2;
    if (i2) {
      let e2 = await this.resolveUpgradeStatus();
      e2.isSupported && !e2.isUpgraded && (a2 = { address: import_ethereum_controllers.MetaMask_EIP7702_Stateless_Delegator, chainId: toHex(this.chain.id) });
    }
    let o2 = a2 ? await this.estimateUpgradeBatchGas(n.to, n.data, a2.address) : void 0, s2 = await this.prepareViaController({ to: n.to, data: n.data, ...o2 === void 0 ? {} : { gas: o2 } }, { fillNonce: true });
    if (s2.gasPrice !== void 0) throw Error(`Remote signing service requires EIP-1559; prepareTransaction returned a legacy tx`);
    let c3 = this.signatureCtx(t?.intent, t?.requestId, t?.bridgeQuoteId);
    if (r) return X(this.stack.keyring).submitErc7821Transaction({ ...this.preparedToRemoteTx(s2), encoding: `erc7821` }, c3);
    let l2 = this.preparedToByokTxParams(s2);
    if (a2) {
      if (s2.nonce === void 0) throw Error(`submitErc7821Batch: prepared tx is missing nonce; cannot sign EIP-7702 authorization for same-sender type-4`);
      let e2 = hexToNumber(s2.nonce);
      l2.type = `0x4`, l2.to = l2.from, l2.authorizationList = [{ ...a2, nonce: toHex(e2 + 1) }];
    }
    let u2 = await this.stack.transaction.addNewUnapprovedTransaction(l2, $2()), d3;
    if (a2 && (d3 = L2(u2), !d3?.length)) throw Error(`submitErc7821Batch: signed transaction is missing authorizationList (prefix ${u2.slice(0, 4)}; expected 0x04 type-4)`);
    return Y(this.stack.keyring).submitErc7821Transaction(u2, { ...this.preparedToRemoteTx(s2), encoding: `erc7821`, ...d3?.length ? { authorizationList: d3 } : {} }, c3);
  }
  async sendErc7821Batch(e, t, n) {
    let r = await this.submitErc7821Batch(e, { intent: t, autoUpgrade: n?.autoUpgrade, requestId: n?.requestId, bridgeQuoteId: n?.bridgeQuoteId }), i2 = y(r) ? r : await this.awaitJob({ pollingId: r.requestId, kind: r.kind }, this.resolvePollOpts(n));
    if (i2.status !== s.CONFIRMED && i2.status !== s.BROADCASTED) throw new x(i2);
    return { hash: i2.txHash, requestId: i2.requestId, status: i2.status };
  }
  async submitGaslessRelay(e, t) {
    let n = this.getAddress(), r = this.chain.id, i2 = this.signatureCtx(t?.intent, t?.requestId, t?.bridgeQuoteId), a2 = await this.buildGaslessRelayWire(n, r, e, t?.autoUpgrade);
    return this.submitGaslessRelayWire(a2, i2);
  }
  async sendGaslessRelay(e, t, n) {
    let r = await this.submitGaslessRelay(e, { intent: t, autoUpgrade: n?.autoUpgrade, requestId: n?.requestId, bridgeQuoteId: n?.bridgeQuoteId }), i2 = y(r) ? r : await this.awaitGaslessRelayJob({ pollingId: r.requestId, kind: r.kind }, this.resolvePollOpts(n));
    if (i2.status !== s.CONFIRMED && i2.status !== s.BROADCASTED) throw new x(i2);
    return { hash: i2.txHash, requestId: i2.requestId, status: i2.status };
  }
  async getGaslessRelayJobStatus(e) {
    if (e.kind !== i.TRANSACTION) throw Error(`getGaslessRelayJobStatus: expected a transaction job handle`);
    return this.remoteJobAdapter().getJobStatus(e);
  }
  async awaitGaslessRelayJob(e, t) {
    return this.remoteJobAdapter().awaitJob(e, t);
  }
  async resolveUpgradeStatus() {
    let { isSupported: e, upgradeContractAddress: t, delegationAddress: n } = await (0, import_ethereum_controllers.getIsEip7702UpgradeSupported)(this.getAddress(), toHex(this.chain.id), this.getEthCode());
    return { isSupported: e, isUpgraded: n != null, upgradeContractAddress: t, delegationAddress: n };
  }
  async estimateUpgradeBatchGas(e, t, n) {
    let r = this.getAddress(), i2 = `${import_ethereum_controllers.EIP_7702_PREFIX}${n.slice(2)}`;
    return hexToBigInt(await this.publicClient.request({ method: `eth_estimateGas`, params: [{ from: r, to: e, data: t, value: `0x0` }, `latest`, { [r]: { code: i2 } }] })) * 3n / 2n;
  }
  async buildGaslessRelayWire(e, t, n, r) {
    if (this.stack.keyring.kind === N.SERVER) {
      let { unsignedDelegation: r2 } = (0, import_ethereum_controllers.prepareDelegation)({ delegator: e, chainId: t, executions: n });
      return { from: e, chainId: t, executions: M2(n), delegation: N2(r2) };
    }
    let { unsignedDelegation: i2, typedData: a2 } = this.buildGaslessBatch(n), o2 = await this.signDelegation(i2, a2), s2;
    if (r !== false) {
      let e2 = await this.getUpgradeStatus();
      if (e2.isSupported && !e2.isUpgraded) {
        let { relay: e3 } = await this.sign7702Authorization();
        s2 = [e3];
      }
    }
    return { from: e, chainId: t, executions: M2(n), delegation: P(o2), ...s2?.length ? { authorizationList: F3(s2) } : {} };
  }
  submitGaslessRelayWire(e, t) {
    return this.stack.keyring.kind === N.SERVER ? X(this.stack.keyring).submitRelayTransaction(e, t) : Y(this.stack.keyring).submitRelayTransaction(e, t);
  }
  remoteJobAdapter() {
    return this.stack.keyring.kind === N.SERVER ? X(this.stack.keyring) : Y(this.stack.keyring);
  }
  async awaitTerminalTxHash(e, t) {
    let n = y(e) ? e : await t();
    if (n.kind !== i.TRANSACTION || n.status !== s.CONFIRMED && n.status !== s.BROADCASTED) throw new x(n);
    if (!n.txHash) throw Error(`Remote signing service confirmed request ${e.requestId} but did not return a txHash`);
    return { hash: n.txHash, status: n.status };
  }
  async prepareViaController(e, t) {
    let n = e.data ?? (e.abi && e.functionName ? encodeFunctionData({ abi: e.abi, functionName: e.functionName, args: e.args ?? [] }) : void 0), r = e.maxFeePerGas !== void 0 || e.maxPriorityFeePerGas !== void 0;
    if (e.gasPrice !== void 0 && r) throw Error(`ControllerEVMWalletClient: cannot mix EIP-1559 (maxFeePerGas/maxPriorityFeePerGas) and legacy (gasPrice) fields on the same tx`);
    let i2 = (e2) => `0x${e2.toString(16)}`, a2 = { from: this.stack.address, to: e.to, value: e.value === void 0 ? `0x0` : i2(e.value), data: n, gas: e.gas === void 0 ? void 0 : i2(e.gas), gasPrice: e.gasPrice === void 0 ? void 0 : i2(e.gasPrice), maxFeePerGas: e.maxFeePerGas === void 0 ? void 0 : i2(e.maxFeePerGas), maxPriorityFeePerGas: e.maxPriorityFeePerGas === void 0 ? void 0 : i2(e.maxPriorityFeePerGas), nonce: e.nonce === void 0 ? void 0 : i2(BigInt(e.nonce)) }, o2 = await this.stack.transaction.prepareTransaction(a2, { speed: e.options?.speed ?? import_ethereum_controllers.GasSpeed.MEDIUM, fillNonce: t.fillNonce });
    return await this.assertSufficientNativeFunds(o2, e.value ?? 0n), o2;
  }
  async assertSufficientNativeFunds(e, t) {
    let n = e.gas === void 0 ? 0n : BigInt(e.gas), r = e.maxFeePerGas === void 0 ? e.gasPrice === void 0 ? 0n : BigInt(e.gasPrice) : BigInt(e.maxFeePerGas), i2 = t + n * r;
    if (i2 === 0n) return;
    let a2 = e.from, o2 = await this.publicClient.getBalance({ address: a2 });
    if (o2 < i2) throw new G({ account: a2, balance: o2, required: i2, value: t, gas: n, feePerGas: r });
  }
  preparedToByokTxParams(e) {
    return { from: e.from, to: e.to, value: e.value, data: e.data, gas: e.gas, gasPrice: e.gasPrice, maxFeePerGas: e.maxFeePerGas, maxPriorityFeePerGas: e.maxPriorityFeePerGas, nonce: e.nonce, type: e.type, accessList: e.accessList, authorizationList: e.authorizationList };
  }
  preparedToRemoteTx(e) {
    return { from: e.from.toLowerCase(), to: e.to, chainId: this.chain.id, data: e.data, value: e.value, nonce: e.nonce === void 0 ? void 0 : Number.parseInt(e.nonce, 16), gasLimit: e.gas, maxFeePerGas: e.maxFeePerGas, maxPriorityFeePerGas: e.maxPriorityFeePerGas };
  }
  signatureCtx(e, t, n) {
    return { chainId: this.chain.id, origin: Q, ...e ? { intent: e } : {}, ...t ? { requestId: t } : {}, ...n ? { bridgeQuoteId: n } : {} };
  }
  typedDataSignatureCtx(e) {
    return { chainId: this.chain.id, origin: Q, ...e?.intent ? { intent: e.intent } : {}, ...e?.requestId ? { requestId: e.requestId } : {}, ...e?.protocol !== void 0 && { protocol: e.protocol }, ...e?.protocolPayload !== void 0 && { protocolPayload: e.protocolPayload } };
  }
  resolvePollOpts(e) {
    let { requestId: t, ...n } = e ?? {};
    if (!(!this.pollOpts && Object.keys(n).length === 0)) return { ...this.pollOpts, ...n };
  }
  assertByok(e) {
    if (this.stack.keyring.kind === N.SERVER) throw new C(e);
  }
};
globalThis.window === void 0 && (globalThis.window = globalThis);
function wt(e) {
  d(e);
  let { keyring: t, address: r, rpcUrl: a2, chainId: o2, pollingIntervalSeconds: s2 = 10, eip1559: c3 = true, gasApiEndpoints: l2 } = e, u2 = `0x${o2.toString(16)}`, d3 = l2?.eip1559 ?? `https://gas-api.metaswap.codefi.network/networks/<chain_id>/suggestedGasFees`, ee = l2?.legacy ?? `https://gas-api.metaswap.codefi.network/networks/<chain_id>/gasPrices`, f2 = { chainNamespace: `eip155`, chainId: u2, rpcTarget: a2, blockExplorerUrl: ``, logo: ``, tickerName: ``, ticker: ``, displayName: `` }, p3 = (0, import_base_controllers.createIdleTimeTracker)(), { networkMiddleware: te, blockTracker: m2 } = (0, import_ethereum_controllers.createJsonRpcClient)(f2, { providerConfig: f2, pollingInterval: s2 }, () => u2, p3), h3 = providerFromEngine2(JRPCEngineV2.create({ middleware: [te] })), g2 = t.kind === N.BYOK ? J(t) : void 0, ne2 = g2 ? g2.signTransaction.bind(g2) : Tt(`signEthTx`), _2 = g2 ? g2.signEip7702Authorization.bind(g2) : Tt(`signEip7702Authorization`), v = new import_ethereum_controllers.GasFeeController({ config: { interval: 6e4, legacyAPIEndpoint: ee, EIP1559APIEndpoint: d3 }, state: {}, idleTimeTracker: p3, getNetworkIdentifier: () => u2, getProvider: () => h3, getCurrentNetworkEIP1559Compatibility: async () => c3, getCurrentAccountEIP1559Compatibility: () => c3, getCurrentNetworkLegacyGasAPICompatibility: () => !c3, fetchGasEstimatesViaEthFeeHistory: import_ethereum_controllers.fetchGasEstimatesViaEthFeeHistory, onNetworkStateChange: () => {
  } });
  return { keyring: t, transaction: new import_ethereum_controllers.TransactionController({ config: { txHistoryLimit: 40 }, state: { transactions: {} }, provider: h3, blockTracker: m2, getCurrentChainId: () => u2, getCurrentNetworkEIP1559Compatibility: async () => c3, getCurrentAccountEIP1559Compatibility: async () => c3, getSelectedAddress: () => r, signEthTx: ne2, signEip7702Authorization: _2, getEIP1559GasFeeEstimates: () => v.fetchGasFeeEstimates() }), provider: h3, blockTracker: m2, address: r, chainId: o2, dispose: () => {
    try {
      v.destroy();
    } catch (e2) {
      c.error(`createEvmControllerStack.dispose failed while destroying GasFeeController:`, e2);
    }
    try {
      m2.removeAllListeners();
    } catch (e2) {
      c.error(`createEvmControllerStack.dispose failed while removing block tracker listeners:`, e2);
    }
  } };
}
function Tt(e) {
  return async () => {
    throw Error(`createEvmControllerStack: ${e} called on a server-mode keyring. Server-mode signing must go through ControllerEVMWalletClient.sendTransaction / submitTransaction; the local TransactionController should never be reached.`);
  };
}

export {
  sha2562 as sha256,
  import_ethereum_controllers,
  M2 as M,
  N2 as N,
  at,
  ct,
  lt,
  Y,
  X,
  Z,
  Ct,
  wt
};
