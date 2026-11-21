-- AlterTable
ALTER TABLE "Goal" ADD COLUMN "rankingEligible" BOOLEAN;
ALTER TABLE "Goal" ADD COLUMN "rankingEligibilityReason" TEXT;

-- AlterTable
ALTER TABLE "SmartGoalProofAttempt" ADD COLUMN "challengeHash" TEXT;
ALTER TABLE "SmartGoalProofAttempt" ADD COLUMN "challengeExpiresAt" TIMESTAMP(3);
