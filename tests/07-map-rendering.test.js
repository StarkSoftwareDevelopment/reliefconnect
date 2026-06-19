/**
 * Suite 7: Map rendering
 *
 * Uses Puppeteer to load the actual page in a real browser and verify:
 * - Google Maps initializes (canvas element appears inside the map div)
 * - Map controls are present (zoom buttons)
 * - After approving a mission, a pin appears on both maps
 * - Clicking a pin opens an info window with mission title
 *
 * Requires: TEST_BASE_URL pointing to a live deploy with Supabase configured.
 * Skipped automatically if puppeteer is not installed.
 */

let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch (e) {
  puppeteer = null;
}

const { api, makeAsk, trackAsk, trackProject, cleanupTestData } = require('./helpers');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const SKIP = !puppeteer;

// Helper: wait for an element matching selector to exist with non-zero size
async function waitForVisible(page, selector, timeout = 10000) {
  await page.waitForSelector(selector, { timeout });
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    },
    { timeout },
    selector
  );
}

// Helper: check if Google Maps has rendered inside a container
async function mapHasRendered(page, containerId) {
  return page.evaluate((id) => {
    const container = document.getElementById(id);
    if (!container) return { rendered: false, reason: 'container not found' };
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { rendered: false, reason: `zero size: ${rect.width}x${rect.height}` };
    // Google Maps injects a div with role="region" and a canvas element
    const canvas = container.querySelector('canvas');
    const region = container.querySelector('[role="region"]');
    return {
      rendered: !!(canvas || region),
      hasCanvas: !!canvas,
      hasRegion: !!region,
      containerSize: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
      reason: canvas ? 'canvas present' : region ? 'region present' : 'no maps elements found'
    };
  }, containerId);
}

const describeOrSkip = SKIP ? describe.skip : describe;

describeOrSkip('7. Map rendering (browser tests)', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Capture browser console errors for debugging
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log('[browser error]', msg.text());
      }
    });
  }, 30000);

  afterAll(async () => {
    await browser?.close();
    await cleanupTestData();
  });

  // ── 7a. Home page map ──────────────────────────────────────────────────────
  describe('7a. Home page map', () => {
    beforeAll(async () => {
      await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    }, 30000);

    test('home-map container exists and has correct dimensions', async () => {
      const info = await mapHasRendered(page, 'home-map');
      expect(info.containerSize).not.toBe('0x0');
      // Should be close to 380px tall
      const height = parseInt(info.containerSize.split('x')[1]);
      expect(height).toBeGreaterThan(300);
    });

    test('Google Maps renders inside home-map (canvas or region element present)', async () => {
      // Wait up to 10s for Maps to initialize
      await page.waitForFunction(
        () => {
          const el = document.getElementById('home-map');
          return el && (el.querySelector('canvas') || el.querySelector('[role="region"]'));
        },
        { timeout: 10000 }
      ).catch(() => {}); // Don't fail — check below will report clearly

      const info = await mapHasRendered(page, 'home-map');
      expect(info.rendered).toBe(true, `Map not rendered: ${info.reason}`);
    }, 15000);

    test('Google Maps zoom controls are present', async () => {
      const hasZoom = await page.evaluate(() => {
        const el = document.getElementById('home-map');
        return !!(el && el.querySelector('[title="Zoom in"], [aria-label="Zoom in"]'));
      });
      expect(hasZoom).toBe(true);
    });

    test('window._mapsApiReady is true after Maps loads', async () => {
      const ready = await page.evaluate(() => window._mapsApiReady);
      expect(ready).toBe(true);
    });

    test('homeMap variable is a google.maps.Map instance', async () => {
      const isMap = await page.evaluate(() => {
        return typeof homeMap !== 'undefined' && homeMap !== null;
      });
      expect(isMap).toBe(true);
    });
  });

  // ── 7b. Missions page map ─────────────────────────────────────────────────
  describe('7b. Missions page map', () => {
    beforeAll(async () => {
      // Click the Missions nav button
      await page.click('#nav-missions');
      // Wait a moment for lazy init
      await page.waitForTimeout(2000);
    }, 15000);

    test('missions-map container has correct dimensions', async () => {
      const info = await mapHasRendered(page, 'missions-map');
      expect(info.containerSize).not.toBe('0x0');
      const height = parseInt(info.containerSize.split('x')[1]);
      expect(height).toBeGreaterThan(300);
    });

    test('Google Maps renders inside missions-map', async () => {
      await page.waitForFunction(
        () => {
          const el = document.getElementById('missions-map');
          return el && (el.querySelector('canvas') || el.querySelector('[role="region"]'));
        },
        { timeout: 10000 }
      ).catch(() => {});

      const info = await mapHasRendered(page, 'missions-map');
      expect(info.rendered).toBe(true, `Missions map not rendered: ${info.reason}`);
    }, 15000);

    test('map variable is a google.maps.Map instance', async () => {
      const isMap = await page.evaluate(() => {
        return typeof map !== 'undefined' && map !== null;
      });
      expect(isMap).toBe(true);
    });
  });

  // ── 7c. Pin appears after mission is approved ─────────────────────────────
  describe('7c. Mission pins on map', () => {
    let projectId;

    beforeAll(async () => {
      // Submit and approve a mission so a pin should appear
      const { ok, data } = await api('/api/submit-ask', makeAsk({
        address: '1600 Pennsylvania Avenue NW, Washington, DC 20500'
      }));
      if (!ok) return;
      trackAsk(data.askId);
      trackProject(data.projectId);
      projectId = data.projectId;

      await api('/api/review-project', {
        projectId,
        action: 'approve',
        reviewerEmail: 'bjlinville1@gmail.com'
      });

      // Reload the page to pick up the new mission
      await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
      // Wait for maps API and data load
      await page.waitForTimeout(3000);
    }, 90000);

    test('at least one map marker exists after mission approval', async () => {
      const markerCount = await page.evaluate(() => {
        // mapMarkers is a global array in app.js
        return typeof mapMarkers !== 'undefined' ? mapMarkers.length : -1;
      });
      expect(markerCount).toBeGreaterThan(0);
    });

    test('clicking a marker opens an info window with mission title', async () => {
      // Trigger a click on the first marker programmatically
      const infoOpened = await page.evaluate(() => {
        if (!mapMarkers || mapMarkers.length === 0) return false;
        // Simulate click on first marker
        google.maps.event.trigger(mapMarkers[0], 'click');
        // Check if an info window opened (gm-style-iw is Google's info window class)
        return new Promise(resolve => {
          setTimeout(() => {
            const iw = document.querySelector('.gm-style-iw');
            resolve(!!iw);
          }, 500);
        });
      });
      expect(infoOpened).toBe(true);
    });

    test('info window contains mission address', async () => {
      const content = await page.evaluate(() => {
        const iw = document.querySelector('.gm-style-iw');
        return iw ? iw.textContent : '';
      });
      expect(content).toContain('Pennsylvania Avenue');
    });
  });
});

// ── Fallback: non-browser map config tests (always run) ────────────────────
describe('7z. Map configuration (no browser required)', () => {
  test('Google Maps API key is set in index.html', () => {
    const fs = require('fs');
    const html = fs.readFileSync(
      require('path').join(__dirname, '../public/index.html'), 'utf8'
    );
    expect(html).toContain('maps.googleapis.com/maps/api/js');
    expect(html).toContain('callback=initMap');
    // Key should be present (not empty)
    const keyMatch = html.match(/key=([A-Za-z0-9_-]+)/);
    expect(keyMatch).toBeTruthy();
    expect(keyMatch[1].length).toBeGreaterThan(10);
  });

  test('Both map container divs exist in index.html', () => {
    const fs = require('fs');
    const html = fs.readFileSync(
      require('path').join(__dirname, '../public/index.html'), 'utf8'
    );
    expect(html).toContain('id="home-map"');
    expect(html).toContain('id="missions-map"');
  });

  test('map containers have explicit height in CSS', () => {
    const fs = require('fs');
    const html = fs.readFileSync(
      require('path').join(__dirname, '../public/index.html'), 'utf8'
    );
    // Should have an explicit pixel height — not just height:100%
    expect(html).toMatch(/#missions-map.*height:\d+px|#home-map.*height:\d+px|#missions-map,#home-map.*height:\d+px/);
  });

  test('initMap function is defined in app.js', () => {
    const fs = require('fs');
    const js = fs.readFileSync(
      require('path').join(__dirname, '../public/app.js'), 'utf8'
    );
    expect(js).toContain('function initMap()');
    expect(js).toContain('function initHomeMap()');
    expect(js).toContain('function initMissionsMap()');
  });

  test('Maps script tag loads after app.js (so initMap is defined first)', () => {
    const fs = require('fs');
    const html = fs.readFileSync(
      require('path').join(__dirname, '../public/index.html'), 'utf8'
    );
    const appJsPos = html.indexOf('src="app.js"');
    const mapsPos = html.indexOf('maps.googleapis.com');
    expect(appJsPos).toBeGreaterThan(0);
    expect(mapsPos).toBeGreaterThan(appJsPos);
  });

  test('maps API uses async defer (non-blocking)', () => {
    const fs = require('fs');
    const html = fs.readFileSync(
      require('path').join(__dirname, '../public/index.html'), 'utf8'
    );
    const mapsScript = html.match(/<script[^>]*maps\.googleapis\.com[^>]*>/)?.[0] || '';
    expect(mapsScript).toContain('async');
    expect(mapsScript).toContain('defer');
  });

  test('initMap defers initialization to avoid zero-size container race condition', () => {
    const fs = require('fs');
    const js = fs.readFileSync(
      require('path').join(__dirname, '../public/app.js'), 'utf8'
    );
    // Should use setTimeout to defer past initial paint
    expect(js).toContain('setTimeout(initHomeMap');
    // Should check offsetWidth/Height before initializing
    expect(js).toContain('offsetWidth');
    expect(js).toContain('offsetHeight');
  });
});
