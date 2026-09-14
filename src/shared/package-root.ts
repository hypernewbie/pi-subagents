import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "pi-subagents";
let cachedPackageRoot: string | undefined;

/** Resolve this package's root from either a source module or dist/bundle.js. */
export function resolvePackageRoot(moduleUrl = import.meta.url): string {
	let directory = path.dirname(fileURLToPath(moduleUrl));
	while (true) {
		try {
			const manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf-8")) as { name?: unknown };
			if (manifest.name === PACKAGE_NAME) return directory;
		} catch {
			// Keep walking until the package root is found.
		}
		const parent = path.dirname(directory);
		if (parent === directory) throw new Error(`Unable to locate ${PACKAGE_NAME} package root from ${moduleUrl}.`);
		directory = parent;
	}
}

export function getPackageRoot(): string {
	return cachedPackageRoot ??= resolvePackageRoot();
}
