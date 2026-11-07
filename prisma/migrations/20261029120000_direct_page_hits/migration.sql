-- Direct visits to a page's link are hits with no plate
ALTER TABLE "Hit" ALTER COLUMN "plateCode" DROP NOT NULL;
