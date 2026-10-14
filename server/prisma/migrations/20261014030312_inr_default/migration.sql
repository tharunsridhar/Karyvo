-- AlterTable
ALTER TABLE "Service" ALTER COLUMN "currency" SET DEFAULT 'INR';

-- The product now prices everything in Indian rupees (amounts stay in minor units, paise).
UPDATE "Service" SET "currency" = 'INR' WHERE "currency" = 'USD';
UPDATE "Booking" SET "currency" = 'INR' WHERE "currency" = 'USD';
