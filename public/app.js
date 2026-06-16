/**
 * ReliefConnect – Volunteer Disaster Relief Coordination Platform
 * Main application logic
 */

// ===== DATA STORE =====
let DB = {
  settings: {
    email: 'bjlinville1@gmail.com',
    pmName: 'B.J. Linville',
    alerts: { bottleneck: true, review: true, newask: true, missioncomplete: true }
  },
  asks: [],
  missions: [],
  volunteers: [],
  bottlenecks: []
};

let currentMissionId = null;
let missionDetailOrigin = 'missions';
let reviewingItem = null;
let submittingTask = null;
let bottleneckTask = null;

// ===== PERSISTENCE =====
function save() {
  try { localStorage.setItem('rc_db', JSON.stringify(DB)); } catch (e) { console.warn('Save failed:', e); }
}

function load() {
  try {
    const d = localStorage.getItem('rc_db');
    if (d) DB = JSON.parse(d);
  } catch (e) { console.warn('Load failed:', e); }
  renderAll();
}

// ===== UTILITIES =====
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function fmt(d) { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function fmtdt(d) { return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function urgencyBadge(u) {
  const map = { critical: ['badge-red', 'Critical'], high: ['badge-orange', 'High'], medium: ['badge-amber', 'Medium'], low: ['badge-gray', 'Low'] };
  const [cls, label] = map[u] || ['badge-gray', u || 'Medium'];
  return `<span class="badge ${cls}"><i class="ti ti-flame"></i>${label}</span>`;
}
function statusBadge(s) {
  const map = { open: ['badge-teal', 'Open'], active: ['badge-orange', 'Active'], complete: ['badge-green', 'Complete'], pending_review: ['badge-amber', 'In review'], failed: ['badge-red', 'Failed'] };
  const [cls, label] = map[s] || ['badge-gray', s];
  return `<span class="badge ${cls}">${label}</span>`;
}

// ===== NAVIGATION =====
function showPage(p) {
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(el => el.classList.remove('active'));
  document.getElementById('page-' + p).classList.add('active');
  const nb = document.getElementById('nav-' + p);
  if (nb) nb.classList.add('active');
  if (p === 'coordinator') renderCoordinator();
  if (p === 'missions') renderMissionsList();
  if (p === 'home') renderHome();
}

function backToMissions() { showPage(missionDetailOrigin === 'coordinator' ? 'coordinator' : 'missions'); }

// ===== FILE DISPLAY =====
function showFileNames(inputId, listId) {
  const files = [...document.getElementById(inputId).files];
  document.getElementById(listId).innerHTML = files.map(f => `<span class="tag"><i class="ti ti-paperclip"></i>${esc(f.name)}</span>`).join('');
}

// ===== SETTINGS =====
function saveSettings() {
  DB.settings.email = document.getElementById('settings-email').value;
  DB.settings.pmName = document.getElementById('settings-pm-name').value;
  DB.settings.alerts = {
    bottleneck: document.getElementById('alert-bottleneck').checked,
    review: document.getElementById('alert-review').checked,
    newask: document.getElementById('alert-newask').checked,
    missioncomplete: document.getElementById('alert-missioncomplete').checked
  };
  save();
  const el = document.getElementById('settings-saved');
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 2500);
}

// ===== AI INTEGRATION =====
/**
 * Calls the Anthropic Claude API to generate mission scope from a help request.
 * Replace ANTHROPIC_API_KEY in your environment or backend proxy.
 * In production, NEVER expose your API key in frontend code — route through a backend.
 */
async function callAI(prompt) {
  const apiKey = window.ANTHROPIC_API_KEY || '';
  if (!apiKey) {
    // Return a structured fallback if no API key is configured
    throw new Error('NO_API_KEY');
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] })
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return d.content && d.content[0] && d.content[0].text || '(no response)';
}

function buildFallbackMission(ask) {
  return {
    missionTitle: `Help needed: ${ask.category || 'General assistance'} at ${ask.address}`,
    summary: ask.desc.slice(0, 140) + (ask.desc.length > 140 ? '...' : ''),
    acceptanceTests: [
      'It would be acceptable if the primary issue described is fully resolved and the location is safe for occupants.',
      'It would be acceptable if all work meets applicable local building codes and safety standards.',
      'It would be acceptable if the affected family confirms the work is satisfactory.'
    ],
    projects: [
      {
        title: 'Assessment & planning',
        tasks: [
          { title: 'Initial site assessment', description: 'Document all damage, identify hazards, photograph all issues thoroughly.', tools: 'Camera, notepad, PPE', estimatedHours: 2 }
        ]
      },
      {
        title: 'Primary remediation',
        tasks: [
          { title: 'Complete main repair work', description: ask.desc.slice(0, 120), tools: 'As determined during assessment', estimatedHours: 6 }
        ]
      }
    ],
    pmBriefing: `Project manager should make contact with ${ask.name} at ${ask.address} to assess: ${ask.desc.slice(0, 120)}. Urgency level: ${ask.urgency}. People affected: ${ask.people || 'unknown'}.`,
    agentBriefing: `MISSION TYPE: ${ask.category || 'General'}. ADDRESS: ${ask.address}. URGENCY: ${ask.urgency}. DESCRIPTION: ${ask.desc}. ACCESS NOTES: ${ask.access || 'none'}. Coordinate volunteers to address all listed issues and verify completion against acceptance tests.`
  };
}

