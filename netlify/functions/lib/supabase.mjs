/**
 * Supabase client factory for Netlify functions.
 * Uses the SERVICE ROLE key for coordinator writes (never exposed to browser).
 * Uses the ANON key for public reads.
 */

export function getSupabaseClient(useServiceRole = false) {
  const url = Netlify.env.get('SUPABASE_URL');
  const key = useServiceRole
    ? Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY')
    : Netlify.env.get('SUPABASE_ANON_KEY');

  return { url, key };
}

export async function supabaseQuery(path, options = {}, useServiceRole = false) {
  const { url, key } = getSupabaseClient(useServiceRole);
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': options.prefer || 'return=representation',
      ...options.headers
    },
    method: options.method || 'GET',
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new Error(data?.message || `Supabase error ${res.status}`);
  }
  return data;
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export function errorResponse(message, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
