-- CreateTable
CREATE TABLE "UserTextReaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" VARCHAR(30) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTextReaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserTextReaction_userId_sortOrder_idx" ON "UserTextReaction"("userId", "sortOrder");

-- AddForeignKey
ALTER TABLE "UserTextReaction" ADD CONSTRAINT "UserTextReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