// ===== SUBMIT ASK =====
async function submitAsk() {
  const name = document.getElementById('ask-name').value.trim();
  const desc = document.getElementById('ask-desc').value.trim();
  const address = document.getElementById('ask-address').value.trim();
  if (!name || !desc || !address) { alert('Please fill in your name, address, and description.'); return; }

  const btn = document.getElementById('ask-submit-btn');
  btn.innerHTML = `<span class="spinner"></span> Processing with AI...`;
  btn.disabled = true;

  const ask = {
    id: uid(), name, phone: document.getElementById('ask-phone').value,
    email: document.getElementById('ask-email').value, address, desc,
    category: document.getElementById('ask-category').value,
    urgency: document.getElementById('ask-urgency').value,
    people: document.getElementById('ask-people').value,
    access: document.getElementById('ask-access').value,
    created: Date.now(), status: 'new'
  };

  const aiPrompt = `You are a disaster relief mission coordinator. A person has submitted a request for help. Your job is to:
1. Write 3-5 ACCEPTANCE TESTS that define what "done" looks like for this request (format: "It would be acceptable if...")
2. Create a SCOPE OF WORK with 2-4 projects, each with 2-4 specific tasks, suggested tools, and estimated labor hours
3. Return ONLY a JSON object — no markdown, no preamble, no trailing text. Schema:
{
  "missionTitle": "short descriptive title for this mission",
  "summary": "1-2 sentence summary",
  "acceptanceTests": ["It would be acceptable if...", ...],
  "projects": [{"title":"","tasks":[{"title":"","description":"","tools":"","estimatedHours":0}]}],
  "pmBriefing": "1 paragraph briefing for the human project manager",
  "agentBriefing": "structured briefing for an AI agent to sequence this work"
}

REQUEST:
Name: ${ask.name}
Address: ${ask.address}
Category: ${ask.category || 'General'}
Urgency: ${ask.urgency}
People affected: ${ask.people || 'unknown'}
Description: ${ask.desc}
Access notes: ${ask.access || 'none'}`;

  let aiResult;
  try {
    const text = await callAI(aiPrompt);
    const clean = text.replace(/```json|```/g, '').trim();
    aiResult = JSON.parse(clean);
  } catch (e) {
    aiResult = buildFallbackMission(ask);
  }

  const mission = {
    id: uid(), askId: ask.id,
    title: aiResult.missionTitle || `Mission at ${ask.address}`,
    summary: aiResult.summary || ask.desc,
    address: ask.address, category: ask.category || 'General',
    urgency: ask.urgency, status: 'open',
    pm: DB.settings.pmName, created: Date.now(),
    acceptanceTests: aiResult.acceptanceTests || [],
    projects: (aiResult.projects || []).map(p => ({
      id: uid(), title: p.title, status: 'open',
      tasks: (p.tasks || []).map(t => ({
        id: uid(), title: t.title, description: t.description,
        tools: t.tools, estimatedHours: t.estimatedHours || 0,
        status: 'open', submissions: [], bottlenecks: []
      }))
    })),
    pmBriefing: aiResult.pmBriefing || '',
    agentBriefing: aiResult.agentBriefing || '',
    volunteers: []
  };

  ask.missionId = mission.id;
  DB.asks.push(ask);
  DB.missions.push(mission);
  save();

  const resultDiv = document.getElementById('ask-result');
  resultDiv.style.display = 'block';
  resultDiv.innerHTML = `
  <div class="form-card">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
      <div style="width:40px;height:40px;border-radius:50%;background:var(--green-light);color:var(--green);display:flex;align-items:center;justify-content:center;font-size:20px"><i class="ti ti-circle-check"></i></div>
      <div><div style="font-weight:600">Request received &amp; mission created</div><div style="font-size:13px;color:var(--text2)">Mission ID: ${mission.id.toUpperCase()}</div></div>
    </div>
    <div class="pm-copy"><div class="pm-label">📋 Project manager briefing</div><p style="font-size:13px;line-height:1.6">${esc(aiResult.pmBriefing || '')}</p></div>
    <div class="ai-output" style="margin-top:12px"><div class="ai-label"><i class="ti ti-robot"></i> AI agent briefing</div><pre>${esc(aiResult.agentBriefing || '')}</pre></div>
    <div style="margin-top:12px"><div style="font-size:13px;font-weight:600;margin-bottom:8px">Acceptance tests:</div><ul class="acceptance-list">${(aiResult.acceptanceTests || []).map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>
    <div class="btn-group" style="margin-top:16px">
      <button class="btn btn-primary btn-sm" onclick="viewMission('${mission.id}','ask')"><i class="ti ti-map"></i> View mission</button>
      <button class="btn btn-secondary btn-sm" onclick="document.getElementById('ask-result').style.display='none';document.getElementById('ask-submit-btn').innerHTML='<i class=\\'ti ti-send\\'></i> Submit request';document.getElementById('ask-submit-btn').disabled=false">Submit another</button>
    </div>
  </div>`;

  btn.innerHTML = `<i class="ti ti-send"></i> Submit request`;
  btn.disabled = false;
  updateStats();
  sendEmailAlert('newask', `New request from ${ask.name} at ${ask.address}`);
}

// ===== SUBMIT OFFER =====
function submitOffer() {
  const name = document.getElementById('offer-name').value.trim();
  if (!name) { alert('Please enter your name.'); return; }
  const types = [...document.querySelectorAll('.offer-type:checked')].map(c => c.value);
  const volunteer = {
    id: uid(), name, phone: document.getElementById('offer-phone').value,
    email: document.getElementById('offer-email').value,
    location: document.getElementById('offer-location').value,
    types, skills: document.getElementById('offer-skills').value,
    availability: document.getElementById('offer-availability').value,
    resources: document.getElementById('offer-resources').value,
    notes: document.getElementById('offer-notes').value,
    created: Date.now(), assignedMissions: []
  };
  DB.volunteers.push(volunteer);
  save();
  document.getElementById('offer-result').style.display = 'block';
  document.getElementById('offer-result').innerHTML = `<div class="form-card"><div style="display:flex;align-items:center;gap:10px"><div style="width:40px;height:40px;border-radius:50%;background:var(--green-light);color:var(--green);display:flex;align-items:center;justify-content:center;font-size:20px"><i class="ti ti-circle-check"></i></div><div><div style="font-weight:600">Thank you, ${esc(name)}!</div><div style="font-size:13px;color:var(--text2)">Your offer has been recorded. A coordinator will reach out when there's a mission that matches your skills and availability.</div></div></div></div>`;
  updateStats();
}

