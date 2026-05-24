import test from "node:test";
import assert from "node:assert/strict";
import {
  canTeamBid,
  activeDivision,
  createDefaultState,
  deriveStats,
  divisionLabel,
  getCurrentPlayer,
  normalizeState,
  markCurrentUnsold,
  playersForDivision,
  retainCurrentPlayer,
  sellCurrentPlayer,
  setFinalBidForTeam,
  snapshotState,
  teamsForDivision,
} from "../src/domain.mjs";
import { parseCSV, playersFromCSV, toCSV } from "../src/csv.mjs";
import { saveState } from "../src/storage.mjs";

test("final bid entry sets winning team and amount", () => {
  const state = createDefaultState();
  const team = state.teams[0];

  setFinalBidForTeam(state, team.id, 1500);

  assert.equal(state.auction.currentBid, 1500);
  assert.equal(state.auction.highestBidderId, team.id);
});

test("default players come from the KPL 2026 registrations", () => {
  const state = createDefaultState();
  const men = playersForDivision(state, "men");
  const women = playersForDivision(state, "women");

  assert.equal(state.players.length, 66);
  assert.equal(men.length, 52);
  assert.equal(women.length, 14);
  assert.equal(men[0].name, "Jeet Shah");
  assert.equal(men[0].playerNumber, "1");
  assert.equal(women[0].name, "Bhavika");
  assert.equal(women[0].playerNumber, "13");
});

test("state keeps men and women auction data in separate sections", () => {
  const state = createDefaultState();

  assert.equal(activeDivision(state), "men");
  assert.equal(divisionLabel("women"), "Women's");
  assert.equal(teamsForDivision(state, "men").length, 6);
  assert.equal(teamsForDivision(state, "women").length, 2);
  assert.equal(playersForDivision(state, "men")[0].playerNumber, "1");
  assert.equal(playersForDivision(state, "women")[0].playerNumber, "13");

  state.ui.division = "women";
  state.auction = state.auctions.women;
  const normalized = normalizeState(state);

  assert.equal(getCurrentPlayer(normalized).division, "women");
  assert.equal(Object.keys(deriveStats(normalized)).length, 2);
});

