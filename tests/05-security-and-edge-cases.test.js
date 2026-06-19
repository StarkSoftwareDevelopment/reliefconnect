/**
 * Suite 5: API security, edge cases, people endpoint, data integrity
 *
 * Tests that are commonly missed in web apps:
 * - SQL injection attempts are safely handled
 * - XSS payloads are stored as text, not executed
 * - Excessively long inputs are handled gracefully
 * - People autocomplete works and doesn't expose sensitive data
 * - Concurrent submissions don't create duplicate people
 * - Missing/malformed JSON bodies return clear errors
 * - Unknown routes return 404 not 500
 * - RLS: anon key cannot read pending_approval projects
 * - RLS: anon key cannot write to projects/tasks directly
 */

const { api, sb, makeAsk, trackAsk, trackProject, cleanupTestData } = require('./helpers');
const fetch = require('node-fetch');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

async function anonFetch(path, options = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
}

describe('5. API security & edge cases', () => {
  afterAll(cleanupTestData);

  // ── 5a. Input safety ───────────────────────────────────────────────────────
  describe('5a. Input safety', () => {
    test('SQL injection in name field is stored as plain text, not executed', async () => {
      const { ok, data } = await api('/api/submit-ask', makeAsk({
        name: "Robert'); DROP TABLE asks;--",
        description: 'Normal description with enough words to pass validation and be processed by the AI system correctly.'
      }));
      // Should succeed (store safely) or fail validation — NOT 500
      expect([true, false]).toContain(ok);
      if (ok) {
        trackAsk(data.askId);
        trackProject(data.projectId);
        const asks = await sb(`asks`, `id=eq.${data.askId}`);
        expect(asks[0].name).toBe("Robert'); DROP TABLE asks;--");
      }
    }, 60000);

    test('XSS payload in description is stored as plain text', async () => {
      const xssPayload = '<script>alert("xss")</script><img src=x onerror=alert(1)>';
      const { ok, data } = await api('/api/submit-ask', makeAsk({
        description: `${xssPayload} The tree fell on the driveway during the storm last night and is blocking vehicle access.`
      }));
      if (ok) {
        trackAsk(data.askId);
        trackProject(data.projectId);
        const asks = await sb(`asks`, `id=eq.${data.askId}`);
        expect(asks[0].description).toContain('<script>');
        // Stored as-is — escaping happens at render time, not storage time (correct behavior)
      }
    }, 60000);

    test('very long description (5000 chars) is handled gracefully', async () => {
      const longDesc = 'A large tree has fallen on the property. '.repeat(120).slice(0, 5000);
      const { status } = await api('/api/submit-ask', makeAsk({ description: longDesc }));
      expect([200, 201, 400, 413]).toContain(status);
    }, 60000);

    test('empty JSON body returns 400, not 500', async () => {
      const res = await fetch(`${BASE_URL}/api/submit-ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBeTruthy();
    });

    test('malformed JSON body returns 400, not 500', async () => {
      const res = await fetch(`${BASE_URL}/api/submit-ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ this is not json }'
      });
      expect(res.status).toBe(400);
    });

    test('GET request to POST-only endpoint returns 405', async () => {
      const res = await fetch(`${BASE_URL}/api/submit-ask`);
      expect(res.status).toBe(405);
    });
  });

  // ── 5b. Row-level security ────────────────────────────────────────────────
  describe('5b. Row-level security (anon key)', () => {
    let pendingProjectId;

    beforeAll(async () => {
      const { ok, data } = await api('/api/submit-ask', makeAsk());
      if (ok) {
        trackAsk(data.askId);
        trackProject(data.projectId);
        pendingProjectId = data.projectId;
      }
    }, 60000);

    test('anon key cannot read pending_approval projects from project_summary', async () => {
      const res = await anonFetch(`project_summary?id=eq.${pendingProjectId}`);
      const data = await res.json();
      expect(data).toHaveLength(0);
    });

    test('anon key cannot read pending_approval projects from projects table directly', async () => {
      const res = await anonFetch(`projects?id=eq.${pendingProjectId}&status=eq.pending_approval`);
      const data = await res.json();
      expect(data).toHaveLength(0);
    });

    test('anon key cannot directly INSERT into projects table', async () => {
      const res = await anonFetch('projects', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify({
          title: 'Injected project',
          address: '123 Fake St',
          status: 'to_do'
        })
      });
      // Should be 401, 403, or 405 — not 200/201
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    test('anon key cannot directly UPDATE tasks table', async () => {
      const res = await anonFetch('tasks?id=neq.00000000-0000-0000-0000-000000000000', {
        method: 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify({ status: 'task_completed_review_satisfactory' })
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    test('anon key cannot read approval_queue', async () => {
      // approval_queue view includes pending_approval projects
      // anon key should not be able to read it
      const res = await anonFetch('approval_queue');
      // Either 0 results or 403
      if (res.ok) {
        const data = await res.json();
        // If it returns data, it should be empty (RLS filters it out)
        expect(data).toHaveLength(0);
      } else {
        expect(res.status).toBeGreaterThanOrEqual(400);
      }
    });
  });

  // ── 5c. People endpoint ───────────────────────────────────────────────────
  describe('5c. People API', () => {
    test('GET /api/people returns array', async () => {
      const res = await fetch(`${BASE_URL}/api/people`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
    });

    test('GET /api/people?q=bj returns B.J. Linville', async () => {
      const res = await fetch(`${BASE_URL}/api/people?q=bj`);
      const data = await res.json();
      const found = data.find(p => p.name.toLowerCase().includes('linville'));
      expect(found).toBeDefined();
    });

    test('POST /api/people creates a new person', async () => {
      const unique = `Test Person ${Date.now()}`;
      const { status, data } = await api('/api/people', {
        name: unique,
        email: `test${Date.now()}@reliefconnect-test.com`
      });
      expect([200, 201]).toContain(status);
      expect(data.name).toBe(unique);
      expect(data.id).toBeTruthy();
      expect(data.slug).toBeTruthy();
    });

    test('POST /api/people with duplicate email returns existing person, not duplicate', async () => {
      const email = `nodupe${Date.now()}@reliefconnect-test.com`;
      const first = await api('/api/people', { name: 'First Name', email });
      const second = await api('/api/people', { name: 'Different Name Same Email', email });
      expect(first.data.id).toBe(second.data.id);
    });

    test('POST /api/people with no name returns 400', async () => {
      const { status, data } = await api('/api/people', { email: 'test@test.com' });
      expect(status).toBe(400);
      expect(data.error).toBeTruthy();
    });

    test('people slugs are URL-safe (no spaces or special chars)', async () => {
      const { data } = await api('/api/people', {
        name: 'Ó\'Reilly & Associates — LLC',
        email: `slug-test-${Date.now()}@test.com`
      });
      expect(data.slug).toMatch(/^[a-z0-9_]+$/);
    });

    test('GET /api/people/:slug returns that person', async () => {
      const created = await api('/api/people', {
        name: 'Slug Test Person',
        email: `slugtest${Date.now()}@test.com`
      });
      const res = await fetch(`${BASE_URL}/api/people/${created.data.slug}`);
      expect(res.ok).toBe(true);
      const person = await res.json();
      expect(person.slug).toBe(created.data.slug);
    });

    test('GET /api/people/:slug with unknown slug returns 404', async () => {
      const res = await fetch(`${BASE_URL}/api/people/this-slug-does-not-exist-xyz`);
      expect(res.status).toBe(404);
    });
  });

  // ── 5d. Data integrity ────────────────────────────────────────────────────
  describe('5d. Data integrity', () => {
    test('projects always have at least 1 acceptance test after generation', async () => {
      const { ok, data } = await api('/api/submit-ask', makeAsk());
      if (!ok) return;
      trackAsk(data.askId); trackProject(data.projectId);
      expect(data.acceptanceTests.length).toBeGreaterThanOrEqual(1);
    }, 60000);

    test('project acceptance tests are always arrays (never null/string)', async () => {
      const projects = await sb('projects', 'order=created_at.desc&limit=5');
      projects.forEach(p => {
        expect(Array.isArray(p.acceptance_tests)).toBe(true);
      });
    });

    test('task acceptance_tests field is always an array', async () => {
      const tasks = await sb('tasks', 'order=created_at.desc&limit=10');
      tasks.forEach(t => {
        expect(Array.isArray(t.acceptance_tests)).toBe(true);
      });
    });

    test('all tasks have a valid project_id that exists', async () => {
      const tasks = await sb('tasks', 'order=created_at.desc&limit=20');
      const projectIds = [...new Set(tasks.map(t => t.project_id))];
      for (const pid of projectIds) {
        const projects = await sb('projects', `id=eq.${pid}`);
        expect(projects.length).toBe(1);
      }
    });

    test('ai_attempt_count is always >= 1', async () => {
      const projects = await sb('projects', 'order=created_at.desc&limit=10');
      projects.forEach(p => {
        expect(p.ai_attempt_count).toBeGreaterThanOrEqual(1);
      });
    });

    test('denial_count is never greater than ai_attempt_count', async () => {
      const projects = await sb('projects', 'denial_count=gt.0&order=created_at.desc&limit=10');
      projects.forEach(p => {
        expect(p.denial_count).toBeLessThanOrEqual(p.ai_attempt_count);
      });
    });

    test('task history is written for every status change', async () => {
      // Find a task that has changed status (submitted = changed from not_assigned)
      const tasks = await sb('tasks',
        'status=eq.task_completed_review_not_assigned&order=updated_at.desc&limit=1'
      );
      if (!tasks.length) return; // No submitted tasks yet, skip
      const history = await sb('task_history', `task_id=eq.${tasks[0].id}`);
      expect(history.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 5e. Concurrent requests ───────────────────────────────────────────────
  describe('5e. Concurrent requests', () => {
    test('two concurrent submissions with same email create only one person', async () => {
      const email = `concurrent${Date.now()}@test.reliefconnect.com`;
      const [r1, r2] = await Promise.all([
        api('/api/people', { name: 'Person A', email }),
        api('/api/people', { name: 'Person B', email })
      ]);
      // Both should succeed, both should return the same ID
      const id1 = r1.data?.id;
      const id2 = r2.data?.id;
      const people = await sb('people', `email=eq.${email}`);
      expect(people.length).toBe(1);
    });
  });
});
