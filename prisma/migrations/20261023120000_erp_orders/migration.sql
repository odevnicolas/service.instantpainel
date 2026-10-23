-- CreateEnum
CREATE TYPE "ErpRole" AS ENUM ('ORDERS', 'CUTTING', 'PRINTING');

-- CreateEnum
CREATE TYPE "OrderStage" AS ENUM ('CUTTING', 'PRINTING', 'READY');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "erpRole" "ErpRole";

-- AlterTable
ALTER TABLE "PlateBatch" ADD COLUMN     "name" TEXT;

-- CreateTable
CREATE TABLE "Order" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "batchId" TEXT,
    "plateType" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "files" TEXT[],
    "dueDate" DATE NOT NULL,
    "stage" "OrderStage" NOT NULL DEFAULT 'CUTTING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_batchId_key" ON "Order"("batchId");

-- CreateIndex
CREATE INDEX "Order_stage_dueDate_idx" ON "Order"("stage", "dueDate");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PlateBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

