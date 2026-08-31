import assert from "node:assert/strict";
import { register } from "node:module";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

register(new URL("../support/ts-loader.mjs", import.meta.url));

test("the configured bundle entrypoint loads with the Pi runtime shim", async () => {
	const bundle = await import(`${pathToFileURL(path.join(projectRoot, "dist", "bundle.js")).href}?bundle-test`);
	assert.equal(typeof bundle.default, "function");
});
