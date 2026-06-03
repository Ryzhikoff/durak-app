/**
 * Shared nickname validation rules used by every DTO that accepts a nickname.
 *
 * - Length: 2..24 characters (after trimming).
 * - Pattern: any unicode codepoints, but the value must not start or end with
 *   whitespace. This catches both empty and pad-only inputs.
 */
export const NICKNAME_PATTERN = /^\S(?:.*\S)?$/u;
export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 24;
export const NICKNAME_PATTERN_MESSAGE = 'nickname must not have leading/trailing whitespace';
