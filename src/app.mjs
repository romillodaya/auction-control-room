import {
  COLORS,
  DIVISIONS,
  addEvent,
  activeDivision,
  canTeamBid,
  createDefaultState,
  deriveStats,
  divisionLabel,
  getCurrentPlayer,
  initials,
  isAuctionablePlayer,
  makePlayer,
  makeTeam,
  normalizeState,
  openingBidFor,
  resetAuctionResults,
  restoreSnapshot,
  retainCurrentPlayer,
  sellCurrentPlayer,
  setFinalBidForTeam,
  snapshotState,
  playersForDivision,
  teamsForDivision,
  uid,
  validateAuction,
  markCurrentUnsold,
} from "./domain.mjs";
import { exportPlayersCSV, exportTeamsCSV, playersFromCSV, teamsFromCSV } from "./csv.mjs";
import { exportExcelBackup, stateFromExcelBackup } from "./excel.mjs";
import { exportBackup, loadState, readDataUrl, readTextFile, saveState, downloadText } from "./storage.mjs";

const app = document.querySelector("#app");
const UNDO_HISTORY_LIMIT = 20;
let state = loadState();

function html(strings, ...values) {
  return strings.reduce((out, part, index) => out + part + (values[index] ?? ""), "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value) {
  return Number(value || 0).toLocaleString("en-IN");
}

function teamById(id) {
  return state.teams.find((team) => team.id === id) ?? null;
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}

function activeDivisionLabel() {
  return divisionLabel(activeDivision(state));
}

function nextPlayerNumber() {
  const numericIds = state.players
    .map((player) => Number.parseInt(player.playerNumber, 10))
    .filter((value) => Number.isFinite(value));
  return String((numericIds.length ? Math.max(...numericIds) : state.players.length) + 1);
}

function candidatePaths(folder, stem) {
  const encodedStem = encodeURIComponent(stem);
  return ["jpg", "jpeg", "png", "webp"].map((extension) => `${folder}/${encodedStem}.${extension}`);
}

function playerPhotoCandidates(player) {
  if (player?.photo) return [player.photo];
  if (!player?.playerNumber) return [];
  return candidatePaths("photos", player.playerNumber);
}

function teamLogoCandidates(team) {
  if (team?.logo) return [team.logo];
  const slug = slugify(team?.name);
  if (!slug) return [];
  return ["png", "jpg", "jpeg", "webp"].map((extension) => `logos/${slug}.${extension}`);
}

function imageFallbackMarkup(candidates, name, imageClass, fallbackClass) {
  const srcs = candidates.filter(Boolean);
  const fallback = `<div class="${fallbackClass}" ${srcs.length ? "hidden" : ""}>${escapeHtml(initials(name))}</div>`;
  if (!srcs.length) return fallback;
  const handler = "const srcs=this.dataset.srcs.split('|');const next=(Number(this.dataset.tryIndex)||0)+1;this.dataset.tryIndex=next;if(next<srcs.length){this.src=srcs[next];}else{this.nextElementSibling.hidden=false;this.remove();}";
  return html`
    <img
      src="${escapeHtml(srcs[0])}"
      data-srcs="${escapeHtml(srcs.join("|"))}"
      data-try-index="0"
      alt="${escapeHtml(name)}"
      class="${escapeHtml(imageClass)}"
      onerror="${escapeHtml(handler)}"
    />
    ${fallback}
  `;
}

function playerPhotoMarkup(player) {
  return imageFallbackMarkup(playerPhotoCandidates(player), player.name, "player-photo", "avatar-fallback");
}

function modalPhotoMarkup(player) {
  return imageFallbackMarkup(playerPhotoCandidates(player), player.name, "modal-player-photo", "modal-avatar-fallback");
}

function teamLogoMarkup(team, className = "") {
  return imageFallbackMarkup(teamLogoCandidates(team), team.name, className, "avatar-fallback");
}

function setMessage(message) {
  state.ui.message = message;
}

function showMessage(message) {
  setMessage(message);
  saveState(state);
  render();
}

function commit(label, mutator, type = "action", detail = {}) {
  const before = snapshotState(state);
  try {
    const draft = structuredClone(state);
    draft.undoStack = [...state.undoStack, before].slice(-UNDO_HISTORY_LIMIT);
    mutator(draft);
    addEvent(draft, type, label, detail);
    draft.ui.message = "";
    state = normalizeState(draft);
    saveState(state);
    render();
  } catch (error) {
    setMessage(error.message || "Action failed");
    render();
  }
}

function setTab(tab) {
  state.ui.tab = tab;
  saveState(state);
  render();
}

function setDivision(division) {
  const nextDivision = activeDivision({ ui: { division } });
  const currentDivision = activeDivision(state);
  state.auctions = { ...(state.auctions || {}), [currentDivision]: state.auction };
  state.ui.division = nextDivision;
  state.auction = state.auctions[nextDivision] || {};
  state.ui.message = "";
  state = normalizeState(state);
  saveState(state);
  render();
}

function imageOrInitial(src, name, className = "") {
  if (src) {
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(name)}" class="${className}" />`;
  }
  return `<span>${escapeHtml(initials(name))}</span>`;
}

function render() {
  const issues = validateAuction(state);
  app.innerHTML = html`
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <div class="brand-logo">${imageOrInitial(state.settings.logo, state.settings.auctionName)}</div>
          <div>
            <h1 class="brand-title">${escapeHtml(state.settings.auctionName)}</h1>
            <p class="brand-subtitle">Auction Control Room</p>
          </div>
        </div>
        <nav class="tabs" aria-label="Main">
          ${["auction", "setup", "teams", "players", "backup"].map((tab) => tabButton(tab)).join("")}
        </nav>
        <div class="division-switch" aria-label="Auction section">
          ${DIVISIONS.map(
            (division) =>
              `<button class="division-tab ${activeDivision(state) === division.id ? "active" : ""}" data-division="${division.id}">${division.label}</button>`,
          ).join("")}
        </div>
      </header>
      <main class="main">
        ${issues.length && state.ui.tab === "auction" ? `<div class="notice"><span>${escapeHtml(issues[0])}</span><button class="btn ghost" data-tab="setup">Fix Setup</button></div>` : ""}
        ${renderActiveTab()}
      </main>
      ${state.ui.message ? `<div class="toast" role="status"><span>${escapeHtml(state.ui.message)}</span><button class="btn ghost" data-action="dismiss-message">Clear</button></div>` : ""}
      ${renderPhotoModal()}
    </div>
  `;
}

