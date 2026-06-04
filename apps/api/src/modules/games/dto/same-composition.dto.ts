import { IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query DTO for `GET /games/:id/same-composition`.
 * Phase 7B: lists past finished games played by the same set of users.
 *
 * NB: We intentionally do NOT enforce an upper bound here — the service
 * silently clamps to `SAME_COMPOSITION_MAX_LIMIT` (currently 50) so callers
 * passing larger values get the largest allowed page instead of a 400. This
 * is the UX-friendlier choice for an optional query param.
 */
export class SameCompositionQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}
