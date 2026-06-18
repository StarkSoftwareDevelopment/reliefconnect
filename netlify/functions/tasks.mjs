/**
 * PATCH /api/tasks/:id            — update task (status, assignment, etc.)
 * POST  /api/tasks/:id/submit     — volunteer submits task update
 * POST  /api/tasks/:id/review     — coordinator reviews submission
 * POST  /api/tasks/:id/bottleneck — report a bottleneck
 * GET   /api/projects/:id/tasks   — get all tasks for a project
 * POST  /api/projects/:id/roles   — create a role on a project
 * POST  /api/projects/:id/roles/:roleId/assign — assign person to role
 */

import { supabaseQuery, jsonResponse, errorResponse } from './lib/supabase.mjs';

export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;

  // Route: GET /api/projects/:id/tasks
  const projectTasksMatch = path.match(/^\/api\/projects\/([^\/]+)\/tasks$/);
  if (projectTasksMatch && req.method === 'GET') {
    return getProjectTasks(projectTasksMatch[1]);
  }

  // Route: POST /api/projects/:id/roles
  const projectRolesMatch = path.match(/^\/api\/projects\/([^\/]+)\/roles$/);
  if (projectRolesMatch && req.method === 'POST') {
    return createRole(req, projectRolesMatch[1]);
  }

  // Route: POST /api/projects/:id/roles/:roleId/assign
  const roleAssignMatch = path.match(/^\/api\/projects\/([^\/]+)\/roles\/([^\/]+)\/assign$/);
  if (roleAssignMatch && req.method === 'POST') {
    return assignPersonToRole(req, roleAssignMatch[1], roleAssignMatch[2]);
  }

  // Route: PATCH /api/tasks/:id
  const taskMatch = path.match(/^\/api\/tasks\/([^\/]+)$/);
  if (taskMatch && req.method === 'PATCH') {
    return updateTask(req, taskMatch[1]);
  }

  // Route: POST /api/tasks/:id/submit
  const submitMatch = path.match(/^\/api\/tasks\/([^\/]+)\/submit$/);
  if (submitMatch && req.method === 'POST') {
    return submitTaskUpdate(req, submitMatch[1]);
  }

  // Route: POST /api/tasks/:id/review
  const reviewMatch = path.match(/^\/api\/tasks\/([^\/]+)\/review$/);
  if (reviewMatch && req.method === 'POST') {
    return reviewTask(req, reviewMatch[1]);
  }

  // Route: POST /api/tasks/:id/bottleneck
  const bottleneckMatch = path.match(/^\/api\/tasks\/([^\/]+)\/bottleneck$/);
  if (bottleneckMatch && req.method === 'POST') {
    return reportBottleneck(req, bottleneckMatch[1]);
  }

  return errorResponse('Not found', 404);
};

async function getProjectTasks(projectId) {
  try {
    const tasks = await supabaseQuery(
      `task_detail?project_id=eq.${projectId}&order=sequence.asc`, {}, false
    );
    return jsonResponse(tasks || []);
  } catch (e) { return errorResponse(e.message); }
}

async function updateTask(req, taskId) {
  let body;
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }

  const allowed = ['status', 'assigned_to', 'role_id', 'title', 'description',
                   'tools', 'acceptance_tests', 'sequence', 'locked_fields'];
  const updates = {};
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key];
  }

  try {
    const [task] = await supabaseQuery(`tasks?id=eq.${taskId}`, {
      method: 'PATCH', body: updates
    }, true);

    // If assigned_to changed, check role auto-propagation
    if (body.assigned_to && body.role_id) {
      await propagateRoleAssignment(body.role_id, body.assigned_to);
    }

    return jsonResponse(task);
  } catch (e) { return errorResponse(e.message); }
}

async function submitTaskUpdate(req, taskId) {
  let body;
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }

  const { notes, personName, personEmail, fileUrls } = body;
  if (!notes) return errorResponse('Notes are required', 400);

  try {
    // Get or create person
    let person = null;
    if (personEmail || personName) {
      const query = personEmail
        ? `people?email=eq.${encodeURIComponent(personEmail)}&limit=1`
        : `people?name=ilike.${encodeURIComponent(personName)}&limit=1`;
      const existing = await supabaseQuery(query, {}, true);
      if (existing?.length) {
        person = existing[0];
      } else if (personName) {
        const [p] = await supabaseQuery('people', {
          method: 'POST', body: { name: personName, email: personEmail }
        }, true);
        person = p;
      }
    }

    const [submission] = await supabaseQuery('submissions', {
      method: 'POST',
      body: {
        task_id: taskId,
        person_id: person?.id || null,
        notes,
        file_urls: fileUrls || []
      }
    }, true);

    // Update task status
    await supabaseQuery(`tasks?id=eq.${taskId}`, {
      method: 'PATCH',
      body: { status: 'task_completed_review_not_assigned' }
    }, true);

    // Send alert
    const [task] = await supabaseQuery(`tasks?id=eq.${taskId}&limit=1`, {}, true);
    if (task) {
      await sendCoordinatorAlert({
        type: 'review',
        subject: `📋 Task submitted for review`,
        message: `Task "${task.title}" has been submitted for review by ${personName || 'a volunteer'}.`,
        taskTitle: task.title
      });
    }

    return jsonResponse({ success: true, submissionId: submission.id });
  } catch (e) { return errorResponse(e.message); }
}

