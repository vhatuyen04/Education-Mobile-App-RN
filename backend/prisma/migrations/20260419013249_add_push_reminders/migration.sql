-- CreateTable
CREATE TABLE "UserPushToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "disabledAt" TIMESTAMP(3),

    CONSTRAINT "UserPushToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserReminderSetting" (
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "eventBeforeMs" INTEGER NOT NULL DEFAULT 1800000,
    "goalBeforeMs" INTEGER NOT NULL DEFAULT 86400000,
    "stepBeforeMs" INTEGER NOT NULL DEFAULT 10800000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserReminderSetting_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ReminderDelivery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserPushToken_token_key" ON "UserPushToken"("token");

-- CreateIndex
CREATE INDEX "UserPushToken_userId_idx" ON "UserPushToken"("userId");

-- CreateIndex
CREATE INDEX "UserPushToken_userId_disabledAt_idx" ON "UserPushToken"("userId", "disabledAt");

-- CreateIndex
CREATE INDEX "UserReminderSetting_enabled_idx" ON "UserReminderSetting"("enabled");

-- CreateIndex
CREATE INDEX "ReminderDelivery_scheduledFor_idx" ON "ReminderDelivery"("scheduledFor");

-- CreateIndex
CREATE INDEX "ReminderDelivery_userId_scheduledFor_idx" ON "ReminderDelivery"("userId", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderDelivery_userId_kind_entityId_scheduledFor_key" ON "ReminderDelivery"("userId", "kind", "entityId", "scheduledFor");

-- AddForeignKey
ALTER TABLE "UserPushToken" ADD CONSTRAINT "UserPushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserReminderSetting" ADD CONSTRAINT "UserReminderSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderDelivery" ADD CONSTRAINT "ReminderDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
