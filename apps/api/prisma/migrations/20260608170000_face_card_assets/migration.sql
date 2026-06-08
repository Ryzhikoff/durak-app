-- CreateTable
CREATE TABLE "FaceCardAsset" (
    "id" TEXT NOT NULL,
    "rank" TEXT NOT NULL,
    "suit" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "uploadedById" TEXT,

    CONSTRAINT "FaceCardAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FaceCardAsset_rank_suit_key" ON "FaceCardAsset"("rank", "suit");

-- AddForeignKey
ALTER TABLE "FaceCardAsset" ADD CONSTRAINT "FaceCardAsset_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
