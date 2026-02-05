/*
  Warnings:

  - You are about to drop the column `total` on the `Factura` table. All the data in the column will be lost.
  - Added the required column `costoTotal` to the `Factura` table without a default value. This is not possible if the table is not empty.
  - Added the required column `igv` to the `Factura` table without a default value. This is not possible if the table is not empty.
  - Added the required column `importeTotal` to the `Factura` table without a default value. This is not possible if the table is not empty.
  - Added the required column `numero` to the `Factura` table without a default value. This is not possible if the table is not empty.
  - Added the required column `serie` to the `Factura` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Factura" DROP COLUMN "total",
ADD COLUMN     "costoTotal" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "igv" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "importeTotal" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "moneda" TEXT NOT NULL DEFAULT 'PEN',
ADD COLUMN     "numero" TEXT NOT NULL,
ADD COLUMN     "serie" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "DetalleFactura" (
    "id" SERIAL NOT NULL,
    "descripcion" TEXT NOT NULL,
    "cantidad" DECIMAL(12,3) NOT NULL,
    "costoUnitario" DECIMAL(12,2) NOT NULL,
    "unidadMedida" TEXT,
    "facturaId" INTEGER NOT NULL,

    CONSTRAINT "DetalleFactura_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "DetalleFactura" ADD CONSTRAINT "DetalleFactura_facturaId_fkey" FOREIGN KEY ("facturaId") REFERENCES "Factura"("idFactura") ON DELETE CASCADE ON UPDATE CASCADE;
