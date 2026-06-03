import { Controller, Get } from '@nestjs/common';
import type { CardBacksListResponse } from '@durak/shared-types';
import { CardBacksService } from './card-backs.service';

@Controller('card-backs')
export class CardBacksController {
  constructor(private readonly service: CardBacksService) {}

  @Get()
  list(): CardBacksListResponse {
    return this.service.list();
  }
}
