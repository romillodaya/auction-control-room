import test from "node:test";
import assert from "node:assert/strict";
import {
  canTeamBid,
  createDefaultState,
  deriveStats,
  getCurrentPlayer,
  markCurrentUnsold,
  retainCurrentPlayer,
  sellCurrentPlayer,
  setFinalBidForTeam,
} from "../src/domain.mjs";
import { parseCSV, toCSV } from "../src/csv.mjs";

test("final bid entry sets winning team and amount", () => {
  const state = createDefaultState();
  const team = state.teams[0];

  setFinalBidForTeam(state, team.id, 1500);

  assert.equal(state.auction.currentBid, 1500);
  assert.equal(state.auction.highestBidderId, team.id);
});

test("final bid must meet opening bid", () => {
  const state = createDefaultState();
  const team = state.teams[0];

  const check = canTeamBid(state, team.id, state.settings.minBid - 1);

  assert.equal(check.ok, false);
  assert.match(check.errors[0], /Bid must be at least/);
});

test("sale assigns player and moves to next available player", () => {
  const state = createDefaultState();
  const firstPlayer = getCurrentPlayer(state);
  const team = state.teams[0];

  setFinalBidForTeam(state, team.id, 1500);
  sellCurrentPlayer(state);

  assert.equal(firstPlayer.status, "sold");
  assert.equal(firstPlayer.teamId, team.id);
  assert.equal(firstPlayer.soldPrice, 1500);
  assert.notEqual(state.auction.currentPlayerId, firstPlayer.id);
});

test("unsold player is passed and auction advances", () => {
  const state = createDefaultState();
  const firstPlayer = getCurrentPlayer(state);

  markCurrentUnsold(state);

  assert.equal(firstPlayer.status, "unsold");
  assert.notEqual(state.auction.currentPlayerId, firstPlayer.id);
});

test("player with an active bid cannot be marked unsold", () => {
  const state = createDefaultState();
  setFinalBidForTeam(state, state.teams[0].id, 1500);

  assert.throws(() => markCurrentUnsold(state), /Use undo before passing/);
});

test("retain is limited per team", () => {
  const state = createDefaultState();
  const team = state.teams[0];

  retainCurrentPlayer(state, team.id);
  assert.equal(deriveStats(state)[team.id].retainedCount, 1);

  assert.throws(() => retainCurrentPlayer(state, team.id), /Retain limit reached/);
});

test("csv parser handles commas, quotes, and newlines", () => {
  const rows = [
    ["Name", "Role"],
    ['A "Fast" Player', "Batter"],
    ["Line\nBreak", "Bowler, Spin"],
  ];

  assert.deepEqual(parseCSV(toCSV(rows)), rows);
});
