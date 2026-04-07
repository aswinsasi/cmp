"use strict";
/**
 * CMP Result Types
 * Layer 6: Chunk results, verification, and task completion.
 *
 * @module types/result
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChunkStatus = void 0;
var ChunkStatus;
(function (ChunkStatus) {
    ChunkStatus[ChunkStatus["SUCCESS"] = 0] = "SUCCESS";
    ChunkStatus[ChunkStatus["FAILED"] = 1] = "FAILED";
    ChunkStatus[ChunkStatus["TIMEOUT"] = 2] = "TIMEOUT";
    ChunkStatus[ChunkStatus["RESOURCE_EXCEEDED"] = 3] = "RESOURCE_EXCEEDED";
})(ChunkStatus || (exports.ChunkStatus = ChunkStatus = {}));
//# sourceMappingURL=result.js.map