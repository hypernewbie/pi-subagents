import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "./utils.ts";

export const LEGACY_PROJECT_SUBAGENTS_RELATIVE_DIR = ".pi/subagents";

const MIGRATABLE_ENTRIES = [
	"refinements",
	"schedules",
	"project-panes",
	"views",
	"artifacts",
	"chain-runs",
] as const;

export interface ProjectStoreLocation {
	canonicalRoot: string;
	key: string;
	dir: string;
}

export interface MigrationResult {
	migrated: boolean;
	copied: string[];
	errors: string[];
}

export function resolveCanonicalProjectRoot(cwd: string): string {
	let current = path.resolve(cwd);
	try {
		current = fs.realpathSync.native(current);
	} catch {
		try {
			current = fs.realpathSync(current);
		} catch {
			// Lexical fallback when path cannot be resolved
		}
	}

	let gitRoot: string | undefined;
	let packageRoot: string | undefined;

	let check = current;
	while (true) {
		const gitPath = path.join(check, ".git");
		if (!gitRoot && fs.existsSync(gitPath)) {
			// Authoritative Git boundary (handles both directories and worktree/submodule pointers)
			gitRoot = check;
			break;
		}

		const packagePath = path.join(check, "package.json");
		if (!packageRoot && fs.existsSync(packagePath)) {
			// Remember nearest package boundary as non-git fallback
			packageRoot = check;
		}

		const parent = path.dirname(check);
		if (parent === check) break;
		check = parent;
	}

	return gitRoot ?? packageRoot ?? current;
}

export function projectHash(cwd: string): string {
	const canonical = resolveCanonicalProjectRoot(cwd);
	const normalized = process.platform === "win32"
		? canonical.toLowerCase().replace(/\\/g, "/")
		: canonical;
	return createHash("sha256").update(normalized).digest("hex").slice(0, 20);
}

export function resolveProjectStore(cwd: string): ProjectStoreLocation {
	const canonicalRoot = resolveCanonicalProjectRoot(cwd);
	const key = projectHash(canonicalRoot);
	const dir = path.join(getAgentDir(), "projects", key);
	return { canonicalRoot, key, dir };
}

export function getProjectSubagentsDir(cwd: string): string {
	return resolveProjectStore(cwd).dir;
}

function copyDirIfMissing(source: string, destination: string): { copiedCount: number; errors: string[] } {
	let copiedCount = 0;
	const errors: string[] = [];
	if (!fs.existsSync(source)) return { copiedCount, errors };

	try {
		fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
		const entries = fs.readdirSync(source, { withFileTypes: true });
		for (const entry of entries) {
			const srcPath = path.join(source, entry.name);
			const destPath = path.join(destination, entry.name);
			if (fs.existsSync(destPath)) continue;

			if (entry.isDirectory()) {
				const nested = copyDirIfMissing(srcPath, destPath);
				copiedCount += nested.copiedCount;
				errors.push(...nested.errors);
			} else {
				try {
					fs.copyFileSync(srcPath, destPath);
					copiedCount += 1;
				} catch (err) {
					errors.push(`Failed to copy file ${srcPath} -> ${destPath}: ${err instanceof Error ? err.message : String(err)}`);
				}
			}
		}
	} catch (err) {
		errors.push(`Failed to read directory ${source}: ${err instanceof Error ? err.message : String(err)}`);
	}

	return { copiedCount, errors };
}

export function migrateLegacyProjectStore(location: ProjectStoreLocation): MigrationResult {
	const markerFile = path.join(location.dir, "_migration-v1.json");
	if (fs.existsSync(markerFile)) {
		return { migrated: false, copied: [], errors: [] };
	}

	const copied: string[] = [];
	const errors: string[] = [];

	// 1. Migrate legacy repository-local .pi/subagents if present (using canonicalRoot)
	const legacyDir = path.join(location.canonicalRoot, LEGACY_PROJECT_SUBAGENTS_RELATIVE_DIR);
	if (fs.existsSync(legacyDir)) {
		for (const entry of MIGRATABLE_ENTRIES) {
			const src = path.join(legacyDir, entry);
			const dest = path.join(location.dir, entry);
			if (fs.existsSync(src)) {
				const result = copyDirIfMissing(src, dest);
				if (result.copiedCount > 0) copied.push(`legacy:${entry} (${result.copiedCount} items)`);
				errors.push(...result.errors);
			}
		}
	}

	// 2. Migrate raw-CWD hash directory from early transition if different from canonical
	const rawHash = createHash("sha256").update(path.resolve(location.canonicalRoot)).digest("hex").slice(0, 20);
	if (rawHash !== location.key) {
		const rawDir = path.join(getAgentDir(), "projects", rawHash);
		if (fs.existsSync(rawDir)) {
			for (const entry of MIGRATABLE_ENTRIES) {
				const src = path.join(rawDir, entry);
				const dest = path.join(location.dir, entry);
				if (fs.existsSync(src)) {
					const result = copyDirIfMissing(src, dest);
					if (result.copiedCount > 0) copied.push(`raw-hash:${entry} (${result.copiedCount} items)`);
					errors.push(...result.errors);
				}
			}
		}
	}

	// Write central migration marker
	try {
		fs.writeFileSync(markerFile, JSON.stringify({
			timestamp: new Date().toISOString(),
			canonicalRoot: location.canonicalRoot,
			key: location.key,
			copied,
			errors,
		}, null, 2), "utf-8");
	} catch (err) {
		errors.push(`Failed to write migration marker: ${err instanceof Error ? err.message : String(err)}`);
	}

	return { migrated: true, copied, errors };
}

export function ensureProjectStore(locationOrCwd: ProjectStoreLocation | string): ProjectStoreLocation {
	const location = typeof locationOrCwd === "string" ? resolveProjectStore(locationOrCwd) : locationOrCwd;
	if (!fs.existsSync(location.dir)) {
		try {
			fs.mkdirSync(location.dir, { recursive: true, mode: 0o700 });
		} catch {
			// Best-effort directory creation
		}
	}

	const breadcrumb = path.join(location.dir, "_project_root.txt");
	if (!fs.existsSync(breadcrumb)) {
		try {
			fs.writeFileSync(breadcrumb, `${location.canonicalRoot}\n`, "utf-8");
		} catch {
			// Best-effort breadcrumb write
		}
	}

	migrateLegacyProjectStore(location);
	return location;
}

export function ensureProjectSubagentsDir(cwd: string): string {
	return ensureProjectStore(cwd).dir;
}
