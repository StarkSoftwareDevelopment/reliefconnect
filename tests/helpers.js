/**
 * ReliefConnect Test Helpers
 * Shared utilities for all test suites.
 * Tests run against the live Supabase instance using the service role key,
 * so they test real database behavior, not mocks.
 */

require('dotenv').config();
const fetch = require('node-fetch');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Base URL for Netlify functions — set TEST_BASE_URL to your preview URL
// e.g. TEST_BASE_URL=https://deploy-preview-1--relief-connect-app.netlify.app
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

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
function makeAsk(overrides = {}) {
  return {
    name: 'Test Requester',
    phone: '(555) 555-0001',
    email: 'test@reliefconnect-test.com',
    address: '1600 Pennsylvania Avenue NW, Washington, DC 20500',
    description: 'A large tree fell across the driveway during last night\'s storm. The trunk is approximately 18 inches in diameter and 40 feet long. It is blocking vehicle access completely. There are multiple large branches scattered across the front yard. No power lines involved. Gate code is 1234.',
    category: 'Debris removal',
    urgency: 'high',
    people_count: '3',
    access_notes: 'Gate code 1234. Dog secured indoors.',
    ...overrides
  };
}

// ===== CLEANUP HELPERS =====
// Track created IDs so we can clean up after each test
const createdIds = { asks: [], projects: [], people: [], tasks: [] };

function trackAsk(id) { createdIds.asks.push(id); }
function trackProject(id) { createdIds.projects.push(id); }
function trackPerson(id) { createdIds.people.push(id); }

async function cleanupTestData() {
  // Delete in FK-safe order
  for (const projectId of createdIds.projects) {
    try {
      await sb(`tasks`, `project_id=eq.${projectId}`, { method: 'DELETE', prefer: 'return=minimal' });
      await sb(`project_roles`, `project_id=eq.${projectId}`, { method: 'DELETE', prefer: 'return=minimal' });
      await sb(`bottlenecks`, `project_id=eq.${projectId}`, { method: 'DELETE', prefer: 'return=minimal' });
      await sb(`projects`, `id=eq.${projectId}`, { method: 'DELETE', prefer: 'return=minimal' });
    } catch (e) { /* already deleted */ }
  }
  for (const askId of createdIds.asks) {
    try {
      await sb(`asks`, `id=eq.${askId}`, { method: 'DELETE', prefer: 'return=minimal' });
    } catch (e) {}
  }
  // Don't delete people — they accumulate and that's fine for test users
  createdIds.asks.length = 0;
  createdIds.projects.length = 0;
  createdIds.people.length = 0;
  createdIds.tasks.length = 0;
}

// ===== SUPABASE READ HELPERS =====
async function getProject(id) {
  const rows = await sb(`project_summary`, `id=eq.${id}`);
  return rows?.[0] || null;
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
  sb, api, makeAsk, trackAsk, trackProject, trackPerson,
  cleanupTestData, getProject, getProjectTasks, getAsk,
  getPendingQueue, BASE_URL, SUPABASE_URL
};
