-- AlterTable
ALTER TABLE "Plate" ADD COLUMN     "batchId" TEXT;

-- CreateTable
CREATE TABLE "PlateBatch" (
    "id" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlateBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlateBatch_createdAt_idx" ON "PlateBatch"("createdAt");

-- CreateIndex
CREATE INDEX "Plate_batchId_idx" ON "Plate"("batchId");

-- AddForeignKey
ALTER TABLE "PlateBatch" ADD CONSTRAINT "PlateBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plate" ADD CONSTRAINT "Plate_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PlateBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
