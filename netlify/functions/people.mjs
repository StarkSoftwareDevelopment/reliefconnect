/**
 * GET  /api/people?q=benjamin     — autocomplete search
 * POST /api/people                — create a new person
 * GET  /api/people/:slug          — get person by slug
 */

import { supabaseQuery, jsonResponse, errorResponse } from './lib/supabase.mjs';

export default async (req) => {
  const url = new URL(req.url);
  const pathParts = url.pathname.replace('/api/people', '').split('/').filter(Boolean);
  const slug = pathParts[0];

  if (req.method === 'GET' && slug) {
    // Get person by slug
    try {
      const people = await supabaseQuery(
        `people?slug=eq.${encodeURIComponent(slug)}&limit=1`, {}, false
      );
      if (!people?.length) return errorResponse('Person not found', 404);
      return jsonResponse(people[0]);
    } catch (e) {
      return errorResponse(e.message);
    }
  }

  if (req.method === 'GET') {
    // Autocomplete search
    const q = url.searchParams.get('q') || '';
    const projectId = url.searchParams.get('project_id');
    const limit = parseInt(url.searchParams.get('limit') || '8');

    try {
      let results;
      if (q.length < 2) {
        // Return recent people (project-scoped if project_id given)
        results = await supabaseQuery(
          `people?order=created_at.desc&limit=${limit}`, {}, false
        );
      } else {
        // Trigram fuzzy search on name
        results = await supabaseQuery(
          `people?name=ilike.*${encodeURIComponent(q)}*&order=name.asc&limit=${limit}`,
          {}, false
        );
      }
      return jsonResponse(results || []);
    } catch (e) {
      return errorResponse(e.message);
    }
  }

  if (req.method === 'POST') {
    // Create new person
    let body;
    try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }

    const { name, email, phone } = body;
    if (!name?.trim()) return errorResponse('Name is required', 400);

    try {
      // Check if already exists by email
      if (email) {
        const existing = await supabaseQuery(
          `people?email=eq.${encodeURIComponent(email)}&limit=1`, {}, true
        );
        if (existing?.length) return jsonResponse(existing[0]);
      }

      const [person] = await supabaseQuery('people', {
        method: 'POST',
        body: { name: name.trim(), email, phone }
      }, true);

      return jsonResponse(person, 201);
    } catch (e) {
      return errorResponse(e.message);
    }
  }

  return errorResponse('Method not allowed', 405);
};

export const config = { path: '/api/people/:slug?' };
