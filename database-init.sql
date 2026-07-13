-- ADSSU Room Scheduling System — Full Database Init
-- Used by Docker MariaDB on first startup (docker-entrypoint-initdb.d)

CREATE DATABASE IF NOT EXISTS adssu_scheduling CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE adssu_scheduling;

-- ── Users ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  role ENUM('chair','vpaa','admin','instructor','student') NOT NULL,
  department VARCHAR(100),
  section VARCHAR(20),
  email VARCHAR(150),
  mobility_level TINYINT DEFAULT 3,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── OTP codes ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS otp_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  otp_code VARCHAR(6) NOT NULL,
  expires_at DATETIME NOT NULL,
  used TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ── Buildings & Rooms ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS buildings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(20) NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  building VARCHAR(50) NOT NULL,
  room_number VARCHAR(20) NOT NULL,
  capacity INT NOT NULL DEFAULT 40,
  room_type ENUM('Lecture','Laboratory','Special') NOT NULL DEFAULT 'Lecture',
  floor_level TINYINT NOT NULL DEFAULT 1,
  is_accessible TINYINT(1) DEFAULT 0,
  UNIQUE KEY uq_room (building, room_number)
);

-- ── Subjects ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subjects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  title VARCHAR(150) NOT NULL,
  units TINYINT NOT NULL,
  lec_hours TINYINT DEFAULT 0,
  lab_hours TINYINT DEFAULT 0,
  room_type_required ENUM('Lecture','Laboratory','Special','Any') DEFAULT 'Lecture',
  prerequisite_code VARCHAR(20) DEFAULT NULL
);

-- ── Sections ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sections (
  id INT AUTO_INCREMENT PRIMARY KEY,
  program VARCHAR(20) NOT NULL,
  year_level TINYINT NOT NULL,
  section_letter VARCHAR(5) NOT NULL,
  UNIQUE KEY uq_section (program, year_level, section_letter)
);

-- ── Submissions ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS submissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  chair_id INT NOT NULL,
  status ENUM('pending_vpaa','pending_admin','validated','returned','scheduled') DEFAULT 'pending_vpaa',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  vpaa_action_at TIMESTAMP NULL,
  admin_action_at TIMESTAMP NULL,
  FOREIGN KEY (chair_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS submission_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  submission_id INT NOT NULL,
  instructor_id INT NOT NULL,
  subject_code VARCHAR(20) NOT NULL,
  section VARCHAR(20) NOT NULL,
  program VARCHAR(20) NOT NULL,
  year_level TINYINT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  FOREIGN KEY (instructor_id) REFERENCES users(id)
);

-- ── Schedules ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schedules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  submission_id INT NOT NULL,
  instructor_id INT NOT NULL,
  room_id INT NOT NULL,
  subject_code VARCHAR(20) NOT NULL,
  section VARCHAR(20) NOT NULL,
  day_of_week ENUM('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday') NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status ENUM('pending','approved','rejected') DEFAULT 'pending',
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (submission_id) REFERENCES submissions(id),
  FOREIGN KEY (instructor_id) REFERENCES users(id),
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);

-- ── Accessibility ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accessibility_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  instructor_id INT NOT NULL,
  reason VARCHAR(255) NOT NULL,
  details TEXT,
  mobility_level TINYINT DEFAULT NULL,
  status ENUM('pending','approved','rejected') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP NULL,
  FOREIGN KEY (instructor_id) REFERENCES users(id)
);

-- ── Prospectus ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prospectus (
  id INT AUTO_INCREMENT PRIMARY KEY,
  program VARCHAR(50) NOT NULL,
  academic_year VARCHAR(20),
  filename VARCHAR(255),
  uploaded_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS prospectus_subjects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  prospectus_id INT NOT NULL,
  course_code VARCHAR(40) NOT NULL,
  descriptive_title VARCHAR(250) NOT NULL,
  units FLOAT DEFAULT 0,
  lec_hours FLOAT DEFAULT 0,
  lab_hours FLOAT DEFAULT 0,
  year_level TINYINT DEFAULT 1,
  semester TINYINT DEFAULT 1,
  prerequisite VARCHAR(100),
  FOREIGN KEY (prospectus_id) REFERENCES prospectus(id) ON DELETE CASCADE
);

-- ── Instructor Specialties ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS instructor_specialties (
  id INT AUTO_INCREMENT PRIMARY KEY,
  instructor_id INT NOT NULL,
  subject_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_specialty (instructor_id, subject_id),
  FOREIGN KEY (instructor_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (subject_id) REFERENCES prospectus_subjects(id) ON DELETE CASCADE
);

-- ── Faculty Loading ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS faculty_load_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  academic_year VARCHAR(20) NOT NULL DEFAULT '2026-2027',
  semester TINYINT NOT NULL DEFAULT 1,
  course_code VARCHAR(40) NOT NULL,
  descriptive_title VARCHAR(250) NOT NULL,
  program_yr_sec VARCHAR(50) NOT NULL DEFAULT '',
  units FLOAT DEFAULT 3,
  lec_hours FLOAT DEFAULT 3,
  lab_hours FLOAT DEFAULT 0,
  assigned_instructor_id INT,
  room VARCHAR(50),
  subject_id INT,
  sort_order INT DEFAULT 0,
  chair_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (assigned_instructor_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (chair_id) REFERENCES users(id),
  FOREIGN KEY (subject_id) REFERENCES prospectus_subjects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS faculty_admin_loads (
  id INT AUTO_INCREMENT PRIMARY KEY,
  instructor_id INT NOT NULL,
  academic_year VARCHAR(20) NOT NULL,
  semester TINYINT NOT NULL DEFAULT 1,
  description VARCHAR(200),
  units FLOAT DEFAULT 0,
  lec_hours FLOAT DEFAULT 0,
  lab_hours FLOAT DEFAULT 0,
  chair_id INT NOT NULL,
  FOREIGN KEY (instructor_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (chair_id) REFERENCES users(id)
);

-- ── Seed: Sample rooms ────────────────────────────────────────────────────────
INSERT IGNORE INTO rooms (building, room_number, capacity, room_type, floor_level, is_accessible) VALUES
('CEIT', '107', 50, 'Lecture', 1, 1),
('CEIT', '207', 50, 'Lecture', 2, 0),
('CEIT', '208', 50, 'Lecture', 2, 0),
('CEIT', 'Lab 1', 40, 'Laboratory', 1, 1),
('CCIS', '101', 50, 'Lecture', 1, 1),
('CCIS', '102', 50, 'Lecture', 1, 1),
('CCIS', 'ICT Lab 1', 40, 'Laboratory', 1, 1),
('CCIS', 'ICT Lab 2', 40, 'Laboratory', 1, 1);

-- ── Seed: Default admin user ──────────────────────────────────────────────────
-- Password: admin123 (bcrypt hash — CHANGE IN PRODUCTION via User Management)
INSERT IGNORE INTO users (username, password_hash, name, role, department, email) VALUES
('admin', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.', 'System Administrator', 'admin', 'Registrar''s Office', NULL);
-- Note: the hash above is for 'password' — change it immediately after first login
-- To generate a real hash: node -e "const b=require('bcryptjs'); b.hash('yourpw',10).then(console.log)"
