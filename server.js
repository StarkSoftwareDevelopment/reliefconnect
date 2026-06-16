/**
 * ReliefConnect – Local development server
 *
 * For production, serve the /public directory with any static host
 * (Netlify, Vercel, GitHub Pages, S3, etc.) and wire up a backend
 * for email alerts and file uploads.
 */

require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from /public
app.use(express.static(path.join(__dirname, 'public')));

// Inject environment variables into the app at runtime
// This keeps API keys out of your source files
app.get('/config.js', (req, res) => {
  res.type('application/javascript');
  // Only expose keys that are safe for the frontend
  // In production, route Anthropic API calls through a backend endpoint instead
  res.send(`window.ANTHROPIC_API_KEY = ${JSON.stringify(process.env.volunteerdisasterrelief_anthropic_api_key || '')};`);
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', version: '1.0.0' }));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🌊 ReliefConnect running at http://localhost:${PORT}\n`);
  if (!process.env.volunteerdisasterrelief_anthropic_api_key) {
    console.warn('⚠️  ANTHROPIC_API_KEY not set — AI mission generation will use fallback mode.');
    console.warn('   Add it to your .env file to enable full AI features.\n');
  }
});
