-- CreateEnum
CREATE TYPE "RankField" AS ENUM ('Sport', 'Academy', 'Entertainment');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "academyScore" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "entertainmentScore" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sportScore" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "LeaderboardTop" (
    "field" "RankField" NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "points" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaderboardTop_pkey" PRIMARY KEY ("field")
);
