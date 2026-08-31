import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
	getArtifactsDir,
	getChainRunsDir,
	getProjectArtifactsDir,
	getProjectChainRunsDir,
	getProjectSubagentsDir,
} from "../../src/shared/artifacts.ts";
import {
	ensureProjectStore,
	ensureProjectSubagentsDir,
	migrateLegacyProjectStore,
	projectHash,
	resolveCanonicalProjectRoot,
	resolveProjectStore,
} from "../../src/shared/project-store.ts";
import { cleanupOrphanedSessionDirs } from "../../src/shared/session-housekeeping.ts";
import { CHAIN_RUNS_DIR, TEMP_ARTIFACTS_DIR } from "../../src/shared/types.ts";
import { getAgentDir } from "../../src/shared/utils.ts";

describe("project-local artifact paths", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
	});

	it("resolves centralised project-scoped paths outside the repo working tree", () => {
		const cwd = path.join(os.tmpdir(), "pi-test-repo");
		const expectedDir = getProjectSubagentsDir(cwd);
		assert.equal(getProjectArtifactsDir(cwd), path.join(expectedDir, "artifacts"));
		assert.equal(getProjectChainRunsDir(cwd), path.join(expectedDir, "chain-runs"));
		assert.equal(getArtifactsDir(null, cwd, "project"), path.join(expectedDir, "artifacts"));
	});

	it("routes chain scratch files according to the artifact preference", () => {
		const cwd = path.join(os.tmpdir(), "pi-test-repo");
		assert.equal(getChainRunsDir(cwd), CHAIN_RUNS_DIR);
		assert.equal(getChainRunsDir(cwd, "project"), getProjectChainRunsDir(cwd));
		assert.equal(getChainRunsDir(cwd, "session"), CHAIN_RUNS_DIR);
		assert.equal(getChainRunsDir(cwd, "temp"), CHAIN_RUNS_DIR);
	});

	it("defaults artifacts to the session directory and falls back to temp", () => {
		const cwd = path.join(os.tmpdir(), "pi-test-repo");
		const sessionFile = path.join(os.tmpdir(), "sessions", "parent.jsonl");
		assert.equal(getArtifactsDir(sessionFile, cwd), path.join(os.tmpdir(), "sessions", "subagent-artifacts"));
		assert.equal(getArtifactsDir(null, cwd), path.join(TEMP_ARTIFACTS_DIR));
	});
});

describe("canonical project identity and resolution", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
	});

	it("resolves nested subdirectories to the Git repository root", () => {
		const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-canonical-repo-"));
		tempDirs.push(repoRoot);
		const nestedDir = path.join(repoRoot, "src", "packages", "core", "components");
		fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
		fs.mkdirSync(nestedDir, { recursive: true });

		assert.equal(resolveCanonicalProjectRoot(nestedDir), resolveCanonicalProjectRoot(repoRoot));
		assert.equal(projectHash(nestedDir), projectHash(repoRoot));
	});

	it("gives Git root precedence over nested package.json boundaries in monorepos", () => {
		const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-monorepo-"));
		tempDirs.push(repoRoot);
		const childPkg = path.join(repoRoot, "packages", "child-app");
		fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
		fs.mkdirSync(childPkg, { recursive: true });
		fs.writeFileSync(path.join(childPkg, "package.json"), JSON.stringify({ name: "child-app" }));

		assert.equal(resolveCanonicalProjectRoot(childPkg), resolveCanonicalProjectRoot(repoRoot));
		assert.equal(projectHash(childPkg), projectHash(repoRoot));
	});

	it("falls back to package.json when outside a Git repository", () => {
		const pkgRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-nongit-pkg-"));
		tempDirs.push(pkgRoot);
		const subDir = path.join(pkgRoot, "lib", "utils");
		fs.mkdirSync(subDir, { recursive: true });
		fs.writeFileSync(path.join(pkgRoot, "package.json"), JSON.stringify({ name: "plain-pkg" }));

		assert.equal(resolveCanonicalProjectRoot(subDir), resolveCanonicalProjectRoot(pkgRoot));
	});
});

