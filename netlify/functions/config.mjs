/**
 * Serves /config.js with public environment variables injected.
 * Only exposes variables that are safe for the browser (anon/public keys).
 * Secret keys (service role, etc.) are never exposed here.
 */
export default async (req) => {
  const config = `
window.SUPABASE_URL = ${JSON.stringify(Netlify.env.get('SUPABASE_URL') || '')};
window.SUPABASE_ANON_KEY = ${JSON.stringify(Netlify.env.get('SUPABASE_ANON_KEY') || '')};
window.GOOGLE_MAPS_KEY = ${JSON.stringify(Netlify.env.get('GOOGLE_MAPS_KEY') || '')};
window.COORDINATOR_EMAIL = ${JSON.stringify(Netlify.env.get('COORDINATOR_EMAIL') || 'bjlinville1@gmail.com')};
`;

  return new Response(config, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    }
  });
};

export const config = { path: '/config.js' };
