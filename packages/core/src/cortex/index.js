"use strict";
/**
 * CMP v3.0 — Mesh Cortex (Layer 14)
 * Distributed neural network inference across mesh devices.
 *
 * @module cortex
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultLayerFunction = exports.LayerExecutor = exports.rebalancePartitions = exports.partitionModel = exports.MeshCortex = void 0;
var mesh_cortex_1 = require("./mesh-cortex");
Object.defineProperty(exports, "MeshCortex", { enumerable: true, get: function () { return mesh_cortex_1.MeshCortex; } });
var partitioner_1 = require("./partitioner");
Object.defineProperty(exports, "partitionModel", { enumerable: true, get: function () { return partitioner_1.partitionModel; } });
Object.defineProperty(exports, "rebalancePartitions", { enumerable: true, get: function () { return partitioner_1.rebalancePartitions; } });
var layer_executor_1 = require("./layer-executor");
Object.defineProperty(exports, "LayerExecutor", { enumerable: true, get: function () { return layer_executor_1.LayerExecutor; } });
Object.defineProperty(exports, "defaultLayerFunction", { enumerable: true, get: function () { return layer_executor_1.defaultLayerFunction; } });
//# sourceMappingURL=index.js.map