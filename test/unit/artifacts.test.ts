import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
	getArtifactsDir,
	getProjectArtifactPackagingWarning,
	getChainRunsDir,
	getProjectArtifactsDir,
	getProjectChainRunsDir,
	getProjectSubagentsDir,
} from "../../src/shared/artifacts.ts";
import { CHAIN_RUNS_DIR, TEMP_ARTIFACTS_DIR } from "../../src/shared/types.ts";

describe("project-local artifact paths", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
	});

	function packageDir(packageJson: object, ignore?: { name: ".npmignore" | ".gitignore"; content: string }): string {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-artifacts-"));
		tempDirs.push(dir);
		fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(packageJson), "utf-8");
		if (ignore) fs.writeFileSync(path.join(dir, ignore.name), ignore.content, "utf-8");
		return dir;
	}

	it("disables packaging warning as artifacts are centralised outside project working trees", () => {
		assert.equal(getProjectArtifactPackagingWarning(packageDir({ name: "unsafe" })), undefined);
		assert.equal(getProjectArtifactPackagingWarning(packageDir({ name: "included", files: [".pi/subagents/**"] })), undefined);
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
