import { readFile } from "node:fs/promises";
import type { Plugin } from "vite";

const BODY_MUSCLES_RUNTIME_MODULE =
	/(^|[/\\])node_modules[/\\]body-muscles[/\\]dist[/\\].+\.js$/;
const SOURCE_MAP_COMMENT = /\r?\n\/\/# sourceMappingURL=[^\r\n]*\.map\s*$/;

export function isBodyMusclesRuntimeModule(id: string): boolean {
	const [modulePath] = id.split("?", 1);
	return BODY_MUSCLES_RUNTIME_MODULE.test(modulePath ?? id);
}

export function stripBodyMusclesSourcemapComments(code: string): string {
	return code.replace(SOURCE_MAP_COMMENT, "\n");
}

export function stripBodyMusclesSourcemapsPlugin(): Plugin {
	return {
		name: "phoenix-strip-body-muscles-sourcemaps",
		enforce: "pre",
		async load(id) {
			if (!isBodyMusclesRuntimeModule(id)) {
				return null;
			}

			const [modulePath] = id.split("?", 1);
			return {
				code: stripBodyMusclesSourcemapComments(
					await readFile(modulePath ?? id, "utf8"),
				),
				map: null,
			};
		},
		transform(code, id) {
			if (!isBodyMusclesRuntimeModule(id)) {
				return null;
			}

			const stripped = stripBodyMusclesSourcemapComments(code);
			if (stripped === code) {
				return null;
			}

			return {
				code: stripped,
				map: null,
			};
		},
	};
}
