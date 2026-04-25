export const STORAGE_KEY = "auction-control-room-v1";

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

const firstNames = [
  "Aarav",
  "Vihaan",
  "Aditya",
  "Sai",
  "Arjun",
  "Siddharth",
  "Rohan",
  "Rahul",
  "Dev",
  "Krishna",
  "Kabir",
  "Aryan",
  "Abhinav",
  "Ravi",
  "Amit",
  "Karan",
  "Yash",
  "Nitin",
  "Pooja",
  "Anjali",
];

const lastNames = [
  "Sharma",
  "Singh",
  "Kumar",
  "Patel",
  "Gupta",
  "Reddy",
  "Rao",
  "Joshi",
  "Desai",
  "Yadav",
  "Chauhan",
  "Thakur",
  "Jain",
  "Verma",
  "Mishra",
  "Mehta",
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

export function makeTeam(name, index = 0) {
  return {
    id: uid("team"),
    name,
    color: COLORS[index % COLORS.length],
    logo: "",
  };
}

export function makePlayer(values = {}, index = 0) {
  const name =
    values.name ??
    `${firstNames[index % firstNames.length]} ${lastNames[(index * 3) % lastNames.length]}`;

  return {
    id: values.id || uid("player"),
    name,
    role: values.role || DEFAULT_ROLES[index % DEFAULT_ROLES.length],
    age: Number(values.age) || 22,
    basePrice: Number(values.basePrice) || 0,
    photo: values.photo || "",
    status: values.status || "available",
    teamId: values.teamId || null,
    soldPrice: Number(values.soldPrice) || 0,
    isRetained: Boolean(values.isRetained),
  };
}

export function createDefaultState() {
  const teams = ["Titans", "Eagles", "Lions", "Panthers", "Sharks", "Falcons"].map(makeTeam);
  const players = Array.from({ length: 40 }, (_, index) => makePlayer({}, index));

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
    events: [],
    undoStack: [],
    ui: {
      tab: "auction",
      message: "",
      search: "",
      statusFilter: "all",
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
  state.events = Array.isArray(state.events) ? state.events : [];
  state.undoStack = Array.isArray(state.undoStack) ? state.undoStack : [];
  state.ui = {
    tab: "auction",
    message: "",
    search: "",
    statusFilter: "all",
    ...(state.ui || {}),
  };

  const teamIds = new Set();
  state.teams = state.teams
    .filter((team) => team && String(team.name || "").trim())
    .map((team, index) => {
      let id = String(team.id || uid("team"));
      if (teamIds.has(id)) id = uid("team");
      teamIds.add(id);
      return {
        id,
        name: String(team.name).trim(),
        color: team.color || COLORS[index % COLORS.length],
        logo: team.logo || "",
      };
    });

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
      const teamId = state.teams.some((team) => team.id === player.teamId) ? player.teamId : null;
      return {
        id,
        name: String(player.name).trim(),
        role: String(player.role || DEFAULT_ROLES[index % DEFAULT_ROLES.length]).trim(),
        age: positiveInt(player.age, 22),
        basePrice: Math.max(0, Number.parseInt(player.basePrice, 10) || 0),
        photo: player.photo || "",
        status: status === "sold" && !teamId ? "available" : status,
        teamId: status === "sold" ? teamId : null,
        soldPrice: status === "sold" ? Math.max(0, Number.parseInt(player.soldPrice, 10) || 0) : 0,
        isRetained: status === "sold" ? Boolean(player.isRetained) : false,
      };
    });

  const current = state.players.find(
    (player) => player.id === state.auction.currentPlayerId && player.status === "available",
  );
  if (!current) state.auction.currentPlayerId = nextAvailablePlayerId(state);
  if (!state.teams.some((team) => team.id === state.auction.highestBidderId)) {
    state.auction.highestBidderId = null;
    state.auction.currentBid = 0;
  }

  return state;
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
  restored.ui = { ...currentState.ui, message: "Last action undone." };
  restored.events = currentState.events;
  return restored;
}

