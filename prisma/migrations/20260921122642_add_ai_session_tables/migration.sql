-- CreateTable
CREATE TABLE `ai_session` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `type` ENUM('interview', 'chat') NOT NULL,
    `title` VARCHAR(128) NOT NULL,
    `provider_id` VARCHAR(64) NULL,
    `model_id` VARCHAR(128) NULL,
    `status` ENUM('active', 'archived', 'deleted') NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_user_type_updated`(`user_id`, `type`, `updated_at` DESC),
    INDEX `idx_user_status`(`user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_session_message` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `session_id` BIGINT NOT NULL,
    `role` ENUM('system', 'user', 'assistant') NOT NULL,
    `kind` ENUM('question', 'answer', 'evaluation', 'normal') NOT NULL DEFAULT 'normal',
    `content` LONGTEXT NOT NULL,
    `prompt_tokens` INTEGER NOT NULL DEFAULT 0,
    `completion_tokens` INTEGER NOT NULL DEFAULT 0,
    `extra` JSON NULL,
    `stream_status` ENUM('streaming', 'done', 'failed') NOT NULL DEFAULT 'done',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_session_id`(`session_id`, `id`),
    INDEX `idx_session_kind`(`session_id`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `interview_session` (
    `session_id` BIGINT NOT NULL,
    `resume_id` VARCHAR(10) NOT NULL,
    `job_title` VARCHAR(128) NULL,
    `difficulty` ENUM('easy', 'medium', 'hard') NOT NULL DEFAULT 'medium',
    `category` VARCHAR(64) NULL,
    `total_score` DECIMAL(5, 2) NULL,
    `summary` TEXT NULL,
    `duration_sec` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_resume`(`resume_id`),
    PRIMARY KEY (`session_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ai_session` ADD CONSTRAINT `ai_session_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_session_message` ADD CONSTRAINT `ai_session_message_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `ai_session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `interview_session` ADD CONSTRAINT `interview_session_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `ai_session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `interview_session` ADD CONSTRAINT `interview_session_resume_id_fkey` FOREIGN KEY (`resume_id`) REFERENCES `Resume`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
