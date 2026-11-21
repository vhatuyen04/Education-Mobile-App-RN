ALTER TABLE "Goal" ADD COLUMN "completedAt" TIMESTAMP(3);

UPDATE "Goal" SET "completedAt" = "updatedAt" WHERE "completed" = true AND "completedAt" IS NULL;

ALTER TABLE "SmartGoalProofAttempt" ADD COLUMN "challengeCode" TEXT;
