-- CreateTable
CREATE TABLE `UserAiConfig` (
    `userId` INTEGER NOT NULL,
    `selectedModel` VARCHAR(32) NOT NULL,
    `polishPrompt` TEXT NULL,
    `providers` JSON NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
