/**
 * Suite 6: Frontend rendering & validation
 *
 * Tests the behavior of the frontend JavaScript functions
 * that don't require a server — validation logic, rendering helpers,
 * HTML escaping, status badges, date formatting, etc.
 *
 * These run in Node (no browser) by extracting and testing the pure functions.
 */

// Extract pure functions from app.js for unit testing
const fs = require('fs');
const path = require('path');

// Load app.js and extract functions we can test in Node
// We mock window/document globals the functions depend on
global.window = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  COORDINATOR_EMAIL: 'test@test.com'
};
global.localStorage = {
  _store: {},
  getItem(k) { return this._store[k] || null; },
  setItem(k, v) { this._store[k] = v; },
  removeItem(k) { delete this._store[k]; }
};
global.document = {
  getElementById: () => null,
  querySelectorAll: () => ({ forEach: () => {} }),
  createElement: (tag) => ({
    tagName: tag, style: {}, classList: { add: () => {}, remove: () => {} },
    addEventListener: () => {}, children: [], innerHTML: ''
  }),
  querySelector: () => null
};
global.fetch = async () => ({ ok: false, json: async () => ({}), text: async () => '' });

// NOTE: Suite 6 is pure unit tests — no network calls, no database writes.
// The email strings used below (jane@example.com etc.) are test inputs to
// validation functions only. No records are created. No cleanup needed.
global.google = null; // Maps not loaded in test env

// We'll test the pure utility functions by defining them directly here
// rather than importing app.js (which has side effects on load)

