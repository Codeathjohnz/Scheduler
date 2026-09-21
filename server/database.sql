-- ADSSU Room Scheduling System — full schema dump (auto-generated from live dev DB)
-- Generated 2026-07-13T08:24:53.387Z

SET FOREIGN_KEY_CHECKS=0;

-- --------------------------------------------------
-- Table: accessibility_requests
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS `accessibility_requests` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `instructor_id` int(11) NOT NULL,
  `reason` varchar(255) NOT NULL,
  `details` text DEFAULT NULL,
  `mobility_level` tinyint(4) DEFAULT NULL,
  `status` enum('pending','approved','rejected') DEFAULT 'pending',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `reviewed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `instructor_id` (`instructor_id`),
  CONSTRAINT `accessibility_requests_ibfk_1` FOREIGN KEY (`instructor_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- Table: building_priorities
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS `building_priorities` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `building` varchar(50) NOT NULL,
  `program` varchar(100) NOT NULL,
  `priority` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_building_program` (`building`,`program`),
  UNIQUE KEY `uq_building_priority` (`building`,`priority`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- Table: buildings
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS `buildings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `code` varchar(20) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- Table: faculty_admin_loads
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS `faculty_admin_loads` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `instructor_id` int(11) NOT NULL,
  `academic_year` varchar(20) NOT NULL,
  `semester` tinyint(4) NOT NULL DEFAULT 1,
  `description` varchar(200) DEFAULT NULL,
  `units` float DEFAULT 0,
  `hours` float DEFAULT NULL,
  `lec_hours` float DEFAULT 0,
  `lab_hours` float DEFAULT 0,
  `load_type` enum('administrative','research','extension','project','consultation','lesson_prep') NOT NULL DEFAULT 'administrative',
  `chair_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `instructor_id` (`instructor_id`),
  KEY `chair_id` (`chair_id`),
  CONSTRAINT `faculty_admin_loads_ibfk_1` FOREIGN KEY (`instructor_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `faculty_admin_loads_ibfk_2` FOREIGN KEY (`chair_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- Table: faculty_load_entries
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS `faculty_load_entries` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `academic_year` varchar(20) NOT NULL DEFAULT '2026-2027',
  `semester` tinyint(4) NOT NULL DEFAULT 1,
  `course_code` varchar(40) NOT NULL,
  `descriptive_title` varchar(250) NOT NULL,
  `program_yr_sec` varchar(50) NOT NULL,
  `year_level` tinyint(4) DEFAULT NULL,
  `units` float DEFAULT 3,
  `lec_hours` float DEFAULT 3,
  `lab_hours` float DEFAULT 0,
  `assigned_instructor_id` int(11) DEFAULT NULL,
  `room` varchar(50) DEFAULT NULL,
  `subject_id` int(11) DEFAULT NULL,
  `sort_order` int(11) DEFAULT 0,
  `chair_id` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `assigned_instructor_id` (`assigned_instructor_id`),
  KEY `chair_id` (`chair_id`),
  KEY `subject_id` (`subject_id`),
  CONSTRAINT `faculty_load_entries_ibfk_1` FOREIGN KEY (`assigned_instructor_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `faculty_load_entries_ibfk_2` FOREIGN KEY (`chair_id`) REFERENCES `users` (`id`),
  CONSTRAINT `faculty_load_entries_ibfk_3` FOREIGN KEY (`subject_id`) REFERENCES `prospectus_subjects` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=2383 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- Table: generated_schedules
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS `generated_schedules` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `academic_year` varchar(20) NOT NULL,
  `semester` tinyint(4) NOT NULL DEFAULT 1,
  `faculty_entry_id` int(11) NOT NULL,
  `session_type` enum('lecture','lab') DEFAULT 'lecture',
  `room_id` int(11) DEFAULT NULL,
  `days` varchar(100) NOT NULL,
  `start_time` time NOT NULL,
  `end_time` time NOT NULL,
  `is_manual` tinyint(1) DEFAULT 0,
  `is_published` tinyint(1) DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `faculty_entry_id` (`faculty_entry_id`),
  KEY `room_id` (`room_id`),
  CONSTRAINT `generated_schedules_ibfk_1` FOREIGN KEY (`faculty_entry_id`) REFERENCES `faculty_load_entries` (`id`) ON DELETE CASCADE,
  CONSTRAINT `generated_schedules_ibfk_2` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=912 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- Table: cross_dept_requests
-- A chair asking an instructor from ANOTHER department to teach one of their
-- subjects. The faculty_load_entries row stays unassigned until the instructor
-- accepts AND their home chair/dean approves.
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS `cross_dept_requests` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `entry_id` int(11) NOT NULL,
  `instructor_id` int(11) NOT NULL,
  `requested_by` int(11) NOT NULL,
  `status` enum('pending_instructor','pending_home','approved','declined','cancelled') NOT NULL DEFAULT 'pending_instructor',
  `note` varchar(255) DEFAULT NULL,
  `decline_reason` varchar(255) DEFAULT NULL,
  `declined_stage` varchar(20) DEFAULT NULL,
  `home_approver_id` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `instructor_action_at` timestamp NULL DEFAULT NULL,
  `home_action_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_entry` (`entry_id`),
  KEY `idx_instructor` (`instructor_id`,`status`),
  KEY `idx_requested_by` (`requested_by`),
  CONSTRAINT `fk_cdr_entry` FOREIGN KEY (`entry_id`) REFERENCES `faculty_load_entries` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cdr_instructor` FOREIGN KEY (`instructor_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cdr_requested_by` FOREIGN KEY (`requested_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- Table: instructor_specialties
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS `instructor_specialties` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `instructor_id` int(11) NOT NULL,
  `subject_id` int(11) NOT NULL,
  `priority` tinyint(4) NOT NULL DEFAULT 1 COMMENT '1 = first priority, 2 = second priority',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_specialty` (`instructor_id`,`subject_id`),
  KEY `subject_id` (`subject_id`),
  CONSTRAINT `instructor_specialties_ibfk_1` FOREIGN KEY (`instructor_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `instructor_specialties_ibfk_2` FOREIGN KEY (`subject_id`) REFERENCES `prospectus_subjects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=396 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- Table: load_requests
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS `load_requests` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `instructor_id` int(11) NOT NULL,
  `academic_year` varchar(20) NOT NULL,
  `semester` tinyint(4) NOT NULL DEFAULT 1,
  `load_type` enum('administrative','research','extension','project','consultation','lesson_prep') NOT NULL,
  `description` varchar(200) NOT NULL,
  `units` float NOT NULL,
  `hours` float DEFAULT NULL,
  `status` enum('pending','approved','rejected') DEFAULT 'pending',
  `reviewed_by` int(11) DEFAULT NULL,
  `reviewed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `instructor_id` (`instructor_id`),
  KEY `reviewed_by` (`reviewed_by`),
  CONSTRAINT `load_requests_ibfk_1` FOREIGN KEY (`instructor_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `load_requests_ibfk_2` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- Table: otp_codes
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS `otp_codes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `otp_code` varchar(6) NOT NULL,
  `expires_at` datetime NOT NULL,
  `used` tinyint(1) DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `otp_codes_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- Table: prospectus
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS `prospectus` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `program` varchar(100) NOT NULL DEFAULT 'BSIT',
  `academic_year` varchar(20) DEFAULT NULL,
  `filename` varchar(255) DEFAULT NULL,
  `uploaded_by` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `uploaded_by` (`uploaded_by`),
  CONSTRAINT `prospectus_ibfk_1` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- Table: prospectus_subjects
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS `prospectus_subjects` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `prospectus_id` int(11) NOT NULL,
  `course_code` varchar(40) NOT NULL,
  `descriptive_title` varchar(250) NOT NULL,
  `units` float DEFAULT 0,
  `lec_hours` float DEFAULT 0,
  `lab_hours` float DEFAULT 0,
  `year_level` tinyint(4) NOT NULL,
  `semester` tinyint(4) NOT NULL,
  `prerequisite` varchar(250) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `prospectus_id` (`prospectus_id`),
  CONSTRAINT `prospectus_subjects_ibfk_1` FOREIGN KEY (`prospectus_id`) REFERENCES `prospectus` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=526 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- Table: rooms
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS `rooms` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `building` varchar(50) NOT NULL,
  `room_number` varchar(20) NOT NULL,
  `capacity` int(11) NOT NULL DEFAULT 40,
  `room_type` enum('Lecture','Laboratory','Special','Gym') NOT NULL DEFAULT 'Lecture',
  `floor_level` tinyint(4) NOT NULL DEFAULT 1,
  `is_accessible` tinyint(1) DEFAULT 0,
  `program_restriction` varchar(255) DEFAULT NULL COMMENT 'Comma-separated list of programs/departments allowed to use this room, e.g. "CCIS,BSIT,BSIS". NULL/empty = open to everyone.',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_room` (`building`,`room_number`)
) ENGINE=InnoDB AUTO_INCREMENT=27 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- Table: schedules
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS `schedules` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `submission_id` int(11) NOT NULL,
  `instructor_id` int(11) NOT NULL,
  `room_id` int(11) NOT NULL,
  `subject_code` varchar(20) NOT NULL,
  `section` varchar(20) NOT NULL,
  `day_of_week` enum('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday') NOT NULL,
  `start_time` time NOT NULL,
  `end_time` time NOT NULL,
  `status` enum('pending','approved','rejected') DEFAULT 'pending',
  `generated_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `submission_id` (`submission_id`),
  KEY `instructor_id` (`instructor_id`),
  KEY `room_id` (`room_id`),
  CONSTRAINT `schedules_ibfk_1` FOREIGN KEY (`submission_id`) REFERENCES `submissions` (`id`),
  CONSTRAINT `schedules_ibfk_2` FOREIGN KEY (`instructor_id`) REFERENCES `users` (`id`),
  CONSTRAINT `schedules_ibfk_3` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- Table: section_counts
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS `section_counts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `chair_id` int(11) NOT NULL,
  `academic_year` varchar(20) NOT NULL,
  `semester` tinyint(4) NOT NULL,
  `year_level` tinyint(4) NOT NULL,
  `section_count` tinyint(4) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_section_count` (`chair_id`,`academic_year`,`semester`,`year_level`),
  CONSTRAINT `section_counts_ibfk_1` FOREIGN KEY (`chair_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- Table: sections
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS `sections` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `program` varchar(20) NOT NULL,
  `year_level` tinyint(4) NOT NULL,
  `section_letter` varchar(5) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_section` (`program`,`year_level`,`section_letter`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- Table: subjects
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS `subjects` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `code` varchar(20) NOT NULL,
  `title` varchar(150) NOT NULL,
  `units` tinyint(4) NOT NULL,
  `lec_hours` tinyint(4) DEFAULT 0,
  `lab_hours` tinyint(4) DEFAULT 0,
  `room_type_required` enum('Lecture','Laboratory','Special','Any') DEFAULT 'Lecture',
  `prerequisite_code` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- Table: submission_confirmations
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS `submission_confirmations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `submission_id` int(11) NOT NULL,
  `instructor_id` int(11) NOT NULL,
  `confirmed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_submission_instructor` (`submission_id`,`instructor_id`),
  KEY `instructor_id` (`instructor_id`),
  CONSTRAINT `submission_confirmations_ibfk_1` FOREIGN KEY (`submission_id`) REFERENCES `submissions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `submission_confirmations_ibfk_2` FOREIGN KEY (`instructor_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=58 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- Table: submission_entries
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS `submission_entries` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `submission_id` int(11) NOT NULL,
  `instructor_id` int(11) NOT NULL,
  `subject_code` varchar(20) NOT NULL,
  `section` varchar(20) NOT NULL,
  `program` varchar(20) NOT NULL,
  `year_level` tinyint(4) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `submission_id` (`submission_id`),
  KEY `instructor_id` (`instructor_id`),
  CONSTRAINT `submission_entries_ibfk_1` FOREIGN KEY (`submission_id`) REFERENCES `submissions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `submission_entries_ibfk_2` FOREIGN KEY (`instructor_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- Table: submissions
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS `submissions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `chair_id` int(11) NOT NULL,
  `status` enum('pending_instructor','pending_dean','pending_chief_cpd','pending_qa','pending_vpaa','pending_admin','validated','returned','scheduled') DEFAULT 'pending_instructor',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `vpaa_action_at` timestamp NULL DEFAULT NULL,
  `dean_action_at` timestamp NULL DEFAULT NULL,
  `chief_cpd_action_at` timestamp NULL DEFAULT NULL,
  `qa_action_at` timestamp NULL DEFAULT NULL,
  `admin_action_at` timestamp NULL DEFAULT NULL,
  `academic_year` varchar(20) DEFAULT NULL,
  `semester` tinyint(4) DEFAULT NULL,
  `submission_type` enum('manual','faculty_load') DEFAULT 'manual',
  PRIMARY KEY (`id`),
  KEY `chair_id` (`chair_id`),
  CONSTRAINT `submissions_ibfk_1` FOREIGN KEY (`chair_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=14 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- Table: users
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(50) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `name` varchar(100) NOT NULL,
  `role` enum('admin','chair','vpaa','instructor','student','dean','quality_assurance','chief_cpd') NOT NULL,
  `department` varchar(100) DEFAULT NULL,
  `section` varchar(20) DEFAULT NULL,
  `programs` varchar(255) DEFAULT NULL COMMENT 'Comma-separated programs an instructor teaches for, e.g. BSIT,BSIS. NULL/empty = every program in the department.',
  `cross_dept_open` tinyint(1) NOT NULL DEFAULT 0 COMMENT '1 = willing to be asked to teach for other departments',
  `mobility_level` tinyint(4) DEFAULT 3,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `email` varchar(150) DEFAULT NULL,
  `signature_image` longtext DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`)
) ENGINE=InnoDB AUTO_INCREMENT=63 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS=1;
