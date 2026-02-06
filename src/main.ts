import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Esto permite que el Frontend de tu compañero se comunique contigo
  app.enableCors(); 
  await app.listen(3043, '0.0.0.0'); // Escucha en toda la red local
  
  //await app.listen(3043);
}
bootstrap();
