-- AlterTable
ALTER TABLE "Factura" ADD COLUMN     "detallesObtenidos" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Factura_usuarioId_estado_idx" ON "Factura"("usuarioId", "estado");

-- CreateIndex
CREATE INDEX "Factura_detallesObtenidos_idx" ON "Factura"("detallesObtenidos");
