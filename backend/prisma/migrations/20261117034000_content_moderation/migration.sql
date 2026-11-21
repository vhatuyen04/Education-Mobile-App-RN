-- AlterEnum
ALTER TYPE "SmartGoalProofStatus" ADD VALUE 'NEEDS_CLARIFICATION';

-- CreateEnum
CREATE TYPE "ContentModerationStatus" AS ENUM ('CLEAR', 'FLAGGED', 'UNCERTAIN');

-- AlterTable
ALTER TABLE "SmartGoalProofAttempt" ADD COLUMN "moderationStatus" "ContentModerationStatus",
ADD COLUMN "moderationNote" TEXT,
ADD COLUMN "moderationCheckedAt" TIMESTAMP(3);
