/**
 * Frontend-local constants. Kept here (instead of importing from
 * `@durak/shared-types`) because shared-types is consumed as raw TS — pulling
 * a runtime value out of it pulls in the whole module graph. Strings are
 * mirrored from the shared definition.
 */

/** Sentinel id meaning "use the user-uploaded custom card back image". */
export const CUSTOM_CARD_BACK_ID = '__custom__';
