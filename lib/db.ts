import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { envConfig } from "./env";

// Server-side only. Anon key + minted x-bh-key secret; RLS policies grant access only when the header matches.
let _db: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!_db) {
    const cfg = envConfig();
    _db = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-bh-key": cfg.bhApiKey } },
    });
  }
  return _db;
}