test("selling in one section does not change the other section auction", () => {
  const state = createDefaultState();
  const womenCurrentId = state.auctions.women.currentPlayerId;

  setFinalBidForTeam(state, teamsForDivision(state, "men")[0].id, 1500);
  sellCurrentPlayer(state);

  assert.equal(state.auctions.women.currentPlayerId, womenCurrentId);
  assert.equal(playersForDivision(state, "women").every((player) => player.status === "available"), true);
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

test("sale advances from a manually selected player to the next player in order", () => {
  const state = createDefaultState();
  const selectedPlayer = state.players[5];
  const expectedNextPlayer = state.players[6];
  const team = state.teams[0];

  state.auction.currentPlayerId = selectedPlayer.id;
  setFinalBidForTeam(state, team.id, 1500);
  sellCurrentPlayer(state);

  assert.equal(selectedPlayer.status, "sold");
  assert.equal(state.auction.currentPlayerId, expectedNextPlayer.id);
});

test("final bid accepts comma formatted values", () => {
  const state = createDefaultState();
  const team = state.teams[0];

  setFinalBidForTeam(state, team.id, "1,500");

  assert.equal(state.auction.currentBid, 1500);
});

test("unsold player is passed and auction advances", () => {
  const state = createDefaultState();
  const firstPlayer = getCurrentPlayer(state);

  markCurrentUnsold(state);

  assert.equal(firstPlayer.status, "unsold");
  assert.notEqual(state.auction.currentPlayerId, firstPlayer.id);
});

test("unsold players stay in the auction rotation and can be sold later", () => {
  const state = createDefaultState();
  state.players = state.players.slice(0, 2);
  state.auction.currentPlayerId = state.players[0].id;
  const firstPlayer = state.players[0];
  const secondPlayer = state.players[1];
  const team = state.teams[0];

  markCurrentUnsold(state);
  assert.equal(state.auction.currentPlayerId, secondPlayer.id);

  markCurrentUnsold(state);
  assert.equal(state.auction.currentPlayerId, firstPlayer.id);
  assert.equal(firstPlayer.status, "unsold");
  assert.equal(canTeamBid(state, team.id, state.settings.minBid).ok, true);

  setFinalBidForTeam(state, team.id, state.settings.minBid);
  sellCurrentPlayer(state);

  assert.equal(firstPlayer.status, "sold");
  assert.equal(firstPlayer.teamId, team.id);
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

test("retain keeps current player for zero points and advances", () => {
  const state = createDefaultState();
  const player = getCurrentPlayer(state);
  const nextPlayer = state.players[1];
  const team = state.teams[0];

  retainCurrentPlayer(state, team.id);

  assert.equal(player.status, "sold");
  assert.equal(player.teamId, team.id);
  assert.equal(player.soldPrice, 0);
  assert.equal(player.isRetained, true);
  assert.equal(state.auction.currentPlayerId, nextPlayer.id);
});

test("max usable bid protects paid slots after the free retain", () => {
  const state = createDefaultState();
  const team = state.teams[0];

  assert.equal(deriveStats(state)[team.id].maxAllowedBid, 7000);

  retainCurrentPlayer(state, team.id);

  assert.equal(deriveStats(state)[team.id].maxAllowedBid, 7000);
});

test("csv parser handles commas, quotes, and newlines", () => {
  const rows = [
    ["Name", "Role"],
    ['A "Fast" Player', "Batter"],
    ["Line\nBreak", "Bowler, Spin"],
  ];

  assert.deepEqual(parseCSV(toCSV(rows)), rows);
});

test("player CSV import handles case-insensitive statuses and comma prices", () => {
  const state = createDefaultState();
  const rows = [
    ["Gender", "Player ID", "Name", "Status", "Team", "Sold Price", "Is Retained"],
    ["Men", "101", "Sold Player", "Sold", state.teams[0].name, "1,500", "true"],
    ["Women", "102", "Unsold Player", "Unsold", "", "", ""],
  ];

  const players = playersFromCSV(toCSV(rows), state.teams);

  assert.equal(players[0].division, "men");
  assert.equal(players[0].playerNumber, "101");
  assert.equal(players[0].status, "sold");
  assert.equal(players[0].teamId, state.teams[0].id);
  assert.equal(players[0].soldPrice, 1500);
  assert.equal(players[0].isRetained, true);
  assert.equal(players[1].division, "women");
  assert.equal(players[1].status, "unsold");
});

test("state save caps undo history in normal browser storage", () => {
  const originalStorage = globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, String(value));
    },
  };

  try {
    const state = createDefaultState();
    state.undoStack = Array.from({ length: 45 }, () => snapshotState(state));

    assert.equal(saveState(state), true);
    assert.equal(state.undoStack.length, 20);
    assert.equal(JSON.parse(store.get("auction-control-room-v2")).undoStack.length, 20);
  } finally {
    globalThis.localStorage = originalStorage;
  }
});

test("state save trims app-owned storage when browser quota is tight", () => {
  const originalStorage = globalThis.localStorage;
  const store = new Map([
    ["auction-control-room-v1", "old-state"],
    ["auction-control-room-v1:last-good", "old-recovery"],
    ["auction-control-room-v2:last-good", "duplicate-recovery"],
  ]);
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      if (String(value).includes("data:image")) {
        throw new Error("quota exceeded");
      }
      store.set(key, String(value));
    },
  };

  try {
    const state = createDefaultState();
    state.settings.logo = `data:image/png;base64,${"x".repeat(2000)}`;
    state.undoStack = Array.from({ length: 12 }, () => snapshotState(state));

    saveState(state);

    assert.equal(store.has("auction-control-room-v1"), false);
    assert.equal(store.has("auction-control-room-v1:last-good"), false);
    assert.equal(store.has("auction-control-room-v2:last-good"), false);
    assert.equal(JSON.parse(store.get("auction-control-room-v2")).settings.logo, "");
  } finally {
    globalThis.localStorage = originalStorage;
  }
});

test("state save does not throw when browser storage is unavailable", () => {
  const originalStorage = globalThis.localStorage;
  const originalConsoleError = console.error;
  globalThis.localStorage = {
    getItem: () => {
      throw new Error("storage unavailable");
    },
    removeItem: () => {
      throw new Error("storage unavailable");
    },
    setItem: () => {
      throw new Error("storage unavailable");
    },
  };
  console.error = () => {};

  try {
    assert.doesNotThrow(() => {
      assert.equal(saveState(createDefaultState()), false);
    });
  } finally {
    console.error = originalConsoleError;
    globalThis.localStorage = originalStorage;
  }
});
