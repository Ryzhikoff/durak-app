import { Injectable } from '@nestjs/common';
import type { CardBackDef, CardBacksListResponse } from '@durak/shared-types';
import { CARD_BACKS, RANDOM_CARD_BACK_OPTION_ID } from './card-backs.data';

@Injectable()
export class CardBacksService {
  /** Returns the canonical (frozen) list of card-back definitions. */
  list(): CardBacksListResponse {
    return {
      items: CARD_BACKS.map((c) => ({ ...c, colors: [c.colors[0], c.colors[1]] })),
      randomOptionId: RANDOM_CARD_BACK_OPTION_ID,
    };
  }

  /** Lookup helper for other modules (e.g. profile rendering). */
  find(id: string): CardBackDef | undefined {
    return CARD_BACKS.find((c) => c.id === id);
  }
}
