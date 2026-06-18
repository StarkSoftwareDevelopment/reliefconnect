/**
 * POST /api/review-project
 * Coordinator approves or denies a pending project.
 * On deny: triggers AI rewrite (up to 2 attempts), then flags for manual.
 * On approve: publishes project, transitions tasks to task_not_assigned.
 */

import { supabaseQuery, jsonResponse, errorResponse } from './lib/supabase.mjs';
import { generateProjectScope } from './submit-ask.mjs';

export default async (req) => {
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  let body;
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }

  const { projectId, action, denialReason, reviewerEmail, projectEdits } = body;
  if (!projectId || !action) return errorResponse('Missing projectId or action', 400);
  if (action === 'deny' && !denialReason) return errorResponse('Denial reason is required', 400);

  try {
    // Get the project
    const [project] = await supabaseQuery(
      `projects?id=eq.${projectId}&limit=1`, {}, true
    );
    if (!project) return errorResponse('Project not found', 404);

    // Get reviewer person record
    let reviewer = null;
    if (reviewerEmail) {
      const people = await supabaseQuery(
        `people?email=eq.${encodeURIComponent(reviewerEmail)}&limit=1`, {}, true
      );
      reviewer = people?.[0] || null;
    }

    if (action === 'approve') {
      // Apply any manual edits from coordinator
      const updates = {
        status: 'to_do',
        approved_at: new Date().toISOString(),
        ...(reviewer ? { approved_by: reviewer.id } : {}),
        ...(projectEdits || {})
      };

      await supabaseQuery(`projects?id=eq.${projectId}`, {
        method: 'PATCH', body: updates
      }, true);

      // Transition all setup tasks to task_not_assigned
      await supabaseQuery(
        `tasks?project_id=eq.${projectId}`,
        { method: 'PATCH', body: { status: 'task_not_assigned' } },
        true
      );

      return jsonResponse({ success: true, action: 'approved', projectId, status: 'to_do' });

    } else if (action === 'deny') {
      const newDenialCount = (project.denial_count || 0) + 1;
      const maxAutoRewrites = 2;

      if (newDenialCount > maxAutoRewrites) {
        // Flag for manual attention — no more auto-rewrites
        await supabaseQuery(`projects?id=eq.${projectId}`, {
          method: 'PATCH',
          body: {
            denial_reason: denialReason,
            denial_count: newDenialCount,
            status: 'pending_approval' // stays in queue, flagged
          }
        }, true);

        return jsonResponse({
          success: true,
          action: 'flagged_for_manual',
          message: `Project has been denied ${newDenialCount} times. Manual rewrite required.`,
          projectId
        });
      }

      // Auto-rewrite with denial context
      const ask = await supabaseQuery(
        `asks?id=eq.${project.ask_id}&limit=1`, {}, true
      ).then(r => r?.[0]);

      if (!ask) return errorResponse('Original ask not found', 404);

      const newAttempt = (project.ai_attempt_count || 1) + 1;
      const aiResult = await generateProjectScope(ask, newAttempt, {
        reason: denialReason,
        previousTitle: project.title
      });

      // Delete old tasks
      await supabaseQuery(
        `tasks?project_id=eq.${projectId}`,
        { method: 'DELETE', prefer: 'return=minimal' },
        true
      );

      // Update project with new AI content
      await supabaseQuery(`projects?id=eq.${projectId}`, {
        method: 'PATCH',
        body: {
          title: aiResult.missionTitle,
          summary: aiResult.summary,
          acceptance_tests: aiResult.acceptanceTests || [],
          pm_briefing: aiResult.pmBriefing || '',
          agent_briefing: aiResult.agentBriefing || '',
          denial_reason: denialReason,
          denial_count: newDenialCount,
          ai_attempt_count: newAttempt,
          status: 'pending_approval'
        }
      }, true);

      // Insert new tasks
      const taskInserts = [];
      let sequence = 0;
      for (const proj of (aiResult.projects || [])) {
        for (const task of (proj.tasks || [])) {
          taskInserts.push({
            project_id: projectId,
            title: task.title,
            description: task.description,
            tools: task.tools || '',
            acceptance_tests: task.acceptanceTests || [],
            status: 'acceptance_test_written',
            sequence: sequence++
          });
        }
      }
      if (taskInserts.length > 0) {
        await supabaseQuery('tasks', {
          method: 'POST', body: taskInserts, prefer: 'return=minimal'
        }, true);
      }

      return jsonResponse({
        success: true,
        action: 'rewritten',
        attempt: newAttempt,
        projectId,
        newTitle: aiResult.missionTitle,
        message: `Project rewritten (attempt ${newAttempt}). Back in approval queue.`
      });
    }

    return errorResponse('Invalid action', 400);

  } catch (err) {
    console.error('review-project error:', err);
    return errorResponse(err.message, 500);
  }
};

export const config = { path: '/api/review-project' };
