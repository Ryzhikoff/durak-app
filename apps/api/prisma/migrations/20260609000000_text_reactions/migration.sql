-- CreateTable
CREATE TABLE "TextReaction" (
    "id" TEXT NOT NULL,
    "text" VARCHAR(30) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TextReaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TextReaction_enabled_sortOrder_idx" ON "TextReaction"("enabled", "sortOrder");