// ===== VIEW MISSION =====
function viewMission(id, origin) {
  missionDetailOrigin = origin || 'missions';
  currentMissionId = id;
  const m = DB.missions.find(x => x.id === id);
  if (!m) return;
  const totalTasks = m.projects.reduce((s, p) => s + p.tasks.length, 0);
  const doneTasks = m.projects.reduce((s, p) => s + p.tasks.filter(t => t.status === 'complete').length, 0);
  const pct = totalTasks ? Math.round(doneTasks / totalTasks * 100) : 0;

  document.getElementById('mission-detail-content').innerHTML = `
  <div class="md-header">
    <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:10px">
      <div style="flex:1">
        <div class="md-title">${esc(m.title)}</div>
        <div class="md-meta">
          <span><i class="ti ti-map-pin"></i>${esc(m.address)}</span>
          <span><i class="ti ti-user"></i>PM: ${esc(m.pm || DB.settings.pmName)}</span>
          <span><i class="ti ti-calendar"></i>${fmt(m.created)}</span>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">${urgencyBadge(m.urgency)}${statusBadge(m.status)}</div>
    </div>
    <p style="font-size:14px;color:var(--text2);margin-bottom:12px">${esc(m.summary)}</p>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <div class="progress-bar" style="flex:1"><div class="progress-fill ${pct === 100 ? 'green' : ''}" style="width:${pct}%"></div></div>
      <div style="font-size:13px;font-weight:600;color:${pct === 100 ? 'var(--green)' : 'var(--navy)'}">${pct}% complete</div>
    </div>
    <div class="btn-group">
      <button class="btn btn-secondary btn-sm" onclick="enrollVolunteer('${m.id}')"><i class="ti ti-user-plus"></i> Volunteer for this mission</button>
    </div>
  </div>
  <div style="margin-bottom:16px">
    <div style="font-size:14px;font-weight:600;margin-bottom:10px">Acceptance tests</div>
    <ul class="acceptance-list">${m.acceptanceTests.map((t, i) => `<li>[${i + 1}] ${esc(t)}</li>`).join('')}</ul>
  </div>
  ${m.projects.map((p, pi) => renderProject(m, p, pi)).join('')}`;

  showPage('mission-detail');
}

function renderProject(m, p, pi) {
  const done = p.tasks.filter(t => t.status === 'complete').length;
  const total = p.tasks.length;
  const bns = p.tasks.reduce((s, t) => s + (t.bottlenecks || []).filter(b => b.open).length, 0);
  return `<div class="project-block" id="proj-${p.id}">
  <div class="proj-header" onclick="toggleProj('${p.id}')">
    <i class="ti ti-folder" style="color:var(--orange);font-size:16px"></i>
    <div class="proj-title">${esc(p.title)}</div>
    <div class="proj-meta">${done}/${total} tasks${bns ? ` · <span style="color:var(--red);font-weight:500">⚠ ${bns} bottleneck${bns > 1 ? 's' : ''}</span>` : ''}</div>
    <i class="ti ti-chevron-down proj-expand" id="exp-${p.id}"></i>
  </div>
  <div class="tasks-list" id="tasks-${p.id}" style="display:none">
    ${p.tasks.map(t => renderTask(m, p, t)).join('')}
  </div>
</div>`;
}

function renderTask(m, p, t) {
  const checkClass = t.status === 'complete' ? 'done' : t.status === 'failed' ? 'failed' : t.status === 'pending_review' ? 'review' : '';
  const checkIcon = t.status === 'complete' ? '<i class="ti ti-check" style="font-size:12px"></i>' : t.status === 'failed' ? '<i class="ti ti-x" style="font-size:12px"></i>' : t.status === 'pending_review' ? '<i class="ti ti-clock" style="font-size:12px"></i>' : '';
  const bns = (t.bottlenecks || []).filter(b => b.open);
  let actions = '';
  if (t.status === 'open' || t.status === 'failed') {
    actions = `<span class="task-action" onclick="openSubmitModal('${m.id}','${p.id}','${t.id}')">Submit update</span> · <span class="task-action" style="color:var(--red)" onclick="openBottleneckModal('${m.id}','${p.id}','${t.id}')">Report bottleneck</span>`;
  } else if (t.status === 'pending_review') {
    actions = `<span style="font-size:12px;color:var(--amber)">Awaiting coordinator review</span>`;
  } else if (t.status === 'complete') {
    actions = `<span style="font-size:12px;color:var(--green)">✓ Approved</span>`;
  }
  const failNote = t.lastReview && t.lastReview.outcome === 'fail' ? `<div class="review-block" style="margin-top:6px"><div class="rv-label" style="color:var(--red)">Failed review</div><p>${esc(t.lastReview.notes)}</p></div>` : '';
  const bnNote = bns.length ? `<div class="review-block" style="background:var(--amber-light);border-color:#FDE68A;margin-top:6px"><div class="rv-label" style="color:var(--amber)">⚠ Active bottleneck</div><p>${esc(bns[bns.length - 1].desc)}</p></div>` : '';
  return `<div class="task-item">
  <div class="task-check ${checkClass}">${checkIcon}</div>
  <div class="task-info">
    <div class="task-name">${esc(t.title)} ${statusBadge(t.status)}</div>
    <div class="task-sub">${esc(t.description)}</div>
    ${t.tools ? `<div class="task-sub" style="margin-top:2px"><i class="ti ti-tool" style="font-size:11px;vertical-align:middle"></i> ${esc(t.tools)}</div>` : ''}
    ${t.estimatedHours ? `<div class="task-sub"><i class="ti ti-clock" style="font-size:11px;vertical-align:middle"></i> Est. ${t.estimatedHours}h</div>` : ''}
    ${failNote}${bnNote}
    <div style="margin-top:6px">${actions}</div>
  </div>
</div>`;
}