function renderPhotoModal() {
  const player = state.players.find((item) => item.id === state.ui.photoModalPlayerId);
  if (!player) return "";

  return html`
    <div class="photo-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(player.name)} photo">
      <div class="photo-modal-backdrop" data-action="close-photo-modal" aria-hidden="true"></div>
      <div class="photo-modal-content">
        <button class="photo-modal-close" data-action="close-photo-modal" aria-label="Close photo view">Close</button>
        <div class="photo-modal-image-shell">
          ${modalPhotoMarkup(player)}
        </div>
        <div class="photo-modal-info">
          <span>ID ${escapeHtml(player.playerNumber)}</span>
          <h2>${escapeHtml(player.name)}</h2>
          <p>${escapeHtml(player.role)} | Age ${escapeHtml(player.age)}</p>
        </div>
      </div>
    </div>
  `;
}

function tabButton(tab) {
  const labels = {
    auction: "Auction",
    setup: "Setup",
    teams: "Teams",
    players: "Players",
    backup: "Backup",
  };
  return `<button class="tab ${state.ui.tab === tab ? "active" : ""}" data-tab="${tab}">${labels[tab]}</button>`;
}

function renderActiveTab() {
  if (state.ui.tab === "setup") return renderSetup();
  if (state.ui.tab === "teams") return renderTeams();
  if (state.ui.tab === "players") return renderPlayers();
  if (state.ui.tab === "backup") return renderBackup();
  return renderAuction();
}

function renderAuction() {
  const currentPlayer = getCurrentPlayer(state);
  const stats = deriveStats(state);
  const selectedTeamStats = stats[state.auction.highestBidderId] ?? null;
  const teams = teamsForDivision(state);
  const players = playersForDivision(state);
  const saleCheck =
    state.auction.highestBidderId && state.auction.currentBid > 0
      ? canTeamBid(state, state.auction.highestBidderId, state.auction.currentBid)
      : null;
  const saleTitle = saleCheck?.errors.join(", ") || "Enter a valid final bid";
  const sold = players.filter((player) => player.status === "sold").length;
  const unsold = players.filter((player) => player.status === "unsold").length;
  const auctionable = players.filter(isAuctionablePlayer).length;

  return html`
    <section class="grid auction-grid">
      <div class="card player-stage">
        ${
          currentPlayer
            ? html`
                <div class="player-card-content">
                  <button class="player-photo-wrap" type="button" data-action="open-photo-modal" title="Open large photo">
                    ${playerPhotoMarkup(currentPlayer)}
                  </button>
                  <h2 class="current-player-name">${escapeHtml(currentPlayer.name)}</h2>
                  <div class="pill-row">
                    <span class="pill">ID ${escapeHtml(currentPlayer.playerNumber)}</span>
                    <span class="pill">${escapeHtml(currentPlayer.role)}</span>
                    <span class="pill">Age ${escapeHtml(currentPlayer.age)}</span>
                    ${currentPlayer.status === "unsold" ? `<span class="pill warning">Passed once</span>` : ""}
                  </div>
                  <div class="final-bid-panel player-final-bid">
                    <div>
                      <div class="bid-label">Winning Team</div>
                      <div class="selected-team-name">${state.auction.highestBidderId ? escapeHtml(teamById(state.auction.highestBidderId)?.name) : "Select a team"}</div>
                      <div class="selected-team-limit">
                        ${
                          selectedTeamStats
                            ? html`
                                <span>
                                  Max usable
                                  <strong>${money(selectedTeamStats.maxAllowedBid)}</strong>
                                  ${escapeHtml(state.settings.currencyLabel)}
                                </span>
                                <span>${money(selectedTeamStats.budgetLeft)} ${escapeHtml(state.settings.currencyLabel)} left</span>
                              `
                            : "Choose a team to see its max usable points"
                        }
                      </div>
                    </div>
                    <label class="final-bid-field">
                      <span>Final Bid</span>
                      <input
                        type="text"
                        min="0"
                        ${selectedTeamStats ? `max="${selectedTeamStats.maxAllowedBid}"` : ""}
                        inputmode="numeric"
                        pattern="[0-9,]*"
                        placeholder="Enter amount"
                        value="${state.auction.currentBid || ""}"
                        data-input="final-bid"
                        data-number-input="true"
                      />
                    </label>
                  </div>
                </div>
              `
            : html`
                <div>
                  <h2 class="current-player-name">Auction Complete</h2>
                  <p class="muted">${activeDivisionLabel()} auction: ${sold} sold, ${unsold} passed once.</p>
                  <div class="row wrap" style="justify-content:center">
                    <button class="btn ghost" data-action="undo" ${state.undoStack.length ? "" : "disabled"}>Undo</button>
                  </div>
                </div>
              `
        }
      </div>
      <div class="card bid-board">
        <div class="team-bid-grid">
          ${teams.map((team) => renderTeamBid(team, stats[team.id])).join("")}
        </div>
        <div class="row wrap spread" style="margin-top:16px">
          <button class="btn ghost" data-action="unsold" ${currentPlayer && !state.auction.highestBidderId && state.auction.currentBid === 0 ? "" : "disabled"}>Pass / Unsold</button>
          <div class="row wrap">
            <button class="btn ghost" data-action="clear-final-bid" ${state.auction.highestBidderId || state.auction.currentBid ? "" : "disabled"}>Clear</button>
            <button class="btn ghost" data-action="undo" ${state.undoStack.length ? "" : "disabled"}>Undo</button>
            <button class="btn success" data-action="sell" title="${escapeHtml(saleCheck?.ok ? "Confirm sale" : saleTitle)}" ${saleCheck?.ok ? "" : "disabled"}>Confirm Sale</button>
          </div>
        </div>
      </div>
    </section>
    <section class="stat-grid" style="margin-top:16px">
      <div class="stat"><span>Can Auction</span><strong>${auctionable}</strong></div>
      <div class="stat"><span>Sold</span><strong>${sold}</strong></div>
      <div class="stat"><span>Passed Once</span><strong>${unsold}</strong></div>
      <div class="stat"><span>Undo Steps</span><strong>${state.undoStack.length}</strong></div>
    </section>
  `;
}

