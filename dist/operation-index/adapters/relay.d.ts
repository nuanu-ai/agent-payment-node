import { type MoneyConflictDomain } from "../../operation-conflict-domain.js";
import { type RelayUnsignedOperation } from "../../relay-unsigned-operation.js";
import { type OperationFamilyAdapter } from "../adapter.js";
export declare function relayDomains(record: RelayUnsignedOperation): readonly MoneyConflictDomain[];
/** The public view: a retirement or a proven source outcome ends this spend attempt (destination delivery is observed separately). */
export declare function relayStatus(root: string, operation: RelayUnsignedOperation): Promise<import("../../relay-unsigned-operation.js").PublicRelayUnsignedOperation>;
/** The saved draft stays `prepared`; it stops holding its account once retired or once its source effect is final. */
export declare const relayAdapter: OperationFamilyAdapter<RelayUnsignedOperation>;