function toggleProj(id) {
  const tasks = document.getElementById('tasks-' + id);
  const exp = document.getElementById('exp-' + id);
  const open = tasks.style.display === 'block';
  tasks.style.display = open ? 'none' : 'block';
  exp.classList.toggle('open', !open);
}

// ===== ENROLL VOLUNTEER =====
function enrollVolunteer(mId) {
  const name = prompt('Enter your name to enroll as a volunteer:');
  if (!name) return;
  const m = DB.missions.find(x => x.id === mId);
  if (!m) return;
  if (!m.volunteers) m.volunteers = [];
  m.volunteers.push({ name: name.trim(), enrolled: Date.now() });
  if (m.status === 'open') m.status = 'active';
  save();
  alert(`Thank you ${name}! You're enrolled. A coordinator will contact you with more details.`);
}

// ===== SUBMIT TASK MODAL =====
function openSubmitModal(mId, pId, tId) {
  const m = DB.missions.find(x => x.id === mId);
  const p = m.projects.find(x => x.id === pId);
  const t = p.tasks.find(x => x.id === tId);
  submittingTask = { mId, pId, tId };
  document.getElementById('submit-modal-title').textContent = `Submit update: ${t.title}`;
  document.getElementById('submit-modal-body').innerHTML = `
    <p style="font-size:13px;color:var(--text2);margin-bottom:12px">${esc(t.description)}</p>
    <div class="field"><label>What did you complete? *</label><textarea id="sub-notes" placeholder="Describe exactly what was done — include measurements, materials used, decisions made, and anything the reviewer needs to know to evaluate against the acceptance tests." style="min-height:80px"></textarea></div>
    <div class="field"><label>Supporting photos/videos</label>
      <div class="file-upload-area" onclick="document.getElementById('sub-files').click()">
        <i class="ti ti-camera" aria-hidden="true"></i>Add photos or videos of completed work
      </div>
      <input id="sub-files" type="file" multiple accept="image/*,video/*" style="display:none" onchange="showFileNames('sub-files','sub-file-list')">
      <div id="sub-file-list" style="margin-top:4px;font-size:12px;color:var(--text2)"></div>
    </div>
    <div class="field"><label>Your name</label><input id="sub-volunteer" placeholder="Your name" type="text"></div>`;
  document.getElementById('submit-modal').style.display = 'flex';
}

function closeSubmitModal(e) {
  if (!e || e.target === document.getElementById('submit-modal')) document.getElementById('submit-modal').style.display = 'none';
}

function submitTaskUpdate() {
  const notes = document.getElementById('sub-notes').value.trim();
  const volunteer = document.getElementById('sub-volunteer').value.trim();
  if (!notes) { alert('Please describe what was completed.'); return; }
  const { mId, pId, tId } = submittingTask;
  const m = DB.missions.find(x => x.id === mId);
  const p = m.projects.find(x => x.id === pId);
  const t = p.tasks.find(x => x.id === tId);
  const sub = { id: uid(), notes, volunteer, created: Date.now(), files: document.getElementById('sub-files').files.length };
  if (!t.submissions) t.submissions = [];
  t.submissions.push(sub);
  t.status = 'pending_review';
  DB.bottlenecks.push({ type: 'review', mId, pId, tId, mTitle: m.title, tTitle: t.title, volunteer, notes, created: Date.now(), open: true });
  save(); closeSubmitModal(); updateAlertCount();
  sendEmailAlert('review', `Task "${t.title}" on mission "${m.title}" submitted for review by ${volunteer || 'a volunteer'}.`);
  viewMission(mId, missionDetailOrigin);
}

// ===== BOTTLENECK MODAL =====
function openBottleneckModal(mId, pId, tId) {
  const m = DB.missions.find(x => x.id === mId);
  const p = m.projects.find(x => x.id === pId);
  const t = p.tasks.find(x => x.id === tId);
  bottleneckTask = { mId, pId, tId };
  document.getElementById('bottleneck-modal-body').innerHTML = `
    <p style="font-size:13px;color:var(--text2);margin-bottom:12px">A bottleneck alert will be sent immediately to the project coordinator at <strong>${esc(DB.settings.email)}</strong>.</p>
    <div class="field"><label>Describe the obstacle or bottleneck *</label><textarea id="bn-desc" placeholder="What's blocking you? What do you need to continue? e.g. 'Missing materials — need 2x4 lumber and drywall screws before we can proceed', 'Need a permit before starting electrical work', 'Structural concern — need an engineer to assess the load-bearing wall before removing it.'" style="min-height:90px"></textarea></div>
    <div class="field"><label>Your name</label><input id="bn-reporter" placeholder="Your name" type="text"></div>`;
  document.getElementById('bottleneck-modal').style.display = 'flex';
}

function closeBottleneckModal(e) {
  if (!e || e.target === document.getElementById('bottleneck-modal')) document.getElementById('bottleneck-modal').style.display = 'none';
}

function submitBottleneck() {
  const desc = document.getElementById('bn-desc').value.trim();
  if (!desc) { alert('Please describe the bottleneck.'); return; }
  const reporter = document.getElementById('bn-reporter').value.trim();
  const { mId, pId, tId } = bottleneckTask;
  const m = DB.missions.find(x => x.id === mId);
  const p = m.projects.find(x => x.id === pId);
  const t = p.tasks.find(x => x.id === tId);
  const bn = { id: uid(), type: 'bottleneck', mId, pId, tId, mTitle: m.title, tTitle: t.title, reporter, desc, created: Date.now(), open: true };
  if (!t.bottlenecks) t.bottlenecks = [];
  t.bottlenecks.push(bn);
  DB.bottlenecks.push(bn);
  save(); closeBottleneckModal(); updateAlertCount();
  sendEmailAlert('bottleneck', `BOTTLENECK on "${m.title}" — Task: "${t.title}" — ${desc}${reporter ? ` (reported by ${reporter})` : ''}`);
  alert(`Bottleneck reported! An alert has been sent to ${DB.settings.email}.`);
  viewMission(mId, missionDetailOrigin);
}