function renderTeamBid(team, stats) {
  const openingBid = openingBidFor(getCurrentPlayer(state), state.settings);
  const bidCheck = canTeamBid(state, team.id, openingBid);
  const retainErrors = retainErrorsForTeam(team.id, stats);
  const canRetain = retainErrors.length === 0;
  const hasRetainLeft = stats.retainedCount < state.settings.maxRetained;
  const retainState = hasRetainLeft ? "available" : "used";
  const isHighest = state.auction.highestBidderId === team.id;
  return html`
    <div
      class="team-bid ${isHighest ? "highest" : ""}"
      style="--team-color:${escapeHtml(team.color)}"
      title="${escapeHtml(bidCheck.errors.join(", ") || "Team controls")}"
    >
      <div class="team-card-head">
        <div class="mini-logo">${teamLogoMarkup(team, "team-logo")}</div>
        <button
          class="retain-chip ${retainState}"
          data-action="retain-player"
          data-team-id="${escapeHtml(team.id)}"
          aria-label="Retain player for ${escapeHtml(team.name)}"
          title="${escapeHtml(retainErrors.join(", ") || "Retain current player for 0 points")}"
          ${canRetain ? "" : "disabled"}
        >
          R
        </button>
      </div>
      <div class="team-name-row">
        <div class="team-name">${escapeHtml(team.name)}</div>
        ${isHighest ? `<span class="selected-badge">Selected</span>` : ""}
      </div>
      <div class="team-max">
        <span>Left points</span>
        <strong>${money(stats.budgetLeft)}</strong>
        <small>${escapeHtml(state.settings.currencyLabel)}</small>
      </div>
      <div class="team-mini-stats">
        <span>Max usable <strong>${money(stats.maxAllowedBid)}</strong></span>
        <span>Players <strong>${stats.playerCount}/${state.settings.maxPlayers}</strong></span>
      </div>
      <button
        class="btn dark team-select"
        data-action="select-team"
        data-team-id="${escapeHtml(team.id)}"
        title="${escapeHtml(bidCheck.errors.join(", ") || "Select team for final bid")}"
        ${bidCheck.ok ? "" : "disabled"}
      >
        Select
      </button>
    </div>
  `;
}

function renderSetup() {
  const teams = teamsForDivision(state);
  const players = playersForDivision(state);
  return html`
    <section class="grid two-grid">
      <form class="card panel stack" data-form="settings">
        <div class="panel-header">
          <h2 class="panel-title">${activeDivisionLabel()} Auction Setup</h2>
          <button class="btn primary" type="submit">Save Setup</button>
        </div>
        <div class="form-grid">
          ${input("Auction Name", "auctionName", state.settings.auctionName, "text", "full")}
          ${input("Currency Label", "currencyLabel", state.settings.currencyLabel)}
          ${input("Initial Budget", "initialBudget", state.settings.initialBudget, "number")}
          ${input("Max Players Per Team", "maxPlayers", state.settings.maxPlayers, "number")}
          ${input("Minimum Bid", "minBid", state.settings.minBid, "number")}
          ${input("Bid Increment", "bidIncrement", state.settings.bidIncrement, "number")}
          ${input("Max Retained Per Team", "maxRetained", state.settings.maxRetained, "number")}
          <div class="field full">
            <label>Auction Logo</label>
            <div class="logo-choice">
              <div class="logo-preview">${imageOrInitial(state.settings.logo, state.settings.auctionName)}</div>
              <div class="row wrap">
                <input id="auction-logo" class="file-input" type="file" accept="image/*" data-file="auction-logo" />
                <button class="btn ghost" type="button" data-click-file="auction-logo">Upload Logo</button>
                <button class="btn ghost" type="button" data-action="clear-auction-logo">Clear</button>
              </div>
            </div>
          </div>
        </div>
      </form>
      <div class="card panel stack">
        <div class="panel-header">
          <h2 class="panel-title">Readiness Check</h2>
        </div>
        ${validateAuction(state).length ? validateAuction(state).map((issue) => `<div class="notice">${escapeHtml(issue)}</div>`).join("") : `<div class="notice"><span>Setup looks ready for auction.</span></div>`}
        <div class="stat-grid">
          <div class="stat"><span>${activeDivisionLabel()} Teams</span><strong>${teams.length}</strong></div>
          <div class="stat"><span>${activeDivisionLabel()} Players</span><strong>${players.length}</strong></div>
          <div class="stat"><span>Total Purse</span><strong>${money(teams.length * state.settings.initialBudget)}</strong></div>
          <div class="stat"><span>Squad Slots</span><strong>${teams.length * state.settings.maxPlayers}</strong></div>
        </div>
      </div>
    </section>
    ${renderTeamSetup()}
  `;
}

function renderTeamSetup() {
  const stats = deriveStats(state);
  const teams = teamsForDivision(state);
  return html`
    <section class="grid two-grid setup-team-grid">
      <form class="card panel stack" data-form="team">
        <div class="panel-header">
          <h2 class="panel-title">Add ${activeDivisionLabel()} Team</h2>
          <button class="btn primary" type="submit">Add Team</button>
        </div>
        <div class="form-grid">
          ${input("Team Name", "name", "", "text", "full")}
          <div class="field">
            <label>Color</label>
            <select name="color">${COLORS.map((color) => `<option value="${color}">${color}</option>`).join("")}</select>
          </div>
          ${input("Logo Path / URL (optional)", "logo", "", "text")}
        </div>
        <div class="row wrap">
          <input id="teams-csv" class="file-input" type="file" accept=".csv,text/csv" data-file="teams-csv" />
          <button class="btn ghost" type="button" data-click-file="teams-csv">Import CSV</button>
          <button class="btn ghost" type="button" data-action="export-teams">Export ${activeDivisionLabel()} Teams</button>
        </div>
      </form>
      <div class="card panel stack">
        <div class="panel-header">
          <h2 class="panel-title">${activeDivisionLabel()} Teams</h2>
        </div>
        ${teams.length ? teams.map((team) => renderTeamEditor(team, stats[team.id])).join("") : `<div class="empty">No ${activeDivisionLabel()} teams yet.</div>`}
      </div>
    </section>
  `;
}

