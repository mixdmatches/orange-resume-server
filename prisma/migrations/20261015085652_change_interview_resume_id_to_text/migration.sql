/*
  Warnings:

  - You are about to drop the column `resume_id` on the `interview_session` table. All the data in the column will be lost.
  - Added the required column `resume_text` to the `interview_session` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE `interview_session` DROP FOREIGN KEY `interview_session_resume_id_fkey`;

-- DropIndex
DROP INDEX `idx_resume` ON `interview_session`;

-- AlterTable
ALTER TABLE `interview_session` DROP COLUMN `resume_id`,
    ADD COLUMN `resume_text` TEXT NOT NULL;
