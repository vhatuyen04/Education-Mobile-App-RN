-- CreateTable
CREATE TABLE "UsedAiSuggestion" (
    "jti" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsedAiSuggestion_pkey" PRIMARY KEY ("jti")
);

-- CreateIndex
CREATE INDEX "UsedAiSuggestion_userId_idx" ON "UsedAiSuggestion"("userId");
