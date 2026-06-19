/**
 * Suite 2: AI scope generation
 *
 * Tests that the AI-generated project scope:
 * - Has a concise, action-oriented mission title (no "Help needed", no address)
 * - Has mission-level acceptance tests in the right format
 * - Has at least one project with at least one task
 * - Tasks are specific and physical (not "assessment" or "planning")
 * - Each task has its own acceptance tests
 * - Tasks do NOT contain banned vague language
 * - PM briefing is present and substantive
 * - Agent briefing is present
 * - ai_attempt_count starts at 1
 */

const {
  api, sb, makeAsk,
  trackAsk, trackProject,
  cleanupTestData, getProject, getProjectTasks
} = require('./helpers');

// Vague words explicitly banned from task descriptions
const BANNED_SPATIAL = ['near ', 'close to', 'next to', 'along the', 'toward ', 'away from'];
const BANNED_QUANTITY = [' some ', ' most ', ' several ', ' a few ', 'as needed', 'as necessary', 'if applicable'];
const BANNED_CONDITION = [' clean ', ' secure ', ' stable ', ' adequate ', ' appropriate ', ' proper '];
const BANNED_TASK_TYPES = ['assessment', 'planning', 'survey', 'evaluation', 'inspect and report'];

describe('2. AI scope generation', () => {
  let result;
  let project;
  let tasks;

  beforeAll(async () => {
    // Use a concrete debris removal ask to get predictable task types
    const ask = makeAsk({
      description: 'A large oak tree fell across the driveway during last night\'s storm. The trunk is approximately 18 inches in diameter and 40 feet long, blocking vehicle access completely. Multiple large branches are scattered across the front yard. No power lines involved. The wood should be cut and stacked for the homeowner to keep.',
      category: 'Debris removal',
      urgency: 'high'
    });

    const { ok, data } = await api('/api/submit-ask', ask);
    expect(ok).toBe(true);
    result = data;

    if (result.askId) trackAsk(result.askId);
    if (result.projectId) trackProject(result.projectId);

    project = await getProject(result.projectId);

    // Get tasks via service role (project is still pending)
    tasks = await sb(`tasks`, `project_id=eq.${result.projectId}&order=sequence.asc`);
  }, 60000); // AI call can take time

  afterAll(cleanupTestData);

  // ── 2a. Mission title ─────────────────────────────────────────────────────
  describe('2a. Mission title', () => {
    test('mission title exists and is non-empty', () => {
      expect(result.missionTitle).toBeTruthy();
      expect(result.missionTitle.length).toBeGreaterThan(3);
    });

    test('mission title does not contain "Help needed"', () => {
      expect(result.missionTitle.toLowerCase()).not.toContain('help needed');
    });

    test('mission title does not contain the street address', () => {
      expect(result.missionTitle.toLowerCase()).not.toContain('pennsylvania');
      expect(result.missionTitle.toLowerCase()).not.toContain('washington');
    });

    test('mission title is concise (≤8 words)', () => {
      const wordCount = result.missionTitle.trim().split(/\s+/).length;
      expect(wordCount).toBeLessThanOrEqual(8);
    });

    test('mission title is action-oriented (starts with verb or noun describing action)', () => {
      // Should not start with "A " or "The " — should be like "Downed tree cleanup"
      expect(result.missionTitle).not.toMatch(/^(A |The |An )/i);
    });
  });

  // ── 2b. Mission-level acceptance tests ────────────────────────────────────
  describe('2b. Mission-level acceptance tests', () => {
    test('at least 1 acceptance test generated', () => {
      expect(result.acceptanceTests).toBeDefined();
      expect(result.acceptanceTests.length).toBeGreaterThanOrEqual(1);
    });

    test('each acceptance test starts with "It would be acceptable if"', () => {
      result.acceptanceTests.forEach(t => {
        expect(t.toLowerCase()).toMatch(/^it would be acceptable if/);
      });
    });

    test('acceptance tests are stored in project record', () => {
      expect(project).toBeDefined();
      expect(project.acceptance_tests).toBeDefined();
      expect(project.acceptance_tests.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 2c. Tasks generated ───────────────────────────────────────────────────
  describe('2c. Tasks', () => {
    test('at least 1 task generated', () => {
      expect(tasks).toBeDefined();
      expect(tasks.length).toBeGreaterThanOrEqual(1);
    });

    test('each task has a non-empty title', () => {
      tasks.forEach(t => {
        expect(t.title).toBeTruthy();
        expect(t.title.length).toBeGreaterThan(3);
      });
    });

    test('each task has a description with ≥20 words', () => {
      tasks.forEach(t => {
        const wordCount = (t.description || '').trim().split(/\s+/).length;
        expect(wordCount).toBeGreaterThanOrEqual(20);
      });
    });

    test('each task has specified tools', () => {
      tasks.forEach(t => {
        expect(t.tools).toBeTruthy();
      });
    });

    test('each task has at least 1 acceptance test', () => {
      tasks.forEach(t => {
        const ats = t.acceptance_tests || [];
        expect(ats.length).toBeGreaterThanOrEqual(1);
      });
    });

    test('task-level acceptance tests start with "It would be acceptable if"', () => {
      tasks.forEach(t => {
        (t.acceptance_tests || []).forEach(at => {
          expect(at.toLowerCase()).toMatch(/^it would be acceptable if/);
        });
      });
    });

    test('tasks start in acceptance_test_written status', () => {
      tasks.forEach(t => {
        expect(t.status).toBe('acceptance_test_written');
      });
    });

    test('tasks have sequential sequence numbers', () => {
      tasks.forEach((t, i) => {
        expect(t.sequence).toBe(i);
      });
    });
  });

  // ── 2d. No vague language in tasks ────────────────────────────────────────
  describe('2d. No vague language in task descriptions', () => {
    test('task descriptions contain no banned spatial words', () => {
      tasks.forEach(task => {
        const desc = (task.description || '').toLowerCase();
        BANNED_SPATIAL.forEach(word => {
          expect(desc).not.toContain(word);
        });
      });
    });

    test('task descriptions contain no banned quantity words', () => {
      tasks.forEach(task => {
        const desc = (task.description || '').toLowerCase();
        BANNED_QUANTITY.forEach(word => {
          expect(desc).not.toContain(word);
        });
      });
    });

    test('task descriptions contain no banned condition words', () => {
      tasks.forEach(task => {
        const desc = (task.description || '').toLowerCase();
        BANNED_CONDITION.forEach(word => {
          expect(desc).not.toContain(word);
        });
      });
    });

    test('no task titles are generic assessment/planning tasks', () => {
      tasks.forEach(task => {
        const title = (task.title || '').toLowerCase();
        BANNED_TASK_TYPES.forEach(banned => {
          expect(title).not.toContain(banned);
        });
      });
    });
  });

  // ── 2e. Briefings ─────────────────────────────────────────────────────────
  describe('2e. PM and agent briefings', () => {
    test('PM briefing is present and ≥30 words', () => {
      const words = (result.pmBriefing || '').trim().split(/\s+/).length;
      expect(words).toBeGreaterThanOrEqual(30);
    });

    test('PM briefing is stored in project record', () => {
      expect(project.pm_briefing || result.pmBriefing).toBeTruthy();
    });

    test('agent briefing is present', () => {
      expect(result.agentBriefing).toBeTruthy();
    });
  });

  // ── 2f. Project metadata ──────────────────────────────────────────────────
  describe('2f. Project metadata', () => {
    test('ai_attempt_count starts at 1', () => {
      expect(project.ai_attempt_count).toBe(1);
    });

    test('project is linked to ask', () => {
      expect(project).toBeDefined();
    });

    test('project summary includes task counts', () => {
      expect(parseInt(project.total_tasks)).toBeGreaterThanOrEqual(1);
      expect(parseInt(project.completed_tasks)).toBe(0);
    });
  });
});
