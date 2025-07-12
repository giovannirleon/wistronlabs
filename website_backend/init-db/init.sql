-- 📄 Create locations table
CREATE TABLE location (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE
);

-- 🌱 Seed locations
INSERT INTO location (name) VALUES
('Processed'),
('In Debug - Wistron'),
('In Debug - Nvidia'),
('Pending Parts'),
('In L10'),
('RMA VID'),
('RMA CID'),
('RMA PID'),
('Sent to L11');


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
    note TEXT NOT NULL,
    changed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE station ( 
    id SERIAL PRIMARY KEY,
    station_name VARCHAR(255) NOT NULL UNIQUE,
    system_id INTEGER REFERENCES system(id),
    status INTEGER DEFAULT 0,
    message VARCHAR(255) DEFAULT ''
);

-- 📄 Index for faster queries on history
CREATE INDEX idx_system_location_history_system_id ON system_location_history(system_id);

