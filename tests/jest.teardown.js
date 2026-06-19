/**
 * Jest global teardown
 * Runs once after ALL test suites complete.
 * Final safety net — deletes anything with the test email domain
 * that wasn't caught by individual suite cleanups.
 */

require('dotenv').config();
const fetch = require('node-fetch');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_EMAIL_DOMAIN = 'test.reliefconnect.com';

async function sb(table, params, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    method: options.method || 'GET',
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return res;
}

module.exports = async function globalTeardown() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;

  console.log('\n[teardown] Running global test artifact cleanup...');

  try {
    // Find all test people
    const peopleRes = await fetch(
      `${SUPABASE_URL}/rest/v1/people?email=like.*%40${TEST_EMAIL_DOMAIN}&select=id`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        }
      }
    );
    const testPeople = await peopleRes.json();

    // Find all test asks (by sentinel email or name marker)
    const asksRes = await fetch(
      `${SUPABASE_URL}/rest/v1/asks?or=(email.like.*%40${TEST_EMAIL_DOMAIN},name.like.*DO+NOT+CONTACT*)&select=id,project_id`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        }
      }
    );
    const testAsks = await asksRes.json();
    const projectIds = [...new Set((testAsks || []).map(a => a.project_id).filter(Boolean))];

    // Delete child records for each test project
    for (const pid of projectIds) {
      await sb(`task_history`,       `task_id=in.(select id from tasks where project_id='${pid}')`, { method: 'DELETE' });
      await sb(`submissions`,        `task_id=in.(select id from tasks where project_id='${pid}')`, { method: 'DELETE' });
      await sb(`reviews`,            `task_id=in.(select id from tasks where project_id='${pid}')`, { method: 'DELETE' });
      await sb(`bottlenecks`,        `project_id=eq.${pid}`, { method: 'DELETE' });
      await sb(`tasks`,              `project_id=eq.${pid}`, { method: 'DELETE' });
      await sb(`role_assignments`,   `role_id=in.(select id from project_roles where project_id='${pid}')`, { method: 'DELETE' });
      await sb(`project_roles`,      `project_id=eq.${pid}`, { method: 'DELETE' });
      await sb(`project_volunteers`, `project_id=eq.${pid}`, { method: 'DELETE' });
      await sb(`projects`,           `id=eq.${pid}`,          { method: 'DELETE' });
    }

    // Delete test asks
    await sb(`asks`, `or=(email.like.*%40${TEST_EMAIL_DOMAIN},name.like.*DO+NOT+CONTACT*)`, { method: 'DELETE' });

    // Delete all people with test domain (must be last — FK refs cleared above)
    const deleted = await sb(`people`, `email=like.*%40${TEST_EMAIL_DOMAIN}`, { method: 'DELETE' });

    const peopleCount = testPeople?.length || 0;
    const projectCount = projectIds.length;
    console.log(`[teardown] Cleaned up ${projectCount} project(s), ${peopleCount} test person(s).`);
  } catch (e) {
    console.warn('[teardown] Cleanup error (non-fatal):', e.message);
  }
};
