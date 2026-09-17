/*
  Warnings:

  - You are about to drop the `user_preference` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `user_preference` DROP FOREIGN KEY `user_preference_user_id_fkey`;

-- AlterTable
ALTER TABLE `user` ADD COLUMN `theme` VARCHAR(10) NOT NULL DEFAULT 'light';

-- DropTable
DROP TABLE `user_preference`;

-- CreateTable
CREATE TABLE `ai_preference` (
    `user_id` INTEGER NOT NULL,
    `selected_provider_id` VARCHAR(64) NULL,
    `polish_prompt` TEXT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ai_preference` ADD CONSTRAINT `ai_preference_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
