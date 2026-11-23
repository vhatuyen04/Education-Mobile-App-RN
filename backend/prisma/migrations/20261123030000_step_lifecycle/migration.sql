ALTER TABLE "GoalStep" ADD COLUMN "durationMinutes" INTEGER;
ALTER TABLE "GoalStep" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "GoalStep" ADD COLUMN "effectiveFrom" TIMESTAMP(3);
ALTER TABLE "GoalStep" ADD COLUMN "effectiveUntil" TIMESTAMP(3);
ALTER TABLE "GoalStep" ADD COLUMN "replacesStepId" TEXT;

ALTER TABLE "GoalStep" ADD CONSTRAINT "GoalStep_durationMinutes_check" CHECK ("durationMinutes" IS NULL OR "durationMinutes" > 0);
ALTER TABLE "GoalStep" ADD CONSTRAINT "GoalStep_replacesStepId_fkey" FOREIGN KEY ("replacesStepId") REFERENCES "GoalStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "GoalStep_archivedAt_idx" ON "GoalStep"("archivedAt");
CREATE INDEX "GoalStep_replacesStepId_idx" ON "GoalStep"("replacesStepId");
