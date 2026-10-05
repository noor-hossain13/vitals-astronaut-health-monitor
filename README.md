# VITALS — Astronaut Health Monitor

> A decision-support dashboard that helps astronauts monitor health risks and act early during long-duration space missions.

Built for the **2026 NASA Space Apps Challenge** challenge: **Create Health Monitoring Software for Astronauts on Space Missions**.

Long missions can expose crew members to radiation, isolation and confinement, altered gravity, and a closed environment. VITALS turns mission and health indicators into an understandable, action-oriented view of astronaut wellbeing.

## The challenge

Astronauts on long-duration missions need to recognize changes to their own health and respond before small issues become serious. VITALS provides one place to review key health indicators, identify risks, understand why they matter, and record or escalate a response.

## What VITALS does

- Shows an at-a-glance **mission health overview** across bone, cardiovascular, immune, and behavioral indicators.
- Tracks **radiation exposure** separately against a career dose threshold and identifies elevated-EVA risk.
- Displays vital telemetry including heart rate, SpO₂, temperature, and radiation dose.
- Generates prioritized **mission alerts** with status tracking and flight-surgeon notes.
- Includes realistic scenario modes: **Nominal Cruise**, **Radiation Event**, and **Sleep & Stress Risk**.
- Simulates day-by-day mission progression, history, milestones, and replay.
- Imports CSV telemetry in the format: `day,hr,spo2,temp,rad,sleep,exercise,mood`.
- Provides mission roles, communications, a crew-facing health assistant, and a shareable mission report.
- Supports collaborative persistence and real-time updates when a MySQL database is configured; it remains usable in offline-first mode without one.

## Why it matters

VITALS focuses on the human factors of exploration. Rather than displaying raw measurements alone, it connects trends to practical actions—such as reviewing sleep and stress risk, adjusting exercise, recording a clinical review, or restricting high-radiation activity.

## Tech stack

- **Frontend:** HTML, CSS, and vanilla JavaScript
- **Backend:** Node.js and Express
- **Optional database:** MySQL via `mysql2`
- **Real-time updates:** Server-Sent Events (SSE)

## Run locally

### Prerequisites

- Node.js 18 or newer
- MySQL 8+ (optional; required only for shared persistent data)

### Setup

```bash
npm install
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

If MySQL is not running, the dashboard automatically starts in offline-first mode. The visual dashboard and local simulation remain available; database-backed endpoints will be unavailable.

### Optional MySQL configuration

Create a local `.env` file (never commit it) with your database connection details:

```env
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=vitals_db
```

The server creates the required database tables when it connects.

## Deployment

Deploy the full Node.js application as a **Render Web Service**:

| Setting | Value |
| --- | --- |
| Build command | `npm install` |
| Start command | `npm start` |
| Health check path | `/api/health` |

Set the database environment variables in the hosting dashboard if you use a hosted MySQL instance. Do not put database passwords in GitHub.

> Add the final hosted URL here before submitting: **Live demo: _coming soon_**

## Data and scientific inspiration

The project uses publicly available NASA research context to guide its health indicators and scenario ranges:

- [NASA Open Science Data Repository (OSDR)](https://osdr.nasa.gov/), including Inspiration4-related studies OSD-575 and OSD-656.
- NASA Human Research Program radiation exposure guidance, used to contextualize cumulative radiation risk.
- Spaceflight research on bone density loss, cardiovascular deconditioning, and crew sleep deficiency.

VITALS is a hackathon prototype and educational decision-support interface. It is **not** a medical device and must not be used for clinical diagnosis or treatment.

## Project structure

```text
.
├── assets/           # Visual assets
├── vitals.html       # Dashboard UI and client-side simulation
├── server.js         # Express API, persistence, and real-time updates
├── schema.sql        # Database schema reference
├── package.json      # Scripts and dependencies
└── README.md
```

## Team

**Team name:** QuantumBytes  
**NASA Space Apps Challenge location:** Cumilla

| Team member | Role |
| --- | --- |
| Noor Hossain | Team Leader, Developer, and System Architect |
| Bijoy Kumar Ray | Developer and Security Lead |
| Samiya Anzuman | Documentation Lead |
| MD. Nazmul Islam Hridoy | Researcher |
| Tanjil Al-Nayeef | QA Lead |

## License

Add a license before publishing if you want others to reuse this project (MIT is a common choice for hackathon projects).
