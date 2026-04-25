import { COLORS, DEFAULT_ROLES, makePlayer, makeTeam } from "./domain.mjs";
import { downloadText } from "./storage.mjs";

export function parseCSV(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  row.push(value);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

export function toCSV(rows) {
  return rows
    .map((row) =>
      row
        .map((value) => {
          const text = String(value ?? "");
          return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
        })
        .join(","),
    )
    .join("\n");
}

function headerIndex(headers, aliases) {
  const lower = headers.map((header) => header.trim().toLowerCase());
  return aliases
    .map((alias) => lower.indexOf(alias))
    .find((index) => Number.isInteger(index) && index >= 0);
}

export function playersFromCSV(text, teams) {
  const rows = parseCSV(text);
  if (rows.length < 2) return [];
  const headers = rows[0];
  const teamByName = new Map(teams.map((team) => [team.name.toLowerCase(), team.id]));

  const nameIndex = headerIndex(headers, ["name", "player name"]);
  const roleIndex = headerIndex(headers, ["role", "category"]);
  const ageIndex = headerIndex(headers, ["age"]);
  const basePriceIndex = headerIndex(headers, ["base price", "baseprice", "minimum price"]);
  const statusIndex = headerIndex(headers, ["status"]);
  const teamIndex = headerIndex(headers, ["team", "team assigned", "assigned team"]);
  const soldPriceIndex = headerIndex(headers, ["sold price", "soldprice", "price"]);
  const retainedIndex = headerIndex(headers, ["is retained", "retained"]);
  const photoIndex = headerIndex(headers, ["photo", "photo url"]);

  return rows.slice(1).map((row, index) => {
    const name = row[nameIndex] || row[1] || row[0] || `Player ${index + 1}`;
    const teamName = String(row[teamIndex] || "").trim().toLowerCase();
    const teamId = teamByName.get(teamName) || null;
    const status = ["available", "sold", "unsold"].includes(String(row[statusIndex]).trim())
      ? String(row[statusIndex]).trim()
      : teamId
        ? "sold"
        : "available";

    return makePlayer(
      {
        name,
        role: row[roleIndex] || DEFAULT_ROLES[index % DEFAULT_ROLES.length],
        age: row[ageIndex] || 22,
        basePrice: row[basePriceIndex] || 0,
        status,
        teamId: status === "sold" ? teamId : null,
        soldPrice: row[soldPriceIndex] || 0,
        isRetained: String(row[retainedIndex] || "").toLowerCase() === "yes",
        photo: row[photoIndex] || "",
      },
      index,
    );
  });
}

export function teamsFromCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return [];
  const headers = rows[0];
  const nameIndex = headerIndex(headers, ["team name", "name"]);
  const logoIndex = headerIndex(headers, ["logo", "logo url"]);
  const colorIndex = headerIndex(headers, ["color", "team color"]);

  return rows.slice(1).map((row, index) => ({
    ...makeTeam(row[nameIndex] || row[1] || row[0] || `Team ${index + 1}`, index),
    logo: row[logoIndex] || "",
    color: row[colorIndex] || COLORS[index % COLORS.length],
  }));
}

export function exportPlayersCSV(state) {
  const teamById = new Map(state.teams.map((team) => [team.id, team.name]));
  const rows = [
    ["Name", "Role", "Age", "Base Price", "Status", "Team Assigned", "Sold Price", "Is Retained", "Photo URL"],
    ...state.players.map((player) => [
      player.name,
      player.role,
      player.age,
      player.basePrice,
      player.status,
      player.teamId ? teamById.get(player.teamId) || "" : "",
      player.soldPrice,
      player.isRetained ? "Yes" : "No",
      player.photo,
    ]),
  ];
  downloadText("auction-players.csv", toCSV(rows), "text/csv");
}

export function exportTeamsCSV(state) {
  const rows = [
    ["Team Name", "Logo URL", "Color"],
    ...state.teams.map((team) => [team.name, team.logo, team.color]),
  ];
  downloadText("auction-teams.csv", toCSV(rows), "text/csv");
}
