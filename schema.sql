-- ============================================================================
-- RGK Myday — Enterprise SQL Database Schema
-- Multi-Master Failover & Backup Storage for Cloud Firestore
-- ============================================================================

-- 1. Authentication Credentials (Passwords, Salts, PBKDF2 Hashes)
CREATE TABLE IF NOT EXISTS auth_users (
    uid VARCHAR(128) PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    disabled BOOLEAN DEFAULT FALSE,
    salt VARCHAR(128),
    hash VARCHAR(256),
    tokens_valid_after BIGINT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Employees & Users
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(128) PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    employee_code VARCHAR(64) UNIQUE,
    phone_number VARCHAR(32),
    auth_email VARCHAR(255) NOT NULL,
    official_email VARCHAR(255),
    role VARCHAR(32) NOT NULL, -- 'ADMIN', 'MANAGEMENT', 'REPORTING_MANAGER', 'EMPLOYEE'
    department_id VARCHAR(64),
    reporting_manager_id VARCHAR(128),
    designation VARCHAR(128),
    active BOOLEAN DEFAULT TRUE,
    raw_data JSON, -- Complete JSON document mirror
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Departments (23 Standard Departments)
CREATE TABLE IF NOT EXISTS departments (
    id VARCHAR(64) PRIMARY KEY,
    code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Daily Reports
CREATE TABLE IF NOT EXISTS daily_reports (
    id VARCHAR(128) PRIMARY KEY,
    employee_id VARCHAR(128) NOT NULL,
    work_date DATE NOT NULL,
    status VARCHAR(32) DEFAULT 'DRAFT', -- 'DRAFT', 'SUBMITTED', 'APPROVED', 'CHANGES_REQUESTED'
    tasks_count INT DEFAULT 0,
    notes TEXT,
    raw_data JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unq_emp_date UNIQUE (employee_id, work_date)
);

-- 5. Individual Priority Tasks
CREATE TABLE IF NOT EXISTS tasks (
    id VARCHAR(128) PRIMARY KEY,
    daily_report_id VARCHAR(128),
    employee_id VARCHAR(128) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    priority VARCHAR(16) DEFAULT 'MEDIUM', -- 'HIGH', 'MEDIUM', 'LOW'
    status VARCHAR(32) DEFAULT 'PLANNED', -- 'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED'
    progress_percentage INT DEFAULT 0,
    planned_start_time TIME,
    planned_end_time TIME,
    collaborators JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Personal Daily Routines
CREATE TABLE IF NOT EXISTS daily_routines (
    id VARCHAR(128) PRIMARY KEY,
    user_id VARCHAR(128) NOT NULL,
    work_date DATE,
    items JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. Real-Time Notifications
CREATE TABLE IF NOT EXISTS notifications (
    id VARCHAR(128) PRIMARY KEY,
    user_id VARCHAR(128) NOT NULL,
    type VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    body TEXT,
    link VARCHAR(255),
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. Report Reviews & Approvals
CREATE TABLE IF NOT EXISTS report_reviews (
    id VARCHAR(128) PRIMARY KEY,
    report_id VARCHAR(128) NOT NULL,
    reviewer_id VARCHAR(128) NOT NULL,
    verdict VARCHAR(32) NOT NULL,
    comments TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9. Weekly Reports
CREATE TABLE IF NOT EXISTS weekly_reports (
    id VARCHAR(128) PRIMARY KEY,
    employee_id VARCHAR(128) NOT NULL,
    week_start DATE NOT NULL,
    narrative JSON,
    status VARCHAR(32) DEFAULT 'DRAFT',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 10. System Settings & Configuration
CREATE TABLE IF NOT EXISTS system_settings (
    id VARCHAR(128) PRIMARY KEY,
    settings_data JSON,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 11. Projects
CREATE TABLE IF NOT EXISTS projects (
    id VARCHAR(128) PRIMARY KEY,
    code VARCHAR(64),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 12. Automated Bi-Directional Firebase Sync & Failover Queue
CREATE TABLE IF NOT EXISTS firebase_sync_queue (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    collection_name VARCHAR(64) NOT NULL,
    doc_id VARCHAR(128) NOT NULL,
    doc_data JSON,
    action VARCHAR(16) NOT NULL, -- 'SET', 'DELETE'
    synced_to_firebase BOOLEAN DEFAULT FALSE,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    synced_at TIMESTAMP NULL
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_dept ON users(department_id);
CREATE INDEX IF NOT EXISTS idx_reports_emp_date ON daily_reports(employee_id, work_date);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_sync_queue_pending ON firebase_sync_queue(synced_to_firebase);
