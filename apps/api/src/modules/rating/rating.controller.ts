import { Controller, Get, Query } from '@nestjs/common';
import type { RatingListResponse } from '@durak/shared-types';
import { RatingService } from './rating.service';
import { ListRatingQueryDto } from './dto/list-rating.dto';

@Controller('rating')
export class RatingController {
  constructor(private readonly service: RatingService) {}

  @Get()
  list(@Query() q: ListRatingQueryDto): Promise<RatingListResponse> {
    return this.service.list({
      page: q.page ?? 1,
      limit: q.limit ?? 20,
    });
  }
}
