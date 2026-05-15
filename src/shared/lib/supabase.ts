import { createClient } from '@supabase/supabase-js';

// Direct Supabase URL — used in dev and as fallback when running outside
// the deployed origin. In production we route via nginx (`/sb/*`) because
// Cloudflare-fronted Supabase is unreachable from many Russian networks.
const directUrl = import.meta.env.VITE_SUPABASE_URL as string;

function resolveSupabaseUrl(): string {
  if (typeof window === 'undefined') return directUrl;
  const host = window.location.hostname;
  // Localhost / vite dev → talk to Supabase directly.
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost')) {
    return directUrl;
  }
  // Production → same-origin proxy. nginx forwards /sb/* to Supabase.
  return `${window.location.origin}/sb`;
}

const supabaseUrl = resolveSupabaseUrl();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
