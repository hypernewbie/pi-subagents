import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = path.join(projectRoot, "package.json");
const bundlePath = path.join(projectRoot, "dist", "bundle.js");
const expectedEntrypoint = "./dist/bundle.js";
const errors = [];

let packageJson;
try {
	packageJson = JSON.parse(fs.readFileSync(packagePath, "utf-8"));
} catch (error) {
	errors.push(`cannot read ${packagePath}: ${error instanceof Error ? error.message : String(error)}`);
}

if (packageJson) {
	if (packageJson.pi?.extensions?.[0] !== expectedEntrypoint) {
		errors.push(`package.json pi.extensions[0] must be ${JSON.stringify(expectedEntrypoint)} (bundle performance is intentional)`);
	}
	if (!packageJson.files?.includes("dist/bundle.js")) {
		errors.push(`package.json files must include ${JSON.stringify("dist/bundle.js")} so published packages contain the configured entrypoint`);
	}
}

try {
	const stats = fs.statSync(bundlePath);
	if (!stats.isFile() || stats.size === 0) {
		errors.push(`${bundlePath} exists but is not a non-empty file`);
	}
} catch (error) {
	errors.push(`configured bundle is missing: ${bundlePath}`);
}

if (errors.length > 0) {
	console.error("\n[FATAL] pi-subagents bundle guard failed.");
	for (const error of errors) console.error(`  - ${error}`);
	console.error("Run `npm run build` to regenerate dist/bundle.js; do not switch the Pi entrypoint back to source.");
	process.exitCode = 1;
} else {
	console.log(`[bundle] OK: ${path.relative(projectRoot, bundlePath)} is present and configured as the Pi entrypoint.`);
}
