-- CreateEnum
CREATE TYPE "CashKind" AS ENUM ('IN', 'OUT');

-- CreateTable
CREATE TABLE "CashEntry" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "kind" "CashKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashEntry_date_idx" ON "CashEntry"("date");
