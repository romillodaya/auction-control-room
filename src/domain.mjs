import { SEED_PLAYERS, SEED_TEAMS } from "./seed-data.mjs";

export const STORAGE_KEY = "auction-control-room-v2";

export const COLORS = [
  "#1d4ed8",
  "#15803d",
  "#c2410c",
  "#7c3aed",
  "#0f766e",
  "#be123c",
  "#4f46e5",
  "#b45309",
  "#0369a1",
  "#64748b",
];

export const DIVISIONS = [
  { id: "men", label: "Men's", aliases: ["men", "mens", "male", "m", "boys"] },
  { id: "women", label: "Women's", aliases: ["women", "womens", "female", "f", "girls"] },
];

export const DEFAULT_ROLES = ["Batter", "Bowler", "All-Rounder", "Wicket Keeper"];

export function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
}

function nameInitials(name) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function initials(name) {
  return nameInitials(name) || "A";
}

export function normalizeDivision(value, fallback = "men") {
  const normalized = String(value || "").trim().toLowerCase().replaceAll(/['\s_-]/g, "");
  const match = DIVISIONS.find((division) => division.aliases.includes(normalized));
  return match?.id || fallback;
}

export function divisionLabel(division) {
  return DIVISIONS.find((item) => item.id === division)?.label || "Men's";
}

export function activeDivision(state) {
  return normalizeDivision(state?.ui?.division, "men");
}

export function makeTeam(name, index = 0, division = "men") {
  return {
    id: uid("team"),
    division: normalizeDivision(division),
    name,
    color: COLORS[index % COLORS.length],
    logo: "",
  };
}

export function makePlayer(values = {}, index = 0) {
  const name = values.name ?? `Player ${index + 1}`;

  return {
    id: values.id || uid("player"),
    division: normalizeDivision(values.division ?? values.gender ?? values.auction, "men"),
    playerNumber: normalizePlayerNumber(values.playerNumber ?? values.playerId ?? values.photoId, index),
    name,
    role: values.role || DEFAULT_ROLES[index % DEFAULT_ROLES.length],
    age: positiveInt(values.age, 22),
    basePrice: nonNegativeInt(values.basePrice),
    photo: values.photo || "",
    status: values.status || "available",
    teamId: values.teamId || null,
    soldPrice: nonNegativeInt(values.soldPrice),
    isRetained: Boolean(values.isRetained),
  };
}

export function createDefaultState() {
  const teams = SEED_TEAMS.map((team, index) => makeTeam(team.name, index, team.division));
  const players = SEED_PLAYERS.map((player, index) => makePlayer(player, index));

  return normalizeState({
    version: 1,
    settings: {
      auctionName: "KPL 2026",
      logo: "",
      currencyLabel: "pts",
      initialBudget: 10000,
      maxPlayers: 8,
      minBid: 500,
      bidIncrement: 100,
      maxRetained: 1,
    },
    teams,
    players,
    auction: {
      currentPlayerId: players[0]?.id ?? null,
      currentBid: 0,
      highestBidderId: null,
    },
    auctions: {
      men: {
        currentPlayerId: players.find((player) => player.division === "men")?.id ?? null,
        currentBid: 0,
        highestBidderId: null,
      },
      women: {
        currentPlayerId: players.find((player) => player.division === "women")?.id ?? null,
        currentBid: 0,
        highestBidderId: null,
      },
    },
    events: [],
    undoStack: [],
    ui: {
      tab: "auction",
      message: "",
      search: "",
      statusFilter: "all",
      division: "men",
    },
  });
}

export function normalizeState(input) {
  const state = structuredClone(input);
  state.version = 1;
  state.settings = {
    auctionName: "Auction",
    logo: "",
    currencyLabel: "pts",
    initialBudget: 10000,
    maxPlayers: 8,
    minBid: 500,
    bidIncrement: 100,
    maxRetained: 1,
    ...(state.settings || {}),
  };
  state.settings.initialBudget = positiveInt(state.settings.initialBudget, 10000);
  state.settings.maxPlayers = positiveInt(state.settings.maxPlayers, 8);
  state.settings.minBid = positiveInt(state.settings.minBid, 500);
  state.settings.bidIncrement = positiveInt(state.settings.bidIncrement, 100);
  state.settings.maxRetained = Math.max(0, Number.parseInt(state.settings.maxRetained, 10) || 0);

  state.teams = Array.isArray(state.teams) ? state.teams : [];
  state.players = Array.isArray(state.players) ? state.players : [];
  state.auction = {
    currentPlayerId: null,
    currentBid: 0,
    highestBidderId: null,
    ...(state.auction || {}),
  };
  state.auction.currentBid = nonNegativeInt(state.auction.currentBid);
  state.events = Array.isArray(state.events) ? state.events : [];
  state.undoStack = Array.isArray(state.undoStack) ? state.undoStack : [];
  state.ui = {
    tab: "auction",
    message: "",
    search: "",
    statusFilter: "all",
    division: "men",
    ...(state.ui || {}),
  };
  state.ui.division = activeDivision(state);

  const teamIds = new Set();
  state.teams = state.teams
    .filter((team) => team && String(team.name || "").trim())
    .map((team, index) => {
      let id = String(team.id || uid("team"));
      if (teamIds.has(id)) id = uid("team");
      teamIds.add(id);
      return {
        id,
        division: normalizeDivision(team.division ?? team.gender ?? team.auction, "men"),
        name: String(team.name).trim(),
        color: team.color || COLORS[index % COLORS.length],
        logo: team.logo || "",
      };
    });
  for (const defaultTeam of createMissingDefaultTeams(state.teams)) {
    state.teams.push(defaultTeam);
  }

  const playerIds = new Set();
  state.players = state.players
    .filter((player) => player && String(player.name || "").trim())
    .map((player, index) => {
      let id = String(player.id || uid("player"));
      if (playerIds.has(id)) id = uid("player");
      playerIds.add(id);
      const status = ["available", "sold", "unsold"].includes(player.status)
        ? player.status
        : "available";
      const division = normalizeDivision(player.division ?? player.gender ?? player.auction, "men");
      const team = state.teams.find((item) => item.id === player.teamId && item.division === division);
      const teamId = team ? team.id : null;
      return {
        id,
        division,
        playerNumber: normalizePlayerNumber(
          player.playerNumber ?? player.playerId ?? player.photoId,
          index,
        ),
        name: String(player.name).trim(),
        role: String(player.role || DEFAULT_ROLES[index % DEFAULT_ROLES.length]).trim(),
        age: positiveInt(player.age, 22),
        basePrice: nonNegativeInt(player.basePrice),
        photo: player.photo || "",
        status: status === "sold" && !teamId ? "available" : status,
        teamId: status === "sold" ? teamId : null,
        soldPrice: status === "sold" ? nonNegativeInt(player.soldPrice) : 0,
        isRetained: status === "sold" ? Boolean(player.isRetained) : false,
      };
    });

  const rawAuctions = state.auctions && typeof state.auctions === "object" ? state.auctions : {};
  state.auctions = {};
  for (const division of DIVISIONS.map((item) => item.id)) {
    const rawAuction =
      division === state.ui.division
        ? { ...(rawAuctions[division] || {}), ...(state.auction || {}) }
        : rawAuctions[division] || {};
    state.auctions[division] = normalizeAuctionState(state, division, rawAuction);
  }
  state.auction = state.auctions[state.ui.division];

  return state;
}

function createMissingDefaultTeams(teams) {
  const missing = [];
  if (!teams.some((team) => team.division === "women")) {
    missing.push(makeTeam("Women A", teams.length, "women"), makeTeam("Women B", teams.length + 1, "women"));
  }
  return missing;
}

function normalizeAuctionState(state, division, auction = {}) {
  const normalized = {
    currentPlayerId: auction.currentPlayerId || null,
    currentBid: nonNegativeInt(auction.currentBid),
    highestBidderId: auction.highestBidderId || null,
  };
  const current = state.players.find(
    (player) =>
      player.id === normalized.currentPlayerId &&
      player.division === division &&
      isAuctionablePlayer(player),
  );
  if (!current) {
    normalized.currentPlayerId = nextAvailablePlayerIdForDivision(state, division, null);
  }
  if (!state.teams.some((team) => team.id === normalized.highestBidderId && team.division === division)) {
    normalized.highestBidderId = null;
    normalized.currentBid = 0;
  }
  return normalized;
}

function positiveInt(value, fallback) {
  const parsed = parseWholeNumber(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInt(value, fallback = 0) {
  const parsed = parseWholeNumber(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizePlayerNumber(value, index) {
  const text = String(value ?? "").trim();
  return text || String(index + 1);
}

function parseWholeNumber(value) {
  const normalized = String(value ?? "").replaceAll(",", "").trim();
  if (!normalized) return Number.NaN;
  return Number.parseInt(normalized, 10);
}

export function snapshotState(state) {
  const copy = structuredClone(state);
  copy.undoStack = [];
  copy.ui = { ...copy.ui, message: "" };
  return copy;
}

export function restoreSnapshot(snapshot, currentState) {
  const restored = normalizeState(snapshot);
  restored.undoStack = currentState.undoStack.slice(0, -1);
  restored.ui = { ...currentState.ui, message: "" };
  restored.events = currentState.events;
  return restored;
}

export function deriveStats(state) {
  const stats = {};
  const { initialBudget, maxPlayers, maxRetained, minBid } = state.settings;
  const paidSlotsTarget = Math.max(0, maxPlayers - Math.min(maxPlayers, maxRetained));
  const division = activeDivision(state);

  for (const team of teamsForDivision(state, division)) {
    const teamPlayers = playersForDivision(state, division).filter((player) => player.teamId === team.id);
    const spent = teamPlayers.reduce((sum, player) => sum + Number(player.soldPrice || 0), 0);
    const playerCount = teamPlayers.length;
    const retainedCount = teamPlayers.filter((player) => player.isRetained).length;
    const paidPlayerCount = Math.max(0, playerCount - retainedCount);
    const budgetLeft = initialBudget - spent;
    const slotsAfterBuy = Math.max(0, paidSlotsTarget - paidPlayerCount - 1);
    const maxAllowedBid =
      playerCount >= maxPlayers ? 0 : Math.max(0, budgetLeft - minBid * slotsAfterBuy);

    stats[team.id] = {
      teamPlayers,
      spent,
      budgetLeft,
      playerCount,
      retainedCount,
      paidPlayerCount,
      maxAllowedBid,
    };
  }

  return stats;
}

export function getCurrentPlayer(state) {
  return state.players.find((player) => player.id === state.auction.currentPlayerId) ?? null;
}

export function teamsForDivision(state, division = activeDivision(state)) {
  return state.teams.filter((team) => team.division === division);
}

export function playersForDivision(state, division = activeDivision(state)) {
  return state.players.filter((player) => player.division === division);
}

export function isAuctionablePlayer(player) {
  return Boolean(player) && player.status !== "sold";
}

export function openingBidFor(player, settings) {
  return Math.max(settings.minBid, Number(player?.basePrice || 0));
}

export function nextBidFor(state) {
  const player = getCurrentPlayer(state);
  if (!player) return 0;
  return state.auction.currentBid > 0
    ? state.auction.currentBid + state.settings.bidIncrement
    : openingBidFor(player, state.settings);
}

export function canTeamBid(state, teamId, bidAmount = nextBidFor(state)) {
  const stats = deriveStats(state)[teamId];
  const finalBid = nonNegativeInt(bidAmount);
  const player = getCurrentPlayer(state);
  const openingBid = openingBidFor(player, state.settings);
  const errors = [];

  if (!player) errors.push("No available player selected");
  if (player && !isAuctionablePlayer(player)) errors.push("Player is already sold");
  if (!stats) errors.push("Team not found");
  if (stats && stats.playerCount >= state.settings.maxPlayers) errors.push("Squad full");
  if (player && finalBid < openingBid) errors.push(`Bid must be at least ${openingBid}`);
  if (stats && stats.maxAllowedBid < finalBid) errors.push("Budget protection limit reached");

  return { ok: errors.length === 0, errors, finalBid };
}

export function nextAvailablePlayerId(state, afterId = state.auction.currentPlayerId) {
  return nextAvailablePlayerIdForDivision(state, activeDivision(state), afterId);
}

function nextAvailablePlayerIdForDivision(state, division, afterId = state.auction?.currentPlayerId) {
  const available = playersForDivision(state, division).filter(isAuctionablePlayer);
  if (available.length === 0) return null;
  const currentIndex = state.players.findIndex((player) => player.id === afterId);
  if (currentIndex === -1) return available[0].id;

  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const player = state.players[(currentIndex + offset) % state.players.length];
    if (player.division === division && isAuctionablePlayer(player)) return player.id;
  }

  return null;
}

export function setFinalBidForTeam(state, teamId, bidAmount) {
  const result = canTeamBid(state, teamId, bidAmount);
  if (!result.ok) throw new Error(result.errors[0]);

  state.auction.currentBid = result.finalBid;
  state.auction.highestBidderId = teamId;
  return state;
}

export function sellCurrentPlayer(state) {
  const player = getCurrentPlayer(state);
  if (!player) throw new Error("No available player selected");
  if (!state.auction.highestBidderId || state.auction.currentBid <= 0) {
    throw new Error("Select a highest bidder before confirming sale");
  }
  const result = canTeamBid(state, state.auction.highestBidderId, state.auction.currentBid);
  if (!result.ok) throw new Error(result.errors[0]);

  player.status = "sold";
  player.teamId = state.auction.highestBidderId;
  player.soldPrice = result.finalBid;
  player.isRetained = false;
  state.auction.currentBid = 0;
  state.auction.highestBidderId = null;
  state.auction.currentPlayerId = nextAvailablePlayerId(state, player.id);
  return state;
}

export function markCurrentUnsold(state) {
  const player = getCurrentPlayer(state);
  if (!player) throw new Error("No available player selected");
  if (state.auction.currentBid > 0 || state.auction.highestBidderId) {
    throw new Error("Use undo before passing a player who already has a bid");
  }

  player.status = "unsold";
  player.teamId = null;
  player.soldPrice = 0;
  player.isRetained = false;
  state.auction.currentBid = 0;
  state.auction.highestBidderId = null;
  state.auction.currentPlayerId = nextAvailablePlayerId(state, player.id);
  return state;
}

export function retainCurrentPlayer(state, teamId) {
  const player = getCurrentPlayer(state);
  const stats = deriveStats(state)[teamId];
  if (!player) throw new Error("No available player selected");
  if (!stats) throw new Error("Team not found");
  if (state.auction.currentBid > 0) throw new Error("Retain is only available before bidding");
  if (stats.playerCount >= state.settings.maxPlayers) throw new Error("Squad full");
  if (stats.retainedCount >= state.settings.maxRetained) {
    throw new Error("Retain limit reached for this team");
  }

  player.status = "sold";
  player.teamId = teamId;
  player.soldPrice = 0;
  player.isRetained = true;
  state.auction.currentBid = 0;
  state.auction.highestBidderId = null;
  state.auction.currentPlayerId = nextAvailablePlayerId(state, player.id);
  return state;
}

export function resetAuctionResults(state) {
  const division = activeDivision(state);
  for (const player of playersForDivision(state, division)) {
    player.status = "available";
    player.teamId = null;
    player.soldPrice = 0;
    player.isRetained = false;
  }
  state.auction.currentBid = 0;
  state.auction.highestBidderId = null;
  state.auction.currentPlayerId = playersForDivision(state, division)[0]?.id ?? null;
  state.events = [];
  return state;
}

export function addEvent(state, type, label, detail = {}) {
  state.events = [
    {
      id: uid("event"),
      type,
      label,
      detail,
      at: new Date().toISOString(),
    },
    ...state.events,
  ].slice(0, 500);
  return state;
}

export function validateAuction(state) {
  const issues = [];
  const teamNames = new Set();
  const playerNames = new Set();
  const division = activeDivision(state);
  const teams = teamsForDivision(state, division);
  const players = playersForDivision(state, division);
  const label = divisionLabel(division);

  if (teams.length === 0) issues.push(`Add at least one ${label} team.`);
  if (players.length === 0) issues.push(`Add at least one ${label} player.`);

  for (const team of teams) {
    const key = team.name.toLowerCase();
    if (teamNames.has(key)) issues.push(`Duplicate team name: ${team.name}`);
    teamNames.add(key);
  }

  for (const player of players) {
    const key = player.name.toLowerCase();
    if (playerNames.has(key)) issues.push(`Duplicate player name: ${player.name}`);
    playerNames.add(key);
  }

  if (state.settings.minBid <= 0) issues.push("Minimum bid must be greater than zero.");
  if (state.settings.bidIncrement <= 0) issues.push("Bid increment must be greater than zero.");
  if (state.settings.initialBudget < state.settings.minBid) {
    issues.push("Initial budget should be at least the minimum bid.");
  }

  return issues;
}