function renderTeams() {
  const stats = deriveStats(state);
  const teams = teamsForDivision(state);
  return html`
    <section class="grid team-roster-grid">
      ${teams.length ? teams.map((team) => renderTeamRoster(team, stats[team.id])).join("") : `<div class="card empty">No ${activeDivisionLabel()} teams yet. Add teams from Setup.</div>`}
    </section>
  `;
}

function renderTeamRoster(team, stats) {
  const players = stats.teamPlayers;
  return html`
    <article class="card team-roster-card" style="--team-color:${escapeHtml(team.color)}">
      <div class="standing-line"></div>
      <div class="team-roster-head">
        <div class="mini-logo">${teamLogoMarkup(team, "team-logo")}</div>
        <div>
          <h2>${escapeHtml(team.name)}</h2>
          <p>${stats.playerCount}/${state.settings.maxPlayers} players</p>
        </div>
      </div>
      <div class="team-roster-stats">
        <div>
          <span>Left</span>
          <strong>${money(stats.budgetLeft)}</strong>
        </div>
        <div>
          <span>Max usable</span>
          <strong>${money(stats.maxAllowedBid)}</strong>
        </div>
      </div>
      <div class="roster-list">
        ${
          players.length
            ? players.map((player) => renderRosterPlayer(player)).join("")
            : `<div class="empty roster-empty">No players bought yet.</div>`
        }
      </div>
    </article>
  `;
}

function renderRosterPlayer(player) {
  return html`
    <div class="roster-player">
      <div>
        <strong>${escapeHtml(player.name)}</strong>
        <span>ID ${escapeHtml(player.playerNumber)} | ${escapeHtml(player.role)}${player.isRetained ? " | Retained" : ""}</span>
      </div>
      <div class="roster-player-price">${player.isRetained ? "R" : money(player.soldPrice)}</div>
    </div>
  `;
}

function renderTeamEditor(team, stats) {
  return html`
    <form class="standing" style="--team-color:${escapeHtml(team.color)}" data-form="edit-team" data-team-id="${escapeHtml(team.id)}">
      <div class="standing-line"></div>
      <div class="form-grid">
        ${input("Name", "name", team.name)}
        <div class="field">
          <label>Color</label>
          <input type="color" name="color" value="${escapeHtml(team.color)}" />
        </div>
        <div class="field full">
          <label>Team Logo</label>
          <div class="logo-choice team-logo-choice">
            <div class="logo-preview">${teamLogoMarkup(team, "team-logo")}</div>
            <div class="stack">
              ${input("Logo Path / URL", "logo", team.logo, "text", "full")}
              <div class="row wrap">
                <input
                  id="team-logo-${escapeHtml(team.id)}"
                  class="file-input"
                  type="file"
                  accept="image/*"
                  data-file="team-logo"
                  data-team-id="${escapeHtml(team.id)}"
                />
                <button class="btn ghost" type="button" data-click-file="team-logo-${escapeHtml(team.id)}">Upload Logo</button>
                <button class="btn ghost" type="button" data-action="clear-team-logo" data-team-id="${escapeHtml(team.id)}">Clear Logo</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="row wrap spread">
        <span class="muted">${stats.playerCount}/${state.settings.maxPlayers} players, ${money(stats.budgetLeft)} ${escapeHtml(state.settings.currencyLabel)} left</span>
        <div class="row">
          <button class="btn ghost" type="submit">Save</button>
          <button class="btn danger" type="button" data-action="delete-team" data-team-id="${escapeHtml(team.id)}">Delete</button>
        </div>
      </div>
    </form>
  `;
}

