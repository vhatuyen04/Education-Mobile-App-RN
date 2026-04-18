-- CreateEnum
CREATE TYPE "GoalRequirementSource" AS ENUM ('USER', 'AI');

-- AlterTable
ALTER TABLE "Goal" ADD COLUMN     "requirement" TEXT,
ADD COLUMN     "requirementSource" "GoalRequirementSource" NOT NULL DEFAULT 'USER';
