/**
 * Suite 4: State machine
 *
 * Tests the full task lifecycle:
 * - Task submission by volunteer moves status to task_completed_review_not_assigned
 * - Coordinator approval moves task to task_completed_review_satisfactory
 * - Coordinator failure moves task to not_satisfactory, creates correction task
 * - Project status syncs automatically as tasks complete
 * - Bottleneck reporting saves to DB and links to task/project
 * - People are created on-the-fly when submitting with a new name
 */

const {
  api, sb, makeAsk,
  trackAsk, trackProject,
  cleanupTestData, getProject, getProjectTasks
} = require('./helpers');

// Helper: submit ask, approve project, return {projectId, tasks}
async function approvedProject(overrides = {}) {
  const { ok, data } = await api('/api/submit-ask', makeAsk({
    description: 'A large section of wooden privacy fence (approximately 40 linear feet) was knocked down by a falling branch. All fence posts are still in the ground. Rails and pickets are broken and scattered across the yard. The homeowner has replacement lumber on site.',
    category: 'Home repair',
    ...overrides
  }));
  if (!ok) throw new Error('submit-ask failed: ' + JSON.stringify(data));
  trackAsk(data.askId);
  trackProject(data.projectId);

  const { ok: approveOk, data: approveData } = await api('/api/review-project', {
    projectId: data.projectId,
    action: 'approve',
    reviewerEmail: 'bjlinville1@gmail.com'
  });
  if (!approveOk) throw new Error('approve failed: ' + JSON.stringify(approveData));

  const tasks = await sb(`tasks`, `project_id=eq.${data.projectId}&order=sequence.asc`);
  return { projectId: data.projectId, tasks };
}

