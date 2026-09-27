-- AlterTable
ALTER TABLE `interview_session` MODIFY `status` ENUM('pending_questions', 'in_progress', 'stopped', 'finished') NOT NULL DEFAULT 'pending_questions';
