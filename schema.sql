CREATE DATABASE IF NOT EXISTS vitals_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE vitals_db;

CREATE TABLE IF NOT EXISTS mission_states (
  mission_id VARCHAR(64) PRIMARY KEY,
  payload JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS missions (
  mission_id VARCHAR(64) PRIMARY KEY,
  crew_name VARCHAR(120),
  current_day INT NOT NULL DEFAULT 0,
  mode VARCHAR(32) NOT NULL DEFAULT 'simulation',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS daily_logs (
  mission_id VARCHAR(64) NOT NULL,
  day INT NOT NULL,
  payload JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (mission_id, day)
);

CREATE TABLE IF NOT EXISTS telemetry_frames (
  mission_id VARCHAR(64) NOT NULL,
  day INT NOT NULL,
  hr INT,
  spo2 INT,
  temp DECIMAL(4,1),
  rad DECIMAL(8,2),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (mission_id, day)
);

CREATE TABLE IF NOT EXISTS alerts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  mission_id VARCHAR(64) NOT NULL,
  day INT NOT NULL,
  severity VARCHAR(16) NOT NULL,
  text TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX alerts_mission_day_idx (mission_id, day)
);

CREATE TABLE IF NOT EXISTS comms_messages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  mission_id VARCHAR(64) NOT NULL,
  day INT NOT NULL,
  message_type VARCHAR(24) NOT NULL,
  severity VARCHAR(16),
  text TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX comms_messages_mission_day_idx (mission_id, day)
);

CREATE TABLE IF NOT EXISTS achievements (
  mission_id VARCHAR(64) NOT NULL,
  achievement_key VARCHAR(64) NOT NULL,
  unlocked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (mission_id, achievement_key)
);

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
);

CREATE TABLE IF NOT EXISTS mission_telemetry (
  mission_id VARCHAR(64) NOT NULL,
  day INT NOT NULL,
  hr INT,
  spo2 INT,
  temp DECIMAL(4,1),
  rad DECIMAL(8,2),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (mission_id, day)
);

CREATE TABLE IF NOT EXISTS mission_alerts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  mission_id VARCHAR(64) NOT NULL,
  day INT NOT NULL,
  severity VARCHAR(16) NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX mission_alerts_mission_day_idx (mission_id, day)
);

CREATE TABLE IF NOT EXISTS mission_comms (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  mission_id VARCHAR(64) NOT NULL,
  day INT NOT NULL,
  message_type VARCHAR(24) NOT NULL,
  severity VARCHAR(16),
  text TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX mission_comms_mission_day_idx (mission_id, day)
);

CREATE TABLE IF NOT EXISTS mission_achievements (
  mission_id VARCHAR(64) NOT NULL,
  achievement_key VARCHAR(64) NOT NULL,
  unlocked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (mission_id, achievement_key)
);