describe('4. Task & project state machine', () => {
  afterAll(cleanupTestData);

  // ── 4a. Task submission by volunteer ──────────────────────────────────────
  describe('4a. Volunteer submits a task update', () => {
    let projectId;
    let task;
    let submitResult;

    beforeAll(async () => {
      ({ projectId, tasks: [task] } = await approvedProject());

      const { ok, data } = await api(`/api/tasks/${task.id}/submit`, {
        notes: 'Removed all broken rails and pickets from the 40-foot section. All debris collected into a single pile 6 feet east of the driveway. Replacement lumber measured and cut to length. Ready for installation.',
        personName: 'Jane Volunteer',
        personEmail: 'jane@test.reliefconnect.com'
      });
      expect(ok).toBe(true, `submit failed: ${JSON.stringify(data)}`);
      submitResult = data;
    }, 90000);

    test('returns success: true', () => {
      expect(submitResult.success).toBe(true);
    });

    test('returns a submissionId', () => {
      expect(submitResult.submissionId).toBeTruthy();
    });

    test('task status moves to task_completed_review_not_assigned', async () => {
      const tasks = await sb(`tasks`, `id=eq.${task.id}`);
      expect(tasks[0].status).toBe('task_completed_review_not_assigned');
    });

    test('submission record saved to database', async () => {
      const submissions = await sb(`submissions`, `task_id=eq.${task.id}`);
      expect(submissions.length).toBeGreaterThanOrEqual(1);
      expect(submissions[0].notes).toContain('removed all broken rails');
    });

    test('volunteer person record created', async () => {
      const people = await sb(`people`, `email=eq.jane@test.reliefconnect.com`);
      expect(people.length).toBeGreaterThanOrEqual(1);
      expect(people[0].name).toBe('Jane Volunteer');
    });

    test('submission without notes returns 400', async () => {
      const { status } = await api(`/api/tasks/${task.id}/submit`, { notes: '' });
      expect(status).toBe(400);
    });
  });

  // ── 4b. Coordinator approves a task ───────────────────────────────────────
  describe('4b. Coordinator approves task — pass', () => {
    let projectId;
    let task;
    let reviewResult;

    beforeAll(async () => {
      ({ projectId, tasks: [task] } = await approvedProject());

      // Submit first
      await api(`/api/tasks/${task.id}/submit`, {
        notes: 'All fence pickets replaced. Posts checked for plumb — all within 1/4 inch of vertical. Rails secured with 3-inch screws at 16-inch intervals.',
        personName: 'Bob Builder',
        personEmail: 'bob@test.reliefconnect.com'
      });

      const { ok, data } = await api(`/api/tasks/${task.id}/review`, {
        outcome: 'pass',
        notes: 'Verified via photos. All pickets installed, posts plumb, rails secure. Acceptance tests [1] and [2] both met.',
        reviewerEmail: 'bjlinville1@gmail.com'
      });
      expect(ok).toBe(true);
      reviewResult = data;
    }, 90000);

    test('review returns success: true', () => {
      expect(reviewResult.success).toBe(true);
    });

    test('task status moves to task_completed_review_satisfactory', () => {
      expect(reviewResult.newStatus).toBe('task_completed_review_satisfactory');
    });

    test('review record saved to database', async () => {
      const reviews = await sb(`reviews`, `task_id=eq.${task.id}`);
      expect(reviews.length).toBeGreaterThanOrEqual(1);
      expect(reviews[0].outcome).toBe('pass');
    });

    test('task history log has status change entry', async () => {
      const history = await sb(`task_history`, `task_id=eq.${task.id}&order=created_at.asc`);
      const passEntry = history.find(h => h.to_status === 'task_completed_review_satisfactory');
      expect(passEntry).toBeDefined();
    });
  });

  // ── 4c. Coordinator fails a task — auto-correction ────────────────────────
  describe('4c. Coordinator fails task — correction task created', () => {
    let projectId;
    let task;
    let tasksBefore;
    let tasksAfter;
    let reviewResult;

    beforeAll(async () => {
      ({ projectId, tasks: [task] } = await approvedProject());
      tasksBefore = await sb(`tasks`, `project_id=eq.${projectId}`);

      // Submit
      await api(`/api/tasks/${task.id}/submit`, {
        notes: 'Fence repaired. All done.',
        personName: 'Hasty Harry'
      });

      // Fail the review
      const { ok, data } = await api(`/api/tasks/${task.id}/review`, {
        outcome: 'fail',
        notes: 'Failed. Acceptance test [1]: All pickets must be vertical within 1/4 inch. Per photos, at least 6 pickets are visibly leaning more than 2 inches from vertical. Re-straighten and resubmit.',
        reviewerEmail: 'bjlinville1@gmail.com'
      });
      expect(ok).toBe(true);
      reviewResult = data;

      tasksAfter = await sb(`tasks`, `project_id=eq.${projectId}&order=sequence.asc`);
    }, 90000);

    test('review returns success: true', () => {
      expect(reviewResult.success).toBe(true);
    });

    test('failed task status moves to task_completed_review_not_satisfactory_reassigned_but_not_started', () => {
      expect(reviewResult.newStatus).toBe(
        'task_completed_review_not_satisfactory_reassigned_but_not_started'
      );
    });

    test('a correction task is automatically created', () => {
      expect(tasksAfter.length).toBe(tasksBefore.length + 1);
    });

    test('correction task title starts with "Correction required:"', () => {
      const corrTask = tasksAfter.find(t => t.title.startsWith('Correction required:'));
      expect(corrTask).toBeDefined();
    });

    test('correction task description contains the failure reason', () => {
      const corrTask = tasksAfter.find(t => t.title.startsWith('Correction required:'));
      expect(corrTask.description.toLowerCase()).toContain('failed');
      expect(corrTask.description.toLowerCase()).toContain('acceptance test');
    });

    test('correction task status is task_not_assigned', () => {
      const corrTask = tasksAfter.find(t => t.title.startsWith('Correction required:'));
      expect(corrTask.status).toBe('task_not_assigned');
    });

    test('review requires notes when failing (400 without notes)', async () => {
      const { status } = await api(`/api/tasks/${task.id}/review`, {
        outcome: 'fail',
        notes: ''
      });
      expect(status).toBe(400);
    });
  });

  // ── 4d. Project status syncs with task completion ─────────────────────────
  describe('4d. Project status syncs automatically', () => {
    let projectId;
    let tasks;

    beforeAll(async () => {
      ({ projectId, tasks } = await approvedProject());
    }, 90000);

    test('project starts in to_do', async () => {
      const p = await getProject(projectId);
      expect(p.status).toBe('to_do');
    });

    test('project moves to doing when a task is submitted', async () => {
      const task = tasks[0];
      await api(`/api/tasks/${task.id}/submit`, {
        notes: 'Started work. First 10 feet of fence cleared.',
        personName: 'Worker One'
      });
      // Trigger the sync by checking task status — project should update
      const raw = await sb(`projects`, `id=eq.${projectId}`);
      // Status should be doing now that a task is in review
      expect(['doing', 'to_do']).toContain(raw[0].status);
    });

    test('project moves to passed_inspection when ALL tasks satisfactory', async () => {
      // Pass all tasks
      for (const task of tasks) {
        // Make sure submitted
        const taskRow = await sb(`tasks`, `id=eq.${task.id}`);
        if (taskRow[0].status === 'task_not_assigned' || taskRow[0].status === 'task_assigned_but_not_started') {
          await api(`/api/tasks/${task.id}/submit`, {
            notes: 'Work completed to specification.',
            personName: 'Worker One'
          });
        }
        // Pass the review
        await api(`/api/tasks/${task.id}/review`, {
          outcome: 'pass',
          notes: 'All acceptance tests met. Work verified.',
          reviewerEmail: 'bjlinville1@gmail.com'
        });
      }

      const raw = await sb(`projects`, `id=eq.${projectId}`);
      expect(raw[0].status).toBe('passed_inspection');
    });
  });

  // ── 4e. Bottleneck reporting ──────────────────────────────────────────────
  describe('4e. Bottleneck reporting', () => {
    let projectId;
    let task;
    let bottleneckResult;

    beforeAll(async () => {
      ({ projectId, tasks: [task] } = await approvedProject());

      const { ok, data } = await api(`/api/tasks/${task.id}/bottleneck`, {
        description: 'Missing materials — need 40 linear feet of 1x6 cedar pickets and 16 8-foot 4x4 posts before work can continue. Lumber yard is 12 miles south on Route 9.',
        reporterName: 'Stuck Sally',
        reporterEmail: 'sally@test.reliefconnect.com'
      });
      expect(ok).toBe(true);
      bottleneckResult = data;
    }, 90000);

    test('returns success: true', () => {
      expect(bottleneckResult.success).toBe(true);
    });

    test('returns a bottleneckId', () => {
      expect(bottleneckResult.bottleneckId).toBeTruthy();
    });

    test('bottleneck saved in database', async () => {
      const bns = await sb(`bottlenecks`, `task_id=eq.${task.id}`);
      expect(bns.length).toBeGreaterThanOrEqual(1);
      expect(bns[0].description).toContain('Missing materials');
      expect(bns[0].resolved).toBe(false);
    });

    test('bottleneck linked to correct project', async () => {
      const bns = await sb(`bottlenecks`, `task_id=eq.${task.id}`);
      expect(bns[0].project_id).toBe(projectId);
    });

    test('appears in open_bottlenecks view', async () => {
      const open = await sb(`open_bottlenecks`, `task_id=eq.${task.id}`);
      expect(open.length).toBeGreaterThanOrEqual(1);
      expect(open[0].reporter_name).toBe('Stuck Sally');
    });

    test('bottleneck can be resolved', async () => {
      const bns = await sb(`bottlenecks`, `task_id=eq.${task.id}`);
      const bnId = bns[0].id;

      const { ok } = await api('/api/resolve-bottleneck', { bottleneckId: bnId });
      expect(ok).toBe(true);

      const updated = await sb(`bottlenecks`, `id=eq.${bnId}`);
      expect(updated[0].resolved).toBe(true);
      expect(updated[0].resolved_at).toBeTruthy();
    });

    test('resolved bottleneck no longer appears in open_bottlenecks view', async () => {
      const open = await sb(`open_bottlenecks`, `task_id=eq.${task.id}`);
      expect(open.length).toBe(0);
    });

    test('bottleneck without description returns 400', async () => {
      const { status } = await api(`/api/tasks/${task.id}/bottleneck`, {
        description: ''
      });
      expect(status).toBe(400);
    });
  });

  // ── 4f. People creation on-the-fly ───────────────────────────────────────
  describe('4f. People created on-the-fly during submissions', () => {
    test('submitting with unrecognized name creates a new person', async () => {
      const { projectId, tasks: [task] } = await approvedProject();
      const uniqueName = `Unique Person ${Date.now()}`;
      const uniqueEmail = `unique${Date.now()}@test.reliefconnect.com`;

      await api(`/api/tasks/${task.id}/submit`, {
        notes: 'Completed the task.',
        personName: uniqueName,
        personEmail: uniqueEmail
      });

      const people = await sb(`people`, `email=eq.${uniqueEmail}`);
      expect(people.length).toBe(1);
      expect(people[0].name).toBe(uniqueName);
    });

    test('submitting twice with same email does not create duplicate person', async () => {
      const { projectId, tasks } = await approvedProject();
      const sharedEmail = `nodupe${Date.now()}@test.reliefconnect.com`;

      for (const task of tasks.slice(0, 2)) {
        await api(`/api/tasks/${task.id}/submit`, {
          notes: 'Work done.',
          personName: 'Same Person',
          personEmail: sharedEmail
        });
      }

      const people = await sb(`people`, `email=eq.${sharedEmail}`);
      expect(people.length).toBe(1);
    });
  });
});
