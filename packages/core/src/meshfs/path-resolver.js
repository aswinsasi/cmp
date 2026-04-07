"use strict";
/**
 * CMP v4.0 — MeshFS Path Resolver
 *
 * Hierarchical path namespace for the mesh filesystem.
 * Normalizes paths, resolves parent/child relationships,
 * and validates path constraints.
 *
 * Paths follow Unix conventions:
 *   /data/sensors/today.csv
 *   /data/sensors/
 *   /
 *
 * @module meshfs/path-resolver
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PathResolver = void 0;
// ─── Path Resolver ───
class PathResolver {
    maxDepth;
    constructor(maxDepth = 10) {
        this.maxDepth = maxDepth;
    }
    /**
     * Normalize a path: ensure leading /, remove trailing /, collapse //.
     */
    normalize(path) {
        // Ensure leading /
        if (!path.startsWith('/'))
            path = '/' + path;
        // Remove trailing / (except root)
        if (path.length > 1 && path.endsWith('/'))
            path = path.slice(0, -1);
        // Collapse //
        path = path.replace(/\/+/g, '/');
        // Resolve . and ..
        const parts = path.split('/').filter(p => p !== '.');
        const resolved = [];
        for (const part of parts) {
            if (part === '..') {
                resolved.pop();
            }
            else {
                resolved.push(part);
            }
        }
        const result = resolved.join('/') || '/';
        return result;
    }
    /**
     * Get the parent directory of a path.
     */
    parent(path) {
        const normalized = this.normalize(path);
        if (normalized === '/')
            return '/';
        const lastSlash = normalized.lastIndexOf('/');
        if (lastSlash <= 0)
            return '/';
        return normalized.substring(0, lastSlash);
    }
    /**
     * Get the file/directory name (last component).
     */
    basename(path) {
        const normalized = this.normalize(path);
        if (normalized === '/')
            return '/';
        const lastSlash = normalized.lastIndexOf('/');
        return normalized.substring(lastSlash + 1);
    }
    /**
     * Get the directory part of a path.
     */
    dirname(path) {
        return this.parent(path);
    }
    /**
     * Join two path segments.
     */
    join(base, ...segments) {
        let result = base;
        for (const seg of segments) {
            if (seg.startsWith('/')) {
                result = seg;
            }
            else {
                result = result + '/' + seg;
            }
        }
        return this.normalize(result);
    }
    /**
     * Check if a path is a child of another.
     */
    isChildOf(child, parent) {
        const normalChild = this.normalize(child);
        const normalParent = this.normalize(parent);
        if (normalParent === '/')
            return normalChild !== '/';
        return normalChild.startsWith(normalParent + '/');
    }
    /**
     * Get the depth of a path (/ = 0, /a = 1, /a/b = 2).
     */
    depth(path) {
        const normalized = this.normalize(path);
        if (normalized === '/')
            return 0;
        return normalized.split('/').length - 1;
    }
    /**
     * Validate a path.
     */
    validate(path) {
        if (!path || path.trim().length === 0) {
            return { valid: false, error: 'Path is empty' };
        }
        const normalized = this.normalize(path);
        if (!normalized.startsWith('/')) {
            return { valid: false, error: 'Path must start with /' };
        }
        if (this.depth(normalized) > this.maxDepth) {
            return { valid: false, error: `Path depth ${this.depth(normalized)} exceeds max ${this.maxDepth}` };
        }
        // Check for invalid characters
        if (/[<>:"|?*\x00-\x1f]/.test(normalized)) {
            return { valid: false, error: 'Path contains invalid characters' };
        }
        return { valid: true, error: null };
    }
    /**
     * List immediate children paths of a directory from a set of all paths.
     */
    listChildren(dirPath, allPaths) {
        const normalDir = this.normalize(dirPath);
        const dirDepth = this.depth(normalDir);
        return allPaths
            .map(p => this.normalize(p))
            .filter(p => {
            if (!this.isChildOf(p, normalDir))
                return false;
            // Only immediate children (depth = dirDepth + 1)
            return this.depth(p) === dirDepth + 1;
        });
    }
    /**
     * Extract unique directory paths from a set of file paths.
     */
    extractDirectories(filePaths) {
        const dirs = new Set();
        dirs.add('/');
        for (const fp of filePaths) {
            let current = this.normalize(fp);
            while (current !== '/') {
                current = this.parent(current);
                dirs.add(current);
            }
        }
        return Array.from(dirs).sort();
    }
}
exports.PathResolver = PathResolver;
//# sourceMappingURL=path-resolver.js.map