require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Inject public config (anon key is safe for browser)
app.get('/config.js', (req, res) => {
  res.type('application/javascript');
  res.send(`
window.SUPABASE_URL = ${JSON.stringify(process.env.SUPABASE_URL || '')};
window.SUPABASE_ANON_KEY = ${JSON.stringify(process.env.SUPABASE_ANON_KEY || '')};
window.COORDINATOR_EMAIL = ${JSON.stringify(process.env.COORDINATOR_EMAIL || 'bjlinville1@gmail.com')};
window.GOOGLE_MAPS_KEY = ${JSON.stringify(process.env.GOOGLE_MAPS_KEY || '')};
  `);
});

app.get('/health', (req, res) => res.json({ status: 'ok', version: '2.0.0' }));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🌊 ReliefConnect running at http://localhost:${PORT}\n`);
  const missing = ['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY']
    .filter(k => !process.env[k]);
  if (missing.length) console.warn('⚠️  Missing env vars:', missing.join(', '));
});
