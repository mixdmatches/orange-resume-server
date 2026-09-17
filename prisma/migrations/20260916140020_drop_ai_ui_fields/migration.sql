/*
  Warnings:

  - You are about to drop the column `version` on the `ai_preference` table. All the data in the column will be lost.
  - You are about to drop the column `hint` on the `ai_provider` table. All the data in the column will be lost.
  - You are about to drop the column `icon` on the `ai_provider` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `ai_provider` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `ai_preference` DROP COLUMN `version`;

-- AlterTable
ALTER TABLE `ai_provider` DROP COLUMN `hint`,
    DROP COLUMN `icon`,
    DROP COLUMN `name`;
