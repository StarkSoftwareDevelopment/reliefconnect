/**
 * ReliefConnect – Email Alert Function
 * Sends coordinator alerts via SendGrid.
 * Triggered by: bottleneck reports, task review submissions,
 *               new help requests, and mission completions.
 *
 * Environment variables required in Netlify:
 *   SENDGRID_API_KEY   – your SendGrid API key (starts with SG.)
 *   ALERT_FROM_EMAIL   – verified sender email in SendGrid (e.g. alerts@volunteerdisasterrelief.com)
 */

export default async (req) => {
  // Only accept POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { to, type, subject, message, missionTitle, taskTitle, reporter, address } = body;

  if (!to || !type || !message) {
    return new Response(JSON.stringify({ error: 'Missing required fields: to, type, message' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const apiKey = Netlify.env.get('SENDGRID_API_KEY');
  const fromEmail = Netlify.env.get('ALERT_FROM_EMAIL') || 'alerts@volunteerdisasterrelief.com';

  if (!apiKey) {
    console.error('SENDGRID_API_KEY not set');
    return new Response(JSON.stringify({ error: 'Email service not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Build email content based on alert type
  const templates = {
    bottleneck: {
      emoji: '⚠️',
      color: '#B87F1A',
      label: 'BOTTLENECK REPORTED',
      intro: 'A volunteer has reported an obstacle that is blocking progress on a mission. Immediate coordinator attention is needed.'
    },
    review: {
      emoji: '📋',
      color: '#0E6E68',
      label: 'TASK SUBMITTED FOR REVIEW',
      intro: 'A volunteer has submitted a task for coordinator review. Please evaluate against the mission acceptance tests.'
    },
    newask: {
      emoji: '🆘',
      color: '#C0392B',
      label: 'NEW HELP REQUEST',
      intro: 'A new request for disaster relief assistance has been submitted and a mission has been created.'
    },
    missioncomplete: {
      emoji: '✅',
      color: '#1A7A4A',
      label: 'MISSION COMPLETE',
      intro: 'All tasks on a mission have been reviewed and approved. The mission is now marked complete.'
    }
  };

  const tmpl = templates[type] || {
    emoji: '📬',
    color: '#1A2744',
    label: 'RELIEFCONNECT ALERT',
    intro: ''
  };

  const emailSubject = subject || `${tmpl.emoji} ${tmpl.label}${missionTitle ? ': ' + missionTitle : ''}`;

  const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F4F5F7;font-family:Inter,-apple-system,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F5F7;padding:32px 16px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
        <!-- Header -->
        <tr><td style="background:#1A2744;padding:20px 28px;display:flex;align-items:center">
          <div style="color:#fff;font-size:20px;font-weight:700">Relief<span style="color:#F97316">Connect</span></div>
        </td></tr>
        <!-- Alert type banner -->
        <tr><td style="background:${tmpl.color};padding:12px 28px">
          <div style="color:#fff;font-size:13px;font-weight:600;letter-spacing:.06em">${tmpl.emoji} ${tmpl.label}</div>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:28px">
          <p style="margin:0 0 16px;font-size:15px;color:#111827;line-height:1.6">${tmpl.intro}</p>

          ${missionTitle ? `
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;margin-bottom:16px">
            <tr><td style="padding:14px 16px">
              <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#6B7280;margin-bottom:4px">Mission</div>
              <div style="font-size:15px;font-weight:600;color:#111827">${escHtml(missionTitle)}</div>
              ${address ? `<div style="font-size:13px;color:#6B7280;margin-top:4px">📍 ${escHtml(address)}</div>` : ''}
            </td></tr>
          </table>` : ''}

          ${taskTitle ? `
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;margin-bottom:16px">
            <tr><td style="padding:14px 16px">
              <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#6B7280;margin-bottom:4px">Task</div>
              <div style="font-size:14px;font-weight:500;color:#111827">${escHtml(taskTitle)}</div>
            </td></tr>
          </table>` : ''}

          <table width="100%" cellpadding="0" cellspacing="0" style="background:#FEF6E4;border:1px solid #FDE68A;border-radius:8px;margin-bottom:24px">
            <tr><td style="padding:14px 16px">
              <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#B87F1A;margin-bottom:6px">Details</div>
              <div style="font-size:14px;color:#111827;line-height:1.6">${escHtml(message)}</div>
              ${reporter ? `<div style="font-size:12px;color:#6B7280;margin-top:8px">Reported by: ${escHtml(reporter)}</div>` : ''}
            </td></tr>
          </table>

          <a href="https://volunteerdisasterrelief.com" style="display:inline-block;background:#E8521A;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600">Open ReliefConnect →</a>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:16px 28px;border-top:1px solid #E5E7EB">
          <p style="margin:0;font-size:12px;color:#9CA3AF">You're receiving this because you're a project coordinator on ReliefConnect. To change alert preferences, visit <a href="https://volunteerdisasterrelief.com" style="color:#E8521A">volunteerdisasterrelief.com</a> → Settings.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const textBody = `${tmpl.label}\n\n${tmpl.intro}\n\n${missionTitle ? 'Mission: ' + missionTitle + '\n' : ''}${address ? 'Location: ' + address + '\n' : ''}${taskTitle ? 'Task: ' + taskTitle + '\n' : ''}\nDetails: ${message}${reporter ? '\nReported by: ' + reporter : ''}\n\nOpen ReliefConnect: https://volunteerdisasterrelief.com`;

  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: fromEmail, name: 'ReliefConnect' },
        subject: emailSubject,
        content: [
          { type: 'text/plain', value: textBody },
          { type: 'text/html', value: htmlBody }
        ]
      })
    });

    if (response.ok || response.status === 202) {
      console.log(`Alert sent: ${type} → ${to}`);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      const err = await response.text();
      console.error('SendGrid error:', response.status, err);
      return new Response(JSON.stringify({ error: 'SendGrid delivery failed', detail: err }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  } catch (err) {
    console.error('Fetch error:', err);
    return new Response(JSON.stringify({ error: 'Network error sending email' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const config = {
  path: '/api/alert'
};
