/**
 * POST /api/submit-ask
 * Saves the ask to Supabase, calls Claude to generate the project scope,
 * saves the project as pending_approval, fires coordinator alert.
 */

import { supabaseQuery, jsonResponse, errorResponse } from './lib/supabase.mjs';

const COORDINATOR_EMAIL = 'bjlinville1@gmail.com';

export default async (req) => {
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  let body;
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }

  const { name, phone, email, address, description, category, urgency, people_count, access_notes } = body;
  if (!name || !address || !description) return errorResponse('Missing required fields', 400);

  try {
    // 1. Save the ask
    const [ask] = await supabaseQuery('asks', {
      method: 'POST',
      body: { name, phone, email, address, description, category, urgency, people_count, access_notes }
    }, true);

    // 2. Generate project scope with Claude
    const aiResult = await generateProjectScope(ask, 1);

    // 3. Get or create default PM
    const defaultPm = await getOrCreatePerson('B.J. Linville', COORDINATOR_EMAIL, true);

    // 4. Save project as pending_approval
    const [project] = await supabaseQuery('projects', {
      method: 'POST',
      body: {
        ask_id: ask.id,
        title: aiResult.missionTitle,
        summary: aiResult.summary,
        address: ask.address,
        category: ask.category || 'General',
        urgency: ask.urgency || 'medium',
        status: 'pending_approval',
        pm_chain: [defaultPm.id],
        acceptance_tests: aiResult.acceptanceTests || [],
        pm_briefing: aiResult.pmBriefing || '',
        agent_briefing: aiResult.agentBriefing || '',
        ai_attempt_count: 1
      }
    }, true);

    // 5. Update ask with project_id
    await supabaseQuery(`asks?id=eq.${ask.id}`, {
      method: 'PATCH',
      body: { project_id: project.id }
    }, true);

    // 6. Save tasks
    const taskInserts = [];
    let sequence = 0;
    for (const proj of (aiResult.projects || [])) {
      for (const task of (proj.tasks || [])) {
        taskInserts.push({
          project_id: project.id,
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
        method: 'POST',
        body: taskInserts,
        prefer: 'return=minimal'
      }, true);
    }

    // 7. Fire coordinator alert
    await sendAlert({
      type: 'newask',
      message: `New request from ${name} at ${address} — project "${aiResult.missionTitle}" is pending your approval.`,
      missionTitle: aiResult.missionTitle,
      address,
      reporter: name
    });

    return jsonResponse({
      success: true,
      askId: ask.id,
      projectId: project.id,
      missionTitle: aiResult.missionTitle,
      summary: aiResult.summary,
      acceptanceTests: aiResult.acceptanceTests,
      pmBriefing: aiResult.pmBriefing,
      agentBriefing: aiResult.agentBriefing,
      projects: aiResult.projects,
      status: 'pending_approval'
    });

  } catch (err) {
    console.error('submit-ask error:', err);
    return errorResponse(err.message, 500);
  }
};

