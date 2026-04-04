-- CreateTable
CREATE TABLE "GoalStep" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3),
    "repeat" TEXT,
    "repeatDay" INTEGER,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoalStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalStepCompletion" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoalStepCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GoalStep_goalId_idx" ON "GoalStep"("goalId");

-- CreateIndex
CREATE INDEX "GoalStep_goalId_order_idx" ON "GoalStep"("goalId", "order");

-- CreateIndex
CREATE INDEX "GoalStep_dueAt_idx" ON "GoalStep"("dueAt");

-- CreateIndex
CREATE INDEX "GoalStep_repeat_idx" ON "GoalStep"("repeat");

-- CreateIndex
CREATE INDEX "GoalStep_repeat_repeatDay_idx" ON "GoalStep"("repeat", "repeatDay");

-- CreateIndex
CREATE INDEX "GoalStepCompletion_date_idx" ON "GoalStepCompletion"("date");

-- CreateIndex
CREATE INDEX "GoalStepCompletion_stepId_idx" ON "GoalStepCompletion"("stepId");

-- CreateIndex
CREATE UNIQUE INDEX "GoalStepCompletion_stepId_date_key" ON "GoalStepCompletion"("stepId", "date");

-- AddForeignKey
ALTER TABLE "GoalStep" ADD CONSTRAINT "GoalStep_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalStepCompletion" ADD CONSTRAINT "GoalStepCompletion_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "GoalStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