function renderPlayers() {
  const filtered = playersForDivision(state).filter((player) => {
    const search = state.ui.search.trim().toLowerCase();
    const statusOk = state.ui.statusFilter === "all" || player.status === state.ui.statusFilter;
    const searchOk =
      !search ||
      player.name.toLowerCase().includes(search) ||
      player.role.toLowerCase().includes(search) ||
      (teamById(player.teamId)?.name.toLowerCase() || "").includes(search);
    return statusOk && searchOk;
  });

  return html`
    <section class="grid">
      <form class="card panel stack" data-form="player">
        <div class="panel-header">
          <h2 class="panel-title">Add ${activeDivisionLabel()} Player</h2>
          <button class="btn primary" type="submit">Add Player</button>
        </div>
        <div class="form-grid">
          ${input("Player ID", "playerNumber", nextPlayerNumber(), "text")}
          <input type="hidden" name="division" value="${activeDivision(state)}" />
          ${input("Player Name", "name", "", "text")}
          ${input("Role", "role", "Batter", "text")}
          ${input("Age", "age", 22, "number")}
          ${input("Base Price", "basePrice", 0, "number")}
          ${input("Photo URL / Path (optional)", "photo", "", "text", "full")}
        </div>
        <div class="row wrap">
          <input id="players-csv" class="file-input" type="file" accept=".csv,text/csv" data-file="players-csv" />
          <button class="btn ghost" type="button" data-click-file="players-csv">Import CSV</button>
          <button class="btn ghost" type="button" data-action="export-players">Export ${activeDivisionLabel()} Players</button>
        </div>
      </form>
      <div class="card panel stack">
        <div class="toolbar">
          <h2 class="panel-title">${activeDivisionLabel()} Players</h2>
          <div class="row wrap">
            <input type="search" placeholder="Search players" value="${escapeHtml(state.ui.search)}" data-input="search" />
            <select data-input="status-filter">
              ${["all", "available", "sold", "unsold"].map((status) => `<option value="${status}" ${state.ui.statusFilter === status ? "selected" : ""}>${status}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Role</th>
                <th>Age</th>
                <th>Status</th>
                <th>Team</th>
                <th>Price</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${filtered.map(renderPlayerRow).join("") || `<tr><td colspan="8" class="empty">No players found.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

function renderPlayerRow(player) {
  const canSelect = isAuctionablePlayer(player);
  return html`
    <tr>
      <td>${escapeHtml(player.playerNumber)}</td>
      <td><strong>${escapeHtml(player.name)}</strong></td>
      <td>${escapeHtml(player.role)}</td>
      <td>${escapeHtml(player.age)}</td>
      <td><span class="status ${escapeHtml(player.status)}">${escapeHtml(player.status)}</span></td>
      <td>${player.teamId ? escapeHtml(teamById(player.teamId)?.name || "") : "-"}</td>
      <td>${player.isRetained ? "Retained" : player.soldPrice ? money(player.soldPrice) : "-"}</td>
      <td><button class="btn ghost" data-action="select-player" data-player-id="${escapeHtml(player.id)}" ${canSelect ? "" : "disabled"}>${player.status === "unsold" ? "Select Again" : "Select"}</button></td>
    </tr>
  `;
}

function renderBackup() {
  const recent = state.events.slice(0, 30);
  return html`
    <section class="grid two-grid">
      <div class="card panel stack">
        <div class="panel-header">
          <h2 class="panel-title">Backup & Recovery</h2>
        </div>
        <div class="row wrap">
          <button class="btn primary" data-action="export-backup">Export Full Backup</button>
          <input id="backup-json" class="file-input" type="file" accept=".json,application/json" data-file="backup-json" />
          <button class="btn ghost" data-click-file="backup-json">Import Backup</button>
          <button class="btn ghost" data-action="export-excel">Export Excel</button>
          <button class="btn ghost" data-action="export-team-cards">Export Team Cards</button>
          <input id="backup-excel" class="file-input" type="file" accept=".xls,application/vnd.ms-excel,text/xml,application/xml" data-file="backup-excel" />
          <button class="btn ghost" data-click-file="backup-excel">Import Excel</button>
        </div>
        <div class="card panel danger-zone stack">
          <h3 class="panel-title">Reset ${activeDivisionLabel()} Results</h3>
          <p class="muted">This keeps teams and players, but clears sales, bids, retained flags, and event history for the active section.</p>
          <button class="btn danger" data-action="reset-auction">Reset ${activeDivisionLabel()} Results</button>
        </div>
      </div>
      <div class="card panel stack">
        <div class="panel-header">
          <h2 class="panel-title">Audit Trail</h2>
        </div>
        ${
          recent.length
            ? recent
                .map(
                  (event) => html`
                    <div class="standing">
                      <strong>${escapeHtml(event.label)}</strong>
                      <span class="muted">${new Date(event.at).toLocaleString()}</span>
                    </div>
                  `,
                )
                .join("")
            : `<div class="empty">Actions will appear here during the auction.</div>`
        }
      </div>
    </section>
  `;
}

async function exportTeamCards() {
  const normalized = normalizeState(state);
  const cards = await Promise.all(
    normalized.teams.map(async (team) => {
      const players = normalized.players.filter((player) => player.teamId === team.id);
      const retained = players.filter((player) => player.isRetained);
      const purchased = players.filter((player) => !player.isRetained);
      const spent = players.reduce((sum, player) => sum + Number(player.soldPrice || 0), 0);
      const logoSrc = await firstUsableImage(teamLogoCandidates(team));
      const logo = logoSrc
        ? `<img src="${escapeHtml(logoSrc)}" alt="${escapeHtml(team.name)} logo" />`
        : `<div class="export-logo-fallback">${escapeHtml(initials(team.name))}</div>`;

      return html`
        <article class="export-card" style="--team-color:${escapeHtml(team.color)}">
          <div class="export-card-head">
            <div class="export-logo">${logo}</div>
            <div>
              <span>${escapeHtml(divisionLabel(team.division))}</span>
              <h2>${escapeHtml(team.name)}</h2>
              <p>${players.length}/${normalized.settings.maxPlayers} players | ${money(spent)} ${escapeHtml(normalized.settings.currencyLabel)} spent | ${money(normalized.settings.initialBudget - spent)} left</p>
            </div>
          </div>
          <section>
            <h3>Retained</h3>
            ${playerListMarkup(retained, "No retained player yet.")}
          </section>
          <section>
            <h3>Purchased</h3>
            ${playerListMarkup(purchased, "No purchased players yet.")}
          </section>
        </article>
      `;
    }),
  );

  const rosterRows = normalized.teams
    .flatMap((team) =>
      normalized.players
        .filter((player) => player.teamId === team.id)
        .map(
          (player) => html`
            <tr>
              <td>${escapeHtml(divisionLabel(team.division))}</td>
              <td>${escapeHtml(team.name)}</td>
              <td>${escapeHtml(player.playerNumber)}</td>
              <td>${escapeHtml(player.name)}</td>
              <td>${escapeHtml(player.role)}</td>
              <td>${player.isRetained ? "Retained" : money(player.soldPrice)}</td>
            </tr>
          `,
        ),
    )
    .join("");

  const document = html`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(normalized.settings.auctionName)} Team Cards</title>
        <style>
          * { box-sizing: border-box; }
          body { margin: 0; padding: 34px; color: #172033; background: #f6f7fb; font-family: Inter, Arial, sans-serif; }
          h1 { margin: 0 0 6px; font-size: 38px; }
          .muted { margin: 0 0 26px; color: #64748b; font-weight: 700; }
          .export-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
          .export-card { break-inside: avoid; padding: 24px; background: #fff; border: 1px solid #dbe3ee; border-top: 10px solid var(--team-color); border-radius: 12px; box-shadow: 0 12px 28px rgba(15, 23, 42, 0.08); }
          .export-card-head { display: grid; grid-template-columns: 104px 1fr; gap: 18px; align-items: center; margin-bottom: 18px; }
          .export-logo { display: grid; width: 104px; height: 104px; place-items: center; overflow: hidden; color: #fff; background: var(--team-color); border-radius: 12px; font-weight: 900; }
          .export-logo img { width: 100%; height: 100%; object-fit: contain; background: #fff; }
          .export-logo-fallback { font-size: 26px; }
          .export-card span { color: var(--team-color); font-size: 12px; font-weight: 900; text-transform: uppercase; }
          .export-card h2 { margin: 5px 0; font-size: 32px; line-height: 1; }
          .export-card p { margin: 0; color: #64748b; font-size: 13px; font-weight: 800; }
          .export-card h3 { margin: 20px 0 10px; font-size: 14px; text-transform: uppercase; }
          .export-list { display: grid; gap: 9px; margin: 0; padding: 0; list-style: none; }
          .export-list li { display: grid; grid-template-columns: 1fr auto; gap: 14px; padding: 11px 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 9px; font-size: 14px; font-weight: 800; }
          .export-list small { display: block; margin-top: 3px; color: #64748b; font-size: 12px; font-weight: 700; }
          .export-empty { padding: 12px; color: #64748b; background: #f8fafc; border-radius: 9px; font-size: 13px; font-weight: 700; }
          .export-summary { margin-top: 34px; padding: 22px; background: #fff; border: 1px solid #dbe3ee; border-radius: 12px; }
          table { width: 100%; border-collapse: collapse; font-size: 13px; }
          th, td { padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: left; }
          th { color: #475569; background: #f8fafc; text-transform: uppercase; }
          @media print {
            body { padding: 12mm; background: #fff; }
            .export-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .export-card, .export-summary { box-shadow: none; }
          }
          @media (max-width: 820px) {
            .export-grid { grid-template-columns: 1fr; }
          }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(normalized.settings.auctionName)} Team Cards</h1>
        <p class="muted">Generated ${escapeHtml(new Date().toLocaleString())}</p>
        <main class="export-grid">${cards.join("")}</main>
        <section class="export-summary">
          <h2>Overall Team Rosters</h2>
          <table>
            <thead>
              <tr>
                <th>Section</th>
                <th>Team</th>
                <th>ID</th>
                <th>Player</th>
                <th>Role</th>
                <th>Price</th>
              </tr>
            </thead>
            <tbody>${rosterRows || `<tr><td colspan="6">No players sold yet.</td></tr>`}</tbody>
          </table>
        </section>
      </body>
    </html>
  `.trim();

  downloadText(`auction-team-cards-${new Date().toISOString().slice(0, 10)}.html`, document, "text/html");
}

function playerListMarkup(players, emptyText) {
  if (!players.length) return `<div class="export-empty">${escapeHtml(emptyText)}</div>`;
  return html`
    <ul class="export-list">
      ${players
        .map(
          (player) => html`
            <li>
              <div>
                ${escapeHtml(player.name)}
                <small>ID ${escapeHtml(player.playerNumber)} | ${escapeHtml(player.role)} | Age ${escapeHtml(player.age)}</small>
              </div>
              <strong>${player.isRetained ? "R" : money(player.soldPrice)}</strong>
            </li>
          `,
        )
        .join("")}
    </ul>
  `;
}

async function firstUsableImage(candidates) {
  for (const candidate of candidates) {
    const resolved = await imageToDataUrl(candidate);
    if (resolved) return resolved;
  }
  return "";
}

async function imageToDataUrl(src) {
  if (!src) return "";
  if (src.startsWith("data:")) return src;
  try {
    const response = await fetch(src);
    if (!response.ok) return "";
    const blob = await response.blob();
    return await blobToDataUrl(blob);
  } catch {
    return /^https?:\/\//i.test(src) ? src : "";
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function input(label, name, value, type = "text", extraClass = "") {
  const inputAttrs =
    type === "number"
      ? `type="text" inputmode="numeric" pattern="[0-9,]*" data-number-input="true"`
      : `type="${escapeHtml(type)}"`;
  return html`
    <div class="field ${extraClass}">
      <label>${escapeHtml(label)}</label>
      <input name="${escapeHtml(name)}" ${inputAttrs} value="${escapeHtml(value)}" />
    </div>
  `;
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function sanitizeNumberInput(value) {
  return String(value || "").replaceAll(/[^\d,]/g, "");
}

function parseFinalBid(value) {
  return Math.max(0, Number.parseInt(sanitizeNumberInput(value).replaceAll(",", ""), 10) || 0);
}

function retainErrorsForTeam(teamId, stats = deriveStats(state)[teamId]) {
  const errors = [];
  const currentPlayer = getCurrentPlayer(state);
  if (!currentPlayer) errors.push("No available player selected");
  if (currentPlayer?.status === "sold") errors.push("Player is already sold");
  if (!stats) errors.push("Team not found");
  if (state.auction.currentBid > 0) errors.push("Retain is only available before bidding");
  if (stats && stats.playerCount >= state.settings.maxPlayers) errors.push("Squad full");
  if (stats && stats.retainedCount >= state.settings.maxRetained) {
    errors.push("Retain limit reached for this team");
  }
  if (state.settings.maxRetained <= 0) errors.push("Retain is disabled in setup");
  return errors;
}

function syncFinalBidFromInput() {
  const finalBidInput = document.querySelector('[data-input="final-bid"]');
  if (!finalBidInput) return state.auction.currentBid;
  const sanitized = sanitizeNumberInput(finalBidInput.value);
  if (finalBidInput.value !== sanitized) finalBidInput.value = sanitized;
  state.auction.currentBid = parseFinalBid(finalBidInput.value);
  saveState(state);
  return state.auction.currentBid;
}

function refreshAuctionControls() {
  const currentPlayer = getCurrentPlayer(state);
  const saleCheck =
    state.auction.highestBidderId && state.auction.currentBid > 0
      ? canTeamBid(state, state.auction.highestBidderId, state.auction.currentBid)
      : null;
  const sellButton = document.querySelector('[data-action="sell"]');
  const clearButton = document.querySelector('[data-action="clear-final-bid"]');
  const unsoldButton = document.querySelector('[data-action="unsold"]');
  const retainButtons = document.querySelectorAll('[data-action="retain-player"]');

  if (sellButton) {
    sellButton.disabled = !saleCheck?.ok;
    sellButton.title = saleCheck?.ok
      ? "Confirm sale"
      : saleCheck?.errors.join(", ") || "Enter a valid final bid";
  }
  if (clearButton) {
    clearButton.disabled = !(state.auction.highestBidderId || state.auction.currentBid);
  }
  if (unsoldButton) {
    unsoldButton.disabled = !(
      currentPlayer &&
      !state.auction.highestBidderId &&
      state.auction.currentBid === 0
    );
  }
  for (const retainButton of retainButtons) {
    const errors = retainErrorsForTeam(retainButton.dataset.teamId);
    retainButton.disabled = errors.length > 0;
    retainButton.title = errors.join(", ") || "Retain current player for 0 points";
  }
}

function renderPreservingInput(target) {
  const inputKey = target?.dataset?.input;
  const selectionStart = target?.selectionStart;
  const selectionEnd = target?.selectionEnd;
  render();

  if (!inputKey) return;
  const nextInput = document.querySelector(`[data-input="${inputKey}"]`);
  if (!nextInput) return;
  nextInput.focus();
  if (typeof nextInput.setSelectionRange === "function" && Number.isInteger(selectionStart)) {
    nextInput.setSelectionRange(selectionStart, selectionEnd);
  }
}

function requireName(data, label) {
  data.name = String(data.name || "").trim();
  if (data.name) return true;
  showMessage(`${label} name is required.`);
  return false;
}

app.addEventListener("click", (event) => {
  const divisionButtonEl = event.target.closest("[data-division]");
  if (divisionButtonEl) {
    setDivision(divisionButtonEl.dataset.division);
    return;
  }

  const tabButtonEl = event.target.closest("[data-tab]");
  if (tabButtonEl) {
    setTab(tabButtonEl.dataset.tab);
    return;
  }

  const fileClick = event.target.closest("[data-click-file]");
  if (fileClick) {
    document.querySelector(`#${fileClick.dataset.clickFile}`)?.click();
    return;
  }

  const actionEl = event.target.closest("[data-action]");
  if (!actionEl) return;
  const action = actionEl.dataset.action;

  if (action === "open-photo-modal") {
    const player = getCurrentPlayer(state);
    if (!player) return;
    state.ui.photoModalPlayerId = player.id;
    render();
    return;
  }
  if (action === "close-photo-modal") {
    state.ui.photoModalPlayerId = "";
    render();
    return;
  }
  if (action === "dismiss-message") {
    setMessage("");
    saveState(state);
    render();
  }
  if (action === "select-team") {
    syncFinalBidFromInput();
    const team = teamById(actionEl.dataset.teamId);
    if (!team) {
      showMessage("Team not found.");
      return;
    }
    state.auction.highestBidderId = team.id;
    state.ui.message = "";
    saveState(state);
    render();
  }
  if (action === "sell") {
    syncFinalBidFromInput();
    const player = getCurrentPlayer(state);
    const team = teamById(state.auction.highestBidderId);
    if (!player) {
      showMessage("No available player selected.");
      return;
    }
    if (!team) {
      showMessage("Select a team before confirming sale.");
      return;
    }
    const finalBid = state.auction.currentBid;
    const check = canTeamBid(state, team.id, finalBid);
    if (!check.ok) {
      showMessage(check.errors[0]);
      return;
    }
    commit(
      `Sold ${player.name} to ${team.name} for ${money(finalBid)}`,
      (draft) => {
        setFinalBidForTeam(draft, team.id, finalBid);
        sellCurrentPlayer(draft);
      },
      "sale",
    );
  }
  if (action === "retain-player") {
    syncFinalBidFromInput();
    const player = getCurrentPlayer(state);
    const team = teamById(actionEl.dataset.teamId);
    if (!player) {
      showMessage("No available player selected.");
      return;
    }
    if (!team) {
      showMessage("Team not found.");
      return;
    }
    commit(
      `Retained ${player.name} for ${team.name}`,
      (draft) => {
        retainCurrentPlayer(draft, team.id);
      },
      "retain",
    );
  }
  if (action === "unsold") {
    const player = getCurrentPlayer(state);
    if (!player) {
      showMessage("No available player selected.");
      return;
    }
    commit(`Marked ${player.name} unsold`, markCurrentUnsold, "unsold");
  }
  if (action === "undo") {
    if (!state.undoStack.length) return;
    state = restoreSnapshot(state.undoStack[state.undoStack.length - 1], state);
    saveState(state);
    render();
  }
  if (action === "clear-auction-logo") {
    commit("Auction logo cleared", (draft) => {
      draft.settings.logo = "";
    });
  }
  if (action === "clear-team-logo") {
    const team = teamById(actionEl.dataset.teamId);
    if (!team) {
      showMessage("Team not found.");
      return;
    }
    commit(`Cleared logo for ${team.name}`, (draft) => {
      const draftTeam = draft.teams.find((item) => item.id === team.id);
      if (draftTeam) draftTeam.logo = "";
    });
  }
  if (action === "clear-final-bid") {
    state.auction.currentBid = 0;
    state.auction.highestBidderId = null;
    state.ui.message = "";
    saveState(state);
    render();
  }
  if (action === "export-teams") exportTeamsCSV(state);
  if (action === "export-players") exportPlayersCSV(state);
  if (action === "export-backup") exportBackup(state);
  if (action === "export-excel") exportExcelBackup(state);
  if (action === "export-team-cards") {
    exportTeamCards().catch((error) => showMessage(error.message || "Team card export failed"));
  }
  if (action === "select-player") {
    const player = state.players.find((item) => item.id === actionEl.dataset.playerId);
    if (!isAuctionablePlayer(player)) {
      showMessage("Sold players cannot be selected.");
      return;
    }
    commit("Selected player", (draft) => {
      draft.auction.currentPlayerId = actionEl.dataset.playerId;
      draft.auction.currentBid = 0;
      draft.auction.highestBidderId = null;
      draft.ui.tab = "auction";
    });
  }
  if (action === "delete-team") {
    const team = teamById(actionEl.dataset.teamId);
    if (!team) {
      showMessage("Team not found.");
      return;
    }
    const ok = confirm(`Delete ${team.name}? Sold players assigned to this team will become available again.`);
    if (!ok) return;
    commit(`Deleted team ${team.name}`, (draft) => {
      draft.teams = draft.teams.filter((item) => item.id !== team.id);
      for (const player of draft.players) {
        if (player.teamId === team.id) {
          player.status = "available";
          player.teamId = null;
          player.soldPrice = 0;
          player.isRetained = false;
        }
      }
    });
  }
  if (action === "reset-auction") {
    if (!confirm(`Reset ${activeDivisionLabel()} auction results?`)) return;
    commit(`${activeDivisionLabel()} auction results reset`, resetAuctionResults, "reset");
  }
});

app.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  const type = form.dataset.form;
  const data = formData(form);

  if (type === "settings") {
    commit("Settings saved", (draft) => {
      draft.settings = { ...draft.settings, ...data };
    });
  }
  if (type === "team") {
    if (!requireName(data, "Team")) return;
    commit(`Added team ${data.name}`, (draft) => {
      draft.teams.push({
        ...makeTeam(data.name, draft.teams.length, activeDivision(state)),
        color: data.color,
        logo: data.logo,
      });
    });
  }
  if (type === "edit-team") {
    if (!requireName(data, "Team")) return;
    commit(`Updated team ${data.name}`, (draft) => {
      const team = draft.teams.find((item) => item.id === form.dataset.teamId);
      if (!team) throw new Error("Team not found");
      team.name = data.name;
      team.color = data.color;
      team.logo = data.logo;
    });
  }
  if (type === "player") {
    if (!requireName(data, "Player")) return;
    commit(`Added player ${data.name}`, (draft) => {
      draft.players.push(makePlayer({ ...data, division: activeDivision(state), id: uid("player") }, draft.players.length));
      if (!draft.auction.currentPlayerId) draft.auction.currentPlayerId = draft.players.at(-1).id;
    });
  }
});

app.addEventListener("input", (event) => {
  if (event.target.dataset.numberInput === "true") {
    const sanitized = sanitizeNumberInput(event.target.value);
    if (event.target.value !== sanitized) event.target.value = sanitized;
  }
  if (event.target.dataset.input === "final-bid") {
    syncFinalBidFromInput();
    refreshAuctionControls();
  }
  if (event.target.dataset.input === "search") {
    state.ui.search = event.target.value;
    saveState(state);
    renderPreservingInput(event.target);
  }
  if (event.target.dataset.input === "status-filter") {
    state.ui.statusFilter = event.target.value;
    saveState(state);
    render();
  }

});

app.addEventListener("change", async (event) => {
  const fileInput = event.target.closest("[data-file]");
  if (!fileInput || !fileInput.files?.[0]) return;
  const file = fileInput.files[0];

  try {
    if (fileInput.dataset.file === "auction-logo") {
      const dataUrl = await readDataUrl(file);
      commit("Auction logo uploaded", (draft) => {
        draft.settings.logo = dataUrl;
      });
    }
    if (fileInput.dataset.file === "team-logo") {
      const dataUrl = await readDataUrl(file);
      const team = teamById(fileInput.dataset.teamId);
      if (!team) throw new Error("Team not found");
      commit(`Uploaded logo for ${team.name}`, (draft) => {
        const draftTeam = draft.teams.find((item) => item.id === team.id);
        if (draftTeam) draftTeam.logo = dataUrl;
      });
    }
    if (fileInput.dataset.file === "teams-csv") {
      const text = await readTextFile(file);
      const imported = teamsFromCSV(text, activeDivision(state));
      if (!imported.length) throw new Error("No teams found in CSV");
      commit(`Imported ${imported.length} teams`, (draft) => {
        const importedDivisions = new Set(imported.map((team) => team.division));
        draft.teams = [
          ...draft.teams.filter((team) => !importedDivisions.has(team.division)),
          ...imported,
        ];
        const teamIds = new Set(imported.map((team) => team.id));
        for (const player of draft.players) {
          if (player.teamId && importedDivisions.has(player.division) && !teamIds.has(player.teamId)) {
            player.status = "available";
            player.teamId = null;
            player.soldPrice = 0;
            player.isRetained = false;
          }
        }
      });
    }
    if (fileInput.dataset.file === "players-csv") {
      const text = await readTextFile(file);
      const imported = playersFromCSV(text, state.teams, activeDivision(state));
      if (!imported.length) throw new Error("No players found in CSV");
      commit(`Imported ${imported.length} players`, (draft) => {
        const importedDivisions = new Set(imported.map((player) => player.division));
        draft.players = [
          ...draft.players.filter((player) => !importedDivisions.has(player.division)),
          ...imported,
        ];
        draft.auction.currentPlayerId =
          imported.find((player) => player.division === activeDivision(state) && isAuctionablePlayer(player))?.id ??
          null;
        draft.auction.currentBid = 0;
        draft.auction.highestBidderId = null;
      });
    }
    if (fileInput.dataset.file === "backup-json") {
      const text = await readTextFile(file);
      const imported = normalizeState(JSON.parse(text));
      commit("Backup imported", (draft) => {
        Object.assign(draft, imported);
      });
    }
    if (fileInput.dataset.file === "backup-excel") {
      const text = await readTextFile(file);
      const imported = stateFromExcelBackup(text);
      commit("Excel backup imported", (draft) => {
        Object.assign(draft, imported);
      });
    }
  } catch (error) {
    setMessage(error.message || "Import failed");
    render();
  } finally {
    fileInput.value = "";
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.ui.photoModalPlayerId) {
    state.ui.photoModalPlayerId = "";
    render();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (!state.undoStack.length) return;
    state = restoreSnapshot(state.undoStack[state.undoStack.length - 1], state);
    saveState(state);
    render();
  }
});

if (!state.players.length && !state.teams.length) {
  state = createDefaultState();
}

saveState(state);
render();
