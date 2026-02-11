import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const usuario = await prisma.usuario.upsert({
    where: { id: 1 },
    update: {},
    create: {
      nombre: 'Admin CodeCamp',
      rol: 'ADMIN',
      credencialSOL: {
        create: {
          ruc: '20614992035',
          usuarioSOL: 'MODDATOS',
          claveSOL: 'moddatos',
          estado: 'ACTIVO',
        },
      },
    },
  });

  console.log({ usuario });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
