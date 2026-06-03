/**
 * Tiny helpers around the `DomainEvent` union. Reducers build event arrays
 * locally; this module just types the union and offers a `filterEvents` that
 * the future broadcast layer can use to redact private bits per recipient.
 */

import type { DomainEvent, PlayerId } from '../types.js';

export function filterEventsForPlayer(
  events: readonly DomainEvent[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _viewerId: PlayerId,
): DomainEvent[] {
  // Right now we trust the snapshot for redaction (PlayerGameView never
  // exposes opponent hands). Event payloads do not include hidden card data,
  // so we return everything as-is. Hook left here intentionally for Phase 5.
  return events.slice();
}
