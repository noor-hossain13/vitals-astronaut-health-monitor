/* VITALS Evidence Stream. Rendering only: all detection happens in src/compute.py. */
(() => {
  const defs = [['heart_rate','HEART RATE','bpm'],['hrv','HRV','ms'],['spo2','SpO₂','%'],['sleep_hours','SLEEP','h'],['core_temperature','CORE TEMP','°C'],['exercise_minutes','EXERCISE','min']];
  const el = id => document.getElementById(id);
  const host = el('evSignals'); if (!host) return;
  host.innerHTML = defs.map(([key,name,unit]) => `<div class="panel ev-signal" id="ev-${key}"><div class="ev-signal-top"><div><div class="ev-signal-name">${name}</div><div class="ev-signal-value">— <small>${unit}</small></div></div><span class="ev-tag">BUILDING</span></div><svg class="ev-chart" viewBox="0 0 250 76" preserveAspectRatio="none"></svg><div class="ev-signal-meta"><span>30D: —</span><span>z: —</span></div></div>`).join('');
  let socket;
  const send = body => { if(socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(body)); };
  const points = (values,min,max) => values.map((v,i)=>`${i*250/Math.max(values.length-1,1)},${76-((v-min)/(max-min||1))*76}`).join(' ');
  function signal(key, unit, history, rule) {
    const card=el(`ev-${key}`), vals=history.map(r=>r[key]), current=vals.at(-1), mean=rule?.baseline_mean ?? (vals.reduce((a,b)=>a+b,0)/vals.length), sd=rule?.baseline_sd ?? 0;
    const low=Math.min(...vals,mean-2*sd), high=Math.max(...vals,mean+2*sd), y=v=>76-((v-low)/(high-low||1))*76;
    card.querySelector('.ev-signal-value').innerHTML=`${current}<small>${unit}</small>`;
    card.querySelector('.ev-signal-meta').innerHTML=`<span>30D: ${mean.toFixed(1)} ${unit}</span><span>z: ${rule?.z ?? '—'}</span>`;
    const tag=card.querySelector('.ev-tag'); tag.textContent=rule?.fired?'RULE FIRED':(vals.length>=31?'WITHIN BAND':'BUILDING');tag.classList.toggle('alert',!!rule?.fired);
    card.querySelector('svg').innerHTML=`<rect x="0" y="${Math.min(y(mean-2*sd),y(mean+2*sd))}" width="250" height="${Math.abs(y(mean-2*sd)-y(mean+2*sd))}" fill="rgba(79,211,232,.13)"/><line x1="0" x2="250" y1="${y(mean)}" y2="${y(mean)}" stroke="rgba(79,211,232,.8)" stroke-dasharray="4 4"/><polyline points="${points(vals,low,high)}" fill="none" stroke="${rule?.fired?'#ff5d5d':'#4ad99b'}" stroke-width="3"/><circle cx="250" cy="${y(current)}" r="3.5" fill="${rule?.fired?'#ff5d5d':'#4ad99b'}"/>`;
  }
  function alerts(list) {
    const singles=list.filter(a=>a.signal), multi=list.find(a=>a.rule==='multi_signal_deviation_48h'); el('evAlertCount').textContent=list.length?`${list.length} ACTIVE RULE${list.length>1?'S':''}`:'NO ACTIVE RULES';
    el('evAlerts').innerHTML=!list.length?'<p class="empty-evidence">No rules firing. The simulated stream is being compared with this crew member’s own baseline.</p>':`${multi?`<div class="ev-alert multi"><div class="ev-alert-head">MULTI-SIGNAL DEVIATION <b>48H RULE</b></div><p>${multi.signals.map(x=>x.replace('_',' ').toUpperCase()).join(' + ')} crossed tested thresholds in the same 48-hour window.</p></div>`:''}${singles.map(a=>`<div class="ev-alert"><div class="ev-alert-head">${a.rule.replaceAll('_',' ').toUpperCase()} <b>z ${a.z}</b></div><p>Current ${a.current} ${a.unit} · mean ${a.baseline_mean} ${a.unit} · SD ${a.baseline_sd} · threshold ±2 SD</p></div>`).join('')}`;
    const focus=multi||singles[0]; if(focus){const x=focus.explanation, study=x.study;el('evExplanation').innerHTML=`<div>${x.text}</div><div class="ev-study"><b>EVIDENCE CITATION</b><a target="_blank" rel="noopener" href="${study.url}">${study.id} — ${study.title} ↗</a><div>${study.context}</div></div>`;}
  }
  function render(payload) {
    const rules=Object.fromEntries(payload.alerts.filter(a=>a.signal).map(a=>[a.signal,a])); defs.forEach(([key,,unit])=>signal(key,unit,payload.history,rules[key])); alerts(payload.alerts);el('evSummary').textContent=payload.summary;el('evState').textContent=payload.alerts.length?'Evidence detected in replay':'Stream nominal';el('evClock').textContent=`DAY ${String(payload.index+1).padStart(2,'0')} / ${payload.history.length}`;
  }
  function connect(){const p=location.protocol==='https:'?'wss':'ws';socket=new WebSocket(`${p}://${location.host}/ws/replay`);socket.onopen=()=>{el('evConnection').textContent='CONNECTED';send({action:'speed',value:el('evSpeed').value});};socket.onmessage=e=>{const data=JSON.parse(e.data);if(data.type==='tick')render(data);if(data.type==='pause')el('evPause').textContent=data.paused?'Resume':'Pause';if(data.type==='complete'){el('evState').textContent='Replay complete';el('evPause').textContent='Resume';}};socket.onclose=()=>{el('evConnection').textContent='RECONNECTING';setTimeout(connect,1500);};}
  el('evPause').onclick=()=>send({action:'pause'});el('evReset').onclick=()=>send({action:'reset'});el('evSpeed').oninput=e=>{el('evSpeedValue').textContent=`${e.target.value}×`;send({action:'speed',value:e.target.value});};connect();
})();
