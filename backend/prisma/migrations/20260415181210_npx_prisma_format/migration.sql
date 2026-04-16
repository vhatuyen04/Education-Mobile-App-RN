-- CreateEnum
CREATE TYPE "SmartGoalProofStatus" AS ENUM ('PENDING_UPLOAD', 'PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "SmartGoalProofAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "status" "SmartGoalProofStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "requirementText" TEXT,
    "proofKey" TEXT,
    "proofUrl" TEXT,
    "aiFeedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmartGoalProofAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmartGoalProofAttempt_userId_idx" ON "SmartGoalProofAttempt"("userId");

-- CreateIndex
CREATE INDEX "SmartGoalProofAttempt_goalId_idx" ON "SmartGoalProofAttempt"("goalId");

-- CreateIndex
CREATE INDEX "SmartGoalProofAttempt_status_idx" ON "SmartGoalProofAttempt"("status");

-- AddForeignKey
ALTER TABLE "SmartGoalProofAttempt" ADD CONSTRAINT "SmartGoalProofAttempt_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmartGoalProofAttempt" ADD CONSTRAINT "SmartGoalProofAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
