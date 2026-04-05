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

// ─── File Entry ───

export interface MeshFileEntry {
  /** Full path (e.g., "/data/sensors/today.csv") */
  path: string;
  /** File name (e.g., "today.csv") */
  name: string;
  /** File size in bytes */
  sizeBytes: number;
  /** MIME type (if known) */
  mimeType: string;
  /** Content hash for integrity verification */
  contentHash: string;
  /** Device that owns/created this file */
  ownerDeviceId: string;
  /** Devices holding replicas/shards */
  replicaDevices: string[];
  /** Creation timestamp */
  createdAt: number;
  /** Last modified timestamp */
  updatedAt: number;
  /** Whether this is a directory */
  isDirectory: boolean;
  /** Metadata (user-defined key-value pairs) */
  metadata: Record<string, string>;
}

// ─── Directory Listing ───

export interface MeshDirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  sizeBytes: number;
  updatedAt: number;
}

// ─── File Info ───

export interface MeshFileInfo {
  entry: MeshFileEntry;
  /** Number of shards/replicas */
  replicaCount: number;
  /** Total storage used (including replicas) */
  totalStorageBytes: number;
  /** Whether all shards are healthy */
  healthy: boolean;
}

// ─── Write Options ───

export interface WriteOptions {
  /** MIME type */
  mimeType?: string;
  /** Custom metadata */
  metadata?: Record<string, string>;
  /** Number of replicas (default: 1) */
  replicas?: number;
  /** Overwrite if exists (default: true) */
  overwrite?: boolean;
}

// ─── MeshFS Config ───

export interface MeshFSConfig {
  /** Default number of replicas for new files */
  defaultReplicas: number;
  /** Maximum file size in bytes (default: 100MB) */
  maxFileSizeBytes: number;
  /** Maximum path depth */
  maxPathDepth: number;
  /** Maximum files tracked */
  maxFiles: number;
}

export const DEFAULT_MESHFS_CONFIG: MeshFSConfig = {
  defaultReplicas: 1,
  maxFileSizeBytes: 100 * 1024 * 1024, // 100MB
  maxPathDepth: 10,
  maxFiles: 10000,
};