// ===== EMAIL ALERT (stub — wire to your backend) =====
function sendEmailAlert(type, message) {
  if (!DB.settings.alerts[type]) return;
  // In production, POST to your backend email service here:
  // fetch('/api/alert', { method: 'POST', body: JSON.stringify({ to: DB.settings.email, type, message }) });
  console.log(`[ALERT → ${DB.settings.email}] ${message}`);
}

// ===== COORDINATOR REVIEW =====
function openReviewModal(mId, pId, tId) {
  const m = DB.missions.find(x => x.id === mId);
  const p = m.projects.find(x => x.id === pId);
  const t = p.tasks.find(x => x.id === tId);
  reviewingItem = { mId, pId, tId };
  const lastSub = t.submissions && t.submissions[t.submissions.length - 1];
  document.getElementById('review-modal-title').textContent = `Review: ${t.title}`;
  document.getElementById('review-modal-body').innerHTML = `
    <div style="font-size:13px;font-weight:600;margin-bottom:8px">Acceptance tests for this mission:</div>
    <ul class="acceptance-list">${m.acceptanceTests.map((a, i) => `<li>[${i + 1}] ${esc(a)}</li>`).join('')}</ul>
    ${lastSub ? `<div class="review-block" style="margin-top:12px"><div class="rv-label">Volunteer submission</div><p>${esc(lastSub.notes)}</p>${lastSub.files ? `<div style="margin-top:4px;font-size:12px;color:var(--text2)">${lastSub.files} file(s) attached</div>` : ''}<div style="font-size:11px;color:var(--text2);margin-top:4px">${fmtdt(lastSub.created)}${lastSub.volunteer ? ' · ' + esc(lastSub.volunteer) : ''}</div></div>` : ''}
    <div class="field" style="margin-top:14px"><label>Review notes *</label><textarea id="review-notes" placeholder="Describe your review decision. If failing, cite the specific acceptance test number. e.g. 'Failed. Acceptance test [2]: All construction must meet county building codes. Spindles are 8&quot; apart — must be no more than 4&quot;. Correct and resubmit.'" style="min-height:90px"></textarea></div>`;
  document.getElementById('review-modal').style.display = 'flex';
}

function closeReviewModal(e) {
  if (!e || e.target === document.getElementById('review-modal')) document.getElementById('review-modal').style.display = 'none';
}

function approveTask() {
  const notes = document.getElementById('review-notes').value.trim();
  if (!notes) { alert('Please enter review notes.'); return; }
  const { mId, pId, tId } = reviewingItem;
  const m = DB.missions.find(x => x.id === mId);
  const p = m.projects.find(x => x.id === pId);
  const t = p.tasks.find(x => x.id === tId);
  t.status = 'complete';
  t.lastReview = { outcome: 'pass', notes, reviewed: Date.now(), reviewer: DB.settings.pmName };
  DB.bottlenecks.filter(b => b.tId === tId && b.type === 'review').forEach(b => b.open = false);
  checkMissionComplete(m);
  save(); closeReviewModal(); updateAlertCount(); renderCoordinator();
}

function failTask() {
  const notes = document.getElementById('review-notes').value.trim();
  if (!notes) { alert('Please enter review notes explaining what failed.'); return; }
  const { mId, pId, tId } = reviewingItem;
  const m = DB.missions.find(x => x.id === mId);
  const p = m.projects.find(x => x.id === pId);
  const t = p.tasks.find(x => x.id === tId);
  t.status = 'failed';
  t.lastReview = { outcome: 'fail', notes, reviewed: Date.now(), reviewer: DB.settings.pmName };
  // Auto-create correction task
  const corrTask = {
    id: uid(), title: `Correction required: ${t.title}`,
    description: `FAILED REVIEW — ${notes}`,
    tools: t.tools || '', estimatedHours: t.estimatedHours || 2,
    status: 'open', submissions: [], bottlenecks: []
  };
  p.tasks.push(corrTask);
  DB.bottlenecks.filter(b => b.tId === tId && b.type === 'review').forEach(b => b.open = false);
  save(); closeReviewModal(); updateAlertCount(); renderCoordinator();
}

function checkMissionComplete(m) {
  const allDone = m.projects.every(p => p.tasks.every(t => t.status === 'complete'));
  if (allDone) {
    m.status = 'complete';
    sendEmailAlert('missioncomplete', `Mission "${m.title}" is now COMPLETE!`);
  }
}

