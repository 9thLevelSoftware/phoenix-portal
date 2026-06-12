const NODE_LOCALSTORAGE_FLAG = "--localstorage-file";
const NODE_WEBSTORAGE_ENABLE_FLAG = "--webstorage";
const NODE_EXPERIMENTAL_WEBSTORAGE_ENABLE_FLAG = "--experimental-webstorage";
const NODE_WEBSTORAGE_DISABLE_FLAG = "--no-experimental-webstorage";

function splitNodeOptions(nodeOptions = "") {
	return nodeOptions.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
}

export function stripNodeWebStorageOptions(nodeOptions = "") {
	const tokens = splitNodeOptions(nodeOptions);
	const filtered = [];

	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		if (token === NODE_LOCALSTORAGE_FLAG) {
			index++;
			continue;
		}
		if (token.startsWith(`${NODE_LOCALSTORAGE_FLAG}=`)) {
			continue;
		}
		if (
			token === NODE_WEBSTORAGE_ENABLE_FLAG ||
			token === NODE_EXPERIMENTAL_WEBSTORAGE_ENABLE_FLAG ||
			token === NODE_WEBSTORAGE_DISABLE_FLAG
		) {
			continue;
		}
		filtered.push(token);
	}

	return filtered.join(" ");
}

export function buildNodeOptionsWithoutNodeWebStorage(nodeOptions = "") {
	const existingOptions = stripNodeWebStorageOptions(nodeOptions);

	return [existingOptions, NODE_WEBSTORAGE_DISABLE_FLAG].filter(Boolean).join(" ");
}
