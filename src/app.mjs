import {
  COLORS,
  addEvent,
  bidForTeam,
  canTeamBid,
  createDefaultState,
  deriveStats,
  getCurrentPlayer,
  initials,
  makePlayer,
  makeTeam,
  nextBidFor,
  normalizeState,
  resetAuctionResults,
  restartUnsoldRound,
  restoreSnapshot,
  retainCurrentPlayer,
  sellCurrentPlayer,
  snapshotState,
  uid,
  validateAuction,
  markCurrentUnsold,
} from "./domain.mjs";
import { exportPlayersCSV, exportTeamsCSV, playersFromCSV, teamsFromCSV } from "./csv.mjs";
import { exportBackup, loadState, readDataUrl, readTextFile, saveState } from "./storage.mjs";

const app = document.querySelector("#app");
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

function setMessage(message) {
  state.ui.message = message;
}

function commit(label, mutator, type = "action", detail = {}) {
  const before = snapshotState(state);
  try {
    const draft = structuredClone(state);
    draft.undoStack = [...state.undoStack, before].slice(-80);
    mutator(draft);
    addEvent(draft, type, label, detail);
    draft.ui.message = label;
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
      </header>
      <main class="main">
        ${state.ui.message ? `<div class="notice"><span>${escapeHtml(state.ui.message)}</span><button class="btn ghost" data-action="dismiss-message">Clear</button></div>` : ""}
        ${issues.length && state.ui.tab === "auction" ? `<div class="notice"><span>${escapeHtml(issues[0])}</span><button class="btn ghost" data-tab="setup">Fix Setup</button></div>` : ""}
        ${renderActiveTab()}
      </main>
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
  const sold = state.players.filter((player) => player.status === "sold").length;
  const unsold = state.players.filter((player) => player.status === "unsold").length;
  const available = state.players.filter((player) => player.status === "available").length;

  return html`
    <section class="grid auction-grid">
      <div class="card player-stage">
        ${
          currentPlayer
            ? html`
                <div>
                  <div class="player-photo-wrap">
                    ${
                      currentPlayer.photo
                        ? `<img src="${escapeHtml(currentPlayer.photo)}" alt="${escapeHtml(currentPlayer.name)}" class="player-photo" />`
                        : `<div class="avatar-fallback">${escapeHtml(initials(currentPlayer.name))}</div>`
                    }
                  </div>
                  <h2 class="current-player-name">${escapeHtml(currentPlayer.name)}</h2>
                  <div class="pill-row">
                    <span class="pill">${escapeHtml(currentPlayer.role)}</span>
                    <span class="pill">Age ${escapeHtml(currentPlayer.age)}</span>
                    <span class="pill">Base ${money(currentPlayer.basePrice || state.settings.minBid)} ${escapeHtml(state.settings.currencyLabel)}</span>
                  </div>
                </div>
              `
            : html`
                <div>
                  <h2 class="current-player-name">Auction Complete</h2>
                  <p class="muted">${sold} sold, ${unsold} unsold.</p>
                  <div class="row wrap" style="justify-content:center">
                    ${unsold > 0 ? `<button class="btn dark" data-action="restart-unsold">Start Unsold Round</button>` : ""}
                    <button class="btn ghost" data-action="undo" ${state.undoStack.length ? "" : "disabled"}>Undo</button>
                  </div>
                </div>
              `
        }
      </div>
      <div class="card bid-board">
        <div class="bid-display">
          <div class="bid-label">Current Bid</div>
          <div class="bid-amount">${state.auction.currentBid ? money(state.auction.currentBid) : "---"}</div>
          <div class="highest">${state.auction.highestBidderId ? escapeHtml(teamById(state.auction.highestBidderId)?.name) : "Waiting for bid"}</div>
          <div class="bid-label">Next: ${currentPlayer ? money(nextBidFor(state)) : "-"} ${escapeHtml(state.settings.currencyLabel)}</div>
        </div>
        <div class="team-bid-grid">
          ${state.teams.map((team) => renderTeamBid(team, stats[team.id])).join("")}
        </div>
        <div class="row wrap spread" style="margin-top:16px">
          <button class="btn ghost" data-action="unsold" ${currentPlayer && state.auction.currentBid === 0 ? "" : "disabled"}>Pass / Unsold</button>
          <div class="row wrap">
            <button class="btn ghost" data-action="undo" ${state.undoStack.length ? "" : "disabled"}>Undo</button>
            <button class="btn success" data-action="sell" ${state.auction.highestBidderId ? "" : "disabled"}>Confirm Sale</button>
          </div>
        </div>
      </div>
    </section>
    <section class="stat-grid" style="margin-top:16px">
      <div class="stat"><span>Available</span><strong>${available}</strong></div>
      <div class="stat"><span>Sold</span><strong>${sold}</strong></div>
      <div class="stat"><span>Unsold</span><strong>${unsold}</strong></div>
      <div class="stat"><span>Undo Points</span><strong>${state.undoStack.length}</strong></div>
    </section>
    <section class="standings">
      ${state.teams
        .map(
          (team) => html`
            <div class="standing" style="--team-color:${escapeHtml(team.color)}">
              <div class="standing-line"></div>
              <strong>${escapeHtml(team.name)}</strong>
              <span class="muted">${stats[team.id].playerCount}/${state.settings.maxPlayers} players</span>
              <span><strong>${money(stats[team.id].budgetLeft)}</strong> ${escapeHtml(state.settings.currencyLabel)} left</span>
            </div>
          `,
        )
        .join("")}
    </section>
  `;
}

function renderTeamBid(team, stats) {
  const check = canTeamBid(state, team.id);
  const isHighest = state.auction.highestBidderId === team.id;
  return html`
    <button
      class="team-bid ${isHighest ? "highest" : ""}"
      style="--team-color:${escapeHtml(team.color)}"
      data-action="bid"
      data-team-id="${escapeHtml(team.id)}"
      title="${escapeHtml(check.errors.join(", ") || "Place next bid")}"
      ${check.ok ? "" : "disabled"}
    >
      <div class="mini-logo">${imageOrInitial(team.logo, team.name)}</div>
      <div class="team-name">${escapeHtml(team.name)}</div>
      <div class="team-meta">
        ${isHighest ? "Highest" : `Max ${money(stats.maxAllowedBid)} | ${stats.playerCount}/${state.settings.maxPlayers}`}
      </div>
    </button>
  `;
}

function renderSetup() {
  return html`
    <section class="grid two-grid">
      <form class="card panel stack" data-form="settings">
        <div class="panel-header">
          <h2 class="panel-title">Auction Setup</h2>
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
          <div class="stat"><span>Teams</span><strong>${state.teams.length}</strong></div>
          <div class="stat"><span>Players</span><strong>${state.players.length}</strong></div>
          <div class="stat"><span>Total Purse</span><strong>${money(state.teams.length * state.settings.initialBudget)}</strong></div>
          <div class="stat"><span>Squad Slots</span><strong>${state.teams.length * state.settings.maxPlayers}</strong></div>
        </div>
      </div>
    </section>
  `;
}

function renderTeams() {
  const stats = deriveStats(state);
  return html`
    <section class="grid two-grid">
      <form class="card panel stack" data-form="team">
        <div class="panel-header">
          <h2 class="panel-title">Add Team</h2>
          <button class="btn primary" type="submit">Add Team</button>
        </div>
        <div class="form-grid">
          ${input("Team Name", "name", "", "text", "full")}
          <div class="field">
            <label>Color</label>
            <select name="color">${COLORS.map((color) => `<option value="${color}">${color}</option>`).join("")}</select>
          </div>
          ${input("Logo URL", "logo", "", "text")}
        </div>
        <div class="row wrap">
          <input id="teams-csv" class="file-input" type="file" accept=".csv,text/csv" data-file="teams-csv" />
          <button class="btn ghost" type="button" data-click-file="teams-csv">Import CSV</button>
          <button class="btn ghost" type="button" data-action="export-teams">Export CSV</button>
        </div>
      </form>
      <div class="card panel stack">
        <div class="panel-header">
          <h2 class="panel-title">Teams</h2>
        </div>
        ${state.teams.length ? state.teams.map((team) => renderTeamEditor(team, stats[team.id])).join("") : `<div class="empty">No teams yet.</div>`}
      </div>
    </section>
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
        ${input("Logo URL", "logo", team.logo, "text", "full")}
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
  const filtered = state.players.filter((player) => {
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
          <h2 class="panel-title">Add Player</h2>
          <button class="btn primary" type="submit">Add Player</button>
        </div>
        <div class="form-grid">
          ${input("Player Name", "name", "", "text")}
          ${input("Role", "role", "Batter", "text")}
          ${input("Age", "age", 22, "number")}
          ${input("Base Price", "basePrice", 0, "number")}
          ${input("Photo URL", "photo", "", "text", "full")}
        </div>
        <div class="row wrap">
          <input id="players-csv" class="file-input" type="file" accept=".csv,text/csv" data-file="players-csv" />
          <button class="btn ghost" type="button" data-click-file="players-csv">Import CSV</button>
          <button class="btn ghost" type="button" data-action="export-players">Export CSV</button>
        </div>
      </form>
      <div class="card panel stack">
        <div class="toolbar">
          <h2 class="panel-title">Players</h2>
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
              ${filtered.map(renderPlayerRow).join("") || `<tr><td colspan="7" class="empty">No players found.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

function renderPlayerRow(player) {
  return html`
    <tr>
      <td><strong>${escapeHtml(player.name)}</strong></td>
      <td>${escapeHtml(player.role)}</td>
      <td>${escapeHtml(player.age)}</td>
      <td><span class="status ${escapeHtml(player.status)}">${escapeHtml(player.status)}</span></td>
      <td>${player.teamId ? escapeHtml(teamById(player.teamId)?.name || "") : "-"}</td>
      <td>${player.isRetained ? "Retained" : player.soldPrice ? money(player.soldPrice) : "-"}</td>
      <td><button class="btn ghost" data-action="select-player" data-player-id="${escapeHtml(player.id)}" ${player.status === "available" ? "" : "disabled"}>Select</button></td>
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
        </div>
        <div class="card panel danger-zone stack">
          <h3 class="panel-title">Reset Results</h3>
          <p class="muted">This keeps teams and players, but clears sales, bids, retained flags, and event history.</p>
          <button class="btn danger" data-action="reset-auction">Reset Auction Results</button>
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

function input(label, name, value, type = "text", extraClass = "") {
  return html`
    <div class="field ${extraClass}">
      <label>${escapeHtml(label)}</label>
      <input name="${escapeHtml(name)}" type="${escapeHtml(type)}" value="${escapeHtml(value)}" />
    </div>
  `;
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

app.addEventListener("click", (event) => {
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

  if (action === "dismiss-message") {
    setMessage("");
    saveState(state);
    render();
  }
  if (action === "bid") {
    const team = teamById(actionEl.dataset.teamId);
    commit(`${team.name} bid ${money(nextBidFor(state))}`, (draft) => bidForTeam(draft, team.id), "bid", {
      teamId: team.id,
    });
  }
  if (action === "sell") {
    const player = getCurrentPlayer(state);
    const team = teamById(state.auction.highestBidderId);
    commit(`Sold ${player.name} to ${team.name} for ${money(state.auction.currentBid)}`, sellCurrentPlayer, "sale");
  }
  if (action === "unsold") {
    const player = getCurrentPlayer(state);
    commit(`Marked ${player.name} unsold`, markCurrentUnsold, "unsold");
  }
  if (action === "restart-unsold") {
    commit("Unsold round started", restartUnsoldRound, "round");
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
  if (action === "export-teams") exportTeamsCSV(state);
  if (action === "export-players") exportPlayersCSV(state);
  if (action === "export-backup") exportBackup(state);
  if (action === "select-player") {
    commit("Selected player", (draft) => {
      draft.auction.currentPlayerId = actionEl.dataset.playerId;
      draft.auction.currentBid = 0;
      draft.auction.highestBidderId = null;
      draft.ui.tab = "auction";
    });
  }
  if (action === "delete-team") {
    const team = teamById(actionEl.dataset.teamId);
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
    if (!confirm("Reset all auction results?")) return;
    commit("Auction results reset", resetAuctionResults, "reset");
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
    commit(`Added team ${data.name}`, (draft) => {
      draft.teams.push({ ...makeTeam(data.name, draft.teams.length), color: data.color, logo: data.logo });
    });
  }
  if (type === "edit-team") {
    commit(`Updated team ${data.name}`, (draft) => {
      const team = draft.teams.find((item) => item.id === form.dataset.teamId);
      team.name = data.name;
      team.color = data.color;
      team.logo = data.logo;
    });
  }
  if (type === "player") {
    commit(`Added player ${data.name}`, (draft) => {
      draft.players.push(makePlayer({ ...data, id: uid("player") }, draft.players.length));
      if (!draft.auction.currentPlayerId) draft.auction.currentPlayerId = draft.players.at(-1).id;
    });
  }
});

app.addEventListener("input", (event) => {
  if (event.target.dataset.input === "search") {
    state.ui.search = event.target.value;
    saveState(state);
    render();
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
    if (fileInput.dataset.file === "teams-csv") {
      const text = await readTextFile(file);
      const imported = teamsFromCSV(text);
      if (!imported.length) throw new Error("No teams found in CSV");
      commit(`Imported ${imported.length} teams`, (draft) => {
        draft.teams = imported;
        const teamIds = new Set(imported.map((team) => team.id));
        for (const player of draft.players) {
          if (player.teamId && !teamIds.has(player.teamId)) {
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
      const imported = playersFromCSV(text, state.teams);
      if (!imported.length) throw new Error("No players found in CSV");
      commit(`Imported ${imported.length} players`, (draft) => {
        draft.players = imported;
        draft.auction.currentPlayerId = imported.find((player) => player.status === "available")?.id ?? null;
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
  } catch (error) {
    setMessage(error.message || "Import failed");
    render();
  } finally {
    fileInput.value = "";
  }
});

window.addEventListener("keydown", (event) => {
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
