/*
  Warnings:

  - You are about to drop the `useraiconfig` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `UserAiConfig` DROP FOREIGN KEY `UserAiConfig_userId_fkey`;

-- DropTable
DROP TABLE `UserAiConfig`;

-- CreateTable
CREATE TABLE `ai_provider` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `provider_id` VARCHAR(64) NOT NULL,
    `provider_name` VARCHAR(64) NULL,
    `api_key_cipher` VARBINARY(512) NULL,
    `api_key_last4` CHAR(4) NULL,
    `model_id` VARCHAR(128) NULL,
    `api_endpoint` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uk_user_provider`(`user_id`, `provider_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_preference` (
    `user_id` INTEGER NOT NULL,
    `selected_provider_id` VARCHAR(64) NULL,
    `polish_prompt` TEXT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ai_provider` ADD CONSTRAINT `ai_provider_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_preference` ADD CONSTRAINT `ai_preference_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
