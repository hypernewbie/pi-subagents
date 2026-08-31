import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { getPackageRoot, resolvePackageRoot } from "../../src/shared/package-root.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("resolves the package root from source and bundled entrypoint URLs", () => {
	const bundlePath = path.join(projectRoot, "dist", "bundle.js");
	assert.equal(fs.existsSync(bundlePath), true);
	assert.equal(getPackageRoot(), projectRoot);
	assert.equal(resolvePackageRoot(pathToFileURL(bundlePath).href), projectRoot);
});
