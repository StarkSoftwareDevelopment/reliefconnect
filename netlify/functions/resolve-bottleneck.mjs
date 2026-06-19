import { supabaseQuery, jsonResponse, errorResponse } from './lib/supabase.mjs';

export default async (req) => {
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);
  let body;
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }
  const { bottleneckId } = body;
  if (!bottleneckId) return errorResponse('bottleneckId required', 400);
  try {
    await supabaseQuery(`bottlenecks?id=eq.${bottleneckId}`, {
      method: 'PATCH',
      body: { resolved: true, resolved_at: new Date().toISOString() }
    }, true);
    return jsonResponse({ success: true });
  } catch (e) {
    return errorResponse(e.message);
  }
};

export const config = { path: '/api/resolve-bottleneck' };
