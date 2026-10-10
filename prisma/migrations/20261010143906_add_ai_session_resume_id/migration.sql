-- AlterTable
ALTER TABLE `ai_session` ADD COLUMN `resume_id` VARCHAR(10) NULL;

-- CreateIndex
CREATE INDEX `idx_ai_session_resume` ON `ai_session`(`resume_id`);

-- AddForeignKey
ALTER TABLE `ai_session` ADD CONSTRAINT `ai_session_resume_id_fkey` FOREIGN KEY (`resume_id`) REFERENCES `Resume`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
