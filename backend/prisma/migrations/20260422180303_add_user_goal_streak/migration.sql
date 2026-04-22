-- AlterTable
ALTER TABLE "User" ADD COLUMN     "goalStreakDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastGoalCompletedAt" TIMESTAMP(3);
