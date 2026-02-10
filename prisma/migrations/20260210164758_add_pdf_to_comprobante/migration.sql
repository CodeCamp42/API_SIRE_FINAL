/*
  Warnings:

  - Added the required column `pdf` to the `ComprobanteElectronico` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ComprobanteElectronico" ADD COLUMN     "pdf" TEXT NOT NULL;
