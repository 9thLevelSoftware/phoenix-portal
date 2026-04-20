#!/usr/bin/env node
/**
 * Generate an Apple "Sign in with Apple" client secret JWT.
 *
 * Apple requires the OAuth `client_secret` to be a short-lived JWT signed with
 * the private key downloaded from the Apple Developer portal. The JWT expires
 * after at most 6 months and must be regenerated + re-pushed to Supabase.
 *
 * Usage:
 *   node scripts/generate-apple-client-secret.mjs \
 *     --team-id <TEAM_ID> \
 *     --key-id <KEY_ID> \
 *     --services-id <SERVICES_ID> \
 *     --key-file <PATH_TO_.p8>
 *
 * Or with env vars (any long-arg can be swapped for the matching env var):
 *   APPLE_TEAM_ID=... APPLE_KEY_ID=... APPLE_SERVICES_ID=... \
 *   APPLE_PRIVATE_KEY_PATH=./AuthKey_XXXXXXXXXX.p8 \
 *   node scripts/generate-apple-client-secret.mjs
 *
 * Optional:
 *   --exp-days <N>             Token lifetime in days (default 180, max 180).
 *   --write-env                Writes SUPABASE_AUTH_EXTERNAL_APPLE_* values
 *                              into .env.local so `npm run auth:social:push`
 *                              picks them up. Client id is the Services ID.
 */

