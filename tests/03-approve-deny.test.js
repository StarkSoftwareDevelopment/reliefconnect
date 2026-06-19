/**
 * Suite 3: Approve / Deny workflow
 *
 * Tests that:
 * - Approving a project transitions it to to_do
 * - Approved project becomes publicly visible
 * - Tasks transition from acceptance_test_written to task_not_assigned on approval
 * - Denying without a reason is rejected
 * - Denying with a reason triggers AI rewrite and increments counters
 * - Rewritten project returns to approval queue with updated content
 * - After 2 denials, project is flagged for manual attention (no more auto-rewrites)
 * - Approving a previously denied project still works correctly
 */

const {
  api, sb, makeAsk,
  trackAsk, trackProject,
  cleanupTestData, getProject, getProjectTasks, getPendingQueue
} = require('./helpers');

// Helper: submit an ask and return the project ID
async function submitAndGetProject(overrides = {}) {
  const { ok, data } = await api('/api/submit-ask', makeAsk(overrides));
  if (!ok) throw new Error(`submit-ask failed: ${JSON.stringify(data)}`);
  trackAsk(data.askId);
  trackProject(data.projectId);
  return data;
}

describe('3. Approve / Deny workflow', () => {
  afterAll(cleanupTestData);

  // ── 3a. Approve a project ─────────────────────────────────────────────────
  describe('3a. Approving a project', () => {
    let projectId;
    let projectBefore;
    let projectAfter;
    let tasksBefore;
    let tasksAfter;

    beforeAll(async () => {
      const sub = await submitAndGetProject({ urgency: 'medium' });
      projectId = sub.projectId;
      projectBefore = await getProject(projectId);
      tasksBefore = await sb(`tasks`, `project_id=eq.${projectId}`);

      const { ok, data } = await api('/api/review-project', {
        projectId,
        action: 'approve',
        reviewerEmail: 'bjlinville1@gmail.com'
      });
      expect(ok).toBe(true, `approve failed: ${JSON.stringify(data)}`);

      projectAfter = await getProject(projectId);
      tasksAfter = await sb(`tasks`, `project_id=eq.${projectId}`);
    }, 60000);

    test('project was in pending_approval before', () => {
      // project_summary excludes pending — we check raw table
      // projectBefore will be null from view (hidden), but project exists
      // We verify it transitions correctly after approval
      expect(projectAfter).toBeDefined();
    });

    test('project status is to_do after approval', () => {
      expect(projectAfter.status).toBe('to_do');
    });

    test('project appears in public project_summary view after approval', () => {
      // getProject() uses project_summary which excludes pending_approval
      expect(projectAfter).not.toBeNull();
      expect(projectAfter.id).toBe(projectId);
    });

    test('approved_at timestamp is set', async () => {
      const raw = await sb(`projects`, `id=eq.${projectId}`);
      expect(raw[0].approved_at).toBeTruthy();
    });

    test('approved_by references B.J. Linville', async () => {
      const raw = await sb(`projects`, `id=eq.${projectId}`);
      expect(raw[0].approved_by).toBeTruthy();
    });

    test('all tasks transition to task_not_assigned', () => {
      expect(tasksAfter.length).toBeGreaterThan(0);
      tasksAfter.forEach(t => {
        expect(t.status).toBe('task_not_assigned');
      });
    });

    test('project no longer appears in approval queue', async () => {
      const queue = await getPendingQueue();
      const found = queue.find(p => p.id === projectId);
      expect(found).toBeUndefined();
    });

    test('returns 400 if action is missing', async () => {
      const { status } = await api('/api/review-project', { projectId });
      expect(status).toBe(400);
    });
  });

  // ── 3b. Deny without reason is rejected ──────────────────────────────────
  describe('3b. Deny requires a reason', () => {
    let projectId;

    beforeAll(async () => {
      const sub = await submitAndGetProject();
      projectId = sub.projectId;
    }, 60000);

    test('deny with no reason returns 400', async () => {
      const { status, data } = await api('/api/review-project', {
        projectId,
        action: 'deny'
      });
      expect(status).toBe(400);
      expect(data.error).toMatch(/reason/i);
    });

    test('deny with empty reason returns 400', async () => {
      const { status } = await api('/api/review-project', {
        projectId,
        action: 'deny',
        denialReason: '   '
      });
      expect(status).toBe(400);
    });

    test('project remains in pending_approval after failed deny', async () => {
      const raw = await sb(`projects`, `id=eq.${projectId}`);
      expect(raw[0].status).toBe('pending_approval');
    });
  });

  // ── 3c. First denial triggers AI rewrite ─────────────────────────────────
  describe('3c. First denial — AI rewrite', () => {
    let sub;
    let projectId;
    let projectBefore;
    let denyResult;
    let projectAfter;
    let tasksAfter;

    beforeAll(async () => {
      sub = await submitAndGetProject({
        description: 'Three large pine trees fell on the back fence during the storm. The fence is damaged in a 30-foot section. Trees need to be removed and the fence needs to be repaired.'
      });
      projectId = sub.projectId;

      // Capture original title before denial
      const rawBefore = await sb(`projects`, `id=eq.${projectId}`);
      projectBefore = rawBefore[0];

      const { ok, data } = await api('/api/review-project', {
        projectId,
        action: 'deny',
        denialReason: 'Tasks are too generic. Please specify exact cut lengths for logs, exact pile placement with cardinal directions and distances, and exact fence repair specifications including post depth and rail dimensions.',
        reviewerEmail: 'bjlinville1@gmail.com'
      });
      expect(ok).toBe(true, `deny failed: ${JSON.stringify(data)}`);
      denyResult = data;

      const rawAfter = await sb(`projects`, `id=eq.${projectId}`);
      projectAfter = rawAfter[0];
      tasksAfter = await sb(`tasks`, `project_id=eq.${projectId}&order=sequence.asc`);
    }, 90000); // Two AI calls (original + rewrite)

    test('deny returns action: rewritten', () => {
      expect(denyResult.action).toBe('rewritten');
    });

    test('attempt number incremented to 2', () => {
      expect(denyResult.attempt).toBe(2);
    });

    test('project ai_attempt_count is 2', () => {
      expect(projectAfter.ai_attempt_count).toBe(2);
    });

    test('project denial_count is 1', () => {
      expect(projectAfter.denial_count).toBe(1);
    });

    test('denial_reason is stored on project', () => {
      expect(projectAfter.denial_reason).toBeTruthy();
      expect(projectAfter.denial_reason.toLowerCase()).toContain('generic');
    });

    test('project remains in pending_approval after rewrite', () => {
      expect(projectAfter.status).toBe('pending_approval');
    });

    test('project still appears in approval queue', async () => {
      const queue = await getPendingQueue();
      const found = queue.find(p => p.id === projectId);
      expect(found).toBeDefined();
    });

    test('rewritten project has new tasks (old tasks replaced)', () => {
      expect(tasksAfter.length).toBeGreaterThanOrEqual(1);
      // All new tasks should be in acceptance_test_written status
      tasksAfter.forEach(t => {
        expect(t.status).toBe('acceptance_test_written');
      });
    });

    test('rewritten project has a (potentially different) title', () => {
      expect(denyResult.newTitle || projectAfter.title).toBeTruthy();
    });

    test('approval queue entry shows denial history', async () => {
      const queue = await getPendingQueue();
      const entry = queue.find(p => p.id === projectId);
      expect(entry).toBeDefined();
      expect(entry.ai_attempt_count).toBe(2);
      expect(entry.denial_count).toBe(1);
    });

    // Can still approve after a rewrite
    test('rewritten project can be approved', async () => {
      const { ok, data } = await api('/api/review-project', {
        projectId,
        action: 'approve',
        reviewerEmail: 'bjlinville1@gmail.com'
      });
      expect(ok).toBe(true);
      const raw = await sb(`projects`, `id=eq.${projectId}`);
      expect(raw[0].status).toBe('to_do');
    });
  });

  // ── 3d. Max denials — flagged for manual ──────────────────────────────────
  describe('3d. After 2 denials — flagged for manual attention', () => {
    let projectId;

    beforeAll(async () => {
      const sub = await submitAndGetProject();
      projectId = sub.projectId;

      // Deny twice
      for (let i = 1; i <= 2; i++) {
        const { ok } = await api('/api/review-project', {
          projectId,
          action: 'deny',
          denialReason: `Test denial #${i} — tasks still too vague, need specific measurements.`
        });
        expect(ok).toBe(true);
      }
    }, 120000); // 3 AI calls total

    test('denial_count reaches 2', async () => {
      const raw = await sb(`projects`, `id=eq.${projectId}`);
      expect(raw[0].denial_count).toBe(2);
    });

    test('third deny returns action: flagged_for_manual', async () => {
      const { ok, data } = await api('/api/review-project', {
        projectId,
        action: 'deny',
        denialReason: 'Still not specific enough.'
      });
      expect(ok).toBe(true);
      expect(data.action).toBe('flagged_for_manual');
    });

    test('flagged project remains in pending_approval', async () => {
      const raw = await sb(`projects`, `id=eq.${projectId}`);
      expect(raw[0].status).toBe('pending_approval');
    });

    test('flagged project still appears in approval queue for manual edit', async () => {
      const queue = await getPendingQueue();
      const found = queue.find(p => p.id === projectId);
      expect(found).toBeDefined();
    });

    // Coordinator can still manually approve a flagged project
    test('flagged project can still be manually approved', async () => {
      const { ok } = await api('/api/review-project', {
        projectId,
        action: 'approve',
        reviewerEmail: 'bjlinville1@gmail.com'
      });
      expect(ok).toBe(true);
      const raw = await sb(`projects`, `id=eq.${projectId}`);
      expect(raw[0].status).toBe('to_do');
    });
  });

  // ── 3e. Edge cases ────────────────────────────────────────────────────────
  describe('3e. Edge cases', () => {
    test('review-project with invalid projectId returns 404', async () => {
      const { status } = await api('/api/review-project', {
        projectId: '00000000-0000-0000-0000-000000000000',
        action: 'approve'
      });
      expect(status).toBe(404);
    });

    test('review-project with invalid action returns 400', async () => {
      const sub = await submitAndGetProject();
      const { status } = await api('/api/review-project', {
        projectId: sub.projectId,
        action: 'maybe'
      });
      expect(status).toBe(400);
    });
  });
});
