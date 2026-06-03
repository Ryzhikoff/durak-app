import type { CardBackDef } from '@durak/shared-types';

/**
 * Canonical card-back catalog.
 *
 * These are just metadata — the actual visual is rendered on the frontend via
 * CSS / SVG using `pattern` + `colors`. Keep ids stable: users have them
 * persisted in the DB (`User.cardBackId`).
 */
export const CARD_BACKS: readonly CardBackDef[] = [
  {
    id: 'classic-1',
    name: 'Classic Red',
    kind: 'pattern',
    colors: ['#7a0d20', '#3a050d'],
    pattern: 'crosshatch',
  },
  {
    id: 'classic-2',
    name: 'Classic Blue',
    kind: 'pattern',
    colors: ['#1a3a7a', '#0a1a3d'],
    pattern: 'crosshatch',
  },
  {
    id: 'classic-3',
    name: 'Classic Green',
    kind: 'pattern',
    colors: ['#13573a', '#06291a'],
    pattern: 'grid',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    kind: 'pattern',
    colors: ['#10131f', '#1f2742'],
    pattern: 'dots',
  },
  {
    id: 'ember',
    name: 'Ember',
    kind: 'pattern',
    colors: ['#b3401b', '#2b0c05'],
    pattern: 'stripes',
  },
  {
    id: 'aurora',
    name: 'Aurora',
    kind: 'pattern',
    colors: ['#1d6a7f', '#7a2d8c'],
    pattern: 'wave',
  },
  {
    id: 'mint',
    name: 'Mint',
    kind: 'pattern',
    colors: ['#0fa37a', '#053826'],
    pattern: 'chevron',
  },
  {
    id: 'rose',
    name: 'Rose',
    kind: 'pattern',
    colors: ['#c14a7a', '#3a1023'],
    pattern: 'dots',
  },
  {
    id: 'mono-light',
    name: 'Mono Light',
    kind: 'pattern',
    colors: ['#dadada', '#9a9a9a'],
    pattern: 'plain',
  },
  {
    id: 'mono-dark',
    name: 'Mono Dark',
    kind: 'pattern',
    colors: ['#1c1c1c', '#0a0a0a'],
    pattern: 'plain',
  },
] as const;

/** Sentinel id the frontend uses to mean "pick a random back per game". */
export const RANDOM_CARD_BACK_OPTION_ID = '__random__';

/**
 * Sentinel id meaning "use the user-uploaded custom card back".
 *
 * Duplicated rather than imported from `@durak/shared-types` so the API doesn't
 * incur a runtime TS-source require (shared-types ships sources only). Must
 * stay in sync with `CUSTOM_CARD_BACK_ID` in `packages/shared-types`.
 */
export const CUSTOM_CARD_BACK_ID = '__custom__';
