-- ADSSU Room Scheduling System Database Schema
CREATE DATABASE IF NOT EXISTS adssu_scheduling CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE adssu_scheduling;

-- Users (all roles in one table)
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  role ENUM('chair','vpaa','admin','instructor','student','dean','quality_assurance') NOT NULL,
  department VARCHAR(100),
  section VARCHAR(20),
  email VARCHAR(150),
  mobility_level TINYINT DEFAULT 3,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- OTP codes for password change
CREATE TABLE IF NOT EXISTS otp_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  otp_code VARCHAR(6) NOT NULL,
  expires_at DATETIME NOT NULL,
  used TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Buildings
CREATE TABLE IF NOT EXISTS buildings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(20) NOT NULL
);

-- Rooms
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

-- Building priorities: ranked list of programs (departments) allowed to use each building.
-- A building with no rows here is "unmanaged" (open to every program). Once a building has
-- rows, only the listed programs may use its rooms, in priority order (1 = first pick).
CREATE TABLE IF NOT EXISTS building_priorities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  building VARCHAR(50) NOT NULL,
  program VARCHAR(100) NOT NULL,
  priority INT NOT NULL,
  UNIQUE KEY uq_building_program (building, program),
  UNIQUE KEY uq_building_priority (building, priority)
);

-- Subjects / Course offerings
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

-- Sections
CREATE TABLE IF NOT EXISTS sections (
  id INT AUTO_INCREMENT PRIMARY KEY,
  program VARCHAR(20) NOT NULL,
  year_level TINYINT NOT NULL,
  section_letter VARCHAR(5) NOT NULL,
  UNIQUE KEY uq_section (program, year_level, section_letter)
);

-- Chair Submissions
-- Approval sequence: pending_instructor (all assigned instructors confirm) ->
-- pending_dean (Dean of the chair's college) -> pending_qa (Quality Assurance)
-- -> pending_vpaa -> pending_admin -> validated -> scheduled. "returned" can
-- happen at the dean/qa/vpaa/admin stages, sending it back to the chair.
CREATE TABLE IF NOT EXISTS submissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  chair_id INT NOT NULL,
  status ENUM('pending_instructor','pending_dean','pending_qa','pending_vpaa','pending_admin','validated','returned','scheduled') DEFAULT 'pending_instructor',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  dean_action_at TIMESTAMP NULL,
  qa_action_at TIMESTAMP NULL,
  vpaa_action_at TIMESTAMP NULL,
  admin_action_at TIMESTAMP NULL,
  FOREIGN KEY (chair_id) REFERENCES users(id)
);

-- Tracks each assigned instructor's confirmation of their share of a
-- faculty_load submission before it can advance to the Dean.
CREATE TABLE IF NOT EXISTS submission_confirmations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  submission_id INT NOT NULL,
  instructor_id INT NOT NULL,
  confirmed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_submission_instructor (submission_id, instructor_id),
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  FOREIGN KEY (instructor_id) REFERENCES users(id)
);

-- Submission line entries
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

-- Generated Schedules
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

-- Accessibility Requests
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

-- Seed: Sample rooms
INSERT IGNORE INTO rooms (building, room_number, capacity, room_type, floor_level, is_accessible) VALUES
('CEIT', '107', 50, 'Lecture', 1, 1),
('CEIT', '207', 50, 'Lecture', 2, 0),
('CEIT', '208', 50, 'Lecture', 2, 0),
('CEIT', '209', 50, 'Lecture', 2, 0),
('CEIT', 'Lab 1', 40, 'Laboratory', 1, 1),
('CEIT', 'Lab 2', 40, 'Laboratory', 1, 1);

-- Seed: Sample subjects
INSERT IGNORE INTO subjects (code, title, units, lec_hours, lab_hours, room_type_required) VALUES
('ITCC 102', 'Intermediate Programming', 3, 2, 3, 'Laboratory'),
('IS 101', 'Organization and Management Concepts', 3, 3, 0, 'Lecture'),
('IS 102', 'Business Process Design and Management', 3, 3, 0, 'Lecture'),
('IS 107', 'IS Strategy, Management and Acquisition', 3, 3, 0, 'Lecture'),
('GE 07', 'Science, Technology and Society', 3, 3, 0, 'Lecture'),
('GE 09', 'Life and Works of Rizal', 3, 3, 0, 'Lecture'),
('PATHFIT 2', 'Exercise-based Fitness Activities', 2, 2, 0, 'Special'),
('NSTP 2', 'National Service Training Program 2', 3, 3, 0, 'Lecture');
