/*
  Warnings:

  - You are about to drop the `ReminderDelivery` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `UserPushToken` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `UserReminderSetting` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ReminderDelivery" DROP CONSTRAINT "ReminderDelivery_userId_fkey";

-- DropForeignKey
ALTER TABLE "UserPushToken" DROP CONSTRAINT "UserPushToken_userId_fkey";

-- DropForeignKey
ALTER TABLE "UserReminderSetting" DROP CONSTRAINT "UserReminderSetting_userId_fkey";

-- AlterTable
ALTER TABLE "Goal" ADD COLUMN     "difficultyConfidence" DOUBLE PRECISION,
ADD COLUMN     "difficultyReason" TEXT,
ADD COLUMN     "difficultyScore" INTEGER,
ADD COLUMN     "pointsAwarded" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "xpAwarded" INTEGER NOT NULL DEFAULT 50;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "xp" INTEGER NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE "ReminderDelivery";

-- DropTable
DROP TABLE "UserPushToken";

-- DropTable
DROP TABLE "UserReminderSetting";
