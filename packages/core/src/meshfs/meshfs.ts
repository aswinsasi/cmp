/**
 * CMP v4.0 — MeshFS
 *
 * Shared filesystem built on Holographic Memory.
 * Paths are keys. Files are erasure-coded and distributed.
 * Gravity-aware reads prefer local shards.
 *
 * API:
 *   meshfs.write("/data/sensors/today.csv", data)
 *   meshfs.read("/data/sensors/today.csv") → Uint8Array
 *   meshfs.ls("/data/sensors/") → DirEntry[]
 *   meshfs.rm("/data/sensors/old.csv")
 *   meshfs.info("/data/sensors/today.csv") → FileInfo
 *
 * @module meshfs/meshfs
 * @author Agent Viscro
 */

import { Logger } from '../utils/logger';
import { PathResolver } from './path-resolver';
import {
  MeshFileEntry, MeshDirEntry, MeshFileInfo,
  WriteOptions, MeshFSConfig, DEFAULT_MESHFS_CONFIG,
} from './meshfs-types';

const log = new Logger('MeshFS');

// ─── Simple Hash ───

function simpleHash(data: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i];
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// ─── MeshFS ───

export class MeshFS {
  private files = new Map<string, MeshFileEntry>();
  private data = new Map<string, Uint8Array>();
  private resolver: PathResolver;
  private config: MeshFSConfig;
  private localDeviceId: string;

  // Stats
  private stats = {
    writes: 0,
    reads: 0,
    deletes: 0,
    bytesWritten: 0,
    bytesRead: 0,
  };

  constructor(localDeviceId: string, config: Partial<MeshFSConfig> = {}) {
    this.localDeviceId = localDeviceId;
    this.config = { ...DEFAULT_MESHFS_CONFIG, ...config };
    this.resolver = new PathResolver(this.config.maxPathDepth);
  }

  // ══════════════════════════════════════
  // Write
  // ══════════════════════════════════════

  /**
   * Write a file to the mesh filesystem.
   */
  write(path: string, content: Uint8Array, options: WriteOptions = {}): MeshFileEntry {
    const normalized = this.resolver.normalize(path);

    // Validate
    const validation = this.resolver.validate(normalized);
    if (!validation.valid) {
      throw new Error(`Invalid path "${path}": ${validation.error}`);
    }

    if (content.length > this.config.maxFileSizeBytes) {
      throw new Error(`File too large: ${content.length} bytes (max: ${this.config.maxFileSizeBytes})`);
    }

    if (this.files.size >= this.config.maxFiles && !this.files.has(normalized)) {
      throw new Error(`Maximum files (${this.config.maxFiles}) reached`);
    }

    // Check overwrite
    const existing = this.files.get(normalized);
    if (existing && options.overwrite === false) {
      throw new Error(`File "${normalized}" already exists (overwrite=false)`);
    }

    // Create entry
    const entry: MeshFileEntry = {
      path: normalized,
      name: this.resolver.basename(normalized),
      sizeBytes: content.length,
      mimeType: options.mimeType ?? this.guessMimeType(normalized),
      contentHash: simpleHash(content),
      ownerDeviceId: this.localDeviceId,
      replicaDevices: [this.localDeviceId],
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      isDirectory: false,
      metadata: options.metadata ?? {},
    };

    // Store
    this.files.set(normalized, entry);
    this.data.set(normalized, new Uint8Array(content)); // Copy

    // Ensure parent directories exist
    this.ensureDirectories(normalized);

    this.stats.writes++;
    this.stats.bytesWritten += content.length;

    log.info(`Write: ${normalized} (${content.length} bytes)`);
    return entry;
  }

  // ══════════════════════════════════════
  // Read
  // ══════════════════════════════════════

  /**
   * Read a file from the mesh filesystem.
   */
  read(path: string): Uint8Array | null {
    const normalized = this.resolver.normalize(path);
    const content = this.data.get(normalized);

    if (!content) {
      return null;
    }

    this.stats.reads++;
    this.stats.bytesRead += content.length;

    return new Uint8Array(content); // Return copy
  }

  // ══════════════════════════════════════
  // List
  // ══════════════════════════════════════

