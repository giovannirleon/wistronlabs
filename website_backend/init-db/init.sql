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

-- 📄 Create factory table
CREATE TABLE factory (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    code VARCHAR(10) UNIQUE NOT NULL
);

-- 🌱 Seed factory data
INSERT INTO factory (name, code) VALUES
('Wistron - Juarez, MX', 'MX'),
('Wistron - Hsinchu, TW', 'A1'),
('Wistron - Hukou, TW', 'N2');

-- 📄 Create systems table
CREATE TABLE system (
    id SERIAL PRIMARY KEY,
    service_tag VARCHAR(100) NOT NULL UNIQUE,
    issue TEXT,
    location_id INT NOT NULL REFERENCES location(id) ON DELETE RESTRICT,
    factory_id INT REFERENCES factory(id) ON DELETE RESTRICT,
    dpn VARCHAR(100),
    manufactured_date DATE,
    serial VARCHAR(100),
    rev VARCHAR(50),
    ppid VARCHAR(100),
    
    CONSTRAINT system_ppid_key UNIQUE (ppid)
);

-- 📄 Create system_location_history table
CREATE TABLE system_location_history (
    id SERIAL PRIMARY KEY,
    system_id INT NOT NULL REFERENCES system(id) ON DELETE CASCADE,
    from_location_id INT REFERENCES location(id),
    to_location_id INT NOT NULL REFERENCES location(id),
    moved_by INT NOT NULL DEFAULT 1,
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

-- 📄 Create pallet table
CREATE TABLE pallet (
    id SERIAL PRIMARY KEY,
    factory_id INT NOT NULL REFERENCES factory(id) ON DELETE RESTRICT,
    pallet_number VARCHAR(50) UNIQUE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open','released')),
    doa_number VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW(),
    released_at TIMESTAMP,
    dpn TEXT                  
);


-- 📄 Create pallet-system relationship
CREATE TABLE pallet_system (
    id SERIAL PRIMARY KEY,
    pallet_id INT NOT NULL REFERENCES pallet(id) ON DELETE CASCADE,
    system_id INT NOT NULL REFERENCES system(id) ON DELETE CASCADE,
    added_at TIMESTAMP DEFAULT NOW(),
    removed_at TIMESTAMP
);

-- 📄 Indexes
CREATE INDEX idx_system_location_history_system_id ON system_location_history(system_id);
CREATE INDEX idx_system_location_history_moved_by ON system_location_history(moved_by);

-- Non-unique index on location.name (for fast lookups)
CREATE INDEX IF NOT EXISTS idx_location_name ON location(name);

-- Additional index for efficient queries by system_id and changed_at
CREATE INDEX idx_history_system_changed_at 
ON system_location_history (system_id, changed_at);

-- Active pallet entries index
CREATE INDEX idx_pallet_system_active
  ON pallet_system(pallet_id)
  WHERE removed_at IS NULL;

-- ✅ Enforce only one active pallet per system
CREATE UNIQUE INDEX unique_active_system_per_pallet
  ON pallet_system(system_id)
  WHERE removed_at IS NULL;

-- Composite index on factory_id and dpn for fast pallet lookups
CREATE INDEX IF NOT EXISTS idx_pallet_factory_dpn
  ON pallet (factory_id, dpn);

CREATE INDEX idx_system_ppid ON system(ppid);
