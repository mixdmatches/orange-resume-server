/*
  Warnings:

  - You are about to drop the column `preferences` on the `user` table. All the data in the column will be lost.
  - You are about to drop the `ai_preference` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `ai_preference` DROP FOREIGN KEY `ai_preference_user_id_fkey`;

-- AlterTable
ALTER TABLE `user` DROP COLUMN `preferences`;

-- DropTable
DROP TABLE `ai_preference`;

-- CreateTable
CREATE TABLE `user_preference` (
    `user_id` INTEGER NOT NULL,
    `selected_provider_id` VARCHAR(64) NULL,
    `polish_prompt` TEXT NULL,
    `theme` VARCHAR(10) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_preference` ADD CONSTRAINT `user_preference_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