export function deriveStats(state) {
  const stats = {};
  const { initialBudget, maxPlayers, minBid } = state.settings;

  for (const team of state.teams) {
    const teamPlayers = state.players.filter((player) => player.teamId === team.id);
    const spent = teamPlayers.reduce((sum, player) => sum + Number(player.soldPrice || 0), 0);
    const playerCount = teamPlayers.length;
    const retainedCount = teamPlayers.filter((player) => player.isRetained).length;
    const budgetLeft = initialBudget - spent;
    const slotsAfterBuy = Math.max(0, maxPlayers - playerCount - 1);
    const maxAllowedBid =
      playerCount >= maxPlayers ? 0 : Math.max(0, budgetLeft - minBid * slotsAfterBuy);

    stats[team.id] = {
      teamPlayers,
      spent,
      budgetLeft,
      playerCount,
      retainedCount,
      maxAllowedBid,
    };
  }

  return stats;
}

export function getCurrentPlayer(state) {
  return state.players.find((player) => player.id === state.auction.currentPlayerId) ?? null;
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

export function canTeamBid(state, teamId) {
  const stats = deriveStats(state)[teamId];
  const nextBid = nextBidFor(state);
  const player = getCurrentPlayer(state);
  const errors = [];

  if (!player) errors.push("No available player selected");
  if (player && player.status !== "available") errors.push("Player is not available");
  if (state.auction.highestBidderId === teamId) errors.push("Already highest bidder");
  if (!stats) errors.push("Team not found");
  if (stats && stats.playerCount >= state.settings.maxPlayers) errors.push("Squad full");
  if (stats && stats.maxAllowedBid < nextBid) errors.push("Budget protection limit reached");

  return { ok: errors.length === 0, errors, nextBid };
}

export function nextAvailablePlayerId(state, afterId = state.auction.currentPlayerId) {
  const available = state.players.filter((player) => player.status === "available");
  if (available.length === 0) return null;
  const currentIndex = available.findIndex((player) => player.id === afterId);
  return available[currentIndex + 1]?.id ?? available[0].id;
}

export function bidForTeam(state, teamId) {
  const result = canTeamBid(state, teamId);
  if (!result.ok) throw new Error(result.errors[0]);

  state.auction.currentBid = result.nextBid;
  state.auction.highestBidderId = teamId;
  return state;
}

export function sellCurrentPlayer(state) {
  const player = getCurrentPlayer(state);
  if (!player) throw new Error("No available player selected");
  if (!state.auction.highestBidderId || state.auction.currentBid <= 0) {
    throw new Error("Select a highest bidder before confirming sale");
  }

  player.status = "sold";
  player.teamId = state.auction.highestBidderId;
  player.soldPrice = state.auction.currentBid;
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

export function restartUnsoldRound(state) {
  for (const player of state.players) {
    if (player.status === "unsold") player.status = "available";
  }
  state.auction.currentBid = 0;
  state.auction.highestBidderId = null;
  state.auction.currentPlayerId = nextAvailablePlayerId(state, null);
  return state;
}

export function resetAuctionResults(state) {
  for (const player of state.players) {
    player.status = "available";
    player.teamId = null;
    player.soldPrice = 0;
    player.isRetained = false;
  }
  state.auction.currentBid = 0;
  state.auction.highestBidderId = null;
  state.auction.currentPlayerId = state.players[0]?.id ?? null;
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

  if (state.teams.length === 0) issues.push("Add at least one team.");
  if (state.players.length === 0) issues.push("Add at least one player.");

  for (const team of state.teams) {
    const key = team.name.toLowerCase();
    if (teamNames.has(key)) issues.push(`Duplicate team name: ${team.name}`);
    teamNames.add(key);
  }

  for (const player of state.players) {
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
