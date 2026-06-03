import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * REST escape hatch payload to send a single {@link GameCommand}. The actual
 * shape (attack / beat / translate / ...) is validated by the engine reducer;
 * this DTO only asserts the outer shape so we don't reject anything the engine
 * would have accepted.
 *
 * Also used by the WebSocket `game:command` handler — see
 * `games.gateway.ts:onCommand`, which manually validates the inbound body via
 * `class-validator`'s `validate(plainToInstance(GameCommandWsDto, body))` to
 * reject malformed payloads with BAD_REQUEST before they reach the service
 * layer. (NestJS pipes don't bind cleanly to the socket.io adapter we use, so
 * the validation is invoked imperatively.)
 */
export class GameCommandDto {
  @IsObject()
  command!: Record<string, unknown>;
}

/**
 * Wire shape for `game:command` (subscribe & command share `gameId`). Kept
 * separate from {@link GameCommandDto} so the REST DTO stays unaware of the
 * gateway envelope.
 */
export class GameCommandWsDto {
  @IsString()
  @MaxLength(64)
  gameId!: string;

  @IsObject()
  command!: Record<string, unknown>;
}

export class SubscribeGameDto {
  @IsString()
  @IsOptional()
  @MaxLength(64)
  gameId?: string;
}
