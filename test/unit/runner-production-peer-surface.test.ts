import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Guards the production boot path of the detached async runner.
 *
 * The parent spawns `jiti-cli` on `src/runs/background/subagent-runner.ts`
 * from inside the materialized package checkout (see spawnRunner in
 * `src/runs/background/async-execution.ts`). jiti executes every statically
 * reachable module eagerly, so any *runtime* bare import in that transitive
 * closure must resolve on the target machine from `dependencies` (peers are
 * only aliased when the host package exposes them, which is not guaranteed).
 *
 * Incident reference: an upstream refactor pulled `watchdog/register-main.ts`
 * into the runner's load closure. It was the first module there with a
 * runtime peer import, so a machine whose checkout could not resolve it died
 * with MODULE_NOT_FOUND before writing any result — surfacing only as
 * "runner exited or disappeared". Nothing else caught it because unit tests
 * run in-process with full dev dependencies.
 *
 * This test freezes the peer surface: adding a new runtime peer import
 * anywhere in the runner closure fails here first, forcing an explicit
 * decision (keep it type-only/lazy, or update the deployment story and this
 * snapshot together).
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const NODE_BUILTINS = new Set([
	"assert", "async_hooks", "buffer", "child_process", "cluster", "console",
	"crypto", "dgram", "diagnostics_channel", "dgram", "dns", "events", "fs",
	"http", "https", "inspector", "module", "net", "os", "path",
	"perf_hooks", "process", "punycode", "querystring", "readline", "repl",
	"sqlite", "stream", "string_decoder", "timers", "tls", "trace_events",
	"tty", "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib",
]);

// Only matches plausible bare specifiers; skips template/dynamic requires.
const SPECIFIER_RE = /^[A-Za-z0-9@][A-Za-z0-9._/-]*$/;

function topLevelPackage(specifier: string): string {
	return specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]!;
}

function resolveRelative(fromFile: string, specifier: string): string | undefined {
	const candidate = path.normalize(path.join(path.dirname(fromFile), specifier));
	for (const withExtension of [candidate, `${candidate}.ts`]) {
		try {
			if (fs.statSync(path.join(repoRoot, withExtension)).isFile() && withExtension.endsWith(".ts")) return withExtension;
		} catch {
			// Missing file: not our concern here (loader tests cover it).
		}
	}
	return undefined;
}

function collectRuntimePeerImports(entry: string): Map<string, Set<string>> {
	const peers = new Map<string, Set<string>>();
	const visited = new Set<string>();
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.pop()!;
		if (visited.has(file)) continue;
		visited.add(file);
		let source: string;
		try {
			source = fs.readFileSync(path.join(repoRoot, file), "utf-8");
		} catch {
			continue;
		}
		// Type-only imports/exports are erased and never resolve at runtime.
		const code = source
			.replace(/^\s*import\s+type\b.*?;[\r\n]*/gms, "")
			.replace(/^\s*export\s+type\b.*?;[\r\n]*/gms, "");
		for (const match of code.matchAll(/(?:from|import|require\()\s*["']([^"']+)["']/g)) {
			const specifier = match[1]!;
			if (specifier.startsWith(".")) {
				const target = resolveRelative(file, specifier);
				if (target) queue.push(target);
			} else if (specifier.startsWith("node:")) {
				continue;
			} else if (SPECIFIER_RE.test(specifier)) {
				const top = topLevelPackage(specifier);
				if (!NODE_BUILTINS.has(top)) {
					if (!peers.has(top)) peers.set(top, new Set());
					peers.get(top)!.add(file);
				}
			}
		}
	}
	return peers;
}

// Every non-dependency runtime import reachable from the jiti runner entry,
// with the reason it must stay resolvable in a bare package checkout.
// Sorted; update deliberately (see header) when this surface must change.
const EXPECTED_RUNTIME_PEERS: Array<{ pkg: string; why: string }> = [
	{ pkg: "@earendil-works/pi-agent-core", why: "watchdog review/permission-arbiter use core runtime values" },
	{ pkg: "@earendil-works/pi-ai", why: "compat completions and pruned-fork message values" },
	{ pkg: "@earendil-works/pi-coding-agent", why: "fork-context SessionManager and supervisor UI host values" },
	{ pkg: "@earendil-works/pi-tui", why: "renderer components (Text/Markdown/width helpers, Key) in watchdog and fleet UI" },
	{ pkg: "typebox", why: "dependency: schema validation across runner helpers" },
	{ pkg: "yaml", why: "dependency: frontmatter/config parsing" },
];

describe("runner production peer surface", () => {
	it("keeps the jiti runner closure free of undeclared runtime imports", () => {
		const peers = collectRuntimePeerImports("src/runs/background/subagent-runner.ts");
		const actual = [...peers.keys()].sort();
		const expected = EXPECTED_RUNTIME_PEERS.map((entry) => entry.pkg).sort();
		assert.deepEqual(
			actual,
			expected,
			`Runner reachable runtime imports changed.\nActual: ${JSON.stringify(actual)}\n`
			+ [...peers.entries()].map(([pkg, files]) => `  ${pkg} via ${[...files].slice(0, 4).join(", ")}${files.size > 4 ? ` (+${files.size - 4} more)` : ""}`).join("\n")
			+ "\nIf the growth is intentional, update EXPECTED_RUNTIME_PEERS and confirm the deployed package story resolves it.",
		);
	});
});
