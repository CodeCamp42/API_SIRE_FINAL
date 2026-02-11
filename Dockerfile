# Usar la imagen oficial de Playwright que ya tiene Node.js y las dependencias de los navegadores
FROM mcr.microsoft.com/playwright:v1.40.0-jammy

# Establecer el directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./
COPY prisma ./prisma/

# Instalar dependencias
# Usamos --foreground para evitar problemas con hooks de postinstalación en algunos entornos
RUN npm install

# Generar el cliente de Prisma
RUN npx prisma generate

# Copiar el resto del código
COPY . .

# Compilar la aplicación
RUN npm run build

# Crear directorio para descargas temporales si no existe
RUN mkdir -p downloads && chmod 777 downloads

# Exponer el puerto de la aplicación (NestJS por defecto es 3000)
EXPOSE 3000

# Script de inicio: ejecuta migraciones y luego la app
# En producción (Dokploy), usaremos prisma migrate deploy
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start:prod"]
