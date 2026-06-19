import { supabaseQuery, jsonResponse, errorResponse } from './lib/supabase.mjs';

export default async (req) => {
  if (req.method !== 'GET') return errorResponse('Method not allowed', 405);
  try {
    const queue = await supabaseQuery('approval_queue', {}, true);
    return jsonResponse(queue || []);
  } catch (e) {
    return errorResponse(e.message);
  }
};

export const config = { path: '/api/approval-queue' };
