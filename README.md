# 🌊 ReliefConnect

**Open-source volunteer disaster relief coordination platform**

ReliefConnect turns disaster help requests into actionable missions that volunteers can find, claim, and complete — with built-in AI-powered scoping, acceptance testing, task review, and real-time progress tracking.

Built by [Stark Software Development](https://github.com/StarkSoftwareDevelopment) · [MIT License](LICENSE)

---

## What it does

When someone submits a help request ("Ask"), ReliefConnect uses Claude AI to automatically:

1. **Write acceptance tests** — defines what "done" looks like ("It would be acceptable if...")
2. **Create a scope of work** — breaks the request into projects and tasks with suggested tools, materials, and labor estimates
3. **Publish a mission** — structured volunteer opportunities that people can search, filter, and sign up for

Volunteers submit text, photos, and video per task. Coordinators review submissions against acceptance tests and approve or fail them. Failed tasks auto-generate correction tasks. Bottleneck reports alert the project manager immediately.

---

## Features

- **Ask for help** — intake form with urgency, category, photos/video, and access notes
- **Offer help** — volunteer registration with skills, credentials, availability, and equipment
- **Find a mission** — searchable, filterable mission board with real-time progress
- **AI mission generation** — Claude creates acceptance tests + full project/task scope from each ask
- **Dual briefing output** — separate human PM briefing and structured AI agent briefing per mission
- **Task submission & review** — volunteers submit updates; coordinators approve or fail against acceptance criteria
- **Auto-correction tasks** — failed reviews automatically create new tasks to fix the issues
- **Bottleneck alerts** — volunteers report obstacles; coordinators are alerted immediately
- **Real-time progress** — mission completion % updates as tasks are reviewed and approved
- **Coordinator dashboard** — bottleneck alerts, review queue, raw asks, volunteer roster
- **Configurable alerts** — set the PM email and alert preferences in Settings

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML/CSS/JS (zero framework dependencies) |
| AI | Anthropic Claude API (`claude-sonnet-4-6`) |
| Server | Node.js + Express (local dev / simple deploy) |
| Storage | `localStorage` (browser) — swap for a database in production |
| Icons | [Tabler Icons](https://tabler.io/icons) |
| Fonts | Inter + DM Serif Display (Google Fonts) |

The app is a single-page application in `public/`. The Node server is only needed to inject your API key safely — in production you can serve `public/` from any static host and proxy the Anthropic API through a backend function.

---

## Getting started locally

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- An [Anthropic API key](https://console.anthropic.com/) (free tier works; required for AI mission generation)
- Git

### 1. Fork and clone the repo

```bash
# Fork the repo on GitHub first, then:
git clone https://github.com/YOUR_USERNAME/reliefconnect.git
cd reliefconnect
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure your environment

```bash
cp .env.example .env
```

Open `.env` and add your Anthropic API key:

```
ANTHROPIC_API_KEY=sk-ant-...
```

> **Security note:** Never commit `.env` to version control. It's already in `.gitignore`.  
> For production deployments, route Anthropic API calls through a backend endpoint rather than exposing the key to the browser.

### 4. Add the config script to index.html

The server injects your API key via `/config.js`. Make sure the following `<script>` tag appears **before** `app.js` in `public/index.html`:

```html
<script src="/config.js"></script>
<script src="app.js"></script>
```

This is already included in the repo — just double-check it's there if you're troubleshooting.

### 5. Start the development server

```bash
npm run dev
```

The app will be available at **http://localhost:3000**

> `npm run dev` uses `nodemon` and auto-restarts when you change server files. For frontend changes, just refresh the browser.

### 6. Load sample data (optional)

Once the app is running:
1. Click **Settings** (gear icon in the nav)
2. Click **Load sample data**

This adds a demo flood-damage mission mid-progress, complete with a bottleneck, a pending review, and an enrolled volunteer — so you can explore every feature without submitting a real request.

---

## Project structure

```
reliefconnect/
├── public/
│   ├── index.html        # Single-page app shell, all HTML and CSS
│   └── app.js            # All application logic (data, rendering, AI calls)
├── server.js             # Express server — serves /public, injects env vars
├── package.json
├── .env.example          # Environment variable template
├── .gitignore
├── LICENSE
└── README.md
```

---

## How to contribute

We welcome contributions of all kinds — bug fixes, features, accessibility improvements, documentation, translations, and design work. Here's how to get involved:

### Before you start

1. **Check [Issues](https://github.com/StarkSoftwareDevelopment/reliefconnect/issues)** — see what's already being worked on or planned. If your idea isn't there, open an issue first to discuss it before writing code.
2. **Read the project structure** above so you know where things live.
3. **Get the app running locally** using the setup steps above.

### Contribution workflow

#### 1. Fork the repo

Click **Fork** on GitHub to create your own copy under your account.

#### 2. Create a branch

Branch names should describe what you're working on:

```bash
git checkout -b fix/bottleneck-modal-escape-key
# or
git checkout -b feature/email-alert-backend
# or
git checkout -b docs/deployment-guide
```

#### 3. Make your changes

- Keep each pull request focused on **one thing**. Smaller PRs are easier to review and faster to merge.
- For UI changes, test in Chrome, Firefox, and Safari if possible.
- For logic changes, make sure the app still works end-to-end: submit an ask, view the generated mission, submit a task update, review it, and fail it to verify correction task creation.
- Don't introduce new dependencies without discussion in an issue first.

#### 4. Test your changes

There's no automated test suite yet (contributions welcome!). For now, manually verify:

- [ ] The three home page flows work (Ask, Offer, Find a mission)
- [ ] AI mission generation works with a valid API key (or gracefully falls back without one)
- [ ] Task submission → coordinator review → approve/fail → correction task creation
- [ ] Bottleneck reporting and coordinator alert
- [ ] Settings save and persist
- [ ] Sample data loads cleanly
- [ ] No console errors

#### 5. Commit with a clear message

```bash
git add .
git commit -m "fix: close bottleneck modal on Escape key press"
```

Follow [Conventional Commits](https://www.conventionalcommits.org/) style if you can:
- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation only
- `style:` — formatting, no logic change
- `refactor:` — code reorganization, no behavior change
- `chore:` — build, dependencies, config

#### 6. Push and open a pull request

```bash
git push origin your-branch-name
```

Then open a pull request on GitHub. In your PR description:
- **What** did you change and why?
- **How** did you test it?
- **Screenshots** for UI changes (before/after is ideal)
- Reference the issue it closes: `Closes #42`

#### 7. Code review

A maintainer will review your PR, leave feedback, and merge it when it's ready. Please be responsive to review comments — PRs that go quiet for 30 days may be closed.

---

## Good first issues

New to the codebase? Look for issues tagged [`good first issue`](https://github.com/StarkSoftwareDevelopment/reliefconnect/issues?q=label%3A%22good+first+issue%22). Some ideas to get you started:

- Add keyboard navigation support (Escape to close modals, etc.)
- Write a deployment guide for Netlify, Vercel, or Render
- Replace `localStorage` with an IndexedDB wrapper for larger datasets
- Add a print/PDF export for mission scopes
- Build an email alert backend using SendGrid or Resend
- Add a real file upload flow using Cloudinary or S3
- Write end-to-end tests with Playwright

---

## Deployment

The `public/` folder is a fully self-contained static site. You can deploy it anywhere:

| Platform | Notes |
|---|---|
| **Netlify** | Drag and drop `public/` or connect your GitHub repo |
| **Vercel** | Set output directory to `public/` |
| **GitHub Pages** | Enable Pages on the repo, point to `/public` |
| **Any VPS** | Run `npm start` and point a reverse proxy (nginx/Caddy) at port 3000 |

For any production deployment, you'll want to:
1. Move the Anthropic API call to a backend function (never expose API keys in browser code)
2. Replace `localStorage` with a real database (Supabase, PlanetScale, or Firebase all work well)
3. Wire up real email alerts (SendGrid, Resend, or AWS SES)
4. Add authentication for the coordinator dashboard

---

## Configuration

All coordinator settings (alert email, PM name, alert preferences) are managed in the **Settings** page inside the app. Changes persist in `localStorage`.

To change the default coordinator email or PM name at the code level, edit the defaults in `public/app.js`:

```js
let DB = {
  settings: {
    email: 'your@email.com',    // ← change this
    pmName: 'Your Name',        // ← and this
    ...
  },
  ...
};
```

---

## Code of conduct

This project is built to help people in crisis. We expect all contributors to treat each other with respect. Be kind, be constructive, and remember why this exists.

If you experience or witness unacceptable behavior, please contact the maintainers.

---

## License

[MIT](LICENSE) — free to use, modify, and distribute. Attribution appreciated but not required.

---

## Acknowledgments

Built with [Claude](https://anthropic.com) by Anthropic · Icons by [Tabler](https://tabler.io) · Fonts by [Google Fonts](https://fonts.google.com)
