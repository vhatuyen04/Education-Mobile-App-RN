-- CreateEnum
CREATE TYPE "GoalFailedReason" AS ENUM ('EXPIRED', 'GAVE_UP');

-- AlterTable
ALTER TABLE "Goal" ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "failedReason" "GoalFailedReason";