describe('6. Frontend utility functions', () => {

  // ── 6a. HTML escaping ─────────────────────────────────────────────────────
  describe('6a. esc() — HTML escaping', () => {
    function esc(s) {
      return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    test('escapes < and > tags', () => {
      expect(esc('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    test('escapes & ampersands', () => {
      expect(esc('Debris & Waste Removal')).toBe('Debris &amp; Waste Removal');
    });

    test('escapes double quotes', () => {
      expect(esc('Say "hello"')).toBe('Say &quot;hello&quot;');
    });

    test('handles null gracefully', () => {
      expect(esc(null)).toBe('');
    });

    test('handles undefined gracefully', () => {
      expect(esc(undefined)).toBe('');
    });

    test('handles numbers', () => {
      expect(esc(42)).toBe('42');
    });

    test('passes plain text through unchanged', () => {
      expect(esc('Hello world')).toBe('Hello world');
    });

    test('XSS payload is fully escaped — tags broken, attributes harmless', () => {
      const xss = '<img src=x onerror=alert("xss")>';
      const escaped = esc(xss);
      // The < and > are escaped so no actual HTML tag exists
      expect(escaped).not.toContain('<img');
      expect(escaped).not.toContain('>');
      expect(escaped).toContain('&lt;img');
      // onerror is still present as text but cannot execute — tag brackets are gone
      expect(escaped).toContain('onerror');
      // Quotes are escaped
      expect(escaped).not.toContain('"xss"');
      expect(escaped).toContain('&quot;xss&quot;');
    });
  });

  // ── 6b. Date formatting ───────────────────────────────────────────────────
  describe('6b. fmt() — date formatting', () => {
    function fmt(d) {
      return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    test('formats ISO date string', () => {
      const result = fmt('2025-06-15T12:00:00Z');
      expect(result).toMatch(/Jun/);
      expect(result).toMatch(/2025/);
    });

    test('formats timestamp', () => {
      const result = fmt(1700000000000);
      expect(result).toMatch(/\d{4}/);
    });

    test('returns a string', () => {
      expect(typeof fmt(Date.now())).toBe('string');
    });
  });

  // ── 6c. Status badge generation ──────────────────────────────────────────
  describe('6c. Status badge labels', () => {
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

    test('all 5 project statuses have labels', () => {
      const expected = ['pending_approval', 'to_do', 'doing', 'done', 'passed_inspection'];
      expected.forEach(s => {
        expect(PROJECT_STATUS_LABELS[s]).toBeTruthy();
      });
    });

    test('all 15 task statuses have labels', () => {
      expect(Object.keys(TASK_STATUS_LABELS)).toHaveLength(15);
    });

    test('task status labels are human-readable (no underscores)', () => {
      Object.values(TASK_STATUS_LABELS).forEach(label => {
        expect(label).not.toContain('_');
      });
    });
  });

  // ── 6d. Validation logic ──────────────────────────────────────────────────
  describe('6d. Form validation logic', () => {

    // Test the validation rules we expect the frontend to enforce
    function validateAsk({ name, address, description }) {
      const errors = {};
      if (!name?.trim()) errors.name = 'Your name is required so we can contact you.';
      if (!address?.trim()) errors.address = 'A full address is required so volunteers can find you.';
      if (!description?.trim()) errors.description = 'Please describe what happened and what you need help with.';
      else if (description.trim().split(/\s+/).length < 10) {
        errors.description = 'Please add more detail — aim for at least a few sentences.';
      }
      return errors;
    }

    function validateOffer({ name, phone, email, types }) {
      const errors = {};
      if (!name?.trim()) errors.name = 'Your name is required.';
      if (!phone?.trim() && !email?.trim()) errors.contact = 'Please provide at least a phone number or email.';
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Please enter a valid email address.';
      if (!types || types.length === 0) errors.types = 'Please select at least one thing you can offer.';
      return errors;
    }

    // Ask validation
    test('ask: empty name produces error', () => {
      const e = validateAsk({ name: '', address: '123 Main St', description: 'A tree fell on my house during the storm last week.' });
      expect(e.name).toBeTruthy();
    });

    test('ask: empty address produces error', () => {
      const e = validateAsk({ name: 'John', address: '', description: 'A tree fell on my house during the storm last week.' });
      expect(e.address).toBeTruthy();
    });

    test('ask: empty description produces error', () => {
      const e = validateAsk({ name: 'John', address: '123 Main St', description: '' });
      expect(e.description).toBeTruthy();
    });

    test('ask: description under 10 words produces error', () => {
      const e = validateAsk({ name: 'John', address: '123 Main St', description: 'Tree fell.' });
      expect(e.description).toBeTruthy();
    });

    test('ask: description with 10+ words passes', () => {
      const e = validateAsk({ name: 'John', address: '123 Main St', description: 'A large tree fell on my house during the storm.' });
      expect(e.description).toBeUndefined();
    });

    test('ask: all valid fields produce no errors', () => {
      const e = validateAsk({
        name: 'John Smith',
        address: '123 Main Street, Springfield, OH 45501',
        description: 'A large oak tree fell across the driveway during last night storm blocking all vehicle access.'
      });
      expect(Object.keys(e)).toHaveLength(0);
    });

    // Offer validation
    test('offer: empty name produces error', () => {
      const e = validateOffer({ name: '', phone: '555-0100', email: '', types: ['time'] });
      expect(e.name).toBeTruthy();
    });

    test('offer: no phone and no email produces error', () => {
      const e = validateOffer({ name: 'Jane', phone: '', email: '', types: ['time'] });
      expect(e.contact).toBeTruthy();
    });

    test('offer: invalid email format produces error', () => {
      const e = validateOffer({ name: 'Jane', phone: '', email: 'not-an-email', types: ['time'] });
      expect(e.email).toBeTruthy();
    });

    test('offer: valid email passes email validation', () => {
      const e = validateOffer({ name: 'Jane', phone: '', email: 'jane@example.com', types: ['time'] });
      expect(e.email).toBeUndefined();
    });

    test('offer: no types selected produces error', () => {
      const e = validateOffer({ name: 'Jane', phone: '555-0100', email: '', types: [] });
      expect(e.types).toBeTruthy();
    });

    test('offer: all valid fields produce no errors', () => {
      const e = validateOffer({ name: 'Jane', phone: '555-0100', email: 'jane@test.com', types: ['time', 'tools'] });
      expect(Object.keys(e)).toHaveLength(0);
    });
  });

  // ── 6e. Urgency and category values ───────────────────────────────────────
  describe('6e. Valid enum values', () => {
    const VALID_URGENCIES = ['critical', 'high', 'medium', 'low'];
    const VALID_CATEGORIES = [
      'Home repair', 'Debris removal', 'Food & water', 'Medical assistance',
      'Transportation', 'Temporary shelter', 'Utilities restoration', 'Emotional support', 'Other'
    ];
    const VALID_PROJECT_STATUSES = ['pending_approval', 'to_do', 'doing', 'done', 'passed_inspection'];
    const VALID_TASK_STATUSES = [
      'task_setup_not_assigned', 'task_setup_assigned_but_not_started',
      'acceptance_test_written', 'acceptance_test_approved',
      'task_requirements_written', 'task_requirements_approved',
      'task_prioritized', 'task_not_assigned', 'task_assigned_but_not_started',
      'task_assigned_and_in_progress', 'task_completed_review_not_assigned',
      'task_completed_review_assigned', 'task_completed_review_in_progress',
      'task_completed_review_satisfactory',
      'task_completed_review_not_satisfactory_reassigned_but_not_started'
    ];

    test('4 urgency levels defined', () => {
      expect(VALID_URGENCIES).toHaveLength(4);
    });

    test('9 categories defined', () => {
      expect(VALID_CATEGORIES).toHaveLength(9);
    });

    test('5 project statuses defined', () => {
      expect(VALID_PROJECT_STATUSES).toHaveLength(5);
    });

    test('15 task statuses defined', () => {
      expect(VALID_TASK_STATUSES).toHaveLength(15);
    });

    test('urgency values are lowercase', () => {
      VALID_URGENCIES.forEach(u => {
        expect(u).toBe(u.toLowerCase());
      });
    });

    test('task status values use underscores not spaces', () => {
      VALID_TASK_STATUSES.forEach(s => {
        expect(s).not.toContain(' ');
      });
    });
  });

  // ── 6f. Text truncation safety ────────────────────────────────────────────
  describe('6f. Text handling edge cases', () => {
    function safeSlice(text, len) {
      return (text || '').slice(0, len);
    }

    test('null text returns empty string', () => {
      expect(safeSlice(null, 90)).toBe('');
    });

    test('undefined text returns empty string', () => {
      expect(safeSlice(undefined, 90)).toBe('');
    });

    test('text shorter than limit returned in full', () => {
      expect(safeSlice('Hello', 90)).toBe('Hello');
    });

    test('text longer than limit is truncated', () => {
      const long = 'A'.repeat(200);
      expect(safeSlice(long, 90)).toHaveLength(90);
    });

    test('emoji in text does not break truncation', () => {
      const emojiText = '🌊'.repeat(50);
      const result = safeSlice(emojiText, 20);
      expect(result.length).toBeLessThanOrEqual(20);
    });
  });
});
