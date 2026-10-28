import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createLocalSupabaseAdapter } from './local-adapter';

let supabaseAdminInstance: SupabaseClient | null = null;
let localAdapterInstance: SupabaseClient | null = null;

function isRealSupabaseConfigured(): boolean {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const serviceRoleKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ''
  ).trim();

  return (
    Boolean(supabaseUrl) &&
    Boolean(serviceRoleKey) &&
    !supabaseUrl.includes('your-project-ref') &&
    !serviceRoleKey.includes('your-supabase')
  );
}

/**
 * Returns a singleton Supabase Admin client using the Service Role key when configured,
 * or falls back to a clean (zero-mock-data) local JSON database adapter during local testing.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (isRealSupabaseConfigured()) {
    if (supabaseAdminInstance) {
      return supabaseAdminInstance;
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
    const serviceRoleKey = (
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )!.trim();

    supabaseAdminInstance = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    return supabaseAdminInstance;
  }

  if (!localAdapterInstance) {
    localAdapterInstance = createLocalSupabaseAdapter();
  }

  return localAdapterInstance;
}