// ===== RENDER HOME =====
function renderHome() {
  updateStats();
  const recent = DB.missions.slice(-5).reverse();
  const el = document.getElementById('home-missions');
  if (!recent.length) {
    el.innerHTML = `<div class="empty"><i class="ti ti-map-search"></i><p>No missions yet. Submit a help request to create the first one.</p></div>`;
    return;
  }
  el.innerHTML = recent.map(m => {
    const total = m.projects.reduce((s, p) => s + p.tasks.length, 0);
    const done = m.projects.reduce((s, p) => s + p.tasks.filter(t => t.status === 'complete').length, 0);
    const pct = total ? Math.round(done / total * 100) : 0;
    return `<div class="mcard" onclick="viewMission('${m.id}','home')">
      <div class="mcard-top">
        <div class="mcard-icon"><i class="ti ti-map-pin"></i></div>
        <div class="mcard-info"><div class="mcard-title">${esc(m.title)}</div><div class="mcard-sub">${esc(m.address)}</div></div>
        <div>${urgencyBadge(m.urgency)}</div>
      </div>
      <div class="mcard-badges">${statusBadge(m.status)}<span class="badge badge-gray">${esc(m.category)}</span></div>
      <div class="progress-bar"><div class="progress-fill ${pct === 100 ? 'green' : ''}" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

function updateStats() {
  document.getElementById('stat-missions').textContent = DB.missions.filter(m => m.status !== 'complete').length;
  document.getElementById('stat-volunteers').textContent = DB.volunteers.length;
  document.getElementById('stat-completed').textContent = DB.missions.reduce((s, m) => s + m.projects.reduce((sp, p) => sp + p.tasks.filter(t => t.status === 'complete').length, 0), 0);
  document.getElementById('stat-asks').textContent = DB.asks.length;
}

// ===== FILTER & RENDER MISSIONS =====
function filterMissions() { renderMissionsList(); }

function renderMissionsList() {
  const cat = document.getElementById('filter-category').value;
  const urg = document.getElementById('filter-urgency').value;
  const sta = document.getElementById('filter-status').value;
  const q = (document.getElementById('filter-search').value || '').toLowerCase();
  const missions = DB.missions.filter(m => {
    if (cat && m.category !== cat) return false;
    if (urg && m.urgency !== urg) return false;
    if (sta && m.status !== sta) return false;
    if (q && !m.title.toLowerCase().includes(q) && !m.address.toLowerCase().includes(q) && !m.summary.toLowerCase().includes(q)) return false;
    return true;
  });
  const el = document.getElementById('missions-list');
  if (!missions.length) { el.innerHTML = `<div class="empty"><i class="ti ti-map-search"></i><p>No missions match your filters.</p></div>`; return; }
  el.innerHTML = missions.map(m => {
    const total = m.projects.reduce((s, p) => s + p.tasks.length, 0);
    const done = m.projects.reduce((s, p) => s + p.tasks.filter(t => t.status === 'complete').length, 0);
    const pct = total ? Math.round(done / total * 100) : 0;
    const bns = DB.bottlenecks.filter(b => b.mId === m.id && b.open && b.type === 'bottleneck').length;
    return `<div class="mcard" onclick="viewMission('${m.id}','missions')">
      <div class="mcard-top">
        <div class="mcard-icon"><i class="ti ti-map-pin"></i></div>
        <div class="mcard-info">
          <div class="mcard-title">${esc(m.title)}</div>
          <div class="mcard-sub">${esc(m.address)}</div>
          <div class="mcard-sub" style="margin-top:3px">${esc(m.summary.slice(0, 90))}${m.summary.length > 90 ? '...' : ''}</div>
        </div>
      </div>
      <div class="mcard-badges">
        ${urgencyBadge(m.urgency)}${statusBadge(m.status)}
        <span class="badge badge-gray">${esc(m.category)}</span>
        ${bns ? `<span class="badge badge-red"><i class="ti ti-alert-triangle"></i>${bns} bottleneck${bns > 1 ? 's' : ''}</span>` : ''}
        <span class="badge badge-gray">${pct}% complete</span>
      </div>
      <div class="progress-bar"><div class="progress-fill ${pct === 100 ? 'green' : ''}" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

// ===== COORDINATOR =====
let coordActiveTab = 'missions';

function coordTab(tab) {
  coordActiveTab = tab;
  ['missions', 'reviews', 'asks', 'volunteers'].forEach(t => {
    document.getElementById('coord-' + t + '-tab').style.display = t === tab ? 'block' : 'none';
  });
  document.querySelectorAll('.tab-bar button').forEach((b, i) => {
    b.classList.toggle('active', ['missions', 'reviews', 'asks', 'volunteers'][i] === tab);
  });
  renderCoordTab(tab);
}

function renderCoordinator() {
  const openBns = DB.bottlenecks.filter(b => b.open && b.type === 'bottleneck');
  const alertEl = document.getElementById('bottleneck-alerts');
  alertEl.innerHTML = openBns.map(b => `<div class="alert-strip">
    <i class="ti ti-alert-triangle al-icon"></i>
    <div class="al-text"><strong>⚠ Bottleneck on "${esc(b.mTitle)}"</strong>Task: ${esc(b.tTitle)} — ${esc(b.desc)}<br><span style="font-size:11px;color:var(--text2)">${fmtdt(b.created)}${b.reporter ? ' · ' + esc(b.reporter) : ''}</span></div>
    <button class="btn btn-secondary btn-sm" onclick="resolveBottleneck('${b.id}')">Resolve</button>
  </div>`).join('');
  renderCoordTab(coordActiveTab);
  updateAlertCount();
}

function resolveBottleneck(id) {
  const bn = DB.bottlenecks.find(b => b.id === id);
  if (bn) bn.open = false;
  save(); renderCoordinator();
}

function updateAlertCount() {
  const n = DB.bottlenecks.filter(b => b.open).length;
  const badge = document.getElementById('alert-count');
  badge.textContent = n;
  badge.style.display = n ? 'inline-flex' : 'none';
}

function renderCoordTab(tab) {
  if (tab === 'missions') renderCoordMissions();
  else if (tab === 'reviews') renderCoordReviews();
  else if (tab === 'asks') renderCoordAsks();
  else if (tab === 'volunteers') renderCoordVolunteers();
}

function renderCoordMissions() {
  const el = document.getElementById('coord-missions-tab');
  if (!DB.missions.length) { el.innerHTML = `<div class="empty"><i class="ti ti-map"></i><p>No missions yet.</p></div>`; return; }
  el.innerHTML = DB.missions.map(m => {
    const total = m.projects.reduce((s, p) => s + p.tasks.length, 0);
    const done = m.projects.reduce((s, p) => s + p.tasks.filter(t => t.status === 'complete').length, 0);
    const review = m.projects.reduce((s, p) => s + p.tasks.filter(t => t.status === 'pending_review').length, 0);
    const pct = total ? Math.round(done / total * 100) : 0;
    return `<div class="mcard" onclick="missionDetailOrigin='coordinator';viewMission('${m.id}','coordinator')">
      <div class="mcard-top">
        <div class="mcard-icon"><i class="ti ti-clipboard-list"></i></div>
        <div class="mcard-info"><div class="mcard-title">${esc(m.title)}</div><div class="mcard-sub">${esc(m.address)} · ${fmt(m.created)}</div></div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px">${urgencyBadge(m.urgency)}${statusBadge(m.status)}</div>
      </div>
      <div class="mcard-badges">
        <span class="badge badge-gray">${done}/${total} tasks done</span>
        ${review ? `<span class="badge badge-amber"><i class="ti ti-eye"></i>${review} awaiting review</span>` : ''}
        <span class="badge badge-gray">${(m.volunteers || []).length} volunteer${m.volunteers && m.volunteers.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="progress-bar"><div class="progress-fill ${pct === 100 ? 'green' : ''}" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

function renderCoordReviews() {
  const el = document.getElementById('coord-reviews-tab');
  const pending = [];
  DB.missions.forEach(m => m.projects.forEach(p => p.tasks.forEach(t => { if (t.status === 'pending_review') pending.push({ m, p, t }); })));
  if (!pending.length) { el.innerHTML = `<div class="empty"><i class="ti ti-circle-check"></i><p>No tasks awaiting review.</p></div>`; return; }
  el.innerHTML = pending.map(({ m, p, t }) => {
    const lastSub = t.submissions && t.submissions[t.submissions.length - 1];
    return `<div class="project-block" style="margin-bottom:12px"><div style="padding:14px 16px">
      <div style="font-weight:600;font-size:14px;margin-bottom:3px">${esc(t.title)}</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:8px">Mission: ${esc(m.title)} · Project: ${esc(p.title)}</div>
      ${lastSub ? `<div class="review-block"><div class="rv-label">Latest submission</div><p>${esc(lastSub.notes)}</p>${lastSub.files ? `<div style="margin-top:4px;font-size:12px;color:var(--text2)">${lastSub.files} file(s) attached</div>` : ''}<div style="font-size:11px;color:var(--text2);margin-top:4px">${fmtdt(lastSub.created)}${lastSub.volunteer ? ' · ' + esc(lastSub.volunteer) : ''}</div></div>` : ''}
      <div class="btn-group" style="margin-top:10px"><button class="btn btn-success btn-sm" onclick="openReviewModal('${m.id}','${p.id}','${t.id}')"><i class="ti ti-clipboard-check"></i> Review task</button></div>
    </div></div>`;
  }).join('');
}

function renderCoordAsks() {
  const el = document.getElementById('coord-asks-tab');
  if (!DB.asks.length) { el.innerHTML = `<div class="empty"><i class="ti ti-inbox"></i><p>No requests received yet.</p></div>`; return; }
  el.innerHTML = DB.asks.map(a => `<div class="mcard">
    <div class="mcard-top">
      <div class="mcard-icon" style="background:var(--red-light);color:var(--red)"><i class="ti ti-sos"></i></div>
      <div class="mcard-info">
        <div class="mcard-title">${esc(a.name)} — ${esc(a.category || 'General')}</div>
        <div class="mcard-sub">${esc(a.address)}</div>
        <div class="mcard-sub" style="margin-top:3px">${esc(a.desc.slice(0, 100))}${a.desc.length > 100 ? '...' : ''}</div>
      </div>
      <div>${urgencyBadge(a.urgency)}</div>
    </div>
    <div class="mcard-badges">
      <span class="badge badge-gray">${fmt(a.created)}</span>
      ${a.missionId ? `<span class="badge badge-green"><i class="ti ti-check"></i>Mission created</span>` : '<span class="badge badge-amber">Needs mission</span>'}
      ${a.people ? `<span class="badge badge-gray">${esc(a.people)} affected</span>` : ''}
    </div>
    ${a.missionId ? `<div style="margin-top:8px"><button class="btn btn-secondary btn-sm" onclick="missionDetailOrigin='coordinator';viewMission('${a.missionId}','coordinator')">View mission →</button></div>` : ''}
  </div>`).join('');
}

function renderCoordVolunteers() {
  const el = document.getElementById('coord-volunteers-tab');
  if (!DB.volunteers.length) { el.innerHTML = `<div class="empty"><i class="ti ti-users"></i><p>No volunteers have registered yet.</p></div>`; return; }
  el.innerHTML = DB.volunteers.map(v => `<div class="mcard">
    <div class="mcard-top">
      <div style="width:38px;height:38px;border-radius:50%;background:var(--navy-light);color:var(--navy);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:14px;flex-shrink:0">${esc(v.name.slice(0, 2).toUpperCase())}</div>
      <div class="mcard-info">
        <div class="mcard-title">${esc(v.name)}</div>
        <div class="mcard-sub">${esc(v.location) || 'Location not provided'} · ${fmt(v.created)}</div>
      </div>
    </div>
    <div class="mcard-badges">${(v.types || []).map(t => `<span class="badge badge-teal">${esc(t)}</span>`).join('')}</div>
    ${v.skills ? `<div style="font-size:13px;color:var(--text2);margin-top:8px">${esc(v.skills)}</div>` : ''}
    ${v.availability ? `<div style="font-size:12px;color:var(--text2);margin-top:4px"><i class="ti ti-calendar"></i> ${esc(v.availability)}</div>` : ''}
  </div>`).join('');
}

// ===== SAMPLE DATA =====
function loadSampleData() {
  if (!confirm('Load sample data? This will add a demo mission, ask, and volunteer.')) return;
  const sampleMission = {
    id: 'demo1', askId: 'ask1',
    title: 'Flood damage repair – 142 Maple St',
    summary: 'Family of 5 experienced significant flood damage to the first floor. Drywall, flooring, and electrical outlets affected. Mold risk present.',
    address: '142 Maple Street, Richfield, OH 44286',
    category: 'Home repair', urgency: 'high', status: 'active',
    pm: DB.settings.pmName, created: Date.now() - 86400000 * 2,
    acceptanceTests: [
      'It would be acceptable if all flood-damaged drywall is removed and replaced with mold-resistant material.',
      'It would be acceptable if all electrical outlets within 12 inches of the flood line are inspected and certified safe by a licensed electrician.',
      'It would be acceptable if flooring is fully removed, the subfloor dried and treated, and new flooring installed.',
      'It would be acceptable if a licensed mold inspector certifies the space mold-free before the family returns.'
    ],
    projects: [
      {
        id: 'p1', title: 'Water removal & drying', status: 'active',
        tasks: [
          { id: 't1', title: 'Extract standing water', description: 'Use wet/dry vacs and pumps to remove all standing water from first floor rooms.', tools: 'Industrial wet/dry vac, submersible pump', estimatedHours: 4, status: 'complete', submissions: [{ id: 's1', notes: 'All standing water removed. Approx. 200 gallons extracted. Fans deployed.', volunteer: 'Mike T.', created: Date.now() - 86400000, files: 0 }], bottlenecks: [], lastReview: { outcome: 'pass', notes: 'Water extraction confirmed complete per photos.', reviewed: Date.now() - 80000000, reviewer: 'B.J. Linville' } },
          { id: 't2', title: 'Deploy industrial drying fans', description: 'Set up dehumidifiers and high-velocity fans in all affected rooms. Monitor moisture levels daily.', tools: 'Industrial fans (4x), dehumidifier (2x), moisture meter', estimatedHours: 2, status: 'pending_review', submissions: [{ id: 's2', notes: '4 fans and 2 dehumidifiers deployed. Moisture reading at 28% — target is under 15%. Will check again tomorrow.', volunteer: 'Sarah K.', created: Date.now() - 3600000 * 5, files: 2 }], bottlenecks: [] },
          { id: 't3', title: 'Moisture level verification', description: 'Confirm all moisture readings are below 15% before proceeding to drywall phase.', tools: 'Moisture meter', estimatedHours: 1, status: 'open', submissions: [], bottlenecks: [] }
        ]
      },
      {
        id: 'p2', title: 'Drywall removal & replacement', status: 'open',
        tasks: [
          { id: 't4', title: 'Remove flood-damaged drywall', description: 'Cut and remove all drywall to 12" above highest flood mark. Double-bag and dispose per county regulations.', tools: 'Utility knife, reciprocating saw, N95 masks, heavy-duty bags', estimatedHours: 6, status: 'open', submissions: [], bottlenecks: [{ id: 'bn1', type: 'bottleneck', desc: 'Need to confirm proper disposal site for potentially mold-contaminated drywall before proceeding. County office is not answering.', reporter: 'Dave R.', created: Date.now() - 3600000 * 2, open: true }] },
          { id: 't5', title: 'Install mold-resistant drywall', description: 'Install 5/8" mold-resistant drywall per manufacturer specs. All seams taped and mudded.', tools: 'Drywall screws, mold-resistant drywall, tape, joint compound, drill', estimatedHours: 8, status: 'open', submissions: [], bottlenecks: [] }
        ]
      }
    ],
    volunteers: [{ name: 'Mike T.', enrolled: Date.now() - 86400000 * 2 }, { name: 'Sarah K.', enrolled: Date.now() - 86400000 }, { name: 'Dave R.', enrolled: Date.now() - 86400000 }],
    pmBriefing: 'Coordinate with the Martinez family at 142 Maple St. Priority is moisture control before mold sets in. Electrical inspection required before drywall is closed up.',
    agentBriefing: 'MISSION: Flood damage repair. ADDRESS: 142 Maple St, Richfield OH. URGENCY: High. Sequence: water removal → drying → mold assessment → drywall → electrical → flooring.'
  };

  if (!DB.missions.find(m => m.id === 'demo1')) {
    DB.missions.push(sampleMission);
    DB.bottlenecks.push({ id: 'bn1', type: 'bottleneck', mId: 'demo1', pId: 'p2', tId: 't4', mTitle: 'Flood damage repair – 142 Maple St', tTitle: 'Remove flood-damaged drywall', reporter: 'Dave R.', desc: 'Need to confirm proper disposal site for potentially mold-contaminated drywall. County office not answering.', created: Date.now() - 3600000 * 2, open: true });
    DB.bottlenecks.push({ id: 'rv1', type: 'review', mId: 'demo1', pId: 'p1', tId: 't2', mTitle: 'Flood damage repair – 142 Maple St', tTitle: 'Deploy industrial drying fans', volunteer: 'Sarah K.', notes: '4 fans and 2 dehumidifiers deployed. Moisture at 28%.', created: Date.now() - 3600000 * 5, open: true });
    DB.asks.push({ id: 'ask1', name: 'The Martinez Family', phone: '(330) 555-0182', email: 'martinez@email.com', address: '142 Maple Street, Richfield, OH 44286', desc: 'We had severe flooding from the storm last weekend. Our entire first floor has standing water and we can already smell mold. We have 3 young children and my elderly mother with us and really need help as soon as possible.', category: 'Home repair', urgency: 'high', people: '5 (including 3 children and 1 elderly adult)', access: 'Gate code: 4471. Dog in backyard — please keep gate closed.', created: Date.now() - 86400000 * 2, missionId: 'demo1', status: 'active' });
    DB.volunteers.push({ id: 'v1', name: 'Mike Thompson', phone: '(330) 555-0191', email: 'mike.t@email.com', location: 'Richfield, OH – can travel 30 miles', types: ['time', 'tools'], skills: '10 years residential construction, drywall certified', availability: 'Weekends all day, Tuesday and Thursday evenings', resources: '2019 F-150 pickup, reciprocating saw, circular saw, extensive hand tools', notes: '', created: Date.now() - 86400000 * 2, assignedMissions: ['demo1'] });
    save(); renderAll();
    alert('Sample data loaded! Visit the Coordinator dashboard to see it in action.');
  } else {
    alert('Sample data is already loaded.');
  }
}

// ===== EXPORT =====
function exportData() {
  const blob = new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'reliefconnect-export.json'; a.click();
  URL.revokeObjectURL(url);
}

// ===== RENDER ALL =====
function renderAll() {
  renderHome();
  updateAlertCount();
  document.getElementById('settings-email').value = DB.settings.email || 'bjlinville1@gmail.com';
  document.getElementById('settings-pm-name').value = DB.settings.pmName || 'B.J. Linville';
}

// ===== INIT =====
load();
