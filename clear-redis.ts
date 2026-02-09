import { Redis } from 'ioredis';

async function clearRedis() {
    const redis = new Redis({
        host: 'localhost',
        port: 6379,
    });

    try {
        console.log('Intentando conectar a Redis en localhost:6379...');
        const result = await redis.flushall();
        console.log('✅ Éxito: Redis vaciado (FLUSHALL):', result);
    } catch (error) {
        console.error('❌ Error al vaciar Redis:', error.message);
        console.log('\nPosibles causas:');
        console.log('1. Redis no está corriendo.');
        console.log('2. El puerto 6379 no es el correcto.');
        console.log('3. Redis requiere contraseña (no configurada en este script).');
    } finally {
        redis.disconnect();
        process.exit(0);
    }
}

clearRedis();
