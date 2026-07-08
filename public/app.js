

/**
 * ReliefConnect — Frontend App
 * Data layer: Supabase (via REST API and Netlify backend functions)
 * All coordinator writes go through /api/* Netlify functions (service role key, never in browser)
 * All public reads go directly to Supabase REST API (anon key)
 */

// ===== CONFIG (injected by server.js / Netlify at runtime) =====
const SUPABASE_URL = window.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || '';
const COORDINATOR_EMAIL = window.COORDINATOR_EMAIL || 'bjlinville1@gmail.com';

// ===== SUPABASE READ CLIENT =====
async function sbQuery(table, params = '') {
  if (!SUPABASE_URL) return [];
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params ? '?' + params : ''}`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    }
  });
  if (!res.ok) { console.warn('Supabase read error:', await res.text()); return []; }
  return res.json();
}

// ===== API CALL (Netlify functions — coordinator writes) =====
async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `API error ${res.status}`);
  return data;
}

// ===== LOCAL STATE =====
let state = {
  projects: [],
  people: [],
  bottlenecks: [],
  currentProjectId: null,
  currentTasks: [],
  missionDetailOrigin: 'missions',
  reviewingTask: null,
  submittingTask: null,
  bottleneckTask: null
};

// ===== SETTINGS (localStorage for coordinator prefs only) =====
let settings = JSON.parse(localStorage.getItem('rc_settings') || '{}');
settings.email = settings.email || COORDINATOR_EMAIL;
settings.pmName = settings.pmName || 'B.J. Linville';

function saveSettings() {
  settings.email = document.getElementById('settings-email').value;
  settings.pmName = document.getElementById('settings-pm-name').value;
  settings.alerts = {
    bottleneck: document.getElementById('alert-bottleneck').checked,
    review: document.getElementById('alert-review').checked,
    newask: document.getElementById('alert-newask').checked,
    missioncomplete: document.getElementById('alert-missioncomplete').checked
  };
  localStorage.setItem('rc_settings', JSON.stringify(settings));
  const el = document.getElementById('settings-saved');
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 2500);
}

// ===== UTILS =====
function fmt(d) { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function fmtdt(d) { return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

const PROJECT_STATUS_LABELS = {
  pending_approval: 'Pending approval',
  to_do: 'To do',
  doing: 'Doing',
  done: 'Done',
  passed_inspection: 'Passed inspection'
};

const TASK_STATUS_LABELS = {
  task_setup_not_assigned: 'Setup: unassigned',
  task_setup_assigned_but_not_started: 'Setup: assigned',
  acceptance_test_written: 'Acceptance test written',
  acceptance_test_approved: 'Acceptance test approved',
  task_requirements_written: 'Requirements written',
  task_requirements_approved: 'Requirements approved',
  task_prioritized: 'Prioritized',
  task_not_assigned: 'Unassigned',
  task_assigned_but_not_started: 'Assigned, not started',
  task_assigned_and_in_progress: 'In progress',
  task_completed_review_not_assigned: 'Completed, review needed',
  task_completed_review_assigned: 'Review assigned',
  task_completed_review_in_progress: 'Under review',
  task_completed_review_satisfactory: '✓ Passed',
  task_completed_review_not_satisfactory_reassigned_but_not_started: '✗ Failed, reassigned'
};

function urgencyBadge(u) {
  const map = { critical: ['badge-red', 'Critical'], high: ['badge-orange', 'High'], medium: ['badge-amber', 'Medium'], low: ['badge-gray', 'Low'] };
  const [cls, label] = map[u] || ['badge-gray', u || 'Medium'];
  return `<span class="badge ${cls}"><i class="ti ti-flame"></i>${label}</span>`;
}

function statusBadge(s) {
  const map = {
    pending_approval: ['badge-amber', '⏳ Pending approval'],
    to_do: ['badge-teal', 'To do'],
    doing: ['badge-orange', 'Doing'],
    done: ['badge-navy', 'Done'],
    passed_inspection: ['badge-green', '✓ Passed inspection']
  };
  const [cls, label] = map[s] || ['badge-gray', PROJECT_STATUS_LABELS[s] || s];
  return `<span class="badge ${cls}">${label}</span>`;
}

function taskStatusBadge(s) {
  const isGood = s === 'task_completed_review_satisfactory';
  const isBad = s === 'task_completed_review_not_satisfactory_reassigned_but_not_started';
  const isReview = s?.includes('review');
  const cls = isGood ? 'badge-green' : isBad ? 'badge-red' : isReview ? 'badge-amber' : 'badge-gray';
  return `<span class="badge ${cls}" style="font-size:10px">${TASK_STATUS_LABELS[s] || s}</span>`;
}

function showFileNames(inputId, listId) {
  const files = [...document.getElementById(inputId).files];
  document.getElementById(listId).innerHTML = files.map(f => `<span class="tag"><i class="ti ti-paperclip"></i>${esc(f.name)}</span>`).join('');
}

// ===== NAVIGATION =====
function showPage(p) {
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(el => el.classList.remove('active'));
  document.getElementById('page-' + p)?.classList.add('active');
  document.getElementById('nav-' + p)?.classList.add('active');
  if (p === 'coordinator') renderCoordinator();
  if (p === 'missions') {
    renderMissionsList();
    if (map) { map.invalidateSize(); renderMapPins(); }
  }
  if (p === 'home') {
    renderHome();
    if (homeMap) { homeMap.invalidateSize(); renderMapPins(); }
  }
}

function backToMissions() { showPage(state.missionDetailOrigin === 'coordinator' ? 'coordinator' : 'missions'); }

// ===== LOAD DATA =====
async function loadData() {
  if (!SUPABASE_URL) {
    showBanner('Database not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in your environment variables.', 'warning');
    renderAll();
    return;
  }
  try {
    state.projects = await sbQuery('project_summary', 'status=neq.pending_approval&order=created_at.desc');
    state.bottlenecks = await sbQuery('open_bottlenecks', 'resolved=eq.false&order=created_at.desc');
    updateAlertCount();
  } catch (e) {
    console.warn('Data load error:', e);
    showBanner('Could not load mission data. Check your internet connection and refresh the page.', 'warning');
  }
  renderAll();
}

// ===== SUBMIT ASK =====
async function submitAsk() {
  // Clear previous errors
  clearFormErrors('ask-form');

  const name = document.getElementById('ask-name').value.trim();
  const desc = document.getElementById('ask-desc').value.trim();
  const address = document.getElementById('ask-address').value.trim();

  let hasErrors = false;
  if (!name) { showFieldError('ask-name', 'Your name is required so we can contact you.'); hasErrors = true; }
  if (!address) { showFieldError('ask-address', 'A full address is required so volunteers can find you.'); hasErrors = true; }
  if (!desc) { showFieldError('ask-desc', 'Please describe what happened and what you need help with.'); hasErrors = true; }
  else if (desc.split(/\s+/).length < 10) { showFieldError('ask-desc', 'Please add more detail — the more you tell us, the better we can scope the mission. Aim for at least a few sentences.'); hasErrors = true; }
  if (hasErrors) { document.querySelector('#page-ask .field-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }

  const btn = document.getElementById('ask-submit-btn');
  btn.innerHTML = `<span class="spinner"></span> Generating mission scope...`;
  btn.disabled = true;

  try {
    const result = await api('/api/submit-ask', {
      name, address, description: desc,
      phone: document.getElementById('ask-phone').value,
      email: document.getElementById('ask-email').value,
      category: document.getElementById('ask-category').value,
      urgency: document.getElementById('ask-urgency').value,
      people_count: document.getElementById('ask-people').value,
      access_notes: document.getElementById('ask-access').value
    });

    const resultDiv = document.getElementById('ask-result');
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = `
    <div class="form-card">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
        <div style="width:40px;height:40px;border-radius:50%;background:var(--amber-light);color:var(--amber);display:flex;align-items:center;justify-content:center;font-size:20px"><i class="ti ti-clock"></i></div>
        <div>
          <div style="font-weight:600">Request received — pending coordinator approval</div>
          <div style="font-size:13px;color:var(--text2)">A mission scope has been generated and is awaiting review before being published.</div>
        </div>
      </div>
      <div class="pm-copy"><div class="pm-label">📋 Project manager briefing</div><p style="font-size:13px;line-height:1.6">${esc(result.pmBriefing)}</p></div>
      <div style="margin-top:12px"><div style="font-size:13px;font-weight:600;margin-bottom:8px">Acceptance tests generated:</div>
        <ul class="acceptance-list">${(result.acceptanceTests || []).map(t => `<li>${esc(t)}</li>`).join('')}</ul>
      </div>
    </div>`;

    btn.innerHTML = `<i class="ti ti-send"></i> Update request`;
    btn.disabled = false;
  } catch (e) {
    console.error('submitAsk error:', e);
    const msg = e.message?.includes('Failed to fetch')
      ? 'Could not reach the server. Please check your internet connection and try again.'
      : e.message?.includes('API key')
      ? 'The AI service is not configured. Please contact the coordinator.'
      : `Something went wrong: ${e.message}. Please try again or call us directly.`;
    showBanner(msg, 'error');
    btn.innerHTML = `<i class="ti ti-send"></i> Submit request`;
    btn.disabled = false;
  }
}

// ===== SUBMIT OFFER =====
async function submitOffer() {
  clearFormErrors('offer-form');
  const name = document.getElementById('offer-name').value.trim();
  const phone = document.getElementById('offer-phone').value.trim();
  const email = document.getElementById('offer-email').value.trim();
  const types = [...document.querySelectorAll('.offer-type:checked')].map(c => c.value);

  let hasErrors = false;
  if (!name) { showFieldError('offer-name', 'Your name is required.'); hasErrors = true; }
  if (!phone && !email) { showFieldError('offer-phone', 'Please provide at least a phone number or email so we can reach you.'); hasErrors = true; }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showFieldError('offer-email', 'Please enter a valid email address.'); hasErrors = true; }
  if (types.length === 0) { showFieldError('offer-type-group', 'Please select at least one thing you can offer.'); hasErrors = true; }
  if (hasErrors) { document.querySelector('#page-offer .field-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  try {
    await api('/api/people', {
      name,
      email: document.getElementById('offer-email').value,
      phone: document.getElementById('offer-phone').value
    });
    const label = document.getElementById('offer-submit-label');
    if (label) label.textContent = 'Update offer';
    document.getElementById('offer-result').style.display = 'block';
    document.getElementById('offer-result').innerHTML = `<div class="form-card"><div style="display:flex;align-items:center;gap:10px"><div style="width:40px;height:40px;border-radius:50%;background:var(--green-light);color:var(--green);display:flex;align-items:center;justify-content:center;font-size:20px"><i class="ti ti-circle-check"></i></div><div><div style="font-weight:600">Thank you, ${esc(name)}!</div><div style="font-size:13px;color:var(--text2)">Your offer has been recorded. A coordinator will reach out when there's a mission that matches your skills and availability.</div></div></div></div>`;
  } catch (e) {
    console.error('submitOffer error:', e);
    const msg = e.message?.includes('Failed to fetch')
      ? 'Could not reach the server. Please check your connection and try again.'
      : `Something went wrong: ${e.message}. Please try again.`;
    showBanner(msg, 'error');
  }
}

// ===== VIEW MISSION =====
async function viewMission(id, origin) {
  state.missionDetailOrigin = origin || 'missions';
  state.currentProjectId = id;

  const m = state.projects.find(x => x.id === id);
  if (!m) return;

  // Load tasks
  try {
    state.currentTasks = await sbQuery('task_detail', `project_id=eq.${id}&order=sequence.asc`);
  } catch (e) {
    state.currentTasks = [];
  }

  const totalTasks = state.currentTasks.length;
  const doneTasks = state.currentTasks.filter(t => t.status === 'task_completed_review_satisfactory').length;
  const pct = totalTasks ? Math.round(doneTasks / totalTasks * 100) : 0;

  document.getElementById('mission-detail-content').innerHTML = `
  <div class="md-header">
    <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:10px">
      <div style="flex:1">
        <div class="md-title">${esc(m.title)}</div>
        <div class="md-meta">
          <span><i class="ti ti-map-pin"></i>${esc(m.address)}</span>
          <span><i class="ti ti-user"></i>PM: ${esc(m.primary_pm_name || settings.pmName)}</span>
          <span><i class="ti ti-calendar"></i>${fmt(m.created_at)}</span>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
        ${urgencyBadge(m.urgency)}${statusBadge(m.status)}
      </div>
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
    <ul class="acceptance-list">${(m.acceptance_tests || []).map((t, i) => `<li>[${i + 1}] ${esc(t)}</li>`).join('')}</ul>
  </div>
  ${renderTaskList(m)}`;

  showPage('mission-detail');
}

