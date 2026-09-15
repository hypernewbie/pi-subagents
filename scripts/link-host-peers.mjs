#!/usr/bin/env node
// Symlink the host's @earendil-works/* peer packages into this extension's
// local node_modules, so `npm install --omit=dev` (Pi's update path) leaves
// pi-tui / pi-agent-core / pi-ai / pi-coding-agent resolvable from this
// extension's cwd via standard node_modules walk-up.
//
// The bundled Peers and the test fixture's local pi-coding-agent devDep are
// already installed by npm; this script only fills in the slots npm cannot.
// Idempotent and never fatal: missing host packages log a warning and exit
// 0 so postinstall failures don't break `npm install` in CI or in dev where
// the host install is absent.

import {
	existsSync,
	lstatSync,
	readFileSync,
	readlinkSync,
	symlinkSync,
	unlinkSync,
	mkdirSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ourRoot = resolve(here, "..");
const ourModulesRoot = join(ourRoot, "node_modules", "@earendil-works");

// Possible host install roots, most-preferred first. Pi sets PI_CODING_AGENT_PACKAGE_ROOT
// on runner spawn and we honour it when set.
const hostRoots = [];
if (process.env.PI_CODING_AGENT_PACKAGE_ROOT) {
	hostRoots.push(dirname(process.env.PI_CODING_AGENT_PACKAGE_ROOT));
}
// Common shipped locations for Pi 0.85+: macOS homebrew, Linux distro paths.
hostRoots.push(
	"/opt/homebrew/lib/node_modules/@earendil-works",
	"/usr/lib/node_modules/@earendil-works",
	"/usr/local/lib/node_modules/@earendil-works",
);

// Pi 0.85.1 ships pi-coding-agent at the host root and bundles the remaining
// peers inside its nested node_modules. Walk the host root for each peer,
// falling back through each candidate in order.
const PEERS = [
	"pi-coding-agent",
	"pi-tui",
	"pi-agent-core",
	"pi-ai",
	"pi-server",
	"chord",
	"pi-telemetry",
	"pi-protocol",
];

function pickHostSource(peer) {
	for (const root of hostRoots) {
		if (!root) continue;
		// Direct install at the host root.
		const direct = join(root, peer);
		if (existsSync(direct)) return direct;
		// Bundled inside pi-coding-agent's nested node_modules.
		const bundled = join(root, "pi-coding-agent", "node_modules", "@earendil-works", peer);
		if (existsSync(bundled)) return bundled;
	}
	return undefined;
}

function readPackageVersion(pkgDir) {
	try {
		const pkgPath = join(pkgDir, "package.json");
		if (!existsSync(pkgPath)) return undefined;
		return JSON.parse(readFileSync(pkgPath, "utf8")).version;
	} catch {
		return undefined;
	}
}

// pi-coding-agent is special: in dev/test we want the local test fixture
// (test/fixtures/pi-coding-agent-shim, declared as a file: devDependency) to
// take precedence over the host install. Detect the shim either by the
// destination being a real dir with the shim sentinel version, or by the
// destination being a symlink whose target lives under the shim directory.
const PI_CODING_AGENT_SHIM_VERSION = "0.0.0-pi-subagents-test-shim";
const PI_CODING_AGENT_SHIM_DIR = resolve(here, "..", "test", "fixtures", "pi-coding-agent-shim");
function resolvesToShim(dst) {
	if (!existsSync(dst)) return false;
	let target = dst;
	try {
		const stat = lstatSync(dst, { throwIfNoEntry: false });
		if (stat?.isSymbolicLink()) target = resolve(dirname(dst), readlinkSync(dst));
	} catch {
		return false;
	}
	return target === PI_CODING_AGENT_SHIM_DIR || target.startsWith(PI_CODING_AGENT_SHIM_DIR + "/");
}
function shouldSkipPiCodingAgentShim(dst) {
	const version = readPackageVersion(dst);
	return (
		version === PI_CODING_AGENT_SHIM_VERSION ||
		resolvesToShim(dst)
	);
}

function ensureSymlink(src, dst, { skipIfShim = false } = {}) {
	try {
		mkdirSync(dirname(dst), { recursive: true });
	} catch {
		// ignore
	}
	const existing = lstatSync(dst, { throwIfNoEntry: false });
	if (existing) {
		if (existing.isSymbolicLink()) {
			if (skipIfShim && shouldSkipPiCodingAgentShim(dst)) return "shim";
			if (readlinkSync(dst) === src) return "unchanged";
			try {
				unlinkSync(dst);
			} catch {
				return "skipped";
			}
		} else {
			if (skipIfShim && shouldSkipPiCodingAgentShim(dst)) return "shim";
			// Real directory already present at the destination. Don't touch —
			// the operator is keeping a vendored copy.
			return "skipped";
		}
	}
	try {
		symlinkSync(src, dst, "dir");
		return "linked";
	} catch (error) {
		console.warn(`[link-host-peers] symlink ${dst} → ${src} failed: ${error.message}`);
		return "skipped";
	}
}

let linked = 0;
let unchanged = 0;
let skipped = 0;
let missing = 0;

for (const peer of PEERS) {
	const src = pickHostSource(peer);
	if (!src) {
		missing++;
		continue;
	}
	const dst = join(ourModulesRoot, peer);
	// pi-coding-agent is the only peer where we have a local fixture that
	// should win on dev/test installs.
	const outcome = ensureSymlink(src, dst, { skipIfShim: peer === "pi-coding-agent" });
	if (outcome === "linked") {
		console.log(`[link-host-peers] + ${peer} → ${src}`);
		linked++;
	} else if (outcome === "unchanged") {
		unchanged++;
	} else if (outcome === "shim") {
		console.log(`[link-host-peers] keep ${peer} (test fixture shim)`);
	} else {
		skipped++;
	}
}

// No-host fallback: print a single warning so CI logs make the cause obvious
// without failing the install.
if (linked === 0 && missing > 0 && skipped === 0) {
	console.warn(
		`[link-host-peers] no host peer packages found in any of:\n  ${hostRoots
			.filter(Boolean)
			.join("\n  ")}\n` +
			`  Extension will rely on JITI_ALIAS / alias map at runtime instead.`,
	);
}

if (process.env.PI_SUBAGENTS_LINK_HOST_PEERS_QUIET === undefined) {
	// Quiet by default when nothing changed; otherwise print a one-line summary.
	if (linked + unchanged + skipped + missing > 0) {
		console.log(
			`[link-host-peers] done. linked=${linked} unchanged=${unchanged} skipped=${skipped} missing=${missing}`,
		);
	}
}
