import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Esto permite que el Frontend de tu compañero se comunique contigo
  app.enableCors(); 
  const port = process.env.PORT || 3043;
  await app.listen(port, '0.0.0.0'); // Escucha en toda la red local
  console.log(`Application is running on: http://localhost:${port}`);
}
bootstrap();