async function generateProjectScope(ask, attemptNumber, denialContext = null) {
  const apiKey = Netlify.env.get('volunteerdisasterrelief_anthropic_api_key');

  const denialSection = denialContext ? `
PREVIOUS ATTEMPT WAS DENIED. Denial reason: "${denialContext.reason}"
Previous attempt title: "${denialContext.previousTitle}"
You MUST specifically address each point in the denial reason. Do not repeat the same mistakes.
` : '';

  const prompt = `You are a disaster relief field operations coordinator turning help requests into executable volunteer missions. The person submitting this request has already done the assessment — your job is to turn it into action.
${denialSection}
CORE PHILOSOPHY:
- NEVER create "assessment", "planning", "survey", or "evaluation" tasks. The intake form IS the assessment. Go straight to physical work.
- Tasks must be SPECIFIC and PHYSICAL — tell volunteers exactly what to do with their hands, to what standard, using what tools.
- Bad task: "Remove debris from property." Good task: "Saw all logs/limbs >2" diameter to 16" lengths (12"–20" tolerance) and stack in a single pile between 4 and 20 feet north of the road shoulder."
- NEVER use vague spatial words: no "near", "close to", "around", "by the", "next to", "along". Always use cardinal direction + distance range in feet.
- NEVER use vague quantities: no "some", "most", "several", "a few", "as needed". Every quantity is a number, range, or measurable threshold.
- NEVER use vague conditions: no "clean", "secure", "stable", "adequate". Use observable, testable criteria.
- Acceptance tests belong at the TASK level. Each task gets 1-2 acceptance tests a non-expert can evaluate with a tape measure, their eyes, or their hands.
- Group tasks into logical PROJECTS based on work type (e.g. "Debris removal", "Structural repair") — NOT phases or planning stages.
- Think like a crew foreman writing a work order for someone who has never been to the site and will follow your instructions literally.

Return ONLY a JSON object — no markdown, no preamble:
{
  "missionTitle": "concise 2-5 word action title (e.g. 'Downed tree cleanup', 'Roof tarp installation')",
  "summary": "1-2 sentence plain-language summary of what volunteers will actually do",
  "acceptanceTests": ["It would be acceptable if... (mission-level only)"],
  "projects": [
    {
      "title": "Short work-type label",
      "tasks": [
        {
          "title": "Short imperative verb phrase",
          "description": "Specific physical instructions. Include dimensions, tolerances, quantities, placement, sequencing.",
          "tools": "Specific tools required",
          "acceptanceTests": ["It would be acceptable if... (task-level, measurable)"]
        }
      ]
    }
  ],
  "pmBriefing": "1 paragraph for the human PM: sequencing, dependencies, safety, coordinator judgment needed",
  "agentBriefing": "Structured briefing for an AI agent to assign volunteers and sequence work"
}

REQUEST:
Name: ${ask.name}
Address: ${ask.address}
Category: ${ask.category || 'General'}
Urgency: ${ask.urgency}
People affected: ${ask.people_count || 'unknown'}
Description: ${ask.description}
Access notes: ${ask.access_notes || 'none'}
This is AI attempt #${attemptNumber}.`;

  if (!apiKey) return buildFallbackScope(ask);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const d = await res.json();
    const text = d.content?.[0]?.text || '';
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch (e) {
    console.error('AI generation failed:', e);
    return buildFallbackScope(ask);
  }
}

function buildFallbackScope(ask) {
  return {
    missionTitle: `${ask.category || 'General'} assistance`,
    summary: ask.description?.slice(0, 140) || '',
    acceptanceTests: ['It would be acceptable if the primary issue is fully resolved and the location is safe for occupants.'],
    projects: [{
      title: 'Primary work',
      tasks: [{
        title: 'Complete repair work',
        description: ask.description || '',
        tools: 'As determined on site',
        acceptanceTests: ['It would be acceptable if all reported issues are addressed and verified by the PM.']
      }]
    }],
    pmBriefing: `Contact ${ask.name} at ${ask.address} to address: ${ask.description?.slice(0, 120)}`,
    agentBriefing: `ADDRESS: ${ask.address}. URGENCY: ${ask.urgency}. DESCRIPTION: ${ask.description}`
  };
}

async function getOrCreatePerson(name, email, isCoordinator = false) {
  const existing = await supabaseQuery(
    `people?email=eq.${encodeURIComponent(email)}&limit=1`,
    {}, true
  );
  if (existing && existing.length > 0) return existing[0];

  const [person] = await supabaseQuery('people', {
    method: 'POST',
    body: { name, email, is_coordinator: isCoordinator }
  }, true);
  return person;
}

async function sendAlert({ type, message, missionTitle, address, reporter }) {
  try {
    const sendgridKey = Netlify.env.get('SENDGRID_API_KEY');
    const fromEmail = Netlify.env.get('ALERT_FROM_EMAIL') || 'alerts@volunteerdisasterrelief.com';
    if (!sendgridKey) return;

    await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${sendgridKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: COORDINATOR_EMAIL }] }],
        from: { email: fromEmail, name: 'ReliefConnect' },
        subject: `⏳ New project pending approval: ${missionTitle}`,
        content: [{
          type: 'text/plain',
          value: `New request from ${reporter} at ${address}.\n\nProject "${missionTitle}" has been generated and is awaiting your approval.\n\nReview it at: https://volunteerdisasterrelief.com`
        }]
      })
    });
  } catch (e) {
    console.warn('Alert send failed:', e);
  }
}

export { generateProjectScope };

export const config = { path: '/api/submit-ask' };
