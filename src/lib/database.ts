/**
 * Client-facing database type: the generated schema types plus the few
 * refinements the Supabase type generator cannot express.
 *
 * src/lib/database.types.ts is generated (npm run gen:types:local) and CI
 * checks it byte-for-byte against the migrated schema, so it must never be
 * hand-edited. Anything the generator gets wrong is corrected here instead,
 * and each correction names the SQL that justifies it.
 *
 * Row/Insert/Update helpers (Tables<>, Json, ...) stay in database.types.ts;
 * import `Database` from this module when typing a Supabase client.
 */
import type { Database as GeneratedDatabase, Json } from "./database.types";

type GeneratedPublic = GeneratedDatabase["public"];
type GeneratedFunctions = GeneratedPublic["Functions"];

/**
 * The generator never adds `| null` to function arguments, but a
 * non-STRICT SQL function accepts NULL for any argument. Widen only the
 * named arguments (optional modifiers are preserved).
 */
type WithNullableArgs<
	Name extends keyof GeneratedFunctions,
	Nullable extends keyof GeneratedFunctions[Name]["Args"],
> = Omit<GeneratedFunctions[Name], "Args"> & {
	Args: {
		[Arg in keyof GeneratedFunctions[Name]["Args"]]: Arg extends Nullable
			? GeneratedFunctions[Name]["Args"][Arg] | null
			: GeneratedFunctions[Name]["Args"][Arg];
	};
};

type FunctionOverrides = {
	// 20260628180000: update_cycle_with_days writes these straight into the
	// nullable training_cycles.started_at / progression_settings /
	// deload_settings columns; NULL means "not started" / "no settings".
	update_cycle_with_days: WithNullableArgs<
		"update_cycle_with_days",
		"p_started_at" | "p_progression_settings" | "p_deload_settings"
	>;
	// import_shared_routine(uuid, text DEFAULT NULL) and
	// import_shared_cycle(uuid, text DEFAULT NULL): NULL = no local profile.
	import_shared_routine: WithNullableArgs<
		"import_shared_routine",
		"p_local_profile_id"
	>;
	import_shared_cycle: WithNullableArgs<
		"import_shared_cycle",
		"p_local_profile_id"
	>;
};

export type Database = Omit<GeneratedDatabase, "public"> & {
	// PostgREST version of the hosted project (it was emitted by the
	// generator when the types came from the live project; `gen types
	// --local` omits it). Tells supabase-js which PostgREST features to type.
	__InternalSupabase: {
		PostgrestVersion: "14.1";
	};
	public: Omit<GeneratedPublic, "Functions"> & {
		Functions: Omit<GeneratedFunctions, keyof FunctionOverrides> &
			FunctionOverrides;
	};
};

export type { Json };
