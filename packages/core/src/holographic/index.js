"use strict";
/**
 * CMP v3.0 — Holographic State (Layer 15)
 * Erasure-coded distributed shared memory.
 *
 * @module holographic
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyShard = exports.simpleHash = exports.calculateShardCounts = exports.rsDecode = exports.rsEncode = exports.MeshMemory = void 0;
var mesh_memory_1 = require("./mesh-memory");
Object.defineProperty(exports, "MeshMemory", { enumerable: true, get: function () { return mesh_memory_1.MeshMemory; } });
var erasure_1 = require("./erasure");
Object.defineProperty(exports, "rsEncode", { enumerable: true, get: function () { return erasure_1.rsEncode; } });
Object.defineProperty(exports, "rsDecode", { enumerable: true, get: function () { return erasure_1.rsDecode; } });
Object.defineProperty(exports, "calculateShardCounts", { enumerable: true, get: function () { return erasure_1.calculateShardCounts; } });
Object.defineProperty(exports, "simpleHash", { enumerable: true, get: function () { return erasure_1.simpleHash; } });
Object.defineProperty(exports, "verifyShard", { enumerable: true, get: function () { return erasure_1.verifyShard; } });
//# sourceMappingURL=index.js.map