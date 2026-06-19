/**
 * ReliefConnect Test Helpers
 *
 * CLEANUP PHILOSOPHY:
 * Tests must leave zero waste. Every record created by a test must be deleted
 * when that test suite finishes. We enforce this two ways:
 *
 * 1. ID tracking — every created ask/project/person ID is registered and
 *    deleted in FK-safe order in cleanupTestData().
 *
 * 2. Email domain sentinel — all test people use emails ending in
 *    @test.reliefconnect.com. A global afterAll in jest.setup.js wipes
 *    any person with that domain, catching anything that slipped through
 *    individual tracking (e.g. people created implicitly by task submissions).
 *
 * Real data (bjlinville1@gmail.com, B.J. Linville) is never touched.
 */

require('dotenv').config();
const fetch = require('node-fetch');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

// All test emails MUST use this domain — it's the cleanup sentinel
const TEST_EMAIL_DOMAIN = 'test.reliefconnect.com';
const TEST_REQUESTER_EMAIL = `test-requester@${TEST_EMAIL_DOMAIN}`;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'Missing env vars. Copy .env.example to .env and fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'
  );
}

// ===== SUPABASE DIRECT CLIENT (service role — for test setup/teardown only) =====
async function sb(table, params = '', options = {}) {
  const key = options.anon ? SUPABASE_ANON_KEY : SUPABASE_SERVICE_ROLE_KEY;
  const url = `${SUPABASE_URL}/rest/v1/${table}${params ? '?' + params : ''}`;
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': options.prefer || 'return=representation'
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${options.method || 'GET'} ${table}: ${text}`);
  return text ? JSON.parse(text) : null;
}

// ===== NETLIFY FUNCTION CALLER =====
async function api(path, body, method = 'POST') {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: res.status, ok: res.ok, data };
}

// ===== TEST DATA FACTORY =====
// All test asks use the sentinel email domain so they can be bulk-cleaned
function makeAsk(overrides = {}) {
  return {
    name: 'Test Requester [DO NOT CONTACT]',
    phone: '(555) 555-0001',
    email: TEST_REQUESTER_EMAIL,
    address: '1600 Pennsylvania Avenue NW, Washington, DC 20500',
    description: 'A large tree fell across the driveway during last night\'s storm. The trunk is approximately 18 inches in diameter and 40 feet long. It is blocking vehicle access completely. There are multiple large branches scattered across the front yard. No power lines involved. Gate code is 1234.',
    category: 'Debris removal',
    urgency: 'high',
    people_count: '3',
    access_notes: 'Gate code 1234. Dog secured indoors.',
    ...overrides
  };
}

// Generate a test email that's clearly a sentinel
function testEmail(label = '') {
  const slug = label ? `${label}-` : '';
  return `${slug}${Date.now()}@${TEST_EMAIL_DOMAIN}`;
}

// ===== ID REGISTRY — tracks everything created this test run =====
const registry = {
  askIds: new Set(),
  projectIds: new Set(),
  personIds: new Set(),
};

function trackAsk(id)     { if (id) registry.askIds.add(id); }
function trackProject(id) { if (id) registry.projectIds.add(id); }
function trackPerson(id)  { if (id) registry.personIds.add(id); }

// ===== FULL CLEANUP — deletes ALL test artifacts in FK-safe order =====
async function cleanupTestData() {
  const errors = [];

  // 1. Find ALL people with the test email domain (catches implicitly-created ones too)
  let testPeople = [];
  try {
    testPeople = await sb(`people`, `email=like.*%40${TEST_EMAIL_DOMAIN}`);
  } catch (e) { errors.push(`people lookup: ${e.message}`); }

  const allPersonIds = new Set([
    ...registry.personIds,
    ...(testPeople || []).map(p => p.id)
  ]);

  // 2. Find any projects owned by test people or tracked directly
  //    (catches projects created by getOrCreatePerson in submit-ask)
  let extraProjects = [];
  try {
    if (allPersonIds.size > 0) {
      const idList = [...allPersonIds].map(id => `"${id}"`).join(',');
      extraProjects = await sb(`projects`, `approved_by=in.(${idList})`);
    }
  } catch (e) { /* none found */ }

  // Also find projects whose ask used the test email
  let askProjects = [];
  try {
    const testAsks = await sb(`asks`, `email=eq.${TEST_REQUESTER_EMAIL}`);
    if (testAsks?.length) {
      const askIds = testAsks.map(a => `"${a.id}"`).join(',');
      const linked = await sb(`projects`, `ask_id=in.(${askIds})`);
      askProjects = linked || [];
    }
  } catch (e) { /* none */ }

  const allProjectIds = new Set([
    ...registry.projectIds,
    ...(extraProjects || []).map(p => p.id),
    ...(askProjects || []).map(p => p.id)
  ]);

  // 3. Delete in FK-safe order: children before parents
  for (const projectId of allProjectIds) {
    try {
      await sb(`submissions`,       `task_id=in.(select id from tasks where project_id='${projectId}')`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => {});
      await sb(`reviews`,           `task_id=in.(select id from tasks where project_id='${projectId}')`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => {});
      await sb(`task_history`,      `task_id=in.(select id from tasks where project_id='${projectId}')`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => {});
      await sb(`bottlenecks`,       `project_id=eq.${projectId}`,  { method: 'DELETE', prefer: 'return=minimal' });
      await sb(`tasks`,             `project_id=eq.${projectId}`,  { method: 'DELETE', prefer: 'return=minimal' });
      await sb(`role_assignments`,  `role_id=in.(select id from project_roles where project_id='${projectId}')`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => {});
      await sb(`project_roles`,     `project_id=eq.${projectId}`,  { method: 'DELETE', prefer: 'return=minimal' });
      await sb(`project_volunteers`,`project_id=eq.${projectId}`,  { method: 'DELETE', prefer: 'return=minimal' });
      await sb(`projects`,          `id=eq.${projectId}`,          { method: 'DELETE', prefer: 'return=minimal' });
    } catch (e) { errors.push(`project ${projectId}: ${e.message}`); }
  }

  // 4. Delete asks with test email
  try {
    await sb(`asks`, `email=eq.${TEST_REQUESTER_EMAIL}`, { method: 'DELETE', prefer: 'return=minimal' });
  } catch (e) { errors.push(`asks cleanup: ${e.message}`); }

  // Also delete individually tracked asks
  for (const askId of registry.askIds) {
    try {
      await sb(`asks`, `id=eq.${askId}`, { method: 'DELETE', prefer: 'return=minimal' });
    } catch (e) { /* already gone */ }
  }

  // 5. Delete all test people (sentinel domain)
  try {
    await sb(`people`, `email=like.*%40${TEST_EMAIL_DOMAIN}`, { method: 'DELETE', prefer: 'return=minimal' });
  } catch (e) { errors.push(`people cleanup: ${e.message}`); }

  // 6. Clear registry
  registry.askIds.clear();
  registry.projectIds.clear();
  registry.personIds.clear();

  if (errors.length > 0) {
    console.warn('[cleanup] Some items may not have been deleted:', errors);
  }
}

// ===== NUCLEAR OPTION — wipe ALL test data (use if tests got messy) =====
async function nukeTestData() {
  console.warn('[nuke] Deleting ALL test artifacts...');
  await cleanupTestData();
  // Also catch anything with no email link — projects with test address
  try {
    const testProjects = await sb(`projects`, `address=like.*Pennsylvania+Avenue*`);
    for (const p of (testProjects || [])) {
      registry.projectIds.add(p.id);
    }
    await cleanupTestData();
  } catch (e) {}
  console.warn('[nuke] Done.');
}

// ===== READ HELPERS =====
async function getProject(id) {
  // Try project_summary first (published), fall back to raw projects table
  try {
    const rows = await sb(`project_summary`, `id=eq.${id}`);
    if (rows?.length) return rows[0];
  } catch (e) {}
  try {
    const rows = await sb(`projects`, `id=eq.${id}`);
    return rows?.[0] || null;
  } catch (e) { return null; }
}

async function getProjectTasks(projectId) {
  return sb(`task_detail`, `project_id=eq.${projectId}&order=sequence.asc`);
}

async function getAsk(id) {
  const rows = await sb(`asks`, `id=eq.${id}`);
  return rows?.[0] || null;
}

async function getPendingQueue() {
  return sb(`approval_queue`);
}

module.exports = {
  sb, api, makeAsk, testEmail,
  trackAsk, trackProject, trackPerson,
  cleanupTestData, nukeTestData,
  getProject, getProjectTasks, getAsk, getPendingQueue,
  BASE_URL, SUPABASE_URL, TEST_EMAIL_DOMAIN, TEST_REQUESTER_EMAIL
};
