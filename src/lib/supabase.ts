import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
	throw new Error(
		"Missing Supabase environment variables. " +
			"Copy .env.example to .env.local and fill in your Supabase project values. " +
			"See: https://supabase.com/dashboard/project/_/settings/api",
	);
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);
