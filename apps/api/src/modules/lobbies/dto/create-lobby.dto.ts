import { IsObject, IsOptional } from 'class-validator';
import type { LobbySettings } from '@durak/shared-types';

/**
 * Validation of the actual fields of `settings` happens centrally in
 * {@link mergeAndValidateSettings} — keeping it here would mean duplicating the
 * rule set both in DTO decorators and in the WS path (which deliberately does
 * not flow through Nest's REST pipeline). The DTO simply asserts the outer
 * shape and lets the service throw `INVALID_SETTINGS` for bad values.
 */
export class CreateLobbyDto {
  @IsOptional()
  @IsObject()
  settings?: Partial<LobbySettings>;
}