import { readFile, writeFile, appendFile, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { createPrivateKey, createSign } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

const APPLE_AUDIENCE = "https://appleid.apple.com";
const MAX_EXP_DAYS = 180; // Apple cap: 6 months.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

loadDotenv({ path: path.join(repoRoot, ".env"), override: false });
loadDotenv({ path: path.join(repoRoot, ".env.local"), override: true });

function parseArgs(argv) {
	const args = {};
	for (let i = 2; i < argv.length; i += 1) {
		const token = argv[i];
		if (!token.startsWith("--")) {
			throw new Error(`Unexpected positional argument: ${token}`);
		}
		const key = token.slice(2);
		if (key === "write-env") {
			args.writeEnv = true;
			continue;
		}
		const next = argv[i + 1];
		if (next == null || next.startsWith("--")) {
			throw new Error(`Missing value for --${key}`);
		}
		args[key] = next;
		i += 1;
	}
	return args;
}

function base64UrlEncode(input) {
	const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
	return buf
		.toString("base64")
		.replace(/=+$/, "")
		.replace(/\+/g, "-")
		.replace(/\//g, "_");
}

function resolveInputs(cli) {
	const teamId = (cli["team-id"] ?? process.env.APPLE_TEAM_ID ?? "").trim();
	const keyId = (cli["key-id"] ?? process.env.APPLE_KEY_ID ?? "").trim();
	const servicesId = (
		cli["services-id"] ??
		process.env.APPLE_SERVICES_ID ??
		""
	).trim();
	const keyPath = (
		cli["key-file"] ??
		process.env.APPLE_PRIVATE_KEY_PATH ??
		""
	).trim();
	const expDaysRaw = cli["exp-days"] ?? process.env.APPLE_EXP_DAYS ?? "180";

	const missing = [];
	if (!teamId) missing.push("--team-id / APPLE_TEAM_ID");
	if (!keyId) missing.push("--key-id / APPLE_KEY_ID");
	if (!servicesId) missing.push("--services-id / APPLE_SERVICES_ID");
	if (!keyPath) missing.push("--key-file / APPLE_PRIVATE_KEY_PATH");

	if (missing.length > 0) {
		throw new Error(
			`Missing required inputs:\n${missing.map((m) => `  - ${m}`).join("\n")}`,
		);
	}

	const expDays = Number.parseInt(expDaysRaw, 10);
	if (!Number.isFinite(expDays) || expDays <= 0 || expDays > MAX_EXP_DAYS) {
		throw new Error(
			`exp-days must be an integer between 1 and ${MAX_EXP_DAYS} (got ${expDaysRaw}).`,
		);
	}

	return {
		teamId,
		keyId,
		servicesId,
		keyPath: path.isAbsolute(keyPath)
			? keyPath
			: path.resolve(process.cwd(), keyPath),
		expDays,
		writeEnv: Boolean(cli.writeEnv),
	};
}

async function loadPrivateKey(keyPath) {
	try {
		const pem = await readFile(keyPath, "utf8");
		return createPrivateKey({ key: pem, format: "pem" });
	} catch (error) {
		throw new Error(
			`Failed to read private key at ${keyPath}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}

function signJwt({ teamId, keyId, servicesId, expDays, privateKey }) {
	const iat = Math.floor(Date.now() / 1000);
	const exp = iat + expDays * 24 * 60 * 60;

	const header = { alg: "ES256", kid: keyId, typ: "JWT" };
	const payload = {
		iss: teamId,
		iat,
		exp,
		aud: APPLE_AUDIENCE,
		sub: servicesId,
	};

	const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
		JSON.stringify(payload),
	)}`;

	const signer = createSign("SHA256");
	signer.update(signingInput);
	signer.end();
	// Apple expects raw r||s (JOSE / IEEE P1363), not DER.
	const signature = signer.sign({ key: privateKey, dsaEncoding: "ieee-p1363" });

	return { jwt: `${signingInput}.${base64UrlEncode(signature)}`, exp };
}

async function updateEnvFile(envPath, updates) {
	let body = "";
	try {
		await access(envPath, fsConstants.R_OK);
		body = await readFile(envPath, "utf8");
	} catch {
		body = "";
	}

	const lines = body.length > 0 ? body.split(/\r?\n/) : [];
	const remaining = new Map(Object.entries(updates));

	const rewritten = lines.map((line) => {
		const match = line.match(/^\s*([A-Z0-9_]+)\s*=/);
		if (!match) return line;
		const key = match[1];
		if (remaining.has(key)) {
			const value = remaining.get(key);
			remaining.delete(key);
			return `${key}=${value}`;
		}
		return line;
	});

	if (remaining.size > 0) {
		if (rewritten.length > 0 && rewritten[rewritten.length - 1] !== "") {
			rewritten.push("");
		}
		rewritten.push("# Apple Sign In secret (auto-generated by generate-apple-client-secret.mjs)");
		for (const [key, value] of remaining) {
			rewritten.push(`${key}=${value}`);
		}
	}

	const next = `${rewritten.join("\n").replace(/\n+$/, "")}\n`;

	if (body === next) return;

	if (body.length === 0) {
		await writeFile(envPath, next, { encoding: "utf8" });
	} else {
		await writeFile(envPath, next, { encoding: "utf8" });
	}
}

async function main() {
	const cli = parseArgs(process.argv);
	const inputs = resolveInputs(cli);
	const privateKey = await loadPrivateKey(inputs.keyPath);

	const { jwt, exp } = signJwt({ ...inputs, privateKey });
	const expIso = new Date(exp * 1000).toISOString();

	process.stdout.write(`${jwt}\n`);
	process.stderr.write(
		[
			"",
			`Apple client secret JWT generated.`,
			`  Services ID (client_id): ${inputs.servicesId}`,
			`  Team ID (iss):           ${inputs.teamId}`,
			`  Key ID (kid):            ${inputs.keyId}`,
			`  Lifetime:                ${inputs.expDays} day(s) — expires ${expIso}`,
			"",
			"Rotate this secret before it expires and rerun `npm run auth:social:push`.",
			"",
		].join("\n"),
	);

	if (inputs.writeEnv) {
		const envPath = path.join(repoRoot, ".env.local");
		await updateEnvFile(envPath, {
			SUPABASE_AUTH_EXTERNAL_APPLE_CLIENT_ID: inputs.servicesId,
			SUPABASE_AUTH_EXTERNAL_APPLE_SECRET: jwt,
		});
		process.stderr.write(
			`Wrote SUPABASE_AUTH_EXTERNAL_APPLE_CLIENT_ID and SUPABASE_AUTH_EXTERNAL_APPLE_SECRET to ${envPath}.\n`,
		);
	}
}

main().catch((error) => {
	process.stderr.write(
		`${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
});
