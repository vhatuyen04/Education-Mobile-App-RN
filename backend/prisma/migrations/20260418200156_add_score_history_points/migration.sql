/*
  Warnings:

  - You are about to drop the column `score` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "score",
ALTER COLUMN "academyScore" DROP NOT NULL,
ALTER COLUMN "entertainmentScore" DROP NOT NULL,
ALTER COLUMN "sportScore" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ScoreHistoryPoint" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "score" INTEGER NOT NULL,

    CONSTRAINT "ScoreHistoryPoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScoreHistoryPoint_userId_at_idx" ON "ScoreHistoryPoint"("userId", "at");

-- AddForeignKey
ALTER TABLE "ScoreHistoryPoint" ADD CONSTRAINT "ScoreHistoryPoint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