function renderTaskList(m) {
  if (!state.currentTasks.length) return `<div class="empty"><i class="ti ti-list"></i><p>No tasks yet.</p></div>`;

  // Group by role_name
  const groups = {};
  for (const t of state.currentTasks) {
    const group = t.role_name || 'General';
    if (!groups[group]) groups[group] = [];
    groups[group].push(t);
  }

  return Object.entries(groups).map(([groupName, tasks]) => `
  <div class="project-block">
    <div class="proj-header" onclick="toggleProj('grp-${esc(groupName)}')">
      <i class="ti ti-folder" style="color:var(--orange);font-size:16px"></i>
      <div class="proj-title">${esc(groupName)}</div>
      <div class="proj-meta">${tasks.filter(t => t.status === 'task_completed_review_satisfactory').length}/${tasks.length} done</div>
      <i class="ti ti-chevron-down proj-expand" id="exp-grp-${esc(groupName)}"></i>
    </div>
    <div class="tasks-list" id="tasks-grp-${esc(groupName)}" style="display:none">
      ${tasks.map(t => renderTask(m, t)).join('')}
    </div>
  </div>`).join('');
}

function renderTask(m, t) {
  const isDone = t.status === 'task_completed_review_satisfactory';
  const isFailed = t.status === 'task_completed_review_not_satisfactory_reassigned_but_not_started';
  const isReview = t.status?.includes('review');
  const checkClass = isDone ? 'done' : isFailed ? 'failed' : isReview ? 'review' : '';
  const checkIcon = isDone ? '<i class="ti ti-check" style="font-size:12px"></i>' : isFailed ? '<i class="ti ti-x" style="font-size:12px"></i>' : isReview ? '<i class="ti ti-clock" style="font-size:12px"></i>' : '';

  const canSubmit = ['task_not_assigned','task_assigned_but_not_started','task_assigned_and_in_progress',
    'task_completed_review_not_satisfactory_reassigned_but_not_started'].includes(t.status);
  const hasSubmissions = t.status !== 'task_not_assigned';

  let actions = '';
  if (canSubmit) {
    actions = `<span class="task-action" onclick="openSubmitModal('${m.id}','${t.id}')">${hasSubmissions ? 'Update' : 'Submit update'}</span> · <span class="task-action" style="color:var(--red)" onclick="openBottleneckModal('${m.id}','${t.id}')">Report bottleneck</span>`;
  } else if (isReview) {
    actions = `<span style="font-size:12px;color:var(--amber)">Awaiting coordinator review</span>`;
  } else if (isDone) {
    actions = `<span style="font-size:12px;color:var(--green)">✓ Passed inspection</span>`;
  }

  const atTests = (t.acceptance_tests || []);

  return `<div class="task-item">
  <div class="task-check ${checkClass}">${checkIcon}</div>
  <div class="task-info">
    <div class="task-name">${esc(t.title)} ${taskStatusBadge(t.status)}</div>
    <div class="task-sub">${esc(t.description)}</div>
    ${t.tools ? `<div class="task-sub" style="margin-top:2px"><i class="ti ti-tool" style="font-size:11px;vertical-align:middle"></i> ${esc(t.tools)}</div>` : ''}
    ${t.assignee_name ? `<div class="task-sub" style="margin-top:2px"><i class="ti ti-user" style="font-size:11px;vertical-align:middle"></i> ${esc(t.assignee_name)}</div>` : ''}
    ${atTests.length ? `<div style="margin-top:6px">${atTests.map(at => `<div style="font-size:11px;color:var(--teal);margin-top:3px;display:flex;gap:5px;align-items:flex-start"><span style="flex-shrink:0">✓</span><span>${esc(at)}</span></div>`).join('')}</div>` : ''}
    <div style="margin-top:6px">${actions}</div>
  </div>
</div>`;
}

