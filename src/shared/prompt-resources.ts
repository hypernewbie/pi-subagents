import * as path from "node:path";
import { getPackageRoot } from "./package-root.ts";
import { getAgentDir, getProjectConfigDir } from "./utils.ts";

export function getPromptDirectories(cwd: string) {
	return {
		package: path.join(getPackageRoot(), "prompts"),
		user: path.join(getAgentDir(), "prompts"),
		project: path.join(getProjectConfigDir(cwd), "prompts"),
	};
}
