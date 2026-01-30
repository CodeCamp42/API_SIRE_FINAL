import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SireService } from './sire.service';


@Module({
  imports: [HttpModule],
  providers: [SireService],
  exports: [SireService],
})
export class SireModule {}
