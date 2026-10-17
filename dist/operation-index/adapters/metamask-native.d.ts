import { type MetaMaskNativeOperation } from "../../metamask-native-journal.js";
import { type OperationFamilyAdapter } from "../adapter.js";
/**
 * MetaMask Agent Wallet native-fee transfers. The account is held from admission until the outcome is resolved; a
 * transfer that never reached its effect marker cannot reach it after its consent deadline (one foreground command),
 * and its next status or a new transfer of the account closes it as failed before effect (the family's own rule).
 */
export declare const metaMaskNativeAdapter: OperationFamilyAdapter<MetaMaskNativeOperation>;
