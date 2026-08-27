// [UAA] Fast native static import without top-level await
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {} from "./src/types/pi-runtime-compat.d.ts";
import registerParentExtension from "./src/extension/index.ts";

export default function registerSubagentExtension(pi: ExtensionAPI): void {
	if (process.env.PI_SUBAGENT_CHILD === "1") return;
	registerParentExtension(pi);
}
