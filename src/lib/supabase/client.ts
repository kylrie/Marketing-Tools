import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseBrowserInstance: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (supabaseBrowserInstance) {
    return supabaseBrowserInstance;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    return null;
  }

  supabaseBrowserInstance = createClient(supabaseUrl, anonKey);
  return supabaseBrowserInstance;
}

