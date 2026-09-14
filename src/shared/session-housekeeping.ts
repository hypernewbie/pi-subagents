import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "./utils.ts";

const ORPHAN_SESSION_MIN_AGE_HOURS = 24;
const MAX_SESSION_SCAN_DEPTH = 4;

// Recursively determine the newest mtime among descendants of a session directory
function getNewestMtimeRecursive(dir: string, maxDepth = MAX_SESSION_SCAN_DEPTH): number {
	let newest = 0;
	try {
		const stat = fs.statSync(dir);
		newest = stat.mtimeMs;
		if (maxDepth <= 0) return newest;
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			try {
				if (entry.isDirectory()) {
					const childNewest = getNewestMtimeRecursive(full, maxDepth - 1);
					if (childNewest > newest) newest = childNewest;
				} else {
					const fileStat = fs.statSync(full);
					if (fileStat.mtimeMs > newest) newest = fileStat.mtimeMs;
				}
			} catch {}
		}
	} catch {}
	return newest;
}

// Sweep orphaned session companion directories with safety age guard and descendant liveness checks
export function cleanupOrphanedSessionDirs(minAgeHours = ORPHAN_SESSION_MIN_AGE_HOURS): void {
	const sessionsBase = path.join(getAgentDir(), "sessions");
	if (!fs.existsSync(sessionsBase)) return;

	let workspaceDirs: string[];
	try {
		workspaceDirs = fs.readdirSync(sessionsBase);
	} catch {
		return;
	}

	const now = Date.now();
	const minAgeMs = Math.max(1, minAgeHours) * 60 * 60 * 1000;

	for (const ws of workspaceDirs) {
		const wsPath = path.join(sessionsBase, ws);
		try {
			const wsStat = fs.statSync(wsPath);
			if (!wsStat.isDirectory()) continue;

			const entries = fs.readdirSync(wsPath);
			const jsonlStems = new Set(
				entries.filter((e) => e.endsWith(".jsonl")).map((e) => e.slice(0, -6)),
			);

			for (const entry of entries) {
				if (entry === "subagent-artifacts" || entry.endsWith(".jsonl")) continue;
				const entryPath = path.join(wsPath, entry);
				try {
					const entryStat = fs.statSync(entryPath);
					if (!entryStat.isDirectory()) continue;
					if (jsonlStems.has(entry)) continue;

					// Inspect recursive descendant mtime to ensure active/recent child
					// sessions or attached work are never purged
					const newestDescendantMtime = getNewestMtimeRecursive(entryPath);
					if (now - newestDescendantMtime > minAgeMs) {
						fs.rmSync(entryPath, { recursive: true, force: true });
					}
				} catch {
					// Best-effort cleanup
				}
			}
		} catch {
			// Best-effort cleanup
		}
	}
}
