(() => {
  const signals = [
    ['heart_rate', 'HEART RATE', 'bpm'], ['hrv', 'HRV', 'ms'], ['spo2', 'SpO₂', '%'],
    ['sleep_hours', 'SLEEP', 'h'], ['core_temperature', 'CORE TEMP', '°C'], ['exercise_minutes', 'EXERCISE', 'min'],
  ];
  const els = {
    signals: document.querySelector('#signals'), alerts: document.querySelector('#alertList'),
    summary: document.querySelector('#summary'), explanation: document.querySelector('#explanationBody'),
    alertCount: document.querySelector('#alertCount'), state: document.querySelector('#streamState'),
    connection: document.querySelector('#connection'), clock: document.querySelector('#clock'),
    pause: document.querySelector('#pause'), reset: document.querySelector('#reset'), speed: document.querySelector('#speed'), speedValue: document.querySelector('#speedValue'),
  };
  let ws, paused = false;

  const card = ([key, label, unit]) => `<article class="signal card" id="signal-${key}"><div class="signal-top"><div><div class="signal-name">${label}</div><div class="signal-value">— <small>${unit}</small></div></div><span class="z-tag">BASELINE</span></div><svg class="chart" viewBox="0 0 300 108" preserveAspectRatio="none" aria-label="${label} trend"></svg><div class="baseline-copy"><span>PERSONAL BASELINE: —</span><span>z: —</span></div></article>`;
  els.signals.innerHTML = signals.map(card).join('');

  function send(message) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); }
  function scale(vals, minY, maxY, width=300, height=108) { return vals.map((v, i) => `${(i * width / Math.max(vals.length - 1, 1)).toFixed(1)},${(height - ((v-minY)/(maxY-minY || 1))*height).toFixed(1)}`).join(' '); }
  function renderSignal(key, label, unit, rows, alert) {
    const el = document.querySelector(`#signal-${key}`), values = rows.map(r => r[key]);
    if (!values.length) return;
    const current = values.at(-1), base = alert?.baseline_mean, sd = alert?.baseline_sd;
    const fallbackBase = values.length > 1 ? values.slice(0, -1).reduce((a,b)=>a+b,0)/(values.length-1) : current;
    const bandMean = base ?? fallbackBase, bandSd = sd ?? 0;
    const all = [...values, bandMean-bandSd*2, bandMean+bandSd*2]; const min = Math.min(...all), max = Math.max(...all);
    const y = v => (108 - ((v-min)/(max-min || 1))*108).toFixed(1);
    const svg = el.querySelector('svg');
    const upper=y(bandMean+2*bandSd), lower=y(bandMean-2*bandSd);
    svg.innerHTML = `<rect x="0" y="${Math.min(upper,lower)}" width="300" height="${Math.abs(lower-upper)}" fill="rgba(103,232,249,.12)"/><line x1="0" x2="300" y1="${y(bandMean)}" y2="${y(bandMean)}" stroke="rgba(103,232,249,.75)" stroke-dasharray="4 4"/><polyline points="${scale(values,min,max)}" fill="none" stroke="${alert?.fired ? '#fb7185' : '#79e3b2'}" stroke-width="3" stroke-linejoin="round"/><circle cx="300" cy="${y(current)}" r="4" fill="${alert?.fired ? '#fb7185' : '#79e3b2'}"/>`;
    el.querySelector('.signal-value').innerHTML = `${current}<small>${unit}</small>`;
    el.querySelector('.baseline-copy').innerHTML = `<span>30D BASELINE: ${bandMean.toFixed(1)} ${unit}</span><span>z: ${alert?.z ?? '—'}</span>`;
    const tag = el.querySelector('.z-tag'); tag.textContent = alert?.fired ? 'RULE FIRED' : (values.length >= 31 ? 'WITHIN BAND' : 'BUILDING'); tag.classList.toggle('alert', !!alert?.fired);
  }
  function renderAlerts(alerts) {
    const singles = alerts.filter(a => a.rule !== 'multi_signal_deviation_48h');
    const multi = alerts.find(a => a.rule === 'multi_signal_deviation_48h');
    els.alertCount.textContent = alerts.length ? `${alerts.length} ACTIVE RULE${alerts.length>1?'S':''}` : 'NO ACTIVE RULES';
    els.alerts.innerHTML = !alerts.length ? '<div class="empty">No rules are firing. VITALS is comparing incoming simulated readings against the crew member’s preceding personal baseline.</div>' : [
      multi ? `<div class="alert multi"><div class="alert-head">MULTI-SIGNAL DEVIATION <span>48H RULE</span></div><p>${multi.signals.map(s=>s.replace('_',' ').toUpperCase()).join(' + ')} each deviated in the same 48-hour window.</p></div>` : '',
      ...singles.map(a=>`<div class="alert"><div class="alert-head">${a.rule.toUpperCase().replaceAll('_',' ')} <span>z ${a.z}</span></div><p>Current ${a.current} ${a.unit} • 30-day mean ${a.baseline_mean} ${a.unit} • SD ${a.baseline_sd} • rule threshold ±2.0 SD</p></div>`)
    ].join('');
  }
  function renderExplanation(alerts) {
    const target = alerts.find(a=>a.rule === 'multi_signal_deviation_48h') || alerts[0];
    if (!target) { els.explanation.innerHTML='<p>When a rule fires, this panel will state the measured deviation and link to a relevant published NASA OSDR study.</p>'; return; }
    const {text, study} = target.explanation;
    els.explanation.innerHTML = `<p>${text}</p><aside class="study"><b>EVIDENCE CITATION</b><a href="${study.url}" target="_blank" rel="noreferrer">${study.id} — ${study.title} ↗</a><p>${study.context}</p></aside>`;
  }
  function update(data) {
    const singles = Object.fromEntries(data.alerts.filter(a=>a.signal).map(a=>[a.signal,a]));
    signals.forEach(([key,label,unit]) => renderSignal(key,label,unit,data.history,singles[key]));
    renderAlerts(data.alerts); renderExplanation(data.alerts); els.summary.textContent=data.summary;
    els.state.textContent = data.alerts.length ? 'Rule evidence detected' : 'Stream nominal';
    els.clock.textContent = `SIM DAY ${String(data.index+1).padStart(2,'0')} / ${data.history.length}`;
  }
  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'; ws = new WebSocket(`${protocol}://${location.host}/ws/replay`);
    ws.onopen = () => { els.connection.textContent='CONNECTED'; els.state.textContent='Stream running'; send({action:'speed',value:els.speed.value}); };
    ws.onmessage = e => { const data=JSON.parse(e.data); if(data.type==='tick') update(data); if(data.type==='complete'){els.state.textContent='Replay complete';els.pause.textContent='Resume';} if(data.type==='pause'){paused=data.paused;els.pause.textContent=paused?'Resume':'Pause';} if(data.type==='reset'){els.state.textContent='Replay reset';} };
    ws.onclose = () => { els.connection.textContent='RECONNECTING'; setTimeout(connect,1500); };
  }
  els.pause.onclick=()=>send({action:'pause'}); els.reset.onclick=()=>send({action:'reset'}); els.speed.oninput=()=>{els.speedValue.textContent=`${els.speed.value}×`;send({action:'speed',value:els.speed.value});}; connect();
})();
