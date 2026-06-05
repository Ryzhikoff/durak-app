import { Controller, Get } from '@nestjs/common';
import type { HighlightsResponse } from '@durak/shared-types';
import { HighlightsService } from './highlights.service';

@Controller('highlights')
export class HighlightsController {
  constructor(private readonly service: HighlightsService) {}

  /** Public — same auth model as /api/rating. */
  @Get()
  list(): Promise<HighlightsResponse> {
    return this.service.getHighlights();
  }
}
