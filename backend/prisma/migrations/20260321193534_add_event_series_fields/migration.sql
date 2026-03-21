-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "seriesEndAt" TIMESTAMP(3),
ADD COLUMN     "seriesId" TEXT,
ADD COLUMN     "seriesStartAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Event_userId_seriesId_idx" ON "Event"("userId", "seriesId");
