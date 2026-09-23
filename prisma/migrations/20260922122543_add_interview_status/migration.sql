-- AlterTable
ALTER TABLE `interview_session` ADD COLUMN `score_detail` JSON NULL,
    ADD COLUMN `started_at` DATETIME(3) NULL,
    ADD COLUMN `status` ENUM('pending_questions', 'in_progress', 'finished') NOT NULL DEFAULT 'pending_questions';
