/*
  Warnings:

  - Added the required column `hint` to the `ai_provider` table without a default value. This is not possible if the table is not empty.
  - Added the required column `icon` to the `ai_provider` table without a default value. This is not possible if the table is not empty.
  - Added the required column `name` to the `ai_provider` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `ai_preference` ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `ai_provider` ADD COLUMN `hint` VARCHAR(256) NOT NULL,
    ADD COLUMN `icon` VARCHAR(256) NOT NULL,
    ADD COLUMN `name` VARCHAR(64) NOT NULL;
