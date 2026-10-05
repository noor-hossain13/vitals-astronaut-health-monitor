(function(){
  const TOTAL_DAYS = 180;
  const indicators = ['bone','cardio','immune','radiation','behavioral'];
  const meta = {
    bone: { label: 'BONE DENSITY', full: 'Bone Mineral Density', unit: '%', start: 100, sub: 'Weight-bearing bone density (hip/spine), relative to pre-mission baseline. Source: NASA-funded bone loss research (Lang et al. 2004; LeBlanc et al.), linked via OSDR.' },
    cardio: { label: 'CARDIOVASCULAR', full: 'Cardiovascular Status', unit: '%', start: 100, sub: 'Cardiovascular conditioning score — deconditioning and orthostatic intolerance risk. Source: Hughson et al. 2012; OSDR Inspiration4 cardiac cytokine data (OSD-575).' },
    immune: { label: 'IMMUNE/INFLAMM.', full: 'Immune & Inflammation', unit: '%', start: 100, sub: 'Immune system stability — inflammatory marker trend (lower is more inflamed). Source: OSDR Inspiration4 immune/inflammation panels (OSD-575, OSD-656).' },
    radiation: { label: 'RADIATION DOSE', full: 'Cumulative Radiation Dose', unit: 'mSv', start: 0, sub: 'Cumulative career radiation exposure against the NASA HRP ~600 mSv limit.' },
    behavioral: { label: 'BEHAVIORAL HEALTH', full: 'Behavioral Health', unit: '%', start: 100, sub: 'Mood, sleep quality, and isolation/confinement risk. Source: NASA HRP Behavioral Health & Performance standards; Barger et al. 2014.' }
  };

  // ---- Settings ----
  const settings = {
    theme: localStorage.getItem('vitals_theme') || 'dark',
    sound: localStorage.getItem('vitals_sound') !== '0',
    reduceMotion: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  };
  let appRole = localStorage.getItem('vitals_role') || 'crew';
  document.documentElement.setAttribute('data-theme', settings.theme);
  document.body.dataset.role = appRole;
  if (settings.reduceMotion) document.body.classList.add('reduce-motion');

  // ---- Achievements ----
  const achievements = {
    firstDay:   { icon: '🚀', name: 'First Step',       desc: 'Complete your first mission day.' },
    streak7:    { icon: '🏅', name: 'Steady Hands',     desc: '7 consecutive nominal days.' },
    streak30:   { icon: '🥇', name: 'Iron Will',        desc: '30 consecutive nominal days.' },
    missionHalf:{ icon: '🌗', name: 'Halfway There',    desc: 'Reach Day 90.' },
    missionDone:{ icon: '🏆', name: 'Mission Complete', desc: 'Complete all 180 days.' },
    boneKeeper: { icon: '🦴', name: 'Bone Keeper',      desc: 'Keep bone density ≥ 95% for 30 days.' },
    radMiser:   { icon: '☢️', name: 'Radiation Miser',  desc: 'Stay under 100 mSv for 60 days.' },
    flawless:   { icon: '💎', name: 'Flawless',         desc: 'Reach Day 90 with no critical alert.' },
    evaVet:     { icon: '👨‍🚀', name: 'EVA Veteran',    desc: 'Complete 5 EVA days.' },
    comms10:    { icon: '💬', name: 'Communicator',     desc: 'Send 10 comms messages.' }
  };
  let unlocked = new Set();
  let evaCount = 0, commsSent = 0, critAlertSeen = false;

  // ---- State ----
  let state = { day: 0, history: {}, current: {} };
  indicators.forEach(k => { state.current[k] = meta[k].start; state.history[k] = [meta[k].start]; });

  let activeIndicator = 'bone';
  let compareIndicator = null;
  let trendRange = 'full';
  let telemetry = [];
  let missionStartMs = Date.now();
  let alertsHistory = [];
  let prevStatus = { bone: 'ok', cardio: 'ok', immune: 'ok', radiation: 'ok', behavioral: 'ok' };
  let undoStack = [];
  let radMilestoneHit = false;
  let activeDayForRestore = null;

  // ---- Persistence ----
  const MISSION_ID = 'default';
  const DB_API = `/api/mission-state/${MISSION_ID}`;
  const DB_STREAM = `${DB_API}/stream`;
  const REALTIME_CLIENT_ID = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  let dbSaveTimer = null;
  let lastPersistedAt = 0;
  let realtimeErrorToastAt = 0;
  let dbOnline = true;
  let presenceUsers = [];
  let replayTimer = null;
  let replayDay = null;
  let dataSourceMode = localStorage.getItem('vitals_source_mode') || 'simulation';
  let authUser = (() => {
    try { return JSON.parse(localStorage.getItem('vitals_auth_user') || 'null'); }
    catch(e) { return null; }
  })();
  let surgeonNotes = [];

  function readOfflineQueue() {
    try { return JSON.parse(localStorage.getItem('vitals_offline_queue') || '[]'); }
    catch(e) { return []; }
  }

  function writeOfflineQueue(queue) {
    localStorage.setItem('vitals_offline_queue', JSON.stringify(queue.slice(-12)));
  }

  function queueOfflinePayload(payload) {
    const queue = readOfflineQueue();
    queue.push(payload);
    writeOfflineQueue(queue);
    renderOperations();
  }

  function missionPayload() {
    const persistedAt = Date.now();
    return {
      day: state.day, current: state.current, history: state.history,
      telemetry, alertsHistory, commsThread, unlocked: [...unlocked],
      surgeonNotes, dataSourceMode, authUser,
      evaCount, commsSent, critAlertSeen, radMilestoneHit,
      unreadComms, cleanStreak, bestStreak, worstDayStreak,
      crewName: document.getElementById('crewName').value,
      persistedAt,
      sourceClientId: REALTIME_CLIENT_ID
    };
  }

  function applyMissionPayload(s) {
    state.day = s.day || 0;
    state.current = s.current || state.current;
    state.history = s.history || state.history;
    telemetry = s.telemetry || [];
    alertsHistory = s.alertsHistory || [];
    commsThread = s.commsThread || [];
    surgeonNotes = s.surgeonNotes || [];
    dataSourceMode = s.dataSourceMode || dataSourceMode;
    authUser = s.authUser || authUser;
    unlocked = new Set(s.unlocked || []);
    evaCount = s.evaCount || 0;
    commsSent = s.commsSent || 0;
    critAlertSeen = s.critAlertSeen || false;
    radMilestoneHit = s.radMilestoneHit || false;
    unreadComms = s.unreadComms || 0;
    cleanStreak = s.cleanStreak || 0;
    bestStreak = s.bestStreak || 0;
    worstDayStreak = s.worstDayStreak || 0;
    lastPersistedAt = Math.max(lastPersistedAt, s.persistedAt || 0);
    if (s.crewName) document.getElementById('crewName').value = s.crewName;
  }

  function syncStateToDatabase(payload) {
    if (!location.protocol.startsWith('http')) return;
    clearTimeout(dbSaveTimer);
    lastPersistedAt = Math.max(lastPersistedAt, payload.persistedAt || 0);
    dbSaveTimer = setTimeout(() => {
      fetch(DB_API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(res => {
        dbOnline = res.ok;
        if (!res.ok) queueOfflinePayload(payload);
        renderOperations();
      }).catch(() => {
        dbOnline = false;
        queueOfflinePayload(payload);
      });
    }, 250);
  }

  async function flushOfflineQueue() {
    if (!location.protocol.startsWith('http')) return;
    const queue = readOfflineQueue();
    if (!queue.length) { renderOperations(); return; }
    const latest = queue[queue.length - 1];
    try {
      const res = await fetch(DB_API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(latest)
      });
      if (!res.ok) throw new Error('Sync failed');
      writeOfflineQueue([]);
      dbOnline = true;
      pushToast('Offline mission changes synced to database.', 'ok');
    } catch(e) {
      dbOnline = false;
    }
    renderOperations();
  }

  async function loadStateFromDatabase() {
    if (!location.protocol.startsWith('http')) return false;
    try {
      const res = await fetch(DB_API);
      if (res.status === 404) return false;
      if (!res.ok) throw new Error('Database load failed');
      const data = await res.json();
      if (!data.payload) return false;
      applyMissionPayload(data.payload);
      localStorage.setItem('vitals_state', JSON.stringify(data.payload));
      return true;
    } catch(e) {
      return false;
    }
  }

  function refreshFromPersistedState() {
    buildCards();
    renderAll();
    renderPreview();
    renderStreaks();
    renderComms();
    updateAssistantStats();
    const badge = document.getElementById('commsBadge');
    if (badge) {
      badge.textContent = unreadComms;
      badge.style.display = unreadComms ? 'inline-block' : 'none';
    }
    if (telemetry.length) {
      document.getElementById('telemetryBody').innerHTML = telemetry.map(f => `<tr><td>${f.day}</td><td>${f.hr}</td><td>${f.spo2}</td><td>${f.temp}</td><td>${f.rad}</td></tr>`).join('');
    } else {
      document.getElementById('telemetryBody').innerHTML = '';
    }
    els.advanceBtn.textContent = `LOG DAY ${state.day + 1} & ADVANCE`;
  }

  function resetMissionUi(message) {
    state.day = 0;
    indicators.forEach(k => { state.current[k] = meta[k].start; state.history[k] = [meta[k].start]; prevStatus[k] = 'ok'; });
    telemetry = []; alertsHistory = []; commsThread = []; surgeonNotes = []; unreadComms = 0;
    cleanStreak = 0; bestStreak = 0; worstDayStreak = 0; undoStack = [];
    unlocked = new Set(); evaCount = 0; commsSent = 0; critAlertSeen = false; radMilestoneHit = false;
    renderStreaks();
    document.getElementById('riskDetail').textContent = "Advance a few mission days, then click a cell to see that day's readings.";
    document.getElementById('focusPanel').className = 'panel focus-panel';
    document.getElementById('focusText').textContent = 'Advance a mission day to get a priority recommendation.';
    document.getElementById('commsBadge').style.display = 'none';
    document.getElementById('telemetryBody').innerHTML = '';
    renderComms();
    els.eventLine.textContent = message || 'Systems reset. Mission restarting from Day 0.';
    els.eventLine.classList.remove('warn');
    els.advanceBtn.textContent = 'LOG DAY 1 & ADVANCE';
    renderAll();
  }

  function connectRealtimeDatabase() {
    if (!location.protocol.startsWith('http') || !window.EventSource) return;
    const stream = new EventSource(DB_STREAM);
    stream.addEventListener('state', (event) => {
      try {
        const data = JSON.parse(event.data);
        const payload = data.payload;
        if (!payload || payload.sourceClientId === REALTIME_CLIENT_ID) return;
        if (payload.persistedAt && payload.persistedAt <= lastPersistedAt) return;
        applyMissionPayload(payload);
        localStorage.setItem('vitals_state', JSON.stringify(payload));
        refreshFromPersistedState();
        pushToast('Realtime mission state synced from database.', 'ok');
      } catch(e) {}
    });
    stream.addEventListener('reset', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.sourceClientId === REALTIME_CLIENT_ID) return;
      } catch(e) {}
      localStorage.removeItem('vitals_state');
      resetMissionUi('Realtime reset received. Mission restarting from Day 0.');
      pushToast('Mission reset synced from database.', 'watch');
    });
    stream.addEventListener('presence', (event) => {
      try {
        const data = JSON.parse(event.data);
        presenceUsers = data.users || [];
        renderOperations();
      } catch(e) {}
    });
    stream.onerror = () => {
      const now = Date.now();
      if (now - realtimeErrorToastAt > 10000) {
        realtimeErrorToastAt = now;
        pushToast('Realtime database link is reconnecting.', 'watch');
      }
    };
  }

  function setRole(role, persist = true) {
    appRole = role || 'crew';
    document.body.dataset.role = appRole;
    if (persist) localStorage.setItem('vitals_role', appRole);
    document.querySelectorAll('#roleSwitch button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.role === appRole);
    });
    renderOperations();
    postPresence();
  }

  function roleBriefText() {
    const weakest = weakestSignal();
    const briefs = {
      crew: [
        ['PRIMARY VIEW', 'Daily actions, check-ins, personal trend awareness.'],
        ['NEXT ACTION', actionFor(weakest.key)]
      ],
      surgeon: [
        ['PRIMARY VIEW', 'Clinical risk review, unresolved alerts, and radiation margin.'],
        ['WATCH ITEM', `${meta[weakest.key].label}: ${weakest.status.toUpperCase()}`]
      ],
      ground: [
        ['PRIMARY VIEW', 'Realtime coordination, comms, structured database health, report export.'],
        ['SYNC STATUS', dbOnline ? 'Database link nominal' : 'Using offline queue']
      ],
      admin: [
        ['PRIMARY VIEW', 'Full mission administration, all permissions, database structure, and report controls.'],
        ['SYSTEM STATE', dbOnline ? 'Database writable' : 'Offline-first fallback active']
      ]
    };
    return briefs[appRole] || briefs.crew;
  }

  function actionFor(key) {
    const actions = {
      bone: 'Increase resistive exercise and track ARED completion.',
      cardio: 'Add controlled cardio intervals and watch orthostatic symptoms.',
      immune: 'Prioritize sleep/rest and flag inflammation trend if persistent.',
      radiation: 'Minimize EVA exposure and use shielded cabin zones.',
      behavioral: 'Schedule support contact and stabilize sleep timing.'
    };
    return actions[key] || 'Continue nominal protocol.';
  }

  function weakestSignal() {
    const scored = indicators.map(key => {
      const value = state.current[key];
      const score = key === 'radiation' ? Math.max(0, 100 - (value / 600) * 100) : value;
      return { key, value, score, status: statusFor(key, value) };
    }).sort((a, b) => a.score - b.score);
    return scored[0];
  }

  function forecastSignal(key, days) {
    const hist = state.history[key] || [];
    const current = state.current[key];
    const sample = hist.slice(-8);
    let slope = 0;
    if (sample.length >= 2) slope = (sample[sample.length - 1] - sample[0]) / (sample.length - 1);
    const fallback = key === 'radiation' ? 0.55 : key === 'bone' ? -0.18 : -0.08;
    const projected = current + (slope || fallback) * days;
    const clamped = key === 'radiation' ? Math.max(0, Math.min(650, projected)) : Math.max(0, Math.min(100, projected));
    return { key, days, value: clamped, status: statusFor(key, clamped) };
  }

  function renderOperations() {
    renderAuthControls();
    const roleBrief = document.getElementById('roleBrief');
    if (roleBrief) {
      roleBrief.innerHTML = roleBriefText().map(([k, v]) =>
        `<div class="ops-card"><div class="k">${k}</div><div class="v">${v}</div></div>`
      ).join('');
    }
    document.querySelectorAll('#roleSwitch button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.role === appRole);
    });

    const presenceEl = document.getElementById('presenceList');
    if (presenceEl) {
      const users = presenceUsers.length ? presenceUsers : [{ role: authUser?.role || appRole, name: authUser?.name || 'This device', clientId: REALTIME_CLIENT_ID, lastSeen: Date.now() }];
      presenceEl.innerHTML = users.map(user =>
        `<div class="presence-item"><span class="presence-dot"></span><div><div class="k">${(user.role || 'crew').toUpperCase()}</div><div class="v">${user.name || 'Operator'}</div></div><span class="presence-age">${presenceAge(user.lastSeen)}</span></div>`
      ).join('');
    }

    const forecastEl = document.getElementById('forecastGrid');
    if (forecastEl) {
      const horizons = [7, 30];
      forecastEl.innerHTML = indicators.flatMap(key => horizons.map(days => forecastSignal(key, days))).map(item => {
        const unit = item.key === 'radiation' ? ' mSv' : '%';
        return `<div class="forecast-card ${item.status}"><div class="k">${meta[item.key].label}</div><div class="v">${Math.round(item.value)}${unit}</div><div class="horizon">DAY +${item.days} ${item.status.toUpperCase()}</div></div>`;
      }).join('');
    }

    const syncEl = document.getElementById('syncGrid');
    if (syncEl) {
      const queue = readOfflineQueue();
      syncEl.innerHTML = [
        ['DATABASE', dbOnline ? 'ONLINE' : 'OFFLINE / RETRYING'],
        ['OFFLINE QUEUE', `${queue.length} pending save${queue.length === 1 ? '' : 's'}`],
        ['LAST SAVE', lastPersistedAt ? new Date(lastPersistedAt).toLocaleTimeString() : 'Not saved yet']
      ].map(([k, v]) => `<div class="sync-item"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
    }

    const slider = document.getElementById('replaySlider');
    if (slider) {
      slider.max = Math.max(0, state.day);
      if (replayDay === null) slider.value = state.day;
      document.getElementById('replayLabel').textContent = replayDay === null ? `Day ${state.day}` : `Replay Day ${replayDay}`;
    }
    renderSourceMode();
    renderSurgeonNotes();
  }

  function presenceAge(lastSeen) {
    if (!lastSeen) return 'synced now';
    const seconds = Math.max(0, Math.round((Date.now() - lastSeen) / 1000));
    if (seconds < 4) return 'online now';
    if (seconds < 60) return `synced ${seconds}s ago`;
    return `synced ${Math.round(seconds / 60)}m ago`;
  }

  function renderAuthControls() {
    const status = document.getElementById('authStatus');
    const loginName = document.getElementById('loginName');
    const loginRole = document.getElementById('loginRole');
    if (loginName && authUser?.name) loginName.value = authUser.name;
    if (loginRole && authUser?.role) loginRole.value = authUser.role;
    document.body.dataset.authRole = authUser?.role || appRole;
    if (status) {
      status.textContent = authUser
        ? `Signed in as ${authUser.name || 'Operator'} (${(authUser.role || appRole).toUpperCase()}). Permission profile is active in this demo.`
        : 'Not signed in. Demo permissions are local to this browser.';
    }

    const canWriteNotes = ['surgeon', 'admin'].includes(authUser?.role || appRole);
    ['noteAlertSelect', 'noteStatus', 'noteSeverity', 'noteText', 'addNoteBtn'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = !canWriteNotes;
    });
    const reportBtn = document.getElementById('reportBtn');
    if (reportBtn) reportBtn.disabled = authUser && !['ground', 'admin', 'surgeon'].includes(authUser.role);
  }

  function renderSourceMode() {
    document.querySelectorAll('#sourceModeSwitch button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.sourceMode === dataSourceMode);
    });
    const status = document.getElementById('sourceModeStatus');
    if (!status) return;
    const importedDays = telemetry.length ? `${Math.min(...telemetry.map(f => f.day))}-${Math.max(...telemetry.map(f => f.day))}` : 'none';
    const copy = {
      simulation: 'Simulation mode is active. Daily check-ins generate the next telemetry frame.',
      imported: `Imported CSV mode is active. Next days will prefer imported telemetry (${importedDays}).`,
      hybrid: `Hybrid mode is active. Simulation runs first, then imported telemetry corrects matching days (${importedDays}).`
    };
    status.textContent = copy[dataSourceMode] || copy.simulation;
  }

  function renderSurgeonNotes() {
    const select = document.getElementById('noteAlertSelect');
    if (select) {
      const options = alertsHistory.length
        ? alertsHistory.map((a, i) => `<option value="${i}">Day ${a.day} - ${a.sev.toUpperCase()} - ${a.text.slice(0, 54)}</option>`)
        : ['<option value="-1">No alerts yet - general note</option>'];
      select.innerHTML = options.join('');
    }
    const list = document.getElementById('surgeonNotesList');
    if (!list) return;
    if (!surgeonNotes.length) {
      list.innerHTML = '<p class="sub">No clinical notes yet.</p>';
      return;
    }
    list.innerHTML = surgeonNotes.slice(0, 12).map(note => `
      <div class="note-card ${note.severity}">
        <div class="note-meta"><span>DAY ${note.day}</span><span>${note.status.toUpperCase()} / ${note.severity.toUpperCase()}</span></div>
        <div>${note.note}</div>
        <div class="note-meta">${note.author || 'Flight Surgeon'} - ${new Date(note.createdAt).toLocaleString()}</div>
      </div>`).join('');
  }

  function postPresence() {
    if (!location.protocol.startsWith('http')) return;
    fetch(`/api/mission-state/${MISSION_ID}/presence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: REALTIME_CLIENT_ID,
        role: authUser?.role || appRole,
        name: authUser?.name || document.getElementById('crewName')?.value || 'Operator'
      })
    }).then(res => res.json()).then(data => {
      presenceUsers = data.users || presenceUsers;
      renderOperations();
    }).catch(() => {});
  }

  function openMissionReport() {
    const weakest = weakestSignal();
    const score = Math.round((state.current.bone + state.current.cardio + state.current.immune + state.current.behavioral) / 4);
    const riskScore = finalRiskScore();
    const alertRows = alertsHistory.slice(0, 10).map(a => `<tr><td>${a.day}</td><td>${a.sev}</td><td>${a.text}</td></tr>`).join('');
    const telemetryRows = telemetry.slice(-12).map(f => `<tr><td>${f.day}</td><td>${f.hr}</td><td>${f.spo2}</td><td>${f.temp}</td><td>${f.rad}</td></tr>`).join('');
    const noteRows = surgeonNotes.slice(0, 8).map(n => `<tr><td>${n.day}</td><td>${n.status}</td><td>${n.severity}</td><td>${n.note}</td></tr>`).join('');
    const forecastRows = indicators.map(key => {
      const f7 = forecastSignal(key, 7);
      const f30 = forecastSignal(key, 30);
      const unit = key === 'radiation' ? ' mSv' : '%';
      return `<tr><td>${meta[key].label}</td><td>${Math.round(f7.value)}${unit} (${f7.status})</td><td>${Math.round(f30.value)}${unit} (${f30.status})</td></tr>`;
    }).join('');
    const win = window.open('', '_blank');
    if (!win) { pushToast('Popup blocked. Allow popups to open the report.', 'watch'); return; }
    win.document.write(`<!doctype html><html><head><title>VITALS Mission Report</title><style>
      body{font-family:Arial,sans-serif;margin:32px;color:#14202b} h1{margin-bottom:4px} table{width:100%;border-collapse:collapse;margin:12px 0} td,th{border:1px solid #ccd6df;padding:7px;text-align:left} .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.card{border:1px solid #ccd6df;padding:10px}.k{font-size:11px;color:#667;text-transform:uppercase}.v{font-size:22px;font-weight:700}@media print{button{display:none}}</style></head><body>
      <button onclick="print()">Print / Save PDF</button>
      <h1>VITALS Mission Report</h1><p>Mission day ${state.day} of ${TOTAL_DAYS}. Generated ${new Date().toLocaleString()}.</p>
      <div class="grid"><div class="card"><div class="k">Composite</div><div class="v">${score}/100</div></div><div class="card"><div class="k">Final Risk</div><div class="v">${riskScore.label}</div></div><div class="card"><div class="k">Radiation</div><div class="v">${Math.round(state.current.radiation)} mSv</div></div><div class="card"><div class="k">Alerts</div><div class="v">${alertsHistory.length}</div></div></div>
      <p><b>Risk rationale:</b> ${riskScore.reason}</p>
      <h2>Current Readings</h2><table><tr><th>Bone</th><th>Cardio</th><th>Immune</th><th>Behavioral</th><th>Radiation</th></tr><tr><td>${Math.round(state.current.bone)}%</td><td>${Math.round(state.current.cardio)}%</td><td>${Math.round(state.current.immune)}%</td><td>${Math.round(state.current.behavioral)}%</td><td>${Math.round(state.current.radiation)} mSv</td></tr></table>
      <h2>Recent Alerts</h2><table><tr><th>Day</th><th>Severity</th><th>Message</th></tr>${alertRows || '<tr><td colspan="3">No alerts.</td></tr>'}</table>
      <h2>Flight Surgeon Notes</h2><table><tr><th>Day</th><th>Status</th><th>Severity</th><th>Note</th></tr>${noteRows || '<tr><td colspan="4">No notes.</td></tr>'}</table>
      <h2>Predictive Risk Forecast</h2><table><tr><th>System</th><th>+7 days</th><th>+30 days</th></tr>${forecastRows}</table>
      <h2>Recent Telemetry</h2><table><tr><th>Day</th><th>HR</th><th>SpO2</th><th>Temp</th><th>Radiation</th></tr>${telemetryRows || '<tr><td colspan="5">No telemetry.</td></tr>'}</table>
      <h2>Recommended Action</h2><p>${actionFor(weakest.key)}</p>
    </body></html>`);
    win.document.close();
  }

  function finalRiskScore() {
    const score = Math.round((state.current.bone + state.current.cardio + state.current.immune + state.current.behavioral) / 4);
    const radiationLoad = Math.min(100, (state.current.radiation / 600) * 100);
    const unresolvedCritical = alertsHistory.filter(a => a.sev === 'crit' && a.status !== 'resolved').length;
    const restricted = surgeonNotes.some(n => ['restricted', 'escalated'].includes(n.status));
    const risk = Math.min(100, Math.round((100 - score) * 0.58 + radiationLoad * 0.32 + unresolvedCritical * 8 + (restricted ? 12 : 0)));
    const level = risk >= 70 ? 'HIGH' : risk >= 40 ? 'MEDIUM' : 'LOW';
    return {
      value: risk,
      label: `${level} (${risk}/100)`,
      reason: `Composite health ${score}/100, radiation load ${Math.round(radiationLoad)}% of limit, ${unresolvedCritical} unresolved critical alert(s).`
    };
  }

  function indicatorsFromTelemetryFrame(frame, index = 0) {
    const hrPenalty = Math.max(0, frame.hr - 72) * 0.9 + Math.max(0, 60 - frame.hr) * 0.45;
    const spo2Penalty = Math.max(0, 97 - frame.spo2) * 5.8;
    const tempPenalty = Math.abs(frame.temp - 36.6) * 7;
    const rad = Math.max(0, Number(frame.rad) || 0);
    const sleep = Number.isFinite(frame.sleep) ? frame.sleep : 7;
    const exercise = Number.isFinite(frame.exercise) ? frame.exercise : 75;
    const mood = Number.isFinite(frame.mood) ? frame.mood : 3;
    const exerciseBoost = Math.min(9, Math.max(0, exercise - 45) * 0.11);
    const sleepBoost = Math.max(-12, Math.min(7, (sleep - 6.5) * 3));
    const moodBoost = (mood - 3) * 4.5;
    return {
      bone: Math.max(42, Math.min(100, 100 - index * 0.14 - rad * 0.018 + exerciseBoost)),
      cardio: Math.max(35, Math.min(100, 100 - hrPenalty - rad * 0.02 + exerciseBoost * 0.55 + sleepBoost * 0.25)),
      immune: Math.max(30, Math.min(100, 100 - spo2Penalty - tempPenalty - rad * 0.012 + sleepBoost)),
      radiation: Math.min(650, rad),
      behavioral: Math.max(30, Math.min(100, 100 - Math.max(0, frame.hr - 82) * 0.5 - tempPenalty * 0.7 + sleepBoost + moodBoost))
    };
  }

  function rebuildMissionFromTelemetry(rows) {
    const ordered = rows.slice().sort((a, b) => a.day - b.day);
    state.day = ordered.at(-1)?.day || 0;
    indicators.forEach(key => { state.history[key] = [meta[key].start]; });
    ordered.forEach((frame, index) => {
      const snapshot = indicatorsFromTelemetryFrame(frame, index + 1);
      indicators.forEach(key => { state.history[key][frame.day] = snapshot[key]; });
    });
    indicators.forEach(key => {
      const hist = state.history[key];
      for (let i = 1; i <= state.day; i += 1) {
        if (hist[i] == null) hist[i] = hist[i - 1] ?? meta[key].start;
      }
      state.current[key] = hist[state.day] ?? meta[key].start;
    });
    indicators.forEach(k => { prevStatus[k] = statusFor(k, state.current[k]); });
  }

  function applyImportedFrame(frame, mode = 'imported') {
    const snapshot = indicatorsFromTelemetryFrame(frame, frame.day);
    if (mode === 'hybrid') {
      indicators.forEach(key => {
        const weighted = key === 'radiation'
          ? Math.max(state.current[key], snapshot[key])
          : (state.current[key] * 0.45) + (snapshot[key] * 0.55);
        state.current[key] = weighted;
        state.history[key][state.day] = weighted;
      });
    } else {
      indicators.forEach(key => {
        state.current[key] = snapshot[key];
        state.history[key][state.day] = snapshot[key];
      });
    }
    telemetry = telemetry.filter(f => f.day !== frame.day);
    telemetry.unshift(frame);
    telemetry = telemetry.slice(0, 24);
    document.getElementById('telemetryBody').innerHTML = telemetry.map(f => `<tr><td>${f.day}</td><td>${f.hr}</td><td>${f.spo2}</td><td>${f.temp}</td><td>${f.rad}</td></tr>`).join('');
  }

  function importTelemetryCsv() {
    const input = document.getElementById('csvInput');
    const rows = (input.value || '').trim().split(/\r?\n/).filter(Boolean);
    const parsed = rows.map(row => row.split(',').map(v => v.trim())).filter(cols => cols.length >= 5 && !Number.isNaN(Number(cols[0])));
    if (!parsed.length) { pushToast('No valid CSV rows found.', 'watch'); return; }
    telemetry = parsed.map(cols => ({
      day: Number(cols[0]),
      hr: Number(cols[1]),
      spo2: Number(cols[2]),
      temp: Number(cols[3]),
      rad: Number(cols[4]),
      sleep: cols[5] === undefined || cols[5] === '' ? undefined : Number(cols[5]),
      exercise: cols[6] === undefined || cols[6] === '' ? undefined : Number(cols[6]),
      mood: cols[7] === undefined || cols[7] === '' ? undefined : Number(cols[7])
    })).sort((a, b) => a.day - b.day);
    rebuildMissionFromTelemetry(telemetry);
    dataSourceMode = 'imported';
    localStorage.setItem('vitals_source_mode', dataSourceMode);
    document.getElementById('telemetryBody').innerHTML = telemetry.map(f => `<tr><td>${f.day}</td><td>${f.hr}</td><td>${f.spo2}</td><td>${f.temp}</td><td>${f.rad}</td></tr>`).join('');
    renderAll();
    checkAlerts();
    saveState();
    renderOperations();
    pushToast(`Imported ${telemetry.length} telemetry rows and rebuilt mission trends.`, 'ok');
  }

  async function checkStructuredDatabase() {
    const target = document.getElementById('structuredStatus');
    if (!location.protocol.startsWith('http')) {
      target.textContent = 'Structured DB check requires the local server.';
      return;
    }
    try {
      const res = await fetch(`/api/mission-state/${MISSION_ID}/structured`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Structured DB check failed');
      target.textContent = `Structured DB OK: ${data.telemetry.length} telemetry frames, ${data.alerts.length} alerts, ${data.comms.length} comms, ${data.achievements.length} achievements.`;
    } catch(e) {
      target.textContent = `Structured DB unavailable: ${e.message}`;
    }
  }

  function startReplay() {
    stopReplay(false);
    replayDay = 0;
    const slider = document.getElementById('replaySlider');
    if (slider) slider.value = 0;
    replayTimer = setInterval(() => {
      replayDay = Math.min(state.day, (replayDay || 0) + 1);
      if (slider) slider.value = replayDay;
      showReplayDay(replayDay);
      if (replayDay >= state.day) stopReplay(false);
    }, 650);
  }

  function stopReplay(showCurrent = true) {
    if (replayTimer) clearInterval(replayTimer);
    replayTimer = null;
    if (showCurrent) {
      replayDay = null;
      const insight = document.getElementById('replayInsight');
      if (insight) {
        insight.className = 'replay-insight';
        insight.textContent = 'Replay will mark events and imported telemetry on the trend chart.';
      }
      renderAll();
    }
    renderOperations();
  }

  function showReplayDay(day) {
    replayDay = Number(day);
    const snapshot = {};
    indicators.forEach(key => {
      const hist = state.history[key] || [];
      snapshot[key] = hist[Math.min(replayDay, hist.length - 1)] ?? state.current[key];
    });
    indicators.forEach(key => {
      const valEl = document.getElementById('val-' + key);
      if (valEl) valEl.textContent = (key === 'radiation' ? Math.round(snapshot[key]) : Math.round(snapshot[key] * 10) / 10) + meta[key].unit;
      const badgeEl = document.getElementById('badge-' + key);
      if (badgeEl) {
        const st = statusFor(key, snapshot[key]);
        badgeEl.className = 'badge ' + st;
        badgeEl.textContent = st === 'ok' ? 'NORMAL' : st === 'watch' ? 'WATCH' : 'CRITICAL';
      }
    });
    els.dayLabel.innerHTML = `REPLAY DAY ${replayDay} <div>saved mission remains day ${state.day}</div>`;
    renderReplayInsight(snapshot);
    drawTrendChart();
    renderOperations();
  }

  function replayEventForDay(day) {
    const alert = alertsHistory.find(a => a.day === day);
    if (alert) return { severity: alert.sev, text: alert.text };
    const scripted = scriptedEvents[day];
    if (scripted) return { severity: scripted.warn ? 'watch' : 'ok', text: scripted.text };
    const frame = telemetry.find(f => f.day === day);
    if (frame) return { severity: 'ok', text: `Imported telemetry: HR ${frame.hr}, SpO2 ${frame.spo2}%, sleep ${frame.sleep ?? 'n/a'}h, exercise ${frame.exercise ?? 'n/a'} min.` };
    return { severity: 'ok', text: 'No notable event logged for this day.' };
  }

  function renderReplayInsight(snapshot) {
    const el = document.getElementById('replayInsight');
    if (!el) return;
    const event = replayEventForDay(replayDay);
    const score = Math.round((snapshot.bone + snapshot.cardio + snapshot.immune + snapshot.behavioral) / 4);
    el.className = 'replay-insight ' + event.severity;
    el.innerHTML = `<b>Day ${replayDay}</b> - Score ${score}/100 - ${event.text}`;
  }

  function saveState() {
    try {
      const payload = missionPayload();
      localStorage.setItem('vitals_state', JSON.stringify(payload));
      syncStateToDatabase(payload);
    } catch(e) {}
  }
  function loadState() {
    try {
      const raw = localStorage.getItem('vitals_state');
      if (!raw) return false;
      const s = JSON.parse(raw);
      applyMissionPayload(s);
      return true;
    } catch(e) { return false; }
  }

  // ---- Sound ----
  function playBeep(sev) {
    if (!settings.sound) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = sev === 'crit' ? 'sawtooth' : sev === 'click' ? 'triangle' : 'sine';
      o.frequency.value = sev === 'crit' ? 920 : sev === 'watch' ? 660 : sev === 'ach' ? 740 : sev === 'click' ? 440 : 520;
      g.gain.setValueAtTime(sev === 'click' ? 0.025 : 0.08, ctx.currentTime);
      if (sev === 'crit') {
        o.frequency.setValueAtTime(920, ctx.currentTime);
        o.frequency.setValueAtTime(640, ctx.currentTime + 0.12);
        o.frequency.setValueAtTime(920, ctx.currentTime + 0.24);
      }
      if (sev === 'ach') o.frequency.exponentialRampToValueAtTime(1180, ctx.currentTime + 0.28);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (sev === 'click' ? 0.08 : 0.38));
      o.start(); o.stop(ctx.currentTime + (sev === 'click' ? 0.08 : 0.38));
    } catch(e) {}
  }

  // ---- Toasts ----
  function pushToast(text, severity, isAch) {
    const stack = document.getElementById('toastStack');
    const t = document.createElement('div');
    t.className = 'toast ' + (severity === 'ok' ? '' : severity) + (isAch ? ' ach-toast' : '');
    t.innerHTML = `<button class="close-x" aria-label="Dismiss">✕</button>
      <div class="ttl">${isAch ? '🏆 ACHIEVEMENT UNLOCKED' : 'AUTO-MESSAGE TO CREW · DAY ' + state.day}</div>
      <div>${text}</div>`;
    t.querySelector('.close-x').addEventListener('click', () => t.remove());
    stack.appendChild(t);
    playBeep(isAch ? 'ach' : severity);
    setTimeout(() => { if (t.parentNode) { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; setTimeout(() => t.remove(), 400); } }, isAch ? 7000 : 5500);
  }
  function unlockAch(key) {
    if (unlocked.has(key)) return;
    unlocked.add(key);
    pushToast(`<b>${achievements[key].icon} ${achievements[key].name}</b> — ${achievements[key].desc}`, 'ok', true);
    renderAchievements();
    saveState();
  }

  // ---- AI ----
  let sampleFn = null, chatTurns = [];
  (async () => {
    try { sampleFn = window.claude ? await window.claude.use('sample') : null; } catch (e) { sampleFn = null; }
    const hint = document.getElementById('assistantHint');
    if (!sampleFn && hint) {
      hint.textContent = "The AI assistant isn't available in this view — try opening this page on claude.ai.";
      document.getElementById('chatSendBtn').disabled = false;
    }
    const source = document.getElementById('assistantSource');
    const status = document.querySelector('.bot-status');
    if (sampleFn) {
      if (hint) hint.textContent = 'Ask about your current readings, what a status means, or what to do next. Answers use live mission data with cloud AI support.';
      if (source) source.textContent = 'cloud AI + live telemetry';
      if (status) status.innerHTML = '<span class="live-dot" style="background:var(--ok);"></span>CLOUD AI ONLINE &middot; LIVE MISSION DATA LINKED';
    } else {
      if (hint) hint.textContent = 'Cloud AI is unavailable here, so the onboard advisor is active. It still answers from the current mission readings and action rules.';
      if (source) source.textContent = 'onboard rules + live telemetry';
      if (status) status.innerHTML = '<span class="live-dot" style="background:var(--watch);"></span>ONBOARD ADVISOR ONLINE &middot; LIVE MISSION DATA LINKED';
    }
  })();

  function buildContextPrompt() {
    const c = state.current;
    return `You are an AI flight-health assistant embedded in the VITALS astronaut health dashboard, a simulated NASA mission tool. Answer concisely (2-4 sentences unless asked for more detail), practically, and safely — this is a training simulation, not real medical advice. Current simulated status: Day ${state.day} of ${TOTAL_DAYS}. Bone density: ${Math.round(c.bone)}%. Cardiovascular: ${Math.round(c.cardio)}%. Immune/inflammation: ${Math.round(c.immune)}%. Radiation dose: ${Math.round(c.radiation)} mSv (career limit 600). Behavioral health: ${Math.round(c.behavioral)}%.`;
  }
  function assistantSnapshot() {
    const c = state.current;
    const rank = { crit: 0, watch: 1, ok: 2 };
    const items = indicators.map(key => ({
      key,
      label: meta[key].label,
      value: c[key],
      status: statusFor(key, c[key])
    }));
    items.sort((a, b) => rank[a.status] - rank[b.status] || (a.key === 'radiation' ? b.value - a.value : a.value - b.value));
    return { current: c, items, top: items[0] };
  }

  function localAssistantAnswer(question) {
    const q = question.toLowerCase();
    const snap = assistantSnapshot();
    const c = snap.current;
    const top = snap.top;
    const score = Math.round((c.bone + c.cardio + c.immune + c.behavioral) / 4);
    const radMargin = Math.max(0, Math.round(600 - c.radiation));
    const statusWord = top.status === 'crit' ? 'critical' : top.status === 'watch' ? 'watch' : 'nominal';
    const actionMap = {
      radiation: c.radiation >= 300 ? 'limit EVA time, move optional work to shielded areas, and watch solar-event scheduling.' : 'keep EVA exposure planned and continue routine dose tracking.',
      bone: c.bone < 78 ? 'prioritize an ARED resistive session before sleep and keep protein/hydration steady.' : 'maintain the current resistive exercise block.',
      cardio: c.cardio < 78 ? 'add a controlled treadmill or cycle interval block and monitor dizziness symptoms.' : 'maintain the current cardio routine.',
      immune: c.immune < 78 ? 'prioritize sleep, hydration, and symptom logging for flight-surgeon review.' : 'continue normal immune and inflammation checks.',
      behavioral: c.behavioral < 78 ? 'schedule a support call or decompression block and protect the next sleep window.' : 'maintain the current sleep and recovery rhythm.'
    };
    if (q.includes('radiation') || q.includes('dose') || q.includes('eva')) {
      return `Radiation is currently ${Math.round(c.radiation)} mSv, leaving about ${radMargin} mSv before the 600 mSv training limit. ${statusFor('radiation', c.radiation) === 'ok' ? 'That is nominal, but EVA days still add dose over time.' : 'That needs closer scheduling control.'} Today I would ${actionMap.radiation}`;
    }
    if (q.includes('trend') || q.includes('trending') || q.includes('overall')) {
      return `Overall crew health score is about ${score}/100 on mission day ${state.day}. The weakest signal is ${top.label.toLowerCase()} at ${Math.round(top.value)}${top.key === 'radiation' ? ' mSv' : '%'}, currently ${statusWord}. The next best move is to ${actionMap[top.key]}`;
    }
    if (q.includes('weakest') || q.includes('priority') || q.includes('today') || q.includes('action') || q.includes('plan')) {
      return `Top priority: ${top.label.toLowerCase()}. Status is ${statusWord}, with a current value of ${Math.round(top.value)}${top.key === 'radiation' ? ' mSv' : '%'}. Three steps: 1. ${actionMap[top.key]} 2. Log the result in Daily Check-In. 3. Recheck trends after advancing one mission day.`;
    }
    if (q.includes('ground') || q.includes('summary') || q.includes('summarize')) {
      return `Ground summary: Day ${state.day}/${TOTAL_DAYS}, composite health ${score}/100. Bone ${Math.round(c.bone)}%, cardio ${Math.round(c.cardio)}%, immune ${Math.round(c.immune)}%, behavioral ${Math.round(c.behavioral)}%, radiation ${Math.round(c.radiation)} mSv. Primary watch item: ${top.label.toLowerCase()} (${statusWord}).`;
    }
    return `Current status: Day ${state.day}/${TOTAL_DAYS}, composite health ${score}/100, radiation ${Math.round(c.radiation)} mSv with ${radMargin} mSv margin. The main item to watch is ${top.label.toLowerCase()}. Recommended next action: ${actionMap[top.key]}`;
  }

  function updateAssistantStats() {
    const day = document.getElementById('aiDayStat');
    if (!day) return;
    const snap = assistantSnapshot();
    day.textContent = `${state.day} / ${TOTAL_DAYS}`;
    document.getElementById('aiPriorityStat').textContent = snap.top.status === 'ok' ? 'Nominal' : meta[snap.top.key].label;
    document.getElementById('aiRadStat').textContent = Math.round(state.current.radiation) + ' mSv';
  }

  const botAvatarSvg = `<span class="mission-avatar chat-avatar" aria-hidden="true"></span>`;
  const userAvatarSvg = `<span class="mission-avatar chat-avatar user" aria-hidden="true"></span>`;

  function appendChatBubble(role, text, isTyping, withChips) {
    const log = document.getElementById('chatLog');
    const row = document.createElement('div');
    row.className = 'chat-row' + (role === 'user' ? ' user' : '');
    const bubble = document.createElement('div');
    bubble.className = 'comm-bubble ' + (role === 'user' ? 'mine' : 'ground');
    bubble.innerHTML = `<div class="from">${role === 'user' ? 'YOU' : 'AI ASSISTANT'}</div>` +
      (isTyping ? '<span class="typing-dots"><span></span><span></span><span></span></span>' : `<span class="bubble-text"></span>`);
    if (!isTyping) bubble.querySelector('.bubble-text').textContent = text;
    row.innerHTML = role === 'user' ? userAvatarSvg : botAvatarSvg;
    row.appendChild(bubble);
    if (withChips && role === 'assistant') {
      const chips = document.createElement('div');
      chips.className = 'chat-actions';
      ['What should I prioritize today?', 'Am I trending well?', 'Explain my radiation risk'].forEach(q => {
        const b = document.createElement('button');
        b.className = 'chat-action-chip';
        b.textContent = q;
        b.addEventListener('click', () => { document.getElementById('chatInput').value = q; sendChat(); });
        chips.appendChild(b);
      });
      bubble.appendChild(chips);
    }
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    return bubble;
  }

  const chatEmptyHTML = document.getElementById('chatLog').innerHTML;
  function bindSuggestButtons() {
    document.querySelectorAll('#suggestRow .tab-btn, .chat-tool-btn').forEach(btn => {
      btn.addEventListener('click', () => { document.getElementById('chatInput').value = btn.dataset.q; sendChat(); });
    });
    updateAssistantStats();
  }
  bindSuggestButtons();

  document.getElementById('clearChatBtn').addEventListener('click', () => {
    chatTurns = [];
    document.getElementById('chatLog').innerHTML = chatEmptyHTML;
    bindSuggestButtons();
  });

  async function sendChat() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const emptyEl = document.getElementById('chatEmpty');
    if (emptyEl) emptyEl.remove();
    chatTurns.push({ role: 'user', content: text });
    appendChatBubble('user', text);
    const thinkingDiv = appendChatBubble('assistant', '', true);
    let streaming = false;
    document.getElementById('chatSendBtn').disabled = true;
    try {
      let answer = '';
      if (sampleFn) {
        const result = await sampleFn(
          [{ role: 'user', content: buildContextPrompt() }, ...chatTurns],
          { cache: false, onText: ({ text: t }) => {
              if (!streaming) { thinkingDiv.innerHTML = `<div class="from">AI ASSISTANT</div><span class="bubble-text"></span>`; streaming = true; }
              thinkingDiv.querySelector('.bubble-text').textContent = t;
              document.getElementById('chatLog').scrollTop = 1e9;
            } }
        );
        answer = result.text;
      } else {
        await new Promise(resolve => setTimeout(resolve, 450));
        answer = localAssistantAnswer(text);
      }
      chatTurns.push({ role: 'assistant', content: answer });
      if (!streaming) thinkingDiv.querySelector('.bubble-text').textContent = answer;
      // add chips
      const chips = document.createElement('div');
      chips.className = 'chat-actions';
      ['What should I prioritize today?', 'Am I trending well?'].forEach(q => {
        const b = document.createElement('button');
        b.className = 'chat-action-chip';
        b.textContent = q;
        b.addEventListener('click', () => { document.getElementById('chatInput').value = q; sendChat(); });
        chips.appendChild(b);
      });
      thinkingDiv.appendChild(chips);
    } catch (e) {
      const msg = e.code === 'not_granted' ? 'Permission for AI answers was not granted in this view.'
        : e.code === 'rate_limited' ? 'Too many requests right now — try again in a moment.'
        : 'Could not get a response right now.';
      thinkingDiv.innerHTML = `<div class="from">AI ASSISTANT</div><span class="bubble-text"></span>
        <div class="chat-actions"><button class="chat-action-chip" id="retryBtn">↻ Retry</button></div>`;
      thinkingDiv.querySelector('.bubble-text').textContent = (e.text || msg) + ' Onboard fallback: ' + localAssistantAnswer(text);
      const rb = thinkingDiv.querySelector('#retryBtn');
      if (rb) rb.addEventListener('click', () => { chatTurns.pop(); thinkingDiv.parentElement.remove(); sendChat(); });
    } finally {
      document.getElementById('chatSendBtn').disabled = false;
    }
  }
  document.getElementById('chatSendBtn').addEventListener('click', sendChat);
  document.getElementById('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

  let unreadComms = 0, cleanStreak = 0, bestStreak = 0, worstDayStreak = 0;

  function updateStreaks() {
    const allOk = indicators.every(k => statusFor(k, state.current[k]) === 'ok');
    if (allOk) { cleanStreak += 1; worstDayStreak = 0; } else { cleanStreak = 0; worstDayStreak += 1; }
    bestStreak = Math.max(bestStreak, cleanStreak);
    if (cleanStreak >= 7) unlockAch('streak7');
    if (cleanStreak >= 30) unlockAch('streak30');
    renderStreaks();
  }

  function goToPage(pageName) {
    document.querySelectorAll('.navbtn').forEach(b => b.classList.toggle('active', b.dataset.page === pageName));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + pageName));
    if (pageName === 'comms') { unreadComms = 0; document.getElementById('commsBadge').style.display = 'none'; }
    if (location.hash !== '#' + pageName) history.replaceState(null, '', '#' + pageName);
  }
  document.querySelectorAll('#quickActions .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => goToPage(btn.dataset.goto));
  });

  function renderSnapshot() {
    const row = document.getElementById('snapshotRow');
    if (!row) return;
    const score = Math.round((state.current.bone + state.current.cardio + state.current.immune + state.current.behavioral) / 4);
    const radBudget = Math.max(0, Math.round(600 - state.current.radiation));
    row.innerHTML = `
      <div class="vital-mini"><div class="lbl">MISSION DAY</div><div class="num">${state.day}<span> / ${TOTAL_DAYS}</span></div></div>
      <div class="vital-mini"><div class="lbl">OVERALL SCORE</div><div class="num">${score}<span>/100</span></div></div>
      <div class="vital-mini"><div class="lbl">RAD BUDGET LEFT</div><div class="num">${radBudget}<span> mSv</span></div></div>`;
  }

  function environmentReadings() {
    const c = state.current;
    const co2 = Math.round(520 + (100 - c.immune) * 6 + (state.day % 17) * 3 + (c.behavioral < 70 ? 45 : 0));
    const o2 = Math.max(19.1, 21 - (100 - c.cardio) * 0.004 - (co2 > 850 ? 0.18 : 0));
    const pressure = Math.max(98.8, 101.3 - state.day * 0.004 - (c.radiation > 300 ? 0.25 : 0));
    const humidity = Math.round(43 + Math.sin(state.day * 0.31) * 7 + (c.behavioral < 65 ? 6 : 0));
    return [
      { key: 'co2', label: 'CABIN CO2', value: co2, unit: ' ppm', fill: Math.min(100, co2 / 12), sev: co2 > 950 ? 'crit' : co2 > 750 ? 'watch' : 'ok' },
      { key: 'o2', label: 'O2 PARTIAL', value: o2.toFixed(1), unit: '%', fill: Math.min(100, o2 / 21 * 100), sev: o2 < 19.5 ? 'crit' : o2 < 20.2 ? 'watch' : 'ok' },
      { key: 'pressure', label: 'CABIN PRESSURE', value: pressure.toFixed(1), unit: ' kPa', fill: Math.min(100, pressure / 101.3 * 100), sev: pressure < 99.3 ? 'crit' : pressure < 100.2 ? 'watch' : 'ok' },
      { key: 'humidity', label: 'HUMIDITY', value: humidity, unit: '%', fill: Math.min(100, humidity), sev: humidity > 62 || humidity < 30 ? 'watch' : 'ok' },
      { key: 'scrubber', label: 'SCRUBBER', value: co2 > 950 ? 'SERVICE' : co2 > 750 ? 'WATCH' : 'NOMINAL', unit: '', fill: co2 > 950 ? 92 : co2 > 750 ? 68 : 38, sev: co2 > 950 ? 'crit' : co2 > 750 ? 'watch' : 'ok' }
    ];
  }

  function renderEnvironment() {
    const grid = document.getElementById('envGrid');
    if (!grid) return;
    grid.innerHTML = environmentReadings().map(item => `
      <div class="env-cell ${item.sev}" title="${item.label}">
        <div class="env-top"><span>${item.label}</span><span>${item.sev.toUpperCase()}</span></div>
        <div class="env-value">${item.value}<span>${item.unit}</span></div>
        <div class="env-meter"><div class="env-fill" style="--fill:${item.fill}%"></div></div>
      </div>`).join('');
  }

  function renderFocus() {
    const panel = document.getElementById('focusPanel');
    const textEl = document.getElementById('focusText');
    if (!panel || state.day < 1) return;
    const c = state.current;
    const candidates = [
      { key: 'radiation', sev: statusFor('radiation', c.radiation), text: 'Radiation dose is elevated — minimize EVA exposure and use shielded areas.' },
      { key: 'bone', sev: statusFor('bone', c.bone), text: 'Bone density is slipping — prioritize resistive exercise (ARED) today.' },
      { key: 'cardio', sev: statusFor('cardio', c.cardio), text: 'Cardiovascular conditioning is declining — add cardio intervals today.' },
      { key: 'immune', sev: statusFor('immune', c.immune), text: 'Immune/inflammation markers are off — prioritize sleep and rest.' },
      { key: 'behavioral', sev: statusFor('behavioral', c.behavioral), text: 'Behavioral health is low — consider a support call with family or ground crew.' }
    ];
    const rank = { crit: 0, watch: 1, ok: 2 };
    candidates.sort((a, b) => rank[a.sev] - rank[b.sev]);
    const top = candidates[0];
    panel.className = 'panel focus-panel' + (top.sev !== 'ok' ? ' ' + top.sev : '');
    textEl.textContent = top.sev === 'ok' ? 'All indicators nominal — maintain your current routine.' : top.text;
  }

  function renderStreaks() {
    const row = document.getElementById('streakRow');
    if (!row) return;
    const badges = [];
    badges.push(`<div class="streak-badge ${cleanStreak >= 3 ? 'lit' : ''}">🏅 Clean streak: ${cleanStreak} day${cleanStreak === 1 ? '' : 's'}</div>`);
    badges.push(`<div class="streak-badge">⭐ Best streak: ${bestStreak} day${bestStreak === 1 ? '' : 's'}</div>`);
    if (worstDayStreak >= 3) badges.push(`<div class="streak-badge crit">⚠️ ${worstDayStreak} days with an issue flagged</div>`);
    row.innerHTML = badges.join('');
  }

  function drawOverviewRing() {
    const c = document.getElementById('overviewRing');
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    const score = Math.round((state.current.bone + state.current.cardio + state.current.immune + state.current.behavioral) / 4);
    const cx = 75, cy = 75, r = 60;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.strokeStyle = '#1c2838'; ctx.lineWidth = 12; ctx.stroke();
    const frac = Math.max(0, Math.min(1, score / 100));
    const color = score < 55 ? '#ff5d5d' : score < 78 ? '#f2c14e' : '#4ad99b';
    ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    ctx.strokeStyle = color; ctx.lineWidth = 12; ctx.lineCap = 'round';
    ctx.shadowBlur = 14; ctx.shadowColor = color; ctx.stroke(); ctx.shadowBlur = 0;
    document.getElementById('overviewScore').textContent = score;
    document.getElementById('overviewScore').style.color = color;
  }

  function renderOverviewStats() {
    const dayEl = document.getElementById('overviewDay');
    if (!dayEl) return;
    const c = state.current;
    const systemScores = [
      { name: 'BONE', value: c.bone },
      { name: 'CARDIO', value: c.cardio },
      { name: 'IMMUNE', value: c.immune },
      { name: 'BEHAV.', value: c.behavioral }
    ].sort((a, b) => a.value - b.value);
    const phase = state.day >= 150 ? 'RETURN PREP'
      : state.day >= 90 ? 'DEEP MISSION'
      : state.day >= 30 ? 'CRUISE'
      : state.day > 0 ? 'ADAPTATION'
      : 'LAUNCH';
    dayEl.textContent = `${state.day} / ${TOTAL_DAYS}`;
    document.getElementById('overviewPhase').textContent = phase;
    document.getElementById('overviewRad').textContent = Math.max(0, Math.round(600 - c.radiation)) + ' mSv';
    document.getElementById('overviewLowest').textContent = `${systemScores[0].name} ${Math.round(systemScores[0].value)}%`;
  }

  function updateProgress() {
    const pct = Math.round((state.day / TOTAL_DAYS) * 100);
    document.getElementById('progressBar').style.width = pct + '%';
    document.getElementById('progressLabel').textContent = `Day ${state.day} of ${TOTAL_DAYS} (${pct}%)`;
    const pctEl = document.getElementById('progressPct');
    if (pctEl) pctEl.textContent = pct + '%';
  }

  document.getElementById('crewName').addEventListener('input', (e) => {
    const name = e.target.value || 'Commander';
    document.querySelector('header .tag').textContent = `ASTRONAUT HEALTH MONITOR — ${name.toUpperCase()}`;
    saveState();
  });

  // ---- Comms ----
  let commsThread = [];
  let commsFilter = 'all';
  const groundReplies = [
    'Copy that, Commander. Flight surgeon has been notified.',
    'Acknowledged — continue current countermeasure protocol.',
    'Received. Ground will monitor and advise if the trend continues.',
    'Roger. Let us know if symptoms change in the next 24 hours.',
    'Understood — we will re-evaluate at tomorrow\'s data dump.'
  ];
  function renderComms() {
    const list = document.getElementById('commsList');
    const items = commsThread.filter(m => commsFilter === 'all' || m.sev === commsFilter);
    if (!items.length) { list.innerHTML = '<p class="sub">No messages yet. Alerts will appear here as the mission progresses.</p>'; return; }
    list.innerHTML = items.map(m => {
      const cls = m.type === 'crew' ? 'mine' : m.type === 'ground' ? 'ground' : (m.sev || 'ok');
      const avatarCls = m.type === 'crew' ? 'user' : m.type === 'ground' ? 'ground' : '';
      const from = m.type === 'crew' ? 'YOU (CREW)' : m.type === 'ground' ? 'GROUND CONTROL' : 'AUTO-MONITOR → CREW';
      return `<div class="comm-bubble ${cls}"><span class="mission-avatar comm-avatar ${avatarCls}" aria-hidden="true"></span><div class="comm-content"><div class="from">${from} · DAY ${m.day}</div>${m.text}</div></div>`;
    }).join('');
    list.scrollTop = list.scrollHeight;
  }
  function buildCommsFilterTabs() {
    const row = document.getElementById('commsFilterTabs');
    row.innerHTML = '';
    [['all','All'],['watch','Watch'],['crit','Critical']].forEach(([key,label]) => {
      const b = document.createElement('button');
      b.className = 'tab-btn' + (commsFilter === key ? ' active' : '');
      b.textContent = label;
      b.addEventListener('click', () => { commsFilter = key; buildCommsFilterTabs(); renderComms(); });
      row.appendChild(b);
    });
  }
  buildCommsFilterTabs();

  document.getElementById('replySendBtn').addEventListener('click', () => {
    const input = document.getElementById('replyInput');
    const text = input.value.trim();
    if (!text) return;
    commsThread.push({ type: 'crew', day: state.day, text });
    input.value = '';
    commsSent += 1;
    if (commsSent >= 10) unlockAch('comms10');
    renderComms();
    saveState();
    setTimeout(() => {
      const reply = groundReplies[Math.floor(Math.random() * groundReplies.length)];
      commsThread.push({ type: 'ground', day: state.day, text: reply });
      renderComms();
      saveState();
    }, 900);
  });
  document.getElementById('replyInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('replySendBtn').click(); });
  document.getElementById('markReadBtn').addEventListener('click', () => { unreadComms = 0; document.getElementById('commsBadge').style.display = 'none'; });

  function renderAlertsFeed() {
    const feed = document.getElementById('alertsFeed');
    if (!alertsHistory.length) { feed.innerHTML = '<li class="ok"><span class="dot"></span><span>No alerts yet. Advance a mission day to begin monitoring.</span></li>'; return; }
    feed.innerHTML = alertsHistory.slice(0, 8).map(a => `<li class="${a.sev}" style="cursor:pointer;"><span class="dot"></span><span><b>Day ${a.day}:</b> ${a.text}</span></li>`).join('');
    feed.querySelectorAll('li').forEach(li => {
      li.addEventListener('click', () => goToPage('comms'));
    });
  }

  const alertMsg = {
    bone: 'Bone density has dropped into {s} range — increase resistive exercise (ARED) time.',
    cardio: 'Cardiovascular conditioning is now {s} — add cardio intervals and watch for orthostatic symptoms.',
    immune: 'Immune/inflammation markers are {s} — prioritize sleep and rest; flag to flight surgeon if it persists.',
    radiation: 'Radiation dose is {s} relative to the career limit — reduce EVA exposure.',
    behavioral: 'Behavioral health score is {s} — consider a support call with family or ground crew.'
  };

  function checkAlerts() {
    indicators.forEach(key => {
      const st = statusFor(key, state.current[key]);
      if (st !== 'ok' && st !== prevStatus[key]) {
        const text = alertMsg[key].replace('{s}', st === 'crit' ? 'critical' : 'watch-level');
        pushToast(text, st);
        alertsHistory.unshift({ day: state.day, text, sev: st });
        commsThread.push({ type: 'auto', day: state.day, text, sev: st });
        unreadComms += 1;
        const badge = document.getElementById('commsBadge');
        badge.textContent = unreadComms;
        badge.style.display = 'inline-block';
        if (st === 'crit') { critAlertSeen = true; triggerCriticalAlert(text); }
      }
      prevStatus[key] = st;
    });
    renderAlertsFeed();
    renderComms();
    saveState();
  }

  function triggerCriticalAlert(text) {
    document.body.classList.remove('critical-alert');
    void document.body.offsetWidth;
    document.body.classList.add('critical-alert');
    showOverlay('Critical Health Alert', text + ' Mission control has been notified.');
    setTimeout(() => document.body.classList.remove('critical-alert'), 2600);
  }

  function liveVitals() {
    const c = state.current;
    const hr = Math.max(50, Math.min(140, 60 + (100 - c.cardio) * 0.5 + (c.radiation / 600) * 10));
    const spo2 = Math.max(90, Math.min(100, 94 + (c.immune / 100) * 5));
    const temp = Math.max(35.5, Math.min(38.5, 36.5 + (100 - c.behavioral) * 0.02 + (c.immune < 60 ? 0.3 : 0)));
    return { hr: Math.round(hr), spo2: Math.round(spo2 * 10) / 10, temp: Math.round(temp * 10) / 10 };
  }

  function updateStatusBar() {
    const c = state.current;
    const worst = Math.min(c.bone, c.cardio, c.immune, c.behavioral);
    const radCrit = c.radiation >= 500;
    const pill = document.getElementById('statusPill');
    const text = document.getElementById('statusText');
    if (worst < 55 || radCrit) { pill.className = 'pill emergency'; text.textContent = 'CRITICAL'; }
    else if (worst < 78 || c.radiation >= 300) { pill.className = 'pill caution'; text.textContent = 'CAUTION'; }
    else { pill.className = 'pill'; text.textContent = 'NOMINAL'; }
    document.getElementById('metClock').textContent = String(state.day).padStart(3, '0') + ':00:00:00';
    document.getElementById('utcClock').textContent = 'UTC ' + new Date().toISOString().substr(11, 8);
  }

  function updateLiveVitals() {
    const v = liveVitals();
    const hrState = v.hr >= 105 ? 'watch' : 'ok';
    const spo2State = v.spo2 < 94 ? 'watch' : 'ok';
    const tempState = v.temp >= 37.6 ? 'watch' : 'ok';
    const setLiveCard = (id, stateName, labelId) => {
      const el = document.getElementById(id);
      if (el) el.className = 'vital-mini ' + stateName;
      const label = document.getElementById(labelId);
      if (label) label.textContent = stateName === 'ok' ? 'NOMINAL' : 'WATCH';
    };
    document.getElementById('liveHr').innerHTML = v.hr + '<span> bpm</span>';
    document.getElementById('liveSpo2').innerHTML = v.spo2 + '<span>%</span>';
    document.getElementById('liveTemp').innerHTML = v.temp + '<span>°C</span>';
    document.getElementById('waveHrLabel').textContent = 'HR ' + v.hr + ' BPM';
    document.getElementById('liveTemp').innerHTML = v.temp + '<span>&deg;C</span>';
    document.getElementById('waveHrLabel').className = 'signal-chip ' + hrState;
    const signal = document.getElementById('liveSignal');
    if (signal) {
      const liveState = [hrState, spo2State, tempState].includes('watch') ? 'watch' : 'ok';
      signal.className = 'signal-chip ' + liveState;
      signal.textContent = liveState === 'ok' ? 'SIGNAL LOCK' : 'REVIEW SIGNAL';
    }
    setLiveCard('liveHrCard', hrState, 'liveHrState');
    setLiveCard('liveSpo2Card', spo2State, 'liveSpo2State');
    const tempCard = document.getElementById('liveTemp').closest('.vital-mini');
    if (tempCard && !tempCard.id) {
      tempCard.id = 'liveTempCard';
      tempCard.insertAdjacentHTML('beforeend', '<div class="mini-meta"><span>THERMAL</span><span id="liveTempState">NOMINAL</span></div>');
    }
    setLiveCard('liveTempCard', tempState, 'liveTempState');
    return v;
  }

  function drawGauge() {
    const c = document.getElementById('gaugeCanvas');
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    const cx = 70, cy = 72, r = 58;
    const frac = Math.min(1, state.current.radiation / 600);
    [[0,0.5,'#4ad99b'],[0.5,0.83,'#f2c14e'],[0.83,1,'#ff5d5d']].forEach(s => {
      ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI + s[0]*Math.PI, Math.PI + s[1]*Math.PI);
      ctx.strokeStyle = s[2]; ctx.lineWidth = 10; ctx.stroke();
    });
    const angle = Math.PI + frac * Math.PI;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(angle) * (r - 4), cy + Math.sin(angle) * (r - 4));
    ctx.strokeStyle = '#e7eef4'; ctx.lineWidth = 2; ctx.stroke();
    document.getElementById('gaugeVal').textContent = Math.round(state.current.radiation) + ' mSv';
    const dose = document.getElementById('doseState');
    if (dose) dose.textContent = `${Math.max(0, Math.round(600 - state.current.radiation))} mSv margin to 600 mSv limit`;
  }

  function pushTelemetryFrame(v) {
    telemetry = telemetry.filter(f => f.day !== state.day);
    telemetry.unshift({ day: state.day, hr: v.hr, spo2: v.spo2, temp: v.temp, rad: Math.round(state.current.radiation) });
    telemetry = telemetry.slice(0, 24);
    document.getElementById('telemetryBody').innerHTML = telemetry.map(f => `<tr><td>${f.day}</td><td>${f.hr}</td><td>${f.spo2}</td><td>${f.temp}</td><td>${f.rad}</td></tr>`).join('');
  }

  let wavePhase = 0, waveRunning = true;
  function animateWave() {
    if (!waveRunning) return;
    const c = document.getElementById('waveCanvas');
    const ctx = c.getContext('2d');
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    ctx.fillStyle = light ? '#f7fafc' : '#07111a';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = light ? 'rgba(13,143,168,.14)' : 'rgba(79,211,232,.12)';
    ctx.lineWidth = 1;
    for (let x = 0; x < c.width; x += 28) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, c.height); ctx.stroke();
    }
    for (let y = 0; y < c.height; y += 24) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(c.width, y); ctx.stroke();
    }
    ctx.fillStyle = light ? 'rgba(13,143,168,.08)' : 'rgba(79,211,232,.055)';
    ctx.fillRect(0, c.height / 2 - 1, c.width, 2);
    const v = liveVitals();
    const speed = v.hr / 60;
    const waveColor = v.hr >= 105 ? '#f2c14e' : '#ff5d5d';
    ctx.beginPath(); ctx.strokeStyle = waveColor; ctx.lineWidth = 2;
    ctx.shadowBlur = 8; ctx.shadowColor = waveColor;
    const midY = c.height / 2;
    for (let x = 0; x < c.width; x++) {
      const t = (x + wavePhase) * 0.05 * speed;
      const beat = t % (Math.PI * 2);
      let y = Math.sin(t) * 6;
      if (beat > 2.9 && beat < 3.3) y -= 28 * Math.sin((beat - 2.9) / 0.4 * Math.PI);
      ctx.lineTo(x, midY + y);
    }
    ctx.stroke(); ctx.shadowBlur = 0;
    wavePhase += settings.reduceMotion ? 1 : 3;
    requestAnimationFrame(animateWave);
  }
  document.addEventListener('visibilitychange', () => { waveRunning = !document.hidden; if (waveRunning) animateWave(); });

  const els = {
    dayLabel: document.getElementById('dayLabel'),
    cardGrid: document.getElementById('cardGrid'),
    eventLine: document.getElementById('eventLine'),
    chartTitle: document.getElementById('chartTitle'),
    chartSub: document.getElementById('chartSub'),
    recoList: document.getElementById('recoList'),
    advanceBtn: document.getElementById('advanceBtn'),
    inEx: document.getElementById('in-exercise'), inSleep: document.getElementById('in-sleep'),
    inMood: document.getElementById('in-mood'), inEva: document.getElementById('in-eva'),
    lblEx: document.getElementById('lbl-ex'), lblSleep: document.getElementById('lbl-sleep'),
    lblMood: document.getElementById('lbl-mood'), lblEva: document.getElementById('lbl-eva')
  };

  function statusFor(key, val) {
    if (key === 'radiation') { if (val >= 500) return 'crit'; if (val >= 300) return 'watch'; return 'ok'; }
    if (val < 55) return 'crit'; if (val < 78) return 'watch'; return 'ok';
  }

  let cardSort = 'default', expandedCard = null;
  document.querySelectorAll('#cardSortRow .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#cardSortRow .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active'); cardSort = btn.dataset.sort; expandedCard = null;
      buildCards(); renderAll();
    });
  });
  function cardOrder() {
    if (cardSort === 'default') return indicators.slice();
    const rank = { crit: 0, watch: 1, ok: 2 };
    return indicators.slice().sort((a, b) => rank[statusFor(a, state.current[a])] - rank[statusFor(b, state.current[b])]);
  }

  function buildCards() {
    els.cardGrid.innerHTML = '';
    cardOrder().forEach(key => {
      const div = document.createElement('div');
      div.className = 'card' + (key === activeIndicator ? ' active' : '');
      div.id = 'card-' + key;
      div.innerHTML = `
        <div class="name">${meta[key].label} <span class="info-ic" data-key="${key}" title="Source">ⓘ</span></div>
        <div class="val"><span id="val-${key}">--</span> <span class="delta" id="delta-${key}"></span></div>
        <span class="badge" id="badge-${key}"></span>
        <canvas class="spark" id="spark-${key}" width="200" height="24"></canvas>
        <div class="card-info" id="info-${key}">${meta[key].sub}</div>
        <div class="card-expand" id="expand-${key}">
          <canvas class="spark-lg" id="sparklg-${key}" width="260" height="60"></canvas>
          <button class="view-trend-btn" data-key="${key}">VIEW FULL TREND →</button>
        </div>`;
      div.querySelector('.info-ic').addEventListener('click', (e) => {
        e.stopPropagation();
        const box = document.getElementById('info-' + key);
        box.style.display = box.style.display === 'block' ? 'none' : 'block';
      });
      div.querySelector('.view-trend-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        activeIndicator = key; renderAll(); goToPage('trends');
      });
      div.addEventListener('click', () => {
        expandedCard = expandedCard === key ? null : key;
        document.querySelectorAll('.card').forEach(c => c.classList.remove('expanded'));
        if (expandedCard) { div.classList.add('expanded'); drawSparkLarge(key); }
      });
      els.cardGrid.appendChild(div);
    });
  }

  function drawSparkLarge(key) {
    const c = document.getElementById('sparklg-' + key); if (!c) return;
    const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height);
    const hist = state.history[key]; if (hist.length < 2) return;
    const max = key === 'radiation' ? 600 : 100;
    ctx.beginPath();
    hist.forEach((v, i) => {
      const x = (i / (hist.length - 1)) * c.width;
      const y = c.height - (v / max) * c.height;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    const st = statusFor(key, state.current[key]);
    ctx.strokeStyle = st === 'crit' ? '#ff5d5d' : st === 'watch' ? '#f2c14e' : '#4ad99b';
    ctx.lineWidth = 2; ctx.stroke();
  }
  function drawSpark(key) {
    const c = document.getElementById('spark-' + key); if (!c) return;
    const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height);
    const hist = state.history[key].slice(-20); if (hist.length < 2) return;
    const max = key === 'radiation' ? 600 : 100;
    ctx.beginPath();
    hist.forEach((v, i) => {
      const x = (i / (hist.length - 1)) * c.width;
      const y = c.height - (v / max) * c.height;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    const st = statusFor(key, state.current[key]);
    ctx.strokeStyle = st === 'crit' ? '#ff5d5d' : st === 'watch' ? '#f2c14e' : '#4ad99b';
    ctx.lineWidth = 1.6; ctx.stroke();
  }

  function buildTrendTabs() {
    const row = document.getElementById('trendTabs'); row.innerHTML = '';
    indicators.forEach(key => {
      const b = document.createElement('button');
      b.className = 'tab-btn' + (key === activeIndicator ? ' active' : '');
      b.textContent = meta[key].label;
      b.addEventListener('click', () => { activeIndicator = key; if (compareIndicator === key) compareIndicator = null; renderAll(); });
      row.appendChild(b);
    });
  }
  function buildCompareTabs() {
    const row = document.getElementById('compareTabs'); row.innerHTML = '';
    const label = document.createElement('span');
    label.textContent = 'COMPARE:';
    label.style.cssText = "font-family:'Space Mono',monospace;font-size:0.6rem;color:var(--text-dim);align-self:center;margin-right:2px;";
    row.appendChild(label);
    ['none', ...indicators.filter(k => k !== activeIndicator)].forEach(key => {
      const b = document.createElement('button');
      const isActive = key === 'none' ? compareIndicator === null : compareIndicator === key;
      b.className = 'tab-btn' + (isActive ? ' active' : '');
      b.textContent = key === 'none' ? 'None' : meta[key].label;
      b.addEventListener('click', () => { compareIndicator = key === 'none' ? null : key; renderAll(); });
      row.appendChild(b);
    });
    const legend = document.getElementById('trendLegend');
    if (compareIndicator) legend.innerHTML = `<span style="color:#4fd3e8;">●</span> ${meta[activeIndicator].label} &nbsp;&nbsp; <span style="color:#c77dff;">●</span> ${meta[compareIndicator].label}`;
    else legend.innerHTML = '';
  }
  document.querySelectorAll('#trendRangeTabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#trendRangeTabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      trendRange = btn.dataset.trange;
      drawTrendChart();
    });
  });

  const trendCanvas = document.getElementById('trendChart');
  const trendTooltip = document.getElementById('trendTooltip');
  trendCanvas.addEventListener('mousemove', (e) => {
    const hist = state.history[activeIndicator]; if (hist.length < 2) return;
    const rangeInfo = getTrendRange(hist.length);
    const rect = trendCanvas.getBoundingClientRect();
    const scaleX = trendCanvas.width / rect.width;
    const xPix = (e.clientX - rect.left) * scaleX;
    const frac = xPix / trendCanvas.width;
    const idx = Math.round(rangeInfo.start + frac * (rangeInfo.end - rangeInfo.start));
    const clamped = Math.max(rangeInfo.start, Math.min(rangeInfo.end, idx));
    const val = hist[clamped];
    let text = `Day ${clamped} · ${Math.round(val * 10) / 10}${meta[activeIndicator].unit}`;
    if (compareIndicator) {
      const chist = state.history[compareIndicator];
      const cval = chist[Math.min(clamped, chist.length - 1)];
      text += ` · ${meta[compareIndicator].label}: ${Math.round(cval * 10) / 10}${meta[compareIndicator].unit}`;
    }
    trendTooltip.textContent = text;
    trendTooltip.style.display = 'block';
    trendTooltip.style.left = (e.clientX - rect.left) + 'px';
    trendTooltip.style.top = (e.clientY - rect.top) + 'px';
  });
  trendCanvas.addEventListener('mouseleave', () => { trendTooltip.style.display = 'none'; });

  function getTrendRange(len) {
    if (trendRange === 'full') return { start: 0, end: len - 1 };
    const n = parseInt(trendRange);
    return { start: Math.max(0, len - n), end: len - 1 };
  }

  let matrixRange = 30;
  document.querySelectorAll('#matrixRange .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#matrixRange .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      matrixRange = btn.dataset.range === 'full' ? 'full' : parseInt(btn.dataset.range);
      buildRiskMatrix();
    });
  });

  function showRiskDetail(d) {
    document.querySelectorAll('.risk-cell').forEach(c => c.classList.remove('selected'));
    const cell = document.getElementById('riskcell-' + d);
    if (cell) cell.classList.add('selected');
    const vals = indicators.map(k => `${meta[k].label}: ${Math.round(state.history[k][d] * 10) / 10}${meta[k].unit}`).join('  ·  ');
    document.getElementById('riskDetail').textContent = `Day ${d} — ${vals}`;
  }

  function buildRiskMatrix() {
    const grid = document.getElementById('riskGrid'); if (!grid) return;
    const totalDays = state.day;
    if (totalDays < 1) { grid.innerHTML = ''; return; }
    let start = 1;
    if (matrixRange === 30) start = Math.max(1, totalDays - 29);
    else if (matrixRange === 90) start = Math.max(1, totalDays - 89);
    grid.innerHTML = '';
    for (let d = start; d <= totalDays; d++) {
      const statuses = indicators.map(k => statusFor(k, state.history[k][d]));
      const worst = statuses.includes('crit') ? 'crit' : statuses.includes('watch') ? 'watch' : 'ok';
      const cell = document.createElement('div');
      cell.className = 'risk-cell ' + worst; cell.id = 'riskcell-' + d; cell.textContent = d;
      cell.addEventListener('click', () => showRiskDetail(d));
      grid.appendChild(cell);
    }
  }

  function drawTrendChart() {
    const c = document.getElementById('trendChart');
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    const fullHist = state.history[activeIndicator];
    const rangeInfo = getTrendRange(fullHist.length);
    const hist = fullHist.slice(rangeInfo.start, rangeInfo.end + 1);
    const max = activeIndicator === 'radiation' ? 600 : 100;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4fd3e8';
    const dimGrid = document.documentElement.getAttribute('data-theme') === 'light' ? 'rgba(60,80,100,.16)' : 'rgba(180,220,255,.12)';
    ctx.strokeStyle = dimGrid; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = (i / 4) * c.height;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(c.width, y); ctx.stroke();
    }
    if (hist.length > 1) {
      const pts = hist.map((v, i) => ({
        x: (i / (hist.length - 1)) * c.width,
        y: c.height - (v / max) * c.height,
        v
      }));
      const fill = ctx.createLinearGradient(0, 0, 0, c.height);
      fill.addColorStop(0, 'rgba(79,211,232,0.28)');
      fill.addColorStop(1, 'rgba(79,211,232,0.02)');
      ctx.beginPath();
      pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.lineTo(c.width, c.height); ctx.lineTo(0, c.height); ctx.closePath();
      ctx.fillStyle = fill; ctx.fill();
      ctx.beginPath();
      pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.strokeStyle = accent; ctx.lineWidth = 2.4;
      ctx.shadowBlur = 12; ctx.shadowColor = accent; ctx.stroke(); ctx.shadowBlur = 0;
      pts.filter((_, i) => i === pts.length - 1 || i % Math.max(1, Math.floor(pts.length / 8)) === 0).forEach(p => {
        ctx.beginPath(); ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = '#061019'; ctx.fill(); ctx.strokeStyle = accent; ctx.lineWidth = 1.4; ctx.stroke();
      });
    }
    const thresholds = activeIndicator === 'radiation' ? [300, 500] : [78, 55];
    thresholds.forEach(th => {
        const y = c.height - (th / max) * c.height;
        const warnLine = activeIndicator === 'radiation' ? th === 300 : th === 78;
        ctx.strokeStyle = warnLine ? 'rgba(242,193,78,0.55)' : 'rgba(255,93,93,0.55)';
        ctx.setLineDash([4,4]); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(c.width, y); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = warnLine ? 'rgba(242,193,78,0.85)' : 'rgba(255,93,93,0.85)';
        ctx.font = '10px Space Mono, monospace';
        ctx.fillText((warnLine ? 'WATCH ' : 'CRIT ') + th, 8, Math.max(10, y - 4));
    });
    if (compareIndicator) {
      const cf = state.history[compareIndicator].slice(rangeInfo.start, rangeInfo.end + 1);
      const cmax = compareIndicator === 'radiation' ? 600 : 100;
      if (cf.length > 1) {
        ctx.beginPath();
        cf.forEach((v, i) => {
          const x = (i / (cf.length - 1)) * c.width;
          const y = c.height - (v / cmax) * c.height;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = '#c77dff'; ctx.lineWidth = 2;
        ctx.shadowBlur = 10; ctx.shadowColor = '#c77dff'; ctx.stroke(); ctx.shadowBlur = 0;
      }
    }
    if (replayDay !== null && replayDay >= rangeInfo.start && replayDay <= rangeInfo.end && hist.length > 1) {
      const x = ((replayDay - rangeInfo.start) / Math.max(1, rangeInfo.end - rangeInfo.start)) * c.width;
      ctx.save();
      ctx.strokeStyle = 'rgba(242,193,78,0.95)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, c.height);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(242,193,78,0.95)';
      ctx.font = '11px Space Mono, monospace';
      ctx.fillText(`DAY ${replayDay}`, Math.min(c.width - 58, x + 7), 16);
      ctx.restore();
    }
  }

  function buildRecommendations() {
    els.recoList.innerHTML = '';
    const recos = [];
    const bone = state.current.bone, cardio = state.current.cardio, immune = state.current.immune, rad = state.current.radiation, beh = state.current.behavioral;
    if (statusFor('bone', bone) !== 'ok') recos.push({ s: statusFor('bone', bone), t: 'Bone density trending down — increase resistive exercise time (ARED) and prioritize weight-bearing sessions today.' });
    else recos.push({ s: 'ok', t: 'Bone density stable — current exercise routine is sufficient.' });
    if (statusFor('cardio', cardio) !== 'ok') recos.push({ s: statusFor('cardio', cardio), t: 'Cardiovascular conditioning declining — add treadmill/cycle cardio intervals; watch for orthostatic symptoms.' });
    else recos.push({ s: 'ok', t: 'Cardiovascular status nominal.' });
    if (statusFor('immune', immune) !== 'ok') recos.push({ s: statusFor('immune', immune), t: 'Elevated inflammation markers — ensure adequate sleep and rest; flag to flight surgeon if trend continues 3+ days.' });
    else recos.push({ s: 'ok', t: 'Immune markers within normal range.' });
    const radStatus = statusFor('radiation', rad);
    if (radStatus !== 'ok') recos.push({ s: radStatus, t: radStatus === 'crit' ? 'Radiation dose approaching career limit — minimize EVA exposure and use shielded areas during solar events.' : 'Radiation dose climbing — monitor EVA scheduling closely.' });
    else recos.push({ s: 'ok', t: 'Radiation dose well within career limits.' });
    if (statusFor('behavioral', beh) !== 'ok') recos.push({ s: statusFor('behavioral', beh), t: 'Mood/sleep scores low — schedule a support call with family or ground crew; consider adjusting sleep schedule.' });
    else recos.push({ s: 'ok', t: 'Behavioral health indicators look good — keep up current routine.' });
    recos.forEach(r => {
      const li = document.createElement('li');
      li.className = r.s;
      li.innerHTML = `<span class="dot"></span><span>${r.t}</span>`;
      els.recoList.appendChild(li);
    });
  }

  function buildActionChecklist() {
    const grid = document.getElementById('actionGrid');
    if (!grid) return;
    const c = state.current;
    const envWorst = environmentReadings().find(item => item.sev !== 'ok');
    const items = [
      {
        sev: statusFor('radiation', c.radiation),
        text: c.radiation >= 300 ? 'Move nonessential work away from EVA windows and use shielded areas.' : 'Keep EVA exposure within planned limits.',
        reason: 'Radiation protection'
      },
      {
        sev: statusFor('bone', c.bone),
        text: c.bone < 78 ? 'Schedule an ARED session before the next sleep cycle.' : 'Complete planned resistive exercise block.',
        reason: 'Bone and muscle countermeasure'
      },
      {
        sev: statusFor('behavioral', c.behavioral),
        text: c.behavioral < 78 ? 'Book a support call or decompression block with ground crew.' : 'Maintain current sleep and recovery rhythm.',
        reason: 'Isolation and stress control'
      },
      {
        sev: statusFor('immune', c.immune),
        text: c.immune < 78 ? 'Prioritize rest, hydration, and symptom logging for flight surgeon review.' : 'Continue daily immune and inflammation check.',
        reason: 'Immune monitoring'
      },
      {
        sev: envWorst ? envWorst.sev : 'ok',
        text: envWorst ? `Inspect ${envWorst.label.toLowerCase()} and confirm life-support status.` : 'Cabin atmosphere is nominal; continue routine life-support scan.',
        reason: 'Closed environment safety'
      }
    ];
    grid.innerHTML = items.map((item, i) => `
      <label class="action-item ${item.sev}">
        <input type="checkbox" aria-label="Complete action ${i + 1}">
        <span>
          <span class="action-top"><span>${item.reason}</span><span class="mini-status"></span></span>
          <span class="action-text">${item.text}</span>
          <span class="action-reason">${item.sev.toUpperCase()}</span>
        </span>
      </label>`).join('');
  }

  function renderMissionCal() {
    const el = document.getElementById('missionCal'); if (!el) return;
    const start = Math.max(1, state.day - 1);
    const end = Math.min(TOTAL_DAYS, start + 14);
    let html = '';
    for (let d = start; d <= end; d++) {
      const ev = scriptedEvents[d];
      const cls = 'cal-day' + (d < state.day ? ' past' : '') + (ev ? ' event' : '');
      html += `<div class="${cls}" title="${ev ? ev.text : ''}"><div class="cal-num">${d}</div><div class="cal-icon">${ev ? (ev.warn ? '⚠️' : '⭐') : '·'}</div></div>`;
    }
    el.innerHTML = html;
  }

  function renderMissionTimeline() {
    const el = document.getElementById('missionTimeline'); if (!el) return;
    const milestones = [
      { d: 1, text: 'Launch adaptation and baseline vitals.' },
      { d: 15, text: 'Solar particle event drill.', crit: true },
      { d: 45, text: 'Resupply docking and morale boost.' },
      { d: 90, text: 'Half-mission medical review.' },
      { d: 120, text: 'CO2 scrubber repair window.', crit: true },
      { d: 150, text: 'Return conditioning phase.' },
      { d: 180, text: 'Mission closeout and landing prep.' }
    ];
    el.innerHTML = milestones.map(m => {
      const cls = 'timeline-node' + (m.d < state.day ? ' past' : '') + (m.d >= state.day ? ' event' : '') + (m.crit ? ' crit' : '');
      return `<div class="${cls}"><div class="timeline-day">DAY ${m.d}</div><div class="timeline-text">${m.text}</div></div>`;
    }).join('');
  }

  function renderAstronautProfile() {
    const nameInput = document.getElementById('crewName');
    const name = (nameInput && nameInput.value.trim()) || 'Commander';
    const v = liveVitals();
    const worst = Math.min(state.current.bone, state.current.cardio, state.current.immune, state.current.behavioral);
    const rad = state.current.radiation;
    const risk = (worst < 55 || rad >= 500) ? 'HIGH' : (worst < 78 || rad >= 300) ? 'MED' : 'LOW';
    const eva = risk === 'HIGH' ? 'HOLD' : risk === 'MED' ? 'CHECK' : 'GO';
    document.getElementById('profileName').textContent = name;
    document.getElementById('profileO2').textContent = v.spo2 + '%';
    document.getElementById('profileTemp').textContent = v.temp + 'C';
    document.getElementById('profileEva').textContent = eva;
    document.getElementById('profileRisk').textContent = risk;
    document.getElementById('profileStatus').textContent = risk === 'HIGH'
      ? 'Critical review required before EVA activity.'
      : risk === 'MED' ? 'Flight surgeon review recommended before EVA.' : 'Suit telemetry linked. EVA readiness nominal.';
  }

  function updateThemeChips() {
    document.querySelectorAll('#themeModeRow .theme-chip').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.themeMode === settings.theme);
    });
  }

  function renderAchievements() {
    const grid = document.getElementById('achGrid'); if (!grid) return;
    grid.innerHTML = Object.entries(achievements).map(([k, a]) =>
      `<div class="ach-cell ${unlocked.has(k) ? 'unlocked' : ''}">
        <div class="ach-icon">${a.icon}</div>
        <div class="ach-name">${a.name}</div>
        <div class="ach-desc">${a.desc}</div>
      </div>`).join('');
    const count = unlocked.size;
    document.getElementById('achCount').textContent = `${count} / ${Object.keys(achievements).length}`;
    document.getElementById('achBar').style.width = (count / Object.keys(achievements).length * 100) + '%';
  }

  function renderAll() {
    els.dayLabel.innerHTML = `MISSION DAY ${state.day} <div>of ${TOTAL_DAYS}</div>`;
    indicators.forEach(key => {
      const val = state.current[key];
      const disp = key === 'radiation' ? Math.round(val) : Math.round(val * 10) / 10;
      const valEl = document.getElementById('val-' + key);
      if (valEl) valEl.textContent = disp + meta[key].unit;
      const st = statusFor(key, val);
      const badgeEl = document.getElementById('badge-' + key);
      if (badgeEl) { badgeEl.className = 'badge ' + st; badgeEl.textContent = st === 'ok' ? 'NORMAL' : st === 'watch' ? 'WATCH' : 'CRITICAL'; }
      const cardEl = document.getElementById('card-' + key);
      if (cardEl) cardEl.classList.toggle('active', key === activeIndicator);
      const hist = state.history[key];
      const deltaEl = document.getElementById('delta-' + key);
      if (deltaEl) {
        if (hist.length >= 2) {
          const diff = hist[hist.length - 1] - hist[hist.length - 2];
          const better = key === 'radiation' ? diff <= 0 : diff >= 0;
          deltaEl.className = 'delta ' + (better ? 'up' : 'down');
          deltaEl.textContent = (diff >= 0 ? '▲' : '▼') + Math.abs(Math.round(diff * 10) / 10);
        } else deltaEl.textContent = '';
      }
      if (expandedCard === key) drawSparkLarge(key);
      drawSpark(key);
    });
    els.chartTitle.textContent = meta[activeIndicator].full + ' — Trend';
    els.chartSub.textContent = meta[activeIndicator].sub;
    buildTrendTabs(); buildCompareTabs(); drawTrendChart(); buildRiskMatrix();
    buildRecommendations(); updateStatusBar(); updateLiveVitals(); drawGauge();
    drawOverviewRing(); renderOverviewStats(); updateProgress(); renderSnapshot(); renderFocus(); renderMissionCal();
    renderMissionTimeline(); renderAstronautProfile(); updateThemeChips(); updateAssistantStats();
    renderAchievements(); renderOperations();
  }

  const previewMeta = { bone: 'BONE', cardio: 'CARDIO', immune: 'IMMUNE', radiation: 'RAD (mSv)', behavioral: 'BEHAV.' };
  function computePreview() {
    const ex = parseFloat(els.inEx.value), sleep = parseFloat(els.inSleep.value);
    const mood = parseFloat(els.inMood.value), eva = els.inEva.value === '1';
    const exFactor = Math.min(1, ex / 90);
    return {
      bone: (exFactor * 0.35) - 0.25 - (eva ? 0.05 : 0),
      cardio: (exFactor * 0.45) - 0.3 + (sleep >= 6 ? 0.1 : -0.2),
      immune: (sleep >= 7 ? 0.3 : sleep >= 5 ? 0 : -0.6) - 0.1,
      radiation: 0.4 + (eva ? 1.8 : 0),
      behavioral: ((mood - 3) * 1.1) + (sleep >= 6 ? 0.3 : -0.5)
    };
  }
  function renderPreview() {
    const d = computePreview();
    document.getElementById('previewGrid').innerHTML = Object.keys(d).map(k => {
      const v = d[k];
      const isRad = k === 'radiation';
      const dir = isRad ? (v > 0.6 ? 'down' : 'up') : (v >= 0 ? 'up' : 'down');
      const sign = v >= 0 ? '+' : '';
      return `<div class="preview-cell"><div class="lbl">${previewMeta[k]}</div><div class="delta ${dir}">${sign}${v.toFixed(2)}</div></div>`;
    }).join('');
  }

  const presets = {
    optimal: { ex: 110, sleep: 8, mood: 5, eva: 0 },
    rest: { ex: 20, sleep: 9, mood: 4, eva: 0 },
    eva: { ex: 60, sleep: 6, mood: 3, eva: 1 },
    neglect: { ex: 0, sleep: 4, mood: 1, eva: 0 }
  };
  document.querySelectorAll('#presetRow .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#presetRow .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const p = presets[btn.dataset.preset];
      els.inEx.value = p.ex; els.lblEx.textContent = p.ex;
      els.inSleep.value = p.sleep; els.lblSleep.textContent = p.sleep.toFixed(1);
      els.inMood.value = p.mood; els.lblMood.textContent = p.mood;
      els.inEva.value = p.eva; els.lblEva.textContent = p.eva === 1 ? 'Yes' : 'No';
      renderPreview();
    });
  });
  function clearPresetActive() { document.querySelectorAll('#presetRow .tab-btn').forEach(b => b.classList.remove('active')); }
  els.inEx.addEventListener('input', () => { els.lblEx.textContent = els.inEx.value; clearPresetActive(); renderPreview(); });
  els.inSleep.addEventListener('input', () => { els.lblSleep.textContent = parseFloat(els.inSleep.value).toFixed(1); clearPresetActive(); renderPreview(); });
  els.inMood.addEventListener('input', () => { els.lblMood.textContent = els.inMood.value; clearPresetActive(); renderPreview(); });
  els.inEva.addEventListener('input', () => { els.lblEva.textContent = els.inEva.value === '1' ? 'Yes' : 'No'; clearPresetActive(); renderPreview(); });

  // ---- Expanded random events ----
  const eventsPool = [
    { text: 'Solar activity nominal. No radiation spikes detected.', rad: 0.4 },
    { text: 'Minor solar event detected — slight radiation uptick.', rad: 1.2, warn: true },
    { text: 'Equipment check complete. All life support systems green.', },
    { text: 'Crew reports good rest cycle — no anomalies.', beh: 1 },
    { text: 'CO2 scrubber running slightly inefficient — flagged for maintenance.', immune: -1, warn: true },
    { text: 'Resupply/comms window with ground support completed.', beh: 2 },
    { text: 'Exercise equipment calibration required — ARED session shortened.', bone: -1, warn: true },
    { text: 'Sleep log shows mild insomnia reported by crew member.', beh: -1, warn: true },
    { text: 'Ground control sends a family video uplink. Morale up.', beh: 3 },
    { text: 'Experiment rack troubleshooting consumed scheduled exercise window.', bone: -0.5, warn: true },
    { text: 'Microgravity adaptation remains stable. No issues.', },
    { text: 'Routine EVA suit inspection — no faults.', },
    { text: 'A mild headache reported; resolved after hydration.', beh: -0.5, warn: true },
    { text: 'Dust filter replacement completed.', },
    { text: 'Amateur radio contact with a school on Earth — behavioral boost.', beh: 2 },
    { text: 'Deep-space radiation monitor flagged elevated GCR counts.', rad: 1.5, warn: true },
    { text: 'Crew sleep cycle slightly ahead of schedule — rested.', beh: 1 },
    { text: 'Water reclamation system nominal.', },
    { text: 'Ground control adjusted daily schedule for efficiency.', beh: 1 },
    { text: 'A minor cut during exercise — treated; no impact on vitals.', },
    { text: 'Solar panel output dipped briefly due to orientation drift.', },
    { text: 'Crew member reported muscle soreness after ARED session.', bone: -0.3, warn: true },
    { text: 'Comms delay with ground briefly increased; resolved.', beh: -0.5, warn: true },
    { text: 'Surprise birthday message from family. Morale spike.', beh: 3 }
  ];

  // ---- Scripted events ----
  const scriptedEvents = {
    15: { text: 'Solar particle event detected — radiation shields activated.', rad: 3.5, warn: true },
    30: { text: 'Monthly medical checkup completed. All systems reviewed.', beh: 1 },
    45: { text: 'Resupply vehicle docked. Fresh food and letters from Earth.', beh: 4 },
    60: { text: 'Quarter-mission milestone. Ground control sends congratulations.', beh: 3 },
    90: { text: 'Halfway point reached. Commander records a message home.', beh: 2 },
    120: { text: 'Minor CO2 scrubber issue — repaired, no impact to crew.', warn: true },
    150: { text: 'Pre-return preparations begin. Physical conditioning emphasized.', },
    175: { text: 'Final stretch. Ground control increases monitoring.', warn: true }
  };

  function runDay(restoring) {
    if (!restoring) {
      undoStack.push(JSON.stringify({
        day: state.day, current: {...state.current},
        history: JSON.parse(JSON.stringify(state.history)),
        telemetry: [...telemetry], alertsHistory: [...alertsHistory],
        evaCount, critAlertSeen, radMilestoneHit
      }));
      if (undoStack.length > 20) undoStack.shift();
    }
    state.day += 1;
    const importedFrame = telemetry.find(f => f.day === state.day);
    if (dataSourceMode === 'imported' && importedFrame) {
      applyImportedFrame(importedFrame, 'imported');
      els.eventLine.textContent = `Imported telemetry frame applied for mission day ${state.day}.`;
      els.eventLine.classList.remove('warn');
      els.advanceBtn.textContent = `LOG DAY ${state.day + 1} & ADVANCE`;
      renderAll();
      checkAlerts();
      updateStreaks();
      if (state.day >= 1) unlockAch('firstDay');
      if (state.day >= 90) unlockAch('missionHalf');
      if (state.day >= TOTAL_DAYS) unlockAch('missionDone');
      saveState();
      return;
    }
    if (dataSourceMode === 'imported' && !importedFrame) {
      pushToast('No imported frame found for this day. Falling back to simulator.', 'watch');
    }

    // prefer scripted event if any
    let ev = scriptedEvents[state.day];
    if (!ev) ev = eventsPool[Math.floor(Math.random() * eventsPool.length)];

    const ex = parseFloat(els.inEx.value);
    const sleep = parseFloat(els.inSleep.value);
    const mood = parseFloat(els.inMood.value);
    const eva = els.inEva.value === '1';
    if (eva) evaCount += 1;
    if (evaCount >= 5) unlockAch('evaVet');

    const exFactor = Math.min(1, ex / 90);

    // Non-linear bone loss: diminishing returns from exercise, accelerating loss over time
    const timePressure = 1 + state.day / 360;
    state.current.bone += (exFactor * 0.35 * (1 - state.day / 500)) - (0.25 * timePressure) - (eva ? 0.08 : 0);
    state.current.bone = Math.max(40, Math.min(100, state.current.bone));

    state.current.cardio += (exFactor * 0.45) - 0.3 + (sleep >= 6 ? 0.1 : -0.2);
    state.current.cardio = Math.max(40, Math.min(100, state.current.cardio));

    const sleepFactor = sleep >= 7 ? 0.3 : sleep >= 5 ? 0 : -0.6;
    state.current.immune += sleepFactor + (ev.immune || 0) * 0.3 - 0.1;
    state.current.immune = Math.max(30, Math.min(100, state.current.immune));

    // Non-linear radiation accumulation (a bit faster later in mission due to cumulative
    // background GCR - realistic modeling of cumulative exposure)
    let radGain = (ev.rad || 0.4) * (1 + state.day / 720);
    if (eva) radGain += 1.8;
    state.current.radiation = Math.min(650, state.current.radiation + radGain);

    const moodFactor = (mood - 3) * 1.1;
    state.current.behavioral += moodFactor + (sleep >= 6 ? 0.3 : -0.5) + (ev.beh || 0) * 0.3;
    state.current.behavioral = Math.max(30, Math.min(100, state.current.behavioral));

    indicators.forEach(k => state.history[k].push(state.current[k]));
    if (dataSourceMode === 'hybrid' && importedFrame) {
      applyImportedFrame(importedFrame, 'hybrid');
      ev = { text: `${ev.text} Imported telemetry correction applied.`, warn: ev.warn };
    }

    els.eventLine.textContent = ev.text;
    els.eventLine.classList.toggle('warn', !!ev.warn);
    els.advanceBtn.textContent = `LOG DAY ${state.day + 1} & ADVANCE`;

    renderAll();
    pushTelemetryFrame(liveVitals());
    checkAlerts();
    updateStreaks();

    // achievements
    if (state.day >= 1) unlockAch('firstDay');
    if (state.day >= 90) unlockAch('missionHalf');
    if (state.day >= TOTAL_DAYS) unlockAch('missionDone');
    if (state.day >= 30 && state.current.bone >= 95) unlockAch('boneKeeper');
    if (state.day >= 60 && state.current.radiation < 100) unlockAch('radMiser');
    if (state.day >= 90 && !critAlertSeen) unlockAch('flawless');

    if (state.current.radiation >= 600 && !radMilestoneHit) {
      radMilestoneHit = true;
      showOverlay('Career Radiation Limit Reached', `On Day ${state.day}, cumulative dose hit the ~600 mSv career limit. In a real mission this would trigger mandatory EVA restrictions.`);
    } else if (state.day >= TOTAL_DAYS) {
      showOverlay('Mission Complete', `The crew member completed all ${TOTAL_DAYS} days of the simulated mission. Review the trend charts to see how daily choices shaped long-term health.`);
    }
    saveState();
  }

  function undoLastDay() {
    if (!undoStack.length) { pushToast('Nothing to undo.', 'ok'); return; }
    const prev = JSON.parse(undoStack.pop());
    state.day = prev.day; state.current = prev.current; state.history = prev.history;
    telemetry = prev.telemetry; alertsHistory = prev.alertsHistory;
    evaCount = prev.evaCount || 0; critAlertSeen = prev.critAlertSeen || false;
    radMilestoneHit = prev.radMilestoneHit || false;
    indicators.forEach(k => { prevStatus[k] = statusFor(k, state.current[k]); });
    els.advanceBtn.textContent = `LOG DAY ${state.day + 1} & ADVANCE`;
    renderAll();
    pushToast('Undid last mission day.', 'ok');
    saveState();
  }

  function showOverlay(title, text) {
    document.getElementById('overlayTitle').textContent = title;
    document.getElementById('overlayText').textContent = text;
    document.getElementById('overlay').classList.add('show');
  }
  document.getElementById('closeOverlay').addEventListener('click', () => {
    document.getElementById('overlay').classList.remove('show');
  });

  els.advanceBtn.addEventListener('click', () => runDay(false));

  document.getElementById('exportBtn').addEventListener('click', () => {
    const rows = [['Day','HR','SpO2','Temp','Radiation_mSv']].concat(telemetry.map(f => [f.day, f.hr, f.spo2, f.temp, f.rad]));
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'vitals-telemetry-log.csv';
    a.click();
  });
  document.getElementById('exportJsonBtn').addEventListener('click', () => {
    const data = { day: state.day, current: state.current, history: state.history, telemetry, alertsHistory, achievements: [...unlocked], crewName: document.getElementById('crewName').value };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'vitals-mission-report.json';
    a.click();
  });

  document.getElementById('resetBtn').addEventListener('click', () => {
    if (!confirm('Reset the mission simulation back to Day 0?')) return;
    localStorage.removeItem('vitals_state');
    if (location.protocol.startsWith('http')) {
      fetch(`${DB_API}?source=${encodeURIComponent(REALTIME_CLIENT_ID)}`, { method: 'DELETE' }).catch(() => {});
    }
    resetMissionUi('Systems reset. Mission restarting from Day 0.');
  });

  document.querySelectorAll('.navbtn').forEach(btn => {
    btn.addEventListener('click', () => goToPage(btn.dataset.page));
  });

  document.querySelectorAll('#roleSwitch button').forEach(btn => {
    btn.addEventListener('click', () => {
      setRole(btn.dataset.role);
      playBeep('click');
    });
  });
  document.getElementById('loginBtn')?.addEventListener('click', () => {
    const role = document.getElementById('loginRole').value;
    const name = document.getElementById('loginName').value.trim() || role.replace(/^\w/, c => c.toUpperCase());
    authUser = { name, role, signedInAt: Date.now() };
    localStorage.setItem('vitals_auth_user', JSON.stringify(authUser));
    setRole(role === 'admin' ? 'ground' : role);
    renderOperations();
    saveState();
    pushToast(`Signed in as ${name} (${role.toUpperCase()}).`, 'ok');
  });
  document.querySelectorAll('#sourceModeSwitch button').forEach(btn => {
    btn.addEventListener('click', () => {
      dataSourceMode = btn.dataset.sourceMode;
      localStorage.setItem('vitals_source_mode', dataSourceMode);
      renderOperations();
      saveState();
      pushToast(`Data source mode set to ${dataSourceMode}.`, 'ok');
    });
  });
  document.getElementById('addNoteBtn')?.addEventListener('click', () => {
    const canWriteNotes = ['surgeon', 'admin'].includes(authUser?.role || appRole);
    if (!canWriteNotes) {
      pushToast('Flight surgeon or admin login required to add clinical notes.', 'watch');
      return;
    }
    const noteText = document.getElementById('noteText').value.trim();
    if (!noteText) {
      pushToast('Write a note before saving.', 'watch');
      return;
    }
    const alertIndex = Number(document.getElementById('noteAlertSelect').value);
    const status = document.getElementById('noteStatus').value;
    const severity = document.getElementById('noteSeverity').value;
    if (alertIndex >= 0 && alertsHistory[alertIndex]) {
      alertsHistory[alertIndex].status = status;
      alertsHistory[alertIndex].sev = severity;
    }
    surgeonNotes.unshift({
      day: state.day,
      alertIndex,
      status,
      severity,
      note: noteText,
      author: authUser?.name || 'Flight Surgeon',
      createdAt: Date.now()
    });
    document.getElementById('noteText').value = '';
    renderAlertsFeed();
    renderSurgeonNotes();
    saveState();
    pushToast('Flight surgeon note saved.', severity === 'crit' ? 'crit' : 'ok');
  });
  document.getElementById('reportBtn')?.addEventListener('click', openMissionReport);
  document.getElementById('structuredBtn')?.addEventListener('click', checkStructuredDatabase);
  document.getElementById('importCsvBtn')?.addEventListener('click', importTelemetryCsv);
  document.getElementById('replayStartBtn')?.addEventListener('click', startReplay);
  document.getElementById('replayStopBtn')?.addEventListener('click', () => stopReplay(true));
  document.getElementById('replaySlider')?.addEventListener('input', (e) => showReplayDay(e.target.value));
  window.addEventListener('online', flushOfflineQueue);
  window.addEventListener('offline', () => { dbOnline = false; renderOperations(); });

  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = btn.parentElement.dataset.cite;
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = 'COPIED'; btn.classList.add('copied');
        setTimeout(() => { btn.textContent = 'COPY'; btn.classList.remove('copied'); }, 1800);
      }).catch(() => {});
    });
  });

  // ---- Theme toggle ----
  const themeBtn = document.getElementById('themeBtn');
  const themeModes = ['dark', 'light', 'emergency', 'deep'];
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', settings.theme);
    themeBtn.textContent = settings.theme === 'dark' ? '🌙' : settings.theme === 'light' ? '☀️' : settings.theme === 'emergency' ? '!' : '◇';
    localStorage.setItem('vitals_theme', settings.theme);
    updateThemeChips();
    drawTrendChart(); drawOverviewRing(); drawGauge();
  }
  themeBtn.addEventListener('click', () => {
    const i = themeModes.indexOf(settings.theme);
    settings.theme = themeModes[(i + 1) % themeModes.length];
    applyTheme();
  });
  document.querySelectorAll('#themeModeRow .theme-chip').forEach(btn => {
    btn.addEventListener('click', () => { settings.theme = btn.dataset.themeMode; applyTheme(); playBeep('click'); });
  });
  applyTheme();

  // ---- Sound toggle ----
  const soundBtn = document.getElementById('soundBtn');
  function applySound() {
    soundBtn.textContent = settings.sound ? '🔊' : '🔇';
    soundBtn.classList.toggle('muted', !settings.sound);
    localStorage.setItem('vitals_sound', settings.sound ? '1' : '0');
  }
  soundBtn.addEventListener('click', () => { settings.sound = !settings.sound; applySound(); });
  applySound();

  // ---- Undo ----
  document.getElementById('undoBtn').addEventListener('click', undoLastDay);

  // ---- Glossary ----
  const glossaryModal = document.getElementById('glossaryModal');
  document.getElementById('glossaryBtn').addEventListener('click', () => glossaryModal.classList.add('show'));
  document.getElementById('glossaryClose').addEventListener('click', () => glossaryModal.classList.remove('show'));
  glossaryModal.addEventListener('click', (e) => { if (e.target === glossaryModal) glossaryModal.classList.remove('show'); });

  // ---- Keyboard shortcuts ----
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    const pages = ['dashboard','overview','vitals','trends','comms','assistant','checkin','operations','achievements'];
    if (e.key === '?' ) { glossaryModal.classList.toggle('show'); e.preventDefault(); return; }
    if (e.key === 'Escape') { glossaryModal.classList.remove('show'); document.getElementById('overlay').classList.remove('show'); return; }
    if (/^[1-9]$/.test(e.key)) { goToPage(pages[+e.key - 1]); e.preventDefault(); return; }
    if (e.shiftKey && e.key === 'ArrowRight') { els.advanceBtn.click(); e.preventDefault(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { undoLastDay(); e.preventDefault(); return; }
  });

  // ---- Hash routing ----
  function handleHash() {
    const hash = location.hash.replace('#','');
    if (hash && document.getElementById('page-' + hash)) {
      document.querySelectorAll('.navbtn').forEach(b => b.classList.toggle('active', b.dataset.page === hash));
      document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + hash));
    }
  }
  window.addEventListener('hashchange', handleHash);

  // ---- Intro / disclaimer ----
  const INTRO_KEY = 'vitals_intro_seen';
  function showIntro() {
    showOverlay('Welcome to VITALS',
      'This is a training simulation of an astronaut health monitor — NOT a real medical device. Readings are modeled from NASA-funded spaceflight research. Use the sidebar (or keys 1-9) to navigate, log daily check-ins, and watch how choices compound over the mission. Press "?" for a glossary.');
    localStorage.setItem(INTRO_KEY, '1');
  }
  document.getElementById('replayIntroBtn').addEventListener('click', showIntro);

  // ---- Visual effects ----
  function initCinematicUi() {
    const canvas = document.getElementById('spaceBackdrop');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const prefersStill = settings.reduceMotion;
    let w = 0, h = 0, stars = [], rafId = null;

    function resizeBackdrop() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(150, Math.max(70, Math.floor((w * h) / 11000)));
      stars = Array.from({ length: count }, (_, i) => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.55 + 0.25,
        s: Math.random() * 0.34 + 0.08,
        hue: i % 9 === 0 ? '199,125,255' : i % 7 === 0 ? '242,193,78' : '79,211,232',
        phase: Math.random() * Math.PI * 2
      }));
    }

    function drawBackdrop(t) {
      ctx.clearRect(0, 0, w, h);
      const dark = document.documentElement.getAttribute('data-theme') !== 'light';
      const glow = ctx.createRadialGradient(w * 0.64, h * 0.2, 0, w * 0.64, h * 0.2, Math.max(w, h) * 0.62);
      glow.addColorStop(0, dark ? 'rgba(79,211,232,0.16)' : 'rgba(13,143,168,0.12)');
      glow.addColorStop(0.44, dark ? 'rgba(199,125,255,0.05)' : 'rgba(242,193,78,0.06)');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      stars.forEach(star => {
        const twinkle = prefersStill ? 0.7 : 0.45 + Math.sin(t * 0.0015 + star.phase) * 0.35;
        ctx.beginPath();
        ctx.fillStyle = `rgba(${star.hue},${dark ? twinkle : twinkle * 0.55})`;
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
        if (!prefersStill) {
          star.y += star.s;
          star.x += Math.sin((t + star.phase) * 0.0006) * 0.08;
          if (star.y > h + 8) { star.y = -8; star.x = Math.random() * w; }
        }
      });

      if (!prefersStill) rafId = requestAnimationFrame(drawBackdrop);
    }

    function moveLight(e) {
      const x = Math.round((e.clientX / window.innerWidth) * 100);
      const y = Math.round((e.clientY / window.innerHeight) * 100);
      document.body.style.setProperty('--mx', x + '%');
      document.body.style.setProperty('--my', y + '%');
    }

    function wireTilt(card) {
      card.addEventListener('pointermove', (e) => {
        if (prefersStill) return;
        const rect = card.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width - 0.5;
        const py = (e.clientY - rect.top) / rect.height - 0.5;
        card.style.setProperty('--tiltX', (px * 4).toFixed(2) + 'deg');
        card.style.setProperty('--tiltY', (-py * 4).toFixed(2) + 'deg');
      });
      card.addEventListener('pointerleave', () => {
        card.style.setProperty('--tiltX', '0deg');
        card.style.setProperty('--tiltY', '0deg');
      });
    }

    function pulseTarget(target) {
      const el = target.closest('.panel, .card, .vital-mini, #statusBar, .chat-shell');
      if (!el) return;
      el.classList.remove('sensor-pulse');
      void el.offsetWidth;
      el.classList.add('sensor-pulse');
    }

    function animateOrbit(t) {
      const scene = document.getElementById('orbitScene');
      if (!scene) return;
      const a = (t || 0) * 0.00045;
      const depth = (Math.sin(a) + 1) / 2;
      scene.style.setProperty('--station-x', (Math.cos(a) * 146).toFixed(1) + 'px');
      scene.style.setProperty('--station-y', (Math.sin(a) * 54).toFixed(1) + 'px');
      scene.style.setProperty('--station-r', (Math.sin(a) * 18 + 8).toFixed(1) + 'deg');
      scene.style.setProperty('--station-scale', (0.78 + depth * 0.34).toFixed(2));
      scene.style.setProperty('--station-opacity', (0.62 + depth * 0.38).toFixed(2));
      scene.style.setProperty('--station-z', depth > 0.48 ? 5 : 1);
      document.getElementById('orbitHud').textContent = 'ALT ' + Math.round(405 + Math.sin(a * 2) * 6) + ' KM';
      if (!prefersStill) requestAnimationFrame(animateOrbit);
    }

    resizeBackdrop();
    drawBackdrop(0);
    animateOrbit(0);
    window.addEventListener('resize', resizeBackdrop);
    window.addEventListener('pointermove', moveLight, { passive: true });
    const orbitScene = document.getElementById('orbitScene');
    if (orbitScene) {
      orbitScene.addEventListener('pointermove', (e) => {
        const rect = orbitScene.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width - 0.5;
        orbitScene.style.setProperty('--orbit-tilt', (-12 + px * 18).toFixed(1) + 'deg');
        orbitScene.style.setProperty('--astro-r', (-10 + px * 24).toFixed(1) + 'deg');
      });
      orbitScene.addEventListener('pointerleave', () => {
        orbitScene.style.setProperty('--orbit-tilt', '-12deg');
        orbitScene.style.setProperty('--astro-r', '-10deg');
      });
    }
    document.querySelectorAll('.card').forEach(wireTilt);
    document.getElementById('cardGrid').addEventListener('pointerover', (e) => {
      const card = e.target.closest('.card');
      if (card && !card.dataset.fxReady) {
        card.dataset.fxReady = '1';
        wireTilt(card);
      }
    });
    document.addEventListener('click', (e) => {
      if (e.target.closest('button, .card, .risk-cell')) {
        pulseTarget(e.target);
        playBeep('click');
      }
    });

    if (prefersStill && rafId) cancelAnimationFrame(rafId);
  }

  // ---- Init ----
  const loaded = loadState();
  buildCards();
  initCinematicUi();
  renderAll();
  renderPreview();
  renderStreaks();
  if (telemetry.length) document.getElementById('telemetryBody').innerHTML = telemetry.map(f => `<tr><td>${f.day}</td><td>${f.hr}</td><td>${f.spo2}</td><td>${f.temp}</td><td>${f.rad}</td></tr>`).join('');
  if (state.day > 0) els.advanceBtn.textContent = `LOG DAY ${state.day + 1} & ADVANCE`;
  pushTelemetryFrame(liveVitals());
  animateWave();
  setInterval(updateStatusBar, 1000);
  handleHash();
  if (!localStorage.getItem(INTRO_KEY)) setTimeout(showIntro, 500);
  loadStateFromDatabase().then(restored => {
    if (restored) {
      refreshFromPersistedState();
      pushToast('Mission state loaded from MySQL.', 'ok');
    }
    connectRealtimeDatabase();
    setRole(appRole, false);
    postPresence();
    flushOfflineQueue();
    setInterval(postPresence, 8000);
  });
})();
