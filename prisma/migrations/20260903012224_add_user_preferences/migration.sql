-- AlterTable
ALTER TABLE `User` ADD COLUMN `preferences` JSON NULL;

-- AddForeignKey
ALTER TABLE `UserAiConfig` ADD CONSTRAINT `UserAiConfig_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