describe("safe project provisioning and central migration", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
	});

	it("provisions project directory, writes breadcrumb, and migrates legacy data with central marker only", () => {
		const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-migrate-test-"));
		tempDirs.push(projectDir);
		const legacySubagents = path.join(projectDir, ".pi", "subagents", "schedules", "sched-1");
		fs.mkdirSync(legacySubagents, { recursive: true });
		fs.writeFileSync(path.join(legacySubagents, "schedule.json"), JSON.stringify({ id: "sched-1" }));

		const centralDir = ensureProjectSubagentsDir(projectDir);
		assert.equal(centralDir, getProjectSubagentsDir(projectDir));
		assert.equal(fs.existsSync(path.join(centralDir, "_project_root.txt")), true);
		assert.equal(fs.existsSync(path.join(centralDir, "schedules", "sched-1", "schedule.json")), true);
		// Legacy directory remains untouched - NO migration files written to repository working tree!
		assert.equal(fs.existsSync(path.join(projectDir, ".pi", "subagents", "schedules", "sched-1", "schedule.json")), true);
		assert.equal(fs.existsSync(path.join(projectDir, ".pi", "subagents", ".migrated-to-central")), false);
		assert.equal(fs.existsSync(path.join(centralDir, "_migration-v1.json")), true);
	});

	it("runs migration even when the central directory already exists", () => {
		const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-preexisting-test-"));
		tempDirs.push(projectDir);
		const location = resolveProjectStore(projectDir);
		fs.mkdirSync(location.dir, { recursive: true });

		const legacySubagents = path.join(projectDir, ".pi", "subagents", "refinements");
		fs.mkdirSync(legacySubagents, { recursive: true });
		fs.writeFileSync(path.join(legacySubagents, "worker.md"), "legacy refinement");

		ensureProjectStore(location);
		assert.equal(fs.existsSync(path.join(location.dir, "refinements", "worker.md")), true);
		assert.equal(fs.existsSync(path.join(location.dir, "_migration-v1.json")), true);
	});

	it("discovers repository legacy data when launched from a subdirectory", () => {
		const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sublaunch-test-"));
		tempDirs.push(repoRoot);
		fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
		const subDir = path.join(repoRoot, "deep", "nested", "module");
		fs.mkdirSync(subDir, { recursive: true });

		const legacySubagents = path.join(repoRoot, ".pi", "subagents", "schedules", "deep-sched");
		fs.mkdirSync(legacySubagents, { recursive: true });
		fs.writeFileSync(path.join(legacySubagents, "schedule.json"), JSON.stringify({ id: "deep-sched" }));

		const location = resolveProjectStore(subDir);
		ensureProjectStore(location);
		assert.equal(fs.existsSync(path.join(location.dir, "schedules", "deep-sched", "schedule.json")), true);
	});
});

describe("liveness-aware orphaned session cleanup", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
	});

	it("preserves fresh companions, active nested child sessions, and purges only stale orphans", () => {
		const wsDir = path.join(getAgentDir(), "sessions", "--mock-cleanup-ws--");
		tempDirs.push(wsDir);
		fs.mkdirSync(wsDir, { recursive: true });

		// 1. Active session with matching .jsonl
		fs.writeFileSync(path.join(wsDir, "sess-active.jsonl"), "{}");
		fs.mkdirSync(path.join(wsDir, "sess-active"), { recursive: true });

		// 2. Fresh orphan directory (<24h)
		const freshOrphan = path.join(wsDir, "sess-fresh-orphan");
		fs.mkdirSync(freshOrphan, { recursive: true });

		// 3. Old companion directory (>24h) with fresh active nested child session
		const oldWithActiveChild = path.join(wsDir, "sess-old-with-active-child");
		const nestedChildDir = path.join(oldWithActiveChild, "run-1", "child-session");
		fs.mkdirSync(nestedChildDir, { recursive: true });
		fs.writeFileSync(path.join(nestedChildDir, "session.jsonl"), "{}");
		const pastTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
		fs.utimesSync(oldWithActiveChild, pastTime, pastTime);

		// 4. Stale true orphan (>24h with stale descendants)
		const staleOrphan = path.join(wsDir, "sess-stale-orphan");
		fs.mkdirSync(staleOrphan, { recursive: true });
		fs.writeFileSync(path.join(staleOrphan, "stale.txt"), "old");
		fs.utimesSync(path.join(staleOrphan, "stale.txt"), pastTime, pastTime);
		fs.utimesSync(staleOrphan, pastTime, pastTime);

		cleanupOrphanedSessionDirs(24);

		const remaining = fs.readdirSync(wsDir);
		assert.equal(remaining.includes("sess-active"), true);
		assert.equal(remaining.includes("sess-fresh-orphan"), true);
		assert.equal(remaining.includes("sess-old-with-active-child"), true);
		assert.equal(remaining.includes("sess-stale-orphan"), false);
	});
});
