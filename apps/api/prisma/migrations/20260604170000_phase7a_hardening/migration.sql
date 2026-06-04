-- Phase 7A hardening:
--   1. Switch GameParticipant.userId and RatingHistory.userId from
--      ON DELETE CASCADE to ON DELETE RESTRICT. We never hard-delete users
--      (admin uses soft-delete via `disabledAt`); RESTRICT guards against an
--      accidental raw-SQL DELETE wiping out game history.
--   2. Add a CHECK constraint on RatingConfig so only the canonical
--      `singleton` row can ever exist.

ALTER TABLE "GameParticipant" DROP CONSTRAINT "GameParticipant_userId_fkey";
ALTER TABLE "GameParticipant" ADD CONSTRAINT "GameParticipant_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RatingHistory" DROP CONSTRAINT "RatingHistory_userId_fkey";
ALTER TABLE "RatingHistory" ADD CONSTRAINT "RatingHistory_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RatingConfig"
  ADD CONSTRAINT "RatingConfig_singleton_check" CHECK (id = 'singleton');
