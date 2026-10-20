-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'RESELLER', 'CLIENT');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'CLIENT',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "managerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageAccess" (
    "pageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "PageAccess_pkey" PRIMARY KEY ("pageId","userId")
);

-- CreateTable
CREATE TABLE "Plate" (
    "code" TEXT NOT NULL,
    "ownerId" TEXT,
    "pageId" TEXT,
    "link" TEXT,
    "google" BOOLEAN NOT NULL DEFAULT false,
    "reviewFilter" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT,
    "description" TEXT,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plate_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "PlateAccess" (
    "plateCode" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "PlateAccess_pkey" PRIMARY KEY ("plateCode","userId")
);

-- CreateTable
CREATE TABLE "Hit" (
    "id" BIGSERIAL NOT NULL,
    "plateCode" TEXT NOT NULL,
    "pageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Hit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_managerId_idx" ON "User"("managerId");

-- CreateIndex
CREATE UNIQUE INDEX "Page_slug_key" ON "Page"("slug");

-- CreateIndex
CREATE INDEX "Page_ownerId_idx" ON "Page"("ownerId");

-- CreateIndex
CREATE INDEX "PageAccess_userId_idx" ON "PageAccess"("userId");

-- CreateIndex
CREATE INDEX "Plate_ownerId_idx" ON "Plate"("ownerId");

-- CreateIndex
CREATE INDEX "Plate_pageId_idx" ON "Plate"("pageId");

-- CreateIndex
CREATE INDEX "PlateAccess_userId_idx" ON "PlateAccess"("userId");

-- CreateIndex
CREATE INDEX "Hit_plateCode_createdAt_idx" ON "Hit"("plateCode", "createdAt");

-- CreateIndex
CREATE INDEX "Hit_pageId_createdAt_idx" ON "Hit"("pageId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageAccess" ADD CONSTRAINT "PageAccess_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageAccess" ADD CONSTRAINT "PageAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plate" ADD CONSTRAINT "Plate_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plate" ADD CONSTRAINT "Plate_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlateAccess" ADD CONSTRAINT "PlateAccess_plateCode_fkey" FOREIGN KEY ("plateCode") REFERENCES "Plate"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlateAccess" ADD CONSTRAINT "PlateAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hit" ADD CONSTRAINT "Hit_plateCode_fkey" FOREIGN KEY ("plateCode") REFERENCES "Plate"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hit" ADD CONSTRAINT "Hit_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;
