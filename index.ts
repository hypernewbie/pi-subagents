// [UAA] Fast native static import without top-level await
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {} from "./src/types/pi-runtime-compat.d.ts";
import { HERDR_PI_MODE_ENV } from "./src/runs/shared/herdr-pi-protocol.ts";
import registerParentExtension from "./src/extension/index.ts";
import registerHerdrPiBridge from "./src/extension/herdr-pi-bridge.ts";

export default function registerSubagentExtension(pi: ExtensionAPI): void {
	if (process.env.PI_SUBAGENT_CHILD === "1") return;
	if (process.env[HERDR_PI_MODE_ENV] === "1") {
		registerHerdrPiBridge(pi);
		return;
	}
	registerParentExtension(pi);
}