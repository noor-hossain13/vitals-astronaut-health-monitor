const path = require('path');
const express = require('express');
const mysql = require('mysql2/promise');
require('dotenv').config();

const app = express();
const port = Number(process.env.PORT || 3000);
const dbName = process.env.DB_NAME || 'vitals_db';

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true
};

let pool;
const realtimeClients = new Map();
const presence = new Map();

async function ensureDatabase() {
  const bootstrap = mysql.createPool(dbConfig);
  await bootstrap.query(
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\`
     CHARACTER SET utf8mb4
     COLLATE utf8mb4_unicode_ci`
  );
  await bootstrap.end();

  pool = mysql.createPool({ ...dbConfig, database: dbName });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mission_states (
      mission_id VARCHAR(64) PRIMARY KEY,
      payload JSON NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS missions (
      mission_id VARCHAR(64) PRIMARY KEY,
      crew_name VARCHAR(120),
      current_day INT NOT NULL DEFAULT 0,
      mode VARCHAR(32) NOT NULL DEFAULT 'simulation',
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_logs (
      mission_id VARCHAR(64) NOT NULL,
      day INT NOT NULL,
      payload JSON NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (mission_id, day)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS telemetry_frames (
      mission_id VARCHAR(64) NOT NULL,
      day INT NOT NULL,
      hr INT,
      spo2 INT,
      temp DECIMAL(4,1),
      rad DECIMAL(8,2),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (mission_id, day)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS alerts (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      mission_id VARCHAR(64) NOT NULL,
      day INT NOT NULL,
      severity VARCHAR(16) NOT NULL,
      text TEXT NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'open',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX alerts_mission_day_idx (mission_id, day)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS comms_messages (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      mission_id VARCHAR(64) NOT NULL,
      day INT NOT NULL,
      message_type VARCHAR(24) NOT NULL,
      severity VARCHAR(16),
      text TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX comms_messages_mission_day_idx (mission_id, day)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS achievements (
      mission_id VARCHAR(64) NOT NULL,
      achievement_key VARCHAR(64) NOT NULL,
      unlocked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (mission_id, achievement_key)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS flight_surgeon_notes (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      mission_id VARCHAR(64) NOT NULL,
      day INT NOT NULL,
      alert_index INT,
      status VARCHAR(32) NOT NULL,
      severity VARCHAR(16) NOT NULL,
      note TEXT NOT NULL,
      author VARCHAR(120),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX flight_surgeon_notes_mission_day_idx (mission_id, day)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mission_telemetry (
      mission_id VARCHAR(64) NOT NULL,
      day INT NOT NULL,
      hr INT,
      spo2 INT,
      temp DECIMAL(4,1),
      rad DECIMAL(8,2),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (mission_id, day)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mission_alerts (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      mission_id VARCHAR(64) NOT NULL,
      day INT NOT NULL,
      severity VARCHAR(16) NOT NULL,
      text TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX mission_alerts_mission_day_idx (mission_id, day)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mission_comms (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      mission_id VARCHAR(64) NOT NULL,
      day INT NOT NULL,
      message_type VARCHAR(24) NOT NULL,
      severity VARCHAR(16),
      text TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX mission_comms_mission_day_idx (mission_id, day)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mission_achievements (
      mission_id VARCHAR(64) NOT NULL,
      achievement_key VARCHAR(64) NOT NULL,
      unlocked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (mission_id, achievement_key)
    )
  `);
}

function errorPayload(error) {
  return {
    ok: false,
    error: error.message || error.code || 'Unknown database error',
    code: error.code || null
  };
}

function normalizePayload(payload) {
  if (typeof payload !== 'string') return payload;
  try {
    return JSON.parse(payload);
  } catch {
    return {};
  }
}

function sendRealtimeEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcastMissionState(missionId, event, data) {
  const clients = realtimeClients.get(missionId);
  if (!clients) return;
  for (const client of clients) {
    sendRealtimeEvent(client, event, data);
  }
}

function onlinePresence(missionId) {
  const cutoff = Date.now() - 20000;
  return [...presence.values()]
    .filter(item => item.missionId === missionId && item.lastSeen >= cutoff)
    .map(({ clientId, role, name, lastSeen }) => ({ clientId, role, name, lastSeen }));
}

async function writeStructuredMission(missionId, payload) {
  await pool.execute(
    `INSERT INTO missions (mission_id, crew_name, current_day, mode)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE crew_name = VALUES(crew_name), current_day = VALUES(current_day), mode = VALUES(mode)`,
    [missionId, payload.crewName || 'Commander', payload.day || 0, payload.dataSourceMode || 'simulation']
  );
  await pool.execute('DELETE FROM mission_telemetry WHERE mission_id = ?', [missionId]);
  await pool.execute('DELETE FROM mission_alerts WHERE mission_id = ?', [missionId]);
  await pool.execute('DELETE FROM mission_comms WHERE mission_id = ?', [missionId]);
  await pool.execute('DELETE FROM mission_achievements WHERE mission_id = ?', [missionId]);
  await pool.execute('DELETE FROM daily_logs WHERE mission_id = ?', [missionId]);
  await pool.execute('DELETE FROM telemetry_frames WHERE mission_id = ?', [missionId]);
  await pool.execute('DELETE FROM alerts WHERE mission_id = ?', [missionId]);
  await pool.execute('DELETE FROM comms_messages WHERE mission_id = ?', [missionId]);
  await pool.execute('DELETE FROM achievements WHERE mission_id = ?', [missionId]);
  await pool.execute('DELETE FROM flight_surgeon_notes WHERE mission_id = ?', [missionId]);

  const historyDays = Math.max(0, payload.day || 0);
  for (let day = 0; day <= historyDays; day += 1) {
    const log = {
      day,
      bone: payload.history?.bone?.[day] ?? null,
      cardio: payload.history?.cardio?.[day] ?? null,
      immune: payload.history?.immune?.[day] ?? null,
      radiation: payload.history?.radiation?.[day] ?? null,
      behavioral: payload.history?.behavioral?.[day] ?? null
    };
    await pool.execute(
      `INSERT INTO daily_logs (mission_id, day, payload)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE payload = VALUES(payload)`,
      [missionId, day, JSON.stringify(log)]
    );
  }

  const telemetry = Array.isArray(payload.telemetry) ? payload.telemetry : [];
  for (const frame of telemetry) {
    await pool.execute(
      `INSERT INTO mission_telemetry (mission_id, day, hr, spo2, temp, rad)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE hr = VALUES(hr), spo2 = VALUES(spo2), temp = VALUES(temp), rad = VALUES(rad)`,
      [missionId, frame.day || 0, frame.hr || null, frame.spo2 || null, frame.temp || null, frame.rad || null]
    );
    await pool.execute(
      `INSERT INTO telemetry_frames (mission_id, day, hr, spo2, temp, rad)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE hr = VALUES(hr), spo2 = VALUES(spo2), temp = VALUES(temp), rad = VALUES(rad)`,
      [missionId, frame.day || 0, frame.hr || null, frame.spo2 || null, frame.temp || null, frame.rad || null]
    );
  }

  const alerts = Array.isArray(payload.alertsHistory) ? payload.alertsHistory : [];
  for (const [index, alert] of alerts.entries()) {
    await pool.execute(
      `INSERT INTO mission_alerts (mission_id, day, severity, text)
       VALUES (?, ?, ?, ?)`,
      [missionId, alert.day || 0, alert.sev || 'ok', alert.text || '']
    );
    await pool.execute(
      `INSERT INTO alerts (mission_id, day, severity, text, status)
       VALUES (?, ?, ?, ?, ?)`,
      [missionId, alert.day || 0, alert.sev || 'ok', alert.text || '', alert.status || 'open']
    );
  }

  const comms = Array.isArray(payload.commsThread) ? payload.commsThread : [];
  for (const message of comms) {
    await pool.execute(
      `INSERT INTO mission_comms (mission_id, day, message_type, severity, text)
       VALUES (?, ?, ?, ?, ?)`,
      [missionId, message.day || 0, message.type || 'auto', message.sev || null, message.text || '']
    );
    await pool.execute(
      `INSERT INTO comms_messages (mission_id, day, message_type, severity, text)
       VALUES (?, ?, ?, ?, ?)`,
      [missionId, message.day || 0, message.type || 'auto', message.sev || null, message.text || '']
    );
  }

  const achievements = Array.isArray(payload.unlocked) ? payload.unlocked : [];
  for (const key of achievements) {
    await pool.execute(
      `INSERT INTO mission_achievements (mission_id, achievement_key)
       VALUES (?, ?)`,
      [missionId, key]
    );
    await pool.execute(
      `INSERT INTO achievements (mission_id, achievement_key)
       VALUES (?, ?)`,
      [missionId, key]
    );
  }

  const notes = Array.isArray(payload.surgeonNotes) ? payload.surgeonNotes : [];
  for (const note of notes) {
    await pool.execute(
      `INSERT INTO flight_surgeon_notes (mission_id, day, alert_index, status, severity, note, author)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [missionId, note.day || 0, note.alertIndex ?? null, note.status || 'reviewed', note.severity || 'watch', note.note || '', note.author || 'Flight Surgeon']
    );
  }
}

app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname));

app.get('/api/health', async (req, res) => {
  if (!pool) {
    res.status(503).json({ ok: false, error: 'Database offline. Dashboard is running in local/offline mode.', code: 'DB_OFFLINE' });
    return;
  }
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json(errorPayload(error));
  }
});

app.get('/api/mission-state/:missionId', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT payload, updated_at FROM mission_states WHERE mission_id = ?',
      [req.params.missionId]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Mission state not found.' });
    res.json({ ok: true, payload: normalizePayload(rows[0].payload), updatedAt: rows[0].updated_at });
  } catch (error) {
    res.status(500).json(errorPayload(error));
  }
});

app.get('/api/mission-state/:missionId/stream', async (req, res) => {
  const missionId = req.params.missionId;
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();

  if (!realtimeClients.has(missionId)) realtimeClients.set(missionId, new Set());
  realtimeClients.get(missionId).add(res);
  sendRealtimeEvent(res, 'connected', { ok: true, missionId });

  try {
    const [rows] = await pool.execute(
      'SELECT payload, updated_at FROM mission_states WHERE mission_id = ?',
      [missionId]
    );
    if (rows.length) {
      sendRealtimeEvent(res, 'state', {
        ok: true,
        payload: normalizePayload(rows[0].payload),
        updatedAt: rows[0].updated_at
      });
    }
  } catch (error) {
    sendRealtimeEvent(res, 'error', errorPayload(error));
  }

  req.on('close', () => {
    const clients = realtimeClients.get(missionId);
    if (!clients) return;
    clients.delete(res);
    if (!clients.size) realtimeClients.delete(missionId);
  });
});

app.get('/api/mission-state/:missionId/structured', async (req, res) => {
  try {
    const missionId = req.params.missionId;
    const [telemetry] = await pool.execute(
      'SELECT day, hr, spo2, temp, rad, created_at FROM mission_telemetry WHERE mission_id = ? ORDER BY day',
      [missionId]
    );
    const [alerts] = await pool.execute(
      'SELECT day, severity, text, created_at FROM mission_alerts WHERE mission_id = ? ORDER BY id DESC',
      [missionId]
    );
    const [comms] = await pool.execute(
      'SELECT day, message_type, severity, text, created_at FROM mission_comms WHERE mission_id = ? ORDER BY id',
      [missionId]
    );
    const [achievements] = await pool.execute(
      'SELECT achievement_key, unlocked_at FROM mission_achievements WHERE mission_id = ? ORDER BY unlocked_at',
      [missionId]
    );
    const [notes] = await pool.execute(
      'SELECT day, alert_index, status, severity, note, author, created_at FROM flight_surgeon_notes WHERE mission_id = ? ORDER BY id DESC',
      [missionId]
    );
    res.json({ ok: true, telemetry, alerts, comms, achievements, notes });
  } catch (error) {
    res.status(500).json(errorPayload(error));
  }
});

app.post('/api/mission-state/:missionId/presence', (req, res) => {
  const item = {
    missionId: req.params.missionId,
    clientId: req.body.clientId || `${Date.now()}-${Math.random()}`,
    role: req.body.role || 'crew',
    name: req.body.name || 'Operator',
    lastSeen: Date.now()
  };
  presence.set(item.clientId, item);
  const users = onlinePresence(req.params.missionId);
  broadcastMissionState(req.params.missionId, 'presence', { ok: true, users });
  res.json({ ok: true, users });
});

app.put('/api/mission-state/:missionId', async (req, res) => {
  try {
    const payload = req.body || {};
    await pool.execute(
      `INSERT INTO mission_states (mission_id, payload)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE payload = VALUES(payload)`,
      [req.params.missionId, JSON.stringify(payload)]
    );
    await writeStructuredMission(req.params.missionId, payload);
    broadcastMissionState(req.params.missionId, 'state', {
      ok: true,
      payload,
      updatedAt: new Date().toISOString()
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json(errorPayload(error));
  }
});

app.delete('/api/mission-state/:missionId', async (req, res) => {
  try {
    await pool.execute('DELETE FROM mission_states WHERE mission_id = ?', [req.params.missionId]);
    await pool.execute('DELETE FROM mission_telemetry WHERE mission_id = ?', [req.params.missionId]);
    await pool.execute('DELETE FROM mission_alerts WHERE mission_id = ?', [req.params.missionId]);
    await pool.execute('DELETE FROM mission_comms WHERE mission_id = ?', [req.params.missionId]);
    await pool.execute('DELETE FROM mission_achievements WHERE mission_id = ?', [req.params.missionId]);
    await pool.execute('DELETE FROM missions WHERE mission_id = ?', [req.params.missionId]);
    await pool.execute('DELETE FROM daily_logs WHERE mission_id = ?', [req.params.missionId]);
    await pool.execute('DELETE FROM telemetry_frames WHERE mission_id = ?', [req.params.missionId]);
    await pool.execute('DELETE FROM alerts WHERE mission_id = ?', [req.params.missionId]);
    await pool.execute('DELETE FROM comms_messages WHERE mission_id = ?', [req.params.missionId]);
    await pool.execute('DELETE FROM achievements WHERE mission_id = ?', [req.params.missionId]);
    await pool.execute('DELETE FROM flight_surgeon_notes WHERE mission_id = ?', [req.params.missionId]);
    broadcastMissionState(req.params.missionId, 'reset', {
      ok: true,
      sourceClientId: req.query.source || null,
      updatedAt: new Date().toISOString()
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json(errorPayload(error));
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'vitals.html'));
});

ensureDatabase()
  .then(() => {
    app.listen(port, () => {
      console.log(`VITALS running at http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error('Could not connect to MySQL:', error.message || error.code || error);
    console.error('Starting dashboard in offline-first mode. Static app works; DB endpoints will retry/fail until MySQL is available.');
    app.listen(port, () => {
      console.log(`VITALS running without database at http://localhost:${port}`);
    });
  });
