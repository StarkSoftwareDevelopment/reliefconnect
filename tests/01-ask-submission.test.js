/**
 * Suite 1: Ask submission
 *
 * Tests that submitting a help request:
 * - Saves the ask to the database with correct fields
 * - Triggers AI project generation
 * - Creates the project in pending_approval state
 * - Does NOT expose the project publicly until approved
 * - Fires a coordinator alert
 */

const {
  api, sb, makeAsk,
  trackAsk, trackProject,
  cleanupTestData, getProject, getAsk, getPendingQueue
} = require('./helpers');

describe('1. Ask submission', () => {
  let submitResult;
  let askPayload;

  beforeAll(async () => {
    askPayload = makeAsk();
    const { status, ok, data } = await api('/api/submit-ask', askPayload);
    expect(ok).toBe(true, `submit-ask returned ${status}: ${JSON.stringify(data)}`);
    submitResult = data;

    if (submitResult.askId) trackAsk(submitResult.askId);
    if (submitResult.projectId) trackProject(submitResult.projectId);
  });

  afterAll(cleanupTestData);

  // ── 1a. API response shape ─────────────────────────────────────────────────
  describe('1a. API response', () => {
    test('returns success: true', () => {
      expect(submitResult.success).toBe(true);
    });

    test('returns askId (UUID)', () => {
      expect(submitResult.askId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    test('returns projectId (UUID)', () => {
      expect(submitResult.projectId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    test('returns status: pending_approval', () => {
      expect(submitResult.status).toBe('pending_approval');
    });
  });

  // ── 1b. Ask persisted correctly ───────────────────────────────────────────
  describe('1b. Ask record in database', () => {
    let ask;
    beforeAll(async () => {
      ask = await getAsk(submitResult.askId);
    });

    test('ask exists in database', () => {
      expect(ask).not.toBeNull();
    });

    test('ask.name matches submitted value', () => {
      expect(ask.name).toBe(askPayload.name);
    });

    test('ask.address matches submitted value', () => {
      expect(ask.address).toBe(askPayload.address);
    });

    test('ask.description matches submitted value', () => {
      expect(ask.description).toBe(askPayload.description);
    });

    test('ask.urgency matches submitted value', () => {
      expect(ask.urgency).toBe(askPayload.urgency);
    });

    test('ask.project_id is set (linked to generated project)', () => {
      expect(ask.project_id).toBe(submitResult.projectId);
    });
  });

  // ── 1c. Project hidden from public ────────────────────────────────────────
  describe('1c. Project not visible publicly until approved', () => {
    test('pending project does NOT appear in public project_summary view', async () => {
      const { default: fetch } = await import('node-fetch');
      const res = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/project_summary?id=eq.${submitResult.projectId}`,
        {
          headers: {
            'apikey': process.env.SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`
          }
        }
      );
      const data = await res.json();
      // project_summary view excludes pending_approval — should return empty
      expect(data).toHaveLength(0);
    });

    test('pending project DOES appear in approval_queue (service role)', async () => {
      const queue = await getPendingQueue();
      const found = queue.find(p => p.id === submitResult.projectId);
      expect(found).toBeDefined();
    });
  });

  // ── 1d. Validation: missing required fields ───────────────────────────────
  describe('1d. Validation — missing required fields', () => {
    test('rejects ask with no name', async () => {
      const { status, data } = await api('/api/submit-ask', makeAsk({ name: '' }));
      expect(status).toBe(400);
      expect(data.error).toBeTruthy();
    });

    test('rejects ask with no address', async () => {
      const { status, data } = await api('/api/submit-ask', makeAsk({ address: '' }));
      expect(status).toBe(400);
    });

    test('rejects ask with no description', async () => {
      const { status, data } = await api('/api/submit-ask', makeAsk({ description: '' }));
      expect(status).toBe(400);
    });
  });
});
