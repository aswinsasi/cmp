"use strict";
/**
 * CMP v4.0 — MeshFS Types
 *
 * Type definitions for the mesh filesystem.
 * MeshFS provides a shared filesystem on top of Holographic Memory
 * with hierarchical path namespace and erasure-coded storage.
 *
 * @module meshfs/meshfs-types
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MESHFS_CONFIG = void 0;
exports.DEFAULT_MESHFS_CONFIG = {
    defaultReplicas: 1,
    maxFileSizeBytes: 100 * 1024 * 1024, // 100MB
    maxPathDepth: 10,
    maxFiles: 10000,
};
//# sourceMappingURL=meshfs-types.js.map