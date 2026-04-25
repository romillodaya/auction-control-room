import test from "node:test";
import assert from "node:assert/strict";
import {
  bidForTeam,
  canTeamBid,
  createDefaultState,
  deriveStats,
  getCurrentPlayer,
  markCurrentUnsold,
  retainCurrentPlayer,
  sellCurrentPlayer,
} from "../src/domain.mjs";
import { parseCSV, toCSV } from "../src/csv.mjs";

test("bidding starts at opening bid and advances by increment", () => {
  const state = createDefaultState();
  const team = state.teams[0];

  bidForTeam(state, team.id);
  assert.equal(state.auction.currentBid, state.settings.minBid);

  bidForTeam(state, state.teams[1].id);
  assert.equal(state.auction.currentBid, state.settings.minBid + state.settings.bidIncrement);
});

test("highest bidder cannot bid again immediately", () => {
  const state = createDefaultState();
  const team = state.teams[0];
  bidForTeam(state, team.id);

  const check = canTeamBid(state, team.id);
  assert.equal(check.ok, false);
  assert.match(check.errors[0], /Already highest bidder/);
});

test("sale assigns player and moves to next available player", () => {
  const state = createDefaultState();
  const firstPlayer = getCurrentPlayer(state);
  const team = state.teams[0];

  bidForTeam(state, team.id);
  sellCurrentPlayer(state);

  assert.equal(firstPlayer.status, "sold");
  assert.equal(firstPlayer.teamId, team.id);
  assert.equal(firstPlayer.soldPrice, state.settings.minBid);
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
  bidForTeam(state, state.teams[0].id);

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