function toggleProj(id) {
  const tasks = document.getElementById('tasks-' + id);
  const exp = document.getElementById('exp-' + id);
  if (!tasks) return;
  const open = tasks.style.display === 'block';
  tasks.style.display = open ? 'none' : 'block';
  exp?.classList.toggle('open', !open);
}

// ===== ENROLL VOLUNTEER =====
async function enrollVolunteer(projectId) {
  const name = prompt('Enter your name to enroll as a volunteer:');
  if (!name) return;
  const email = prompt('Email address (optional):') || '';
  try {
    await api('/api/people', { name: name.trim(), email });
    alert(`Thank you ${name}! You're enrolled. A coordinator will contact you with more details.`);
  } catch (e) {
    alert('Error enrolling: ' + e.message);
  }
}

// ===== SUBMIT TASK MODAL =====
function openSubmitModal(projectId, taskId) {
  const t = state.currentTasks.find(x => x.id === taskId);
  if (!t) return;
  state.submittingTask = { projectId, taskId };
  const hasExisting = t.status !== 'task_not_assigned' && t.status !== 'task_assigned_but_not_started';
  document.getElementById('submit-modal-title').textContent = `${hasExisting ? 'Update' : 'Submit'}: ${t.title}`;
  document.getElementById('submit-modal-body').innerHTML = `
    <p style="font-size:13px;color:var(--text2);margin-bottom:12px">${esc(t.description)}</p>
    <div class="field"><label>What did you complete? *</label><textarea id="sub-notes" placeholder="Describe exactly what was done — include measurements, materials used, decisions made, anything the reviewer needs to evaluate against the acceptance tests." style="min-height:80px"></textarea></div>
    <div class="field"><label>Supporting photos/videos</label>
      <div class="file-upload-area" onclick="document.getElementById('sub-files').click()">
        <i class="ti ti-camera" aria-hidden="true"></i>Add photos or videos
      </div>
      <input id="sub-files" type="file" multiple accept="image/*,video/*" style="display:none" onchange="showFileNames('sub-files','sub-file-list')">
      <div id="sub-file-list" style="margin-top:4px;font-size:12px;color:var(--text2)"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Your name</label><input id="sub-volunteer" placeholder="Your name" type="text"></div>
      <div class="field"><label>Your email</label><input id="sub-email" placeholder="you@email.com" type="email"></div>
    </div>`;
  document.getElementById('submit-modal').style.display = 'flex';
}

function closeSubmitModal(e) {
  if (!e || e.target === document.getElementById('submit-modal')) document.getElementById('submit-modal').style.display = 'none';
}

async function submitTaskUpdate() {
  const notes = document.getElementById('sub-notes').value.trim();
  if (!notes) {
    showFieldError('sub-notes', 'Please describe what was completed. The reviewer needs enough detail to evaluate your work against the acceptance tests.');
    return;
  }
  if (notes.split(/\s+/).length < 5) {
    showFieldError('sub-notes', 'Please add more detail — describe what specifically was done, including any measurements or materials used.');
    return;
  }
  const { projectId, taskId } = state.submittingTask;
  try {
    await api(`/api/tasks/${taskId}/submit`, {
      notes,
      personName: document.getElementById('sub-volunteer').value.trim(),
      personEmail: document.getElementById('sub-email').value.trim()
    });
    closeSubmitModal();
    await viewMission(projectId, state.missionDetailOrigin);
    updateAlertCount();
  } catch (e) {
    alert('Error submitting: ' + e.message);
  }
}

// ===== BOTTLENECK MODAL =====
function openBottleneckModal(projectId, taskId) {
  const t = state.currentTasks.find(x => x.id === taskId);
  state.bottleneckTask = { projectId, taskId };
  document.getElementById('bottleneck-modal-body').innerHTML = `
    <p style="font-size:13px;color:var(--text2);margin-bottom:12px">An alert will be sent immediately to the project coordinator at <strong>${esc(settings.email)}</strong>.</p>
    <div class="field"><label>Describe the obstacle *</label><textarea id="bn-desc" placeholder="What's blocking you? What do you need to continue? Include specifics." style="min-height:90px"></textarea></div>
    <div class="field-row">
      <div class="field"><label>Your name</label><input id="bn-reporter" placeholder="Your name" type="text"></div>
      <div class="field"><label>Your email</label><input id="bn-email" placeholder="you@email.com" type="email"></div>
    </div>`;
  document.getElementById('bottleneck-modal').style.display = 'flex';
}

function closeBottleneckModal(e) {
  if (!e || e.target === document.getElementById('bottleneck-modal')) document.getElementById('bottleneck-modal').style.display = 'none';
}

