-- Phase 7A: persist completed games + TrueSkill rating updates + admin config.

-- AlterTable: User gains games_played counter for fast profile/rating display.
ALTER TABLE "User" ADD COLUMN "gamesPlayed" INTEGER NOT NULL DEFAULT 0;

-- CreateTable: Game (one row per completed game).
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "settingsJson" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "loserId" TEXT,
    "totalBouts" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: list latest games first.
CREATE INDEX "Game_finishedAt_idx" ON "Game"("finishedAt" DESC);

-- CreateTable: GameParticipant (one row per (game, user)).
CREATE TABLE "GameParticipant" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "place" INTEGER NOT NULL,
    "seatIndex" INTEGER NOT NULL,
    "isWinner" BOOLEAN NOT NULL,
    "isLoser" BOOLEAN NOT NULL,
    "muBefore" DOUBLE PRECISION NOT NULL,
    "sigmaBefore" DOUBLE PRECISION NOT NULL,
    "muAfter" DOUBLE PRECISION NOT NULL,
    "sigmaAfter" DOUBLE PRECISION NOT NULL,
    "deltaDisplay" DOUBLE PRECISION NOT NULL,
    "nicknameSnapshot" TEXT NOT NULL,
    "avatarUrlSnapshot" TEXT,
    "attacksMade" INTEGER NOT NULL DEFAULT 0,
    "beatsMade" INTEGER NOT NULL DEFAULT 0,
    "translatesMade" INTEGER NOT NULL DEFAULT 0,
    "takesAsked" INTEGER NOT NULL DEFAULT 0,
    "cardsTaken" INTEGER NOT NULL DEFAULT 0,
    "boutsAttacked" INTEGER NOT NULL DEFAULT 0,
    "boutsDefended" INTEGER NOT NULL DEFAULT 0,
    "cheatAttemptedTotal" INTEGER NOT NULL DEFAULT 0,
    "cheatCaught" INTEGER NOT NULL DEFAULT 0,
    "cheatEscaped" INTEGER NOT NULL DEFAULT 0,
    "noticesIssued" INTEGER NOT NULL DEFAULT 0,
    "noticesCorrect" INTEGER NOT NULL DEFAULT 0,
    "noticesWrong" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GameParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GameParticipant_gameId_userId_key" ON "GameParticipant"("gameId", "userId");
CREATE INDEX "GameParticipant_userId_gameId_idx" ON "GameParticipant"("userId", "gameId");
CREATE INDEX "GameParticipant_userId_place_idx" ON "GameParticipant"("userId", "place");

-- CreateTable: RatingConfig (singleton, id = 'singleton').
CREATE TABLE "RatingConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "initialMu" DOUBLE PRECISION NOT NULL DEFAULT 25.0,
    "initialSigma" DOUBLE PRECISION NOT NULL DEFAULT 8.333333,
    "beta" DOUBLE PRECISION NOT NULL DEFAULT 4.166667,
    "tau" DOUBLE PRECISION NOT NULL DEFAULT 0.083333,
    "drawProbability" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "RatingConfig_pkey" PRIMARY KEY ("id")
);

-- RatingHistory: existing rows (none yet in production) need gameId not null
-- and a FK to Game.id. Drop any orphan rows defensively, then alter.
DELETE FROM "RatingHistory" WHERE "gameId" IS NULL;
ALTER TABLE "RatingHistory" ALTER COLUMN "gameId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_loserId_fkey" FOREIGN KEY ("loserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GameParticipant" ADD CONSTRAINT "GameParticipant_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameParticipant" ADD CONSTRAINT "GameParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RatingHistory" ADD CONSTRAINT "RatingHistory_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
