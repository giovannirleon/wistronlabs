-- 📄 Create locations table
CREATE TABLE location (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE
);

-- 🌱 Seed locations
INSERT INTO location (name) VALUES
('Received'),
('In Debug - Wistron'),
('In Debug - Nvidia'),
('Pending Parts'),
('In L10'),
('RMA VID'),
('RMA CID'),
('RMA PID'),
('Sent to L11');

-- 📄 Create users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 🌱 Seed deleted user
INSERT INTO users (username, password_hash)
VALUES ('deleted_user@example.com', '');

-- 📄 Create systems table
CREATE TABLE system (
    id SERIAL PRIMARY KEY,
    service_tag VARCHAR(100) NOT NULL UNIQUE,
    issue TEXT,
    location_id INT NOT NULL REFERENCES location(id) ON DELETE RESTRICT
);

-- 📄 Create system_location_history table
CREATE TABLE system_location_history (
    id SERIAL PRIMARY KEY,
    system_id INT NOT NULL REFERENCES system(id) ON DELETE CASCADE,
    from_location_id INT REFERENCES location(id),
    to_location_id INT NOT NULL REFERENCES location(id),
    moved_by INT NOT NULL DEFAULT (
        (SELECT id FROM users WHERE username = 'deleted_user@example.com')
    ),
    note TEXT NOT NULL,
    changed_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_moved_by FOREIGN KEY (moved_by) REFERENCES users(id) ON DELETE SET DEFAULT
);

-- 📄 Create station table
CREATE TABLE station (
    id SERIAL PRIMARY KEY,
    station_name VARCHAR(255) NOT NULL UNIQUE,
    system_id INTEGER REFERENCES system(id),
    status INTEGER DEFAULT 0,
    message VARCHAR(255) DEFAULT ''
);

-- 📄 Indexes
CREATE INDEX idx_system_location_history_system_id ON system_location_history(system_id);
CREATE INDEX idx_system_location_history_moved_by ON system_location_history(moved_by);
-- 📄 Optional: Non-unique index on location.name (for fast lookups)
CREATE INDEX IF NOT EXISTS idx_location_name ON location(name);
-- 📄 Additional index for efficient queries by system_id and changed_at
CREATE INDEX idx_history_system_changed_at 
ON system_location_history (system_id, changed_at);