async function submitBottleneck() {
  const desc = document.getElementById('bn-desc').value.trim();
  if (!desc) {
    showFieldError('bn-desc', 'Please describe what is blocking you and what you need to continue.');
    return;
  }
  const { projectId, taskId } = state.bottleneckTask;
  try {
    await api(`/api/tasks/${taskId}/bottleneck`, {
      description: desc,
      reporterName: document.getElementById('bn-reporter').value.trim(),
      reporterEmail: document.getElementById('bn-email').value.trim()
    });
    closeBottleneckModal();
    alert(`Bottleneck reported! An alert has been sent to ${settings.email}.`);
    state.bottlenecks = await sbQuery('open_bottlenecks', 'resolved=eq.false&order=created_at.desc');
    updateAlertCount();
    await viewMission(projectId, state.missionDetailOrigin);
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

// ===== COORDINATOR: REVIEW MODAL =====
function openReviewModal(projectId, taskId) {
  const m = state.projects.find(x => x.id === projectId);
  const t = state.currentTasks.find(x => x.id === taskId) ||
            state.projects.flatMap(p => []).find(t => t?.id === taskId);
  state.reviewingTask = { projectId, taskId };

  document.getElementById('review-modal-title').textContent = `Review: ${t?.title || 'Task'}`;
  document.getElementById('review-modal-body').innerHTML = `
    ${t?.acceptance_tests?.length ? `<div style="font-size:13px;font-weight:600;margin-bottom:6px">Task acceptance tests:</div><ul class="acceptance-list">${t.acceptance_tests.map((a, i) => `<li>[${i+1}] ${esc(a)}</li>`).join('')}</ul>` : ''}
    ${m?.acceptance_tests?.length ? `<div style="font-size:13px;font-weight:600;margin-top:10px;margin-bottom:6px">Mission acceptance tests:</div><ul class="acceptance-list">${m.acceptance_tests.map((a, i) => `<li>[${i+1}] ${esc(a)}</li>`).join('')}</ul>` : ''}
    <div class="field" style="margin-top:14px"><label>Review notes *</label><textarea id="review-notes" placeholder="Describe your decision. If failing, cite the specific acceptance test number. e.g. 'Failed. Test [2]: spindles must be ≤4&quot; apart. Per photos, spindles are 8&quot; apart.'" style="min-height:90px"></textarea></div>`;
  document.getElementById('review-modal').style.display = 'flex';
}

function closeReviewModal(e) {
  if (!e || e.target === document.getElementById('review-modal')) document.getElementById('review-modal').style.display = 'none';
}

async function approveTask() {
  const notes = document.getElementById('review-notes').value.trim();
  if (!notes) {
    showFieldError('review-notes', 'Review notes are required. Describe what you verified and how.');
    return;
  }
  const { projectId, taskId } = state.reviewingTask;
  try {
    await api(`/api/tasks/${taskId}/review`, { outcome: 'pass', notes, reviewerEmail: settings.email });
    closeReviewModal();
    await viewMission(projectId, state.missionDetailOrigin);
    await loadData();
    renderCoordinator();
  } catch (e) { alert('Error: ' + e.message); }
}

async function failTask() {
  const notes = document.getElementById('review-notes').value.trim();
  if (!notes) {
    showFieldError('review-notes', 'Failure notes are required — cite the specific acceptance test number and explain exactly what must be corrected before resubmitting.');
    return;
  }
  const { projectId, taskId } = state.reviewingTask;
  try {
    await api(`/api/tasks/${taskId}/review`, { outcome: 'fail', notes, reviewerEmail: settings.email });
    closeReviewModal();
    await viewMission(projectId, state.missionDetailOrigin);
    await loadData();
    renderCoordinator();
  } catch (e) { alert('Error: ' + e.message); }
}

// ===== COORDINATOR: APPROVAL QUEUE =====
async function loadApprovalQueue() {
  if (!SUPABASE_URL) return [];
  // Use service role via backend function for pending_approval projects
  try {
    const res = await fetch('/api/approval-queue', {
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

async function approveProject(projectId) {
  if (!confirm('Approve this project and publish it to the map and mission board?')) return;
  try {
    await api('/api/review-project', {
      projectId, action: 'approve', reviewerEmail: settings.email
    });
    alert('Project approved and published!');
    await loadData();
    renderCoordinator();
  } catch (e) { alert('Error: ' + e.message); }
}

async function denyProject(projectId, currentTitle) {
  const reason = prompt(`Denial reason for "${currentTitle}":\n(The AI will use this to rewrite the project scope)`);
  if (!reason?.trim()) { alert('Denial reason is required.'); return; }
  try {
    const result = await api('/api/review-project', {
      projectId, action: 'deny', denialReason: reason.trim(), reviewerEmail: settings.email
    });
    if (result.action === 'flagged_for_manual') {
      alert(`Project has been denied ${result.message} Manual editing required.`);
    } else {
      alert(`Project rewritten (attempt ${result.attempt}). "${result.newTitle}" is back in the approval queue.`);
    }
    renderCoordinator();
  } catch (e) { alert('Error: ' + e.message); }
}

// ===== RENDER HOME =====
function renderHome() {
  // Stats are commented out (moved to coordinator tab later)
}

// ===== RENDER MISSIONS LIST =====
function filterMissions() { renderMissionsList(); }

function renderMissionsList() {
  const cat = document.getElementById('filter-category').value;
  const urg = document.getElementById('filter-urgency').value;
  const sta = document.getElementById('filter-status').value;
  const q = (document.getElementById('filter-search').value || '').toLowerCase();

  const missions = state.projects.filter(m => {
    if (m.status === 'pending_approval') return false;
    if (cat && m.category !== cat) return false;
    if (urg && m.urgency !== urg) return false;
    if (sta && m.status !== sta) return false;
    if (q && !m.title?.toLowerCase().includes(q) && !m.address?.toLowerCase().includes(q)) return false;
    return true;
  });

  const el = document.getElementById('missions-list');
  if (!missions.length) { el.innerHTML = `<div class="empty"><i class="ti ti-map-search"></i><p>No missions match your filters.</p></div>`; return; }

  el.innerHTML = missions.map(m => {
    const total = parseInt(m.total_tasks) || 0;
    const done = parseInt(m.completed_tasks) || 0;
    const pct = total ? Math.round(done / total * 100) : 0;
    const bns = parseInt(m.open_bottlenecks) || 0;
    return `<div class="mcard" onclick="viewMission('${m.id}','missions')">
      <div class="mcard-top">
        <div class="mcard-icon"><i class="ti ti-map-pin"></i></div>
        <div class="mcard-info">
          <div class="mcard-title">${esc(m.title)}</div>
          <div class="mcard-sub">${esc(m.address)}</div>
          <div class="mcard-sub" style="margin-top:3px">${esc((m.summary || '').slice(0, 90))}${(m.summary || '').length > 90 ? '...' : ''}</div>
        </div>
      </div>
      <div class="mcard-badges">
        ${urgencyBadge(m.urgency)}${statusBadge(m.status)}
        <span class="badge badge-gray">${esc(m.category || '')}</span>
        ${bns ? `<span class="badge badge-red"><i class="ti ti-alert-triangle"></i>${bns} bottleneck${bns > 1 ? 's' : ''}</span>` : ''}
        <span class="badge badge-gray">${pct}% complete</span>
      </div>
      <div class="progress-bar"><div class="progress-fill ${pct === 100 ? 'green' : ''}" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

// ===== COORDINATOR DASHBOARD =====
let coordActiveTab = 'approval';

function coordTab(tab) {
  coordActiveTab = tab;
  ['approval', 'missions', 'reviews', 'volunteers'].forEach(t => {
    document.getElementById('coord-' + t + '-tab').style.display = t === tab ? 'block' : 'none';
  });
  document.querySelectorAll('.tab-bar button').forEach((b, i) => {
    b.classList.toggle('active', ['approval', 'missions', 'reviews', 'volunteers'][i] === tab);
  });
  renderCoordTab(tab);
}

async function renderCoordinator() {
  // Bottleneck alerts
  const alertEl = document.getElementById('bottleneck-alerts');
  alertEl.innerHTML = state.bottlenecks.map(b => `<div class="alert-strip">
    <i class="ti ti-alert-triangle al-icon"></i>
    <div class="al-text"><strong>⚠ Bottleneck on "${esc(b.project_title)}"</strong>${esc(b.task_title)} — ${esc(b.description)}<br><span style="font-size:11px;color:var(--text2)">${fmtdt(b.created_at)}${b.reporter_name ? ' · ' + esc(b.reporter_name) : ''}</span></div>
    <button class="btn btn-secondary btn-sm" onclick="resolveBottleneck('${b.id}')">Resolve</button>
  </div>`).join('');

  renderCoordTab(coordActiveTab);
  updateAlertCount();
}

async function resolveBottleneck(id) {
  try {
    await api('/api/resolve-bottleneck', { bottleneckId: id });
    state.bottlenecks = state.bottlenecks.filter(b => b.id !== id);
    renderCoordinator();
    updateAlertCount();
  } catch (e) { alert('Error: ' + e.message); }
}

async function renderCoordTab(tab) {
  if (tab === 'approval') await renderApprovalQueue();
  else if (tab === 'missions') renderCoordMissions();
  else if (tab === 'reviews') await renderCoordReviews();
  else if (tab === 'volunteers') renderCoordVolunteers();
}

async function renderApprovalQueue() {
  const el = document.getElementById('coord-approval-tab');
  el.innerHTML = `<div class="empty"><i class="ti ti-loader" style="animation:spin 1s linear infinite"></i><p>Loading approval queue...</p></div>`;
  const queue = await loadApprovalQueue();
  if (!queue.length) { el.innerHTML = `<div class="empty"><i class="ti ti-circle-check"></i><p>No projects pending approval.</p></div>`; return; }
  el.innerHTML = queue.map(p => {
    const isMaxDenied = p.denial_count >= 2;
    return `<div class="project-block" style="margin-bottom:14px">
    <div style="padding:16px">
      <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px">
        <div style="flex:1">
          <div style="font-weight:600;font-size:15px;margin-bottom:3px">${esc(p.title)}</div>
          <div style="font-size:12px;color:var(--text2)">${esc(p.address)} · Submitted ${fmt(p.created_at)}</div>
          ${isMaxDenied ? `<div style="font-size:12px;color:var(--red);margin-top:4px;font-weight:500">⚠ Denied ${p.denial_count} times — manual rewrite required</div>` : ''}
          ${p.denial_count > 0 && !isMaxDenied ? `<div style="font-size:12px;color:var(--amber);margin-top:4px">AI attempt #${p.ai_attempt_count} · Previous denial: "${esc(p.denial_reason)}"</div>` : ''}
        </div>
        <div>${urgencyBadge(p.urgency)}</div>
      </div>
      <p style="font-size:13px;color:var(--text2);margin-bottom:10px">${esc(p.summary || p.ask_description || '')}</p>
      <div style="font-size:13px;font-weight:600;margin-bottom:6px">Acceptance tests:</div>
      <ul class="acceptance-list" style="margin-bottom:12px">
        ${(p.acceptance_tests || []).map((t, i) => `<li>[${i+1}] ${esc(t)}</li>`).join('')}
      </ul>
      <div style="font-size:13px;font-weight:600;margin-bottom:6px">PM briefing:</div>
      <p style="font-size:13px;color:var(--text2);margin-bottom:12px">${esc(p.pm_briefing || '')}</p>
      <div class="btn-group">
        <button class="btn btn-success btn-sm" onclick="approveProject('${p.id}')"><i class="ti ti-circle-check"></i> Approve & publish</button>
        <button class="btn btn-danger btn-sm" onclick="denyProject('${p.id}','${esc(p.title)}')"><i class="ti ti-circle-x"></i> Deny & rewrite</button>
      </div>
    </div>
  </div>`;
  }).join('');
}

function renderCoordMissions() {
  const el = document.getElementById('coord-missions-tab');
  if (!state.projects.length) { el.innerHTML = `<div class="empty"><i class="ti ti-map"></i><p>No published missions yet.</p></div>`; return; }
  el.innerHTML = state.projects.filter(m => m.status !== 'pending_approval').map(m => {
    const total = parseInt(m.total_tasks) || 0;
    const done = parseInt(m.completed_tasks) || 0;
    const review = 0; // would need additional query
    const pct = total ? Math.round(done / total * 100) : 0;
    return `<div class="mcard" onclick="state.missionDetailOrigin='coordinator';viewMission('${m.id}','coordinator')">
      <div class="mcard-top">
        <div class="mcard-icon"><i class="ti ti-clipboard-list"></i></div>
        <div class="mcard-info"><div class="mcard-title">${esc(m.title)}</div><div class="mcard-sub">${esc(m.address)} · ${fmt(m.created_at)}</div></div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px">${urgencyBadge(m.urgency)}${statusBadge(m.status)}</div>
      </div>
      <div class="mcard-badges"><span class="badge badge-gray">${done}/${total} tasks done</span><span class="badge badge-gray">PM: ${esc(m.primary_pm_name || settings.pmName)}</span></div>
      <div class="progress-bar"><div class="progress-fill ${pct === 100 ? 'green' : ''}" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

async function renderCoordReviews() {
  const el = document.getElementById('coord-reviews-tab');
  try {
    const tasks = await sbQuery('task_detail',
      `status=eq.task_completed_review_not_assigned&order=updated_at.asc`
    );
    if (!tasks.length) { el.innerHTML = `<div class="empty"><i class="ti ti-circle-check"></i><p>No tasks awaiting review.</p></div>`; return; }
    el.innerHTML = tasks.map(t => `<div class="project-block" style="margin-bottom:12px"><div style="padding:14px 16px">
      <div style="font-weight:600;font-size:14px;margin-bottom:3px">${esc(t.title)}</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:8px">Mission: ${esc(t.project_title)}</div>
      ${t.acceptance_tests?.length ? `<ul class="acceptance-list" style="margin-bottom:8px">${t.acceptance_tests.map((a,i) => `<li>[${i+1}] ${esc(a)}</li>`).join('')}</ul>` : ''}
      <div class="btn-group" style="margin-top:10px">
        <button class="btn btn-success btn-sm" onclick="state.currentTasks=[...state.currentTasks.filter(x=>x.id!='${t.id}'),${JSON.stringify(t).replace(/"/g,"'")}];openReviewModal('${t.project_id}','${t.id}')">
          <i class="ti ti-clipboard-check"></i> Review task
        </button>
      </div>
    </div></div>`).join('');
  } catch(e) { el.innerHTML = `<div class="empty"><p>Error loading reviews: ${esc(e.message)}</p></div>`; }
}

async function renderCoordVolunteers() {
  const el = document.getElementById('coord-volunteers-tab');
  try {
    const people = await sbQuery('people', 'order=created_at.desc&limit=50');
    if (!people.length) { el.innerHTML = `<div class="empty"><i class="ti ti-users"></i><p>No volunteers registered yet.</p></div>`; return; }
    el.innerHTML = people.map(v => `<div class="mcard">
      <div class="mcard-top">
        <div style="width:38px;height:38px;border-radius:50%;background:var(--navy-light);color:var(--navy);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:14px;flex-shrink:0">${esc(v.name.slice(0,2).toUpperCase())}</div>
        <div class="mcard-info">
          <div class="mcard-title">${esc(v.name)}</div>
          <div class="mcard-sub">${esc(v.email || 'No email')} · Added ${fmt(v.created_at)}</div>
        </div>
        ${v.is_coordinator ? '<span class="badge badge-teal">Coordinator</span>' : ''}
      </div>
    </div>`).join('');
  } catch(e) { el.innerHTML = `<div class="empty"><p>Error: ${esc(e.message)}</p></div>`; }
}

function updateAlertCount() {
  const n = state.bottlenecks.length;
  const badge = document.getElementById('alert-count');
  if (badge) { badge.textContent = n; badge.style.display = n ? 'inline-flex' : 'none'; }
}

// ===== EXPORT =====
function exportData() {
  const blob = new Blob([JSON.stringify({ projects: state.projects, bottlenecks: state.bottlenecks }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'reliefconnect-export.json'; a.click();
  URL.revokeObjectURL(url);
}

// ===== RENDER ALL =====
function renderAll() {
  renderHome();
  updateAlertCount();
  if (document.getElementById('settings-email')) {
    document.getElementById('settings-email').value = settings.email;
    document.getElementById('settings-pm-name').value = settings.pmName;
  }
}

// ===== LEAFLET MAPS (OpenStreetMap — no API key required) =====
var map = null;
var homeMap = null;
var mapMarkers = [];
var homeMapMarkers = [];

const MAP_CENTER = [39.5, -98.35];
const MAP_ZOOM = 4;
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function initMap() {
  homeMap = L.map('home-map').setView(MAP_CENTER, MAP_ZOOM);
  L.tileLayer(TILE_URL, { attribution: TILE_ATTR }).addTo(homeMap);

  map = L.map('missions-map').setView(MAP_CENTER, MAP_ZOOM);
  L.tileLayer(TILE_URL, { attribution: TILE_ATTR }).addTo(map);

  renderMapPins();
}

async function geocodeAddress(address) {
  const encoded = encodeURIComponent(address);
  const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1`, {
    headers: { 'Accept-Language': 'en', 'User-Agent': 'ReliefConnect/1.0 (volunteerdisasterrelief.com)' }
  });
  const data = await res.json();
  if (data?.[0]) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  return null;
}

async function renderMapPins() {
  if (!map && !homeMap) return;

  // Clear existing markers
  mapMarkers.forEach(m => m.remove()); mapMarkers = [];
  homeMapMarkers.forEach(m => m.remove()); homeMapMarkers = [];

  const urgencyColors = { critical: '#C0392B', high: '#E8521A', medium: '#B87F1A', low: '#1A7A4A' };
  const bounds = [];

  for (const mission of state.projects.filter(m => m.status !== 'pending_approval')) {
    if (!mission.address) continue;
    if (!mission.coords) {
      try { mission.coords = await geocodeAddress(mission.address); } catch { continue; }
      if (!mission.coords) continue;
    }

    const coords = typeof mission.coords === 'string' ? JSON.parse(mission.coords) : mission.coords;
    const lat = coords.lat, lng = coords.lng;
    if (!lat || !lng) continue;

    const color = urgencyColors[mission.urgency] || '#1A2744';
    const total = parseInt(mission.total_tasks) || 0;
    const done = parseInt(mission.completed_tasks) || 0;
    const pct = total ? Math.round(done / total * 100) : 0;

    // Custom circle marker with ! using Leaflet divIcon
    const icon = L.divIcon({
      className: '',
      html: `<div style="width:28px;height:28px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:900;color:#fff;font-family:Inter,sans-serif">!</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    const popupContent = `<div style="font-family:Inter,sans-serif;padding:4px;min-width:180px">
      <div style="font-weight:600;font-size:14px;margin-bottom:4px">${esc(mission.title)}</div>
      <div style="font-size:12px;color:#6B7280;margin-bottom:6px">${esc(mission.address)}</div>
      <div style="font-size:12px;margin-bottom:8px">${pct}% complete · ${esc(mission.status)}</div>
      <a href="#" onclick="event.preventDefault();viewMission('${mission.id}','missions')" style="font-size:12px;color:#E8521A;font-weight:500;text-decoration:none">View mission →</a>
    </div>`;

    [{ m: map, arr: mapMarkers }, { m: homeMap, arr: homeMapMarkers }].forEach(({ m: mapInst, arr }) => {
      if (!mapInst) return;
      const marker = L.marker([lat, lng], { icon }).addTo(mapInst);
      marker.bindPopup(popupContent);
      arr.push(marker);
    });

    bounds.push([lat, lng]);
  }

  if (bounds.length) {
    const leafletBounds = L.latLngBounds(bounds);
    [map, homeMap].filter(Boolean).forEach(m => {
      m.fitBounds(leafletBounds, { maxZoom: 14, padding: [30, 30] });
    });
  }
}


// ===== FORM VALIDATION HELPERS =====
function showFieldError(fieldId, message) {
  const field = document.getElementById(fieldId);
  if (!field) return;
  // Remove any existing error
  field.classList.add('field-invalid');
  const existing = field.parentElement.querySelector('.field-error');
  if (existing) existing.remove();
  const err = document.createElement('div');
  err.className = 'field-error';
  err.innerHTML = `<i class="ti ti-alert-circle"></i> ${esc(message)}`;
  field.parentElement.appendChild(err);
  field.addEventListener('input', () => clearFieldError(fieldId), { once: true });
}

function clearFieldError(fieldId) {
  const field = document.getElementById(fieldId);
  if (!field) return;
  field.classList.remove('field-invalid');
  field.parentElement.querySelector('.field-error')?.remove();
}

function clearFormErrors(formId) {
  document.querySelectorAll('.field-invalid').forEach(el => el.classList.remove('field-invalid'));
  document.querySelectorAll('.field-error').forEach(el => el.remove());
}

// ===== GLOBAL BANNER =====
let bannerTimeout = null;
function showBanner(message, type = 'error') {
  let banner = document.getElementById('global-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'global-banner';
    document.querySelector('nav').after(banner);
  }
  const colors = {
    error: { bg: 'var(--red-light)', border: '#FECACA', icon: 'ti-alert-circle', color: 'var(--red)' },
    warning: { bg: 'var(--amber-light)', border: '#FDE68A', icon: 'ti-alert-triangle', color: 'var(--amber)' },
    success: { bg: 'var(--green-light)', border: '#BBF7D0', icon: 'ti-circle-check', color: 'var(--green)' }
  };
  const c = colors[type] || colors.error;
  banner.style.cssText = `background:${c.bg};border-bottom:1px solid ${c.border};padding:10px 24px;display:flex;align-items:center;gap:10px;font-size:13px;color:${c.color}`;
  banner.innerHTML = `<i class="ti ${c.icon}"></i><span style="flex:1">${esc(message)}</span><button onclick="document.getElementById('global-banner').style.display='none'" style="background:none;border:none;cursor:pointer;color:${c.color};font-size:16px">×</button>`;
  if (bannerTimeout) clearTimeout(bannerTimeout);
  if (type === 'success') bannerTimeout = setTimeout(() => { banner.style.display = 'none'; }, 4000);
}

// ===== INIT =====
loadData();