async function reviewTask(req, taskId) {
  let body;
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }

  const { outcome, notes, reviewerEmail } = body;
  if (!outcome) return errorResponse('Outcome required', 400);
  if (outcome === 'fail' && !notes) return errorResponse('Notes required when failing', 400);

  try {
    let reviewer = null;
    if (reviewerEmail) {
      const people = await supabaseQuery(
        `people?email=eq.${encodeURIComponent(reviewerEmail)}&limit=1`, {}, true
      );
      reviewer = people?.[0];
    }

    const [review] = await supabaseQuery('reviews', {
      method: 'POST',
      body: { task_id: taskId, reviewer_id: reviewer?.id, outcome, notes }
    }, true);

    const newStatus = outcome === 'pass'
      ? 'task_completed_review_satisfactory'
      : 'task_completed_review_not_satisfactory_reassigned_but_not_started';

    await supabaseQuery(`tasks?id=eq.${taskId}`, {
      method: 'PATCH', body: { status: newStatus }
    }, true);

    // On fail: create a correction task
    if (outcome === 'fail') {
      const [originalTask] = await supabaseQuery(`tasks?id=eq.${taskId}&limit=1`, {}, true);
      if (originalTask) {
        await supabaseQuery('tasks', {
          method: 'POST',
          body: {
            project_id: originalTask.project_id,
            title: `Correction required: ${originalTask.title}`,
            description: `FAILED REVIEW — ${notes}\n\nOriginal task: ${originalTask.description}`,
            tools: originalTask.tools,
            acceptance_tests: originalTask.acceptance_tests,
            status: 'task_not_assigned',
            sequence: (originalTask.sequence || 0) + 0.5
          },
          prefer: 'return=minimal'
        }, true);
      }
    }

    return jsonResponse({ success: true, reviewId: review.id, newStatus });
  } catch (e) { return errorResponse(e.message); }
}

async function reportBottleneck(req, taskId) {
  let body;
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }

  const { description, reporterName, reporterEmail } = body;
  if (!description) return errorResponse('Description required', 400);

  try {
    const [task] = await supabaseQuery(`tasks?id=eq.${taskId}&limit=1`, {}, true);
    if (!task) return errorResponse('Task not found', 404);

    let reporter = null;
    if (reporterEmail || reporterName) {
      const query = reporterEmail
        ? `people?email=eq.${encodeURIComponent(reporterEmail)}&limit=1`
        : `people?name=ilike.${encodeURIComponent(reporterName)}&limit=1`;
      const existing = await supabaseQuery(query, {}, true);
      reporter = existing?.[0] || null;
      if (!reporter && reporterName) {
        const [p] = await supabaseQuery('people', {
          method: 'POST', body: { name: reporterName, email: reporterEmail }
        }, true);
        reporter = p;
      }
    }

    const [bn] = await supabaseQuery('bottlenecks', {
      method: 'POST',
      body: {
        task_id: taskId,
        project_id: task.project_id,
        reporter_id: reporter?.id,
        description
      }
    }, true);

    await sendCoordinatorAlert({
      type: 'bottleneck',
      subject: `⚠️ Bottleneck reported`,
      message: description,
      taskTitle: task.title
    });

    return jsonResponse({ success: true, bottleneckId: bn.id });
  } catch (e) { return errorResponse(e.message); }
}

async function createRole(req, projectId) {
  let body;
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }
  const { name, requiredCredential, createdByEmail } = body;
  if (!name) return errorResponse('Role name required', 400);

  try {
    let creator = null;
    if (createdByEmail) {
      const people = await supabaseQuery(
        `people?email=eq.${encodeURIComponent(createdByEmail)}&limit=1`, {}, true
      );
      creator = people?.[0];
    }

    const [role] = await supabaseQuery('project_roles', {
      method: 'POST',
      body: { project_id: projectId, name, required_credential: requiredCredential || null, created_by: creator?.id }
    }, true);

    return jsonResponse(role, 201);
  } catch (e) { return errorResponse(e.message); }
}

async function assignPersonToRole(req, projectId, roleId) {
  let body;
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }
  const { personId, approvedByEmail } = body;
  if (!personId) return errorResponse('personId required', 400);

  try {
    let approver = null;
    if (approvedByEmail) {
      const people = await supabaseQuery(
        `people?email=eq.${encodeURIComponent(approvedByEmail)}&limit=1`, {}, true
      );
      approver = people?.[0];
    }

    const [assignment] = await supabaseQuery('role_assignments', {
      method: 'POST',
      body: { role_id: roleId, person_id: personId, approved: !!approver, approved_by: approver?.id }
    }, true);

    // Auto-assign all tasks delegated to this role to this person
    if (approver) {
      await propagateRoleAssignment(roleId, personId);
    }

    return jsonResponse(assignment, 201);
  } catch (e) { return errorResponse(e.message); }
}

async function propagateRoleAssignment(roleId, personId) {
  // Find all unassigned tasks for this role and assign them to the person
  await supabaseQuery(
    `tasks?role_id=eq.${roleId}&assigned_to=is.null`,
    {
      method: 'PATCH',
      body: { assigned_to: personId, status: 'task_assigned_but_not_started' }
    },
    true
  );
}

async function sendCoordinatorAlert({ type, subject, message, taskTitle }) {
  try {
    const sendgridKey = Netlify.env.get('SENDGRID_API_KEY');
    const fromEmail = Netlify.env.get('ALERT_FROM_EMAIL') || 'alerts@volunteerdisasterrelief.com';
    const toEmail = 'bjlinville1@gmail.com';
    if (!sendgridKey) return;

    await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${sendgridKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: toEmail }] }],
        from: { email: fromEmail, name: 'ReliefConnect' },
        subject,
        content: [{
          type: 'text/plain',
          value: `${message}\n\nTask: ${taskTitle || 'N/A'}\n\nView at: https://volunteerdisasterrelief.com`
        }]
      })
    });
  } catch (e) { console.warn('Alert failed:', e); }
}

export const config = { path: '/api/*' };
