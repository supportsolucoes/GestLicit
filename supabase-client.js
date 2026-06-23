function getConfig() {
  return window.GESTLICIT_CONFIG || {};
}

export function isSupabaseConfigured() {
  const cfg = getConfig();
  return Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase?.createClient);
}

let client = null;

export function getSupabaseClient() {
  if (!isSupabaseConfigured()) return null;
  if (client) return client;
  const cfg = getConfig();
  client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    global: { headers: { 'X-Client-Info': `${cfg.appName || 'GestLicit'}/v1` } },
  });
  return client;
}
