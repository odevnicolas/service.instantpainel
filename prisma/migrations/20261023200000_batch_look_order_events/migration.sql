-- AlterEnum
ALTER TYPE "OrderStage" ADD VALUE 'DELIVERED';

-- AlterTable
ALTER TABLE "PlateBatch" ADD COLUMN     "art" TEXT,
ADD COLUMN     "layout" JSONB;

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "stage" "OrderStage" NOT NULL,
    "userId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderEvent_orderId_at_idx" ON "OrderEvent"("orderId", "at");

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: orders from before the log get their registration and current stage, at the times known
INSERT INTO "OrderEvent" ("orderId", "stage", "at") SELECT "id", 'CUTTING', "createdAt" FROM "Order";
INSERT INTO "OrderEvent" ("orderId", "stage", "at") SELECT "id", "stage", "updatedAt" FROM "Order" WHERE "stage" <> 'CUTTING';