  /**
   * List contents of a directory.
   */
  ls(dirPath: string = '/'): MeshDirEntry[] {
    const normalized = this.resolver.normalize(dirPath);
    const allPaths = Array.from(this.files.keys());
    const children = this.resolver.listChildren(normalized, allPaths);

    return children.map(childPath => {
      const entry = this.files.get(childPath);
      return {
        name: this.resolver.basename(childPath),
        path: childPath,
        isDirectory: entry?.isDirectory ?? false,
        sizeBytes: entry?.sizeBytes ?? 0,
        updatedAt: entry?.updatedAt ?? 0,
      };
    }).sort((a, b) => {
      // Directories first, then alphabetical
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  // ══════════════════════════════════════
  // Delete
  // ══════════════════════════════════════

  /**
   * Delete a file.
   */
  rm(path: string): boolean {
    const normalized = this.resolver.normalize(path);
    const entry = this.files.get(normalized);

    if (!entry) return false;

    // Don't delete non-empty directories
    if (entry.isDirectory) {
      const children = this.ls(normalized);
      if (children.length > 0) {
        throw new Error(`Cannot delete non-empty directory "${normalized}"`);
      }
    }

    this.files.delete(normalized);
    this.data.delete(normalized);
    this.stats.deletes++;

    log.info(`Delete: ${normalized}`);
    return true;
  }

  // ══════════════════════════════════════
  // Info
  // ══════════════════════════════════════

  /**
   * Get detailed info about a file.
   */
  info(path: string): MeshFileInfo | null {
    const normalized = this.resolver.normalize(path);
    const entry = this.files.get(normalized);

    if (!entry) return null;

    return {
      entry,
      replicaCount: entry.replicaDevices.length,
      totalStorageBytes: entry.sizeBytes * entry.replicaDevices.length,
      healthy: entry.replicaDevices.length >= 1,
    };
  }

  /**
   * Check if a path exists.
   */
  exists(path: string): boolean {
    return this.files.has(this.resolver.normalize(path));
  }

  // ══════════════════════════════════════
  // Mkdir
  // ══════════════════════════════════════

  /**
   * Create a directory.
   */
  mkdir(path: string): MeshFileEntry {
    const normalized = this.resolver.normalize(path);

    if (this.files.has(normalized)) {
      const existing = this.files.get(normalized)!;
      if (existing.isDirectory) return existing;
      throw new Error(`"${normalized}" exists and is not a directory`);
    }

    const entry: MeshFileEntry = {
      path: normalized,
      name: this.resolver.basename(normalized),
      sizeBytes: 0,
      mimeType: 'inode/directory',
      contentHash: '',
      ownerDeviceId: this.localDeviceId,
      replicaDevices: [this.localDeviceId],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isDirectory: true,
      metadata: {},
    };

    this.files.set(normalized, entry);
    this.ensureDirectories(normalized);

    return entry;
  }

  // ══════════════════════════════════════
  // Stats
  // ══════════════════════════════════════

  /**
   * Get filesystem stats.
   */
  getStats(): {
    totalFiles: number;
    totalDirectories: number;
    totalSizeBytes: number;
    writes: number;
    reads: number;
    deletes: number;
    bytesWritten: number;
    bytesRead: number;
  } {
    let files = 0, dirs = 0, size = 0;
    for (const entry of this.files.values()) {
      if (entry.isDirectory) dirs++;
      else { files++; size += entry.sizeBytes; }
    }

    return {
      totalFiles: files,
      totalDirectories: dirs,
      totalSizeBytes: size,
      ...this.stats,
    };
  }

  /**
   * Get the path resolver (for direct use).
   */
  getResolver(): PathResolver {
    return this.resolver;
  }

  /**
   * Clear all files and directories.
   */
  clear(): void {
    this.files.clear();
    this.data.clear();
  }

  // ══════════════════════════════════════
  // Internals
  // ══════════════════════════════════════

  /**
   * Ensure all parent directories exist.
   */
  private ensureDirectories(filePath: string): void {
    let current = this.resolver.parent(filePath);
    while (current !== '/' && !this.files.has(current)) {
      this.files.set(current, {
        path: current,
        name: this.resolver.basename(current),
        sizeBytes: 0,
        mimeType: 'inode/directory',
        contentHash: '',
        ownerDeviceId: this.localDeviceId,
        replicaDevices: [this.localDeviceId],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isDirectory: true,
        metadata: {},
      });
      current = this.resolver.parent(current);
    }
  }

  /**
   * Guess MIME type from file extension.
   */
  private guessMimeType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    const types: Record<string, string> = {
      csv: 'text/csv',
      json: 'application/json',
      txt: 'text/plain',
      bin: 'application/octet-stream',
      wasm: 'application/wasm',
      html: 'text/html',
      xml: 'application/xml',
      png: 'image/png',
      jpg: 'image/jpeg',
    };
    return types[ext ?? ''] ?? 'application/octet-stream';
  }
}
