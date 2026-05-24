import {
  COLORS,
  DEFAULT_ROLES,
  activeDivision,
  divisionLabel,
  makePlayer,
  makeTeam,
  normalizeDivision,
  playersForDivision,
  teamsForDivision,
} from "./domain.mjs";
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

function filenameDivision(division) {
  return division === "women" ? "women" : "men";
}

export function playersFromCSV(text, teams, fallbackDivision = "men") {
  const rows = parseCSV(text);
  if (rows.length < 2) return [];
  const headers = rows[0];
  const teamByName = new Map(
    teams.map((team) => [`${team.division}:${team.name.toLowerCase()}`, team.id]),
  );

  const playerNumberIndex = headerIndex(headers, ["player id", "player number", "photo id", "id"]);
  const divisionIndex = headerIndex(headers, ["gender", "division", "auction", "section"]);
  const nameIndex = headerIndex(headers, ["name", "player name"]);
  const roleIndex = headerIndex(headers, ["role", "category"]);
  const ageIndex = headerIndex(headers, ["age"]);
  const basePriceIndex = headerIndex(headers, ["base price", "baseprice", "minimum price"]);
  const statusIndex = headerIndex(headers, ["status"]);
  const teamIndex = headerIndex(headers, ["team", "team assigned", "assigned team"]);
  const soldPriceIndex = headerIndex(headers, ["sold price", "soldprice", "price"]);
  const retainedIndex = headerIndex(headers, ["is retained", "retained"]);
  const photoIndex = headerIndex(headers, ["photo", "photo url", "photo path", "photo url or path"]);

  return rows.slice(1).map((row, index) => {
    const rawPlayerNumber = String(row[playerNumberIndex] || "").trim();
    const division = normalizeDivision(row[divisionIndex], fallbackDivision);
    const name = row[nameIndex] || row[1] || row[0] || `Player ${index + 1}`;
    const teamName = String(row[teamIndex] || "").trim().toLowerCase();
    const teamId = teamByName.get(`${division}:${teamName}`) || null;
    const rawStatus = String(row[statusIndex] || "").trim().toLowerCase();
    const status = ["available", "sold", "unsold"].includes(rawStatus)
      ? rawStatus
      : teamId
        ? "sold"
        : "available";
    const retained = String(row[retainedIndex] || "").trim().toLowerCase();

    return makePlayer(
      {
        division,
        playerNumber: rawPlayerNumber.startsWith("player_") ? "" : rawPlayerNumber,
        name,
        role: row[roleIndex] || DEFAULT_ROLES[index % DEFAULT_ROLES.length],
        age: row[ageIndex] || 22,
        basePrice: row[basePriceIndex] || 0,
        status,
        teamId: status === "sold" ? teamId : null,
        soldPrice: row[soldPriceIndex] || 0,
        isRetained: ["yes", "true", "1", "retained"].includes(retained),
        photo: row[photoIndex] || "",
      },
      index,
    );
  });
}

export function teamsFromCSV(text, fallbackDivision = "men") {
  const rows = parseCSV(text);
  if (rows.length < 2) return [];
  const headers = rows[0];
  const divisionIndex = headerIndex(headers, ["gender", "division", "auction", "section"]);
  const nameIndex = headerIndex(headers, ["team name", "name"]);
  const logoIndex = headerIndex(headers, ["logo", "logo url"]);
  const colorIndex = headerIndex(headers, ["color", "team color"]);

  return rows.slice(1).map((row, index) => ({
    ...makeTeam(
      row[nameIndex] || row[1] || row[0] || `Team ${index + 1}`,
      index,
      normalizeDivision(row[divisionIndex], fallbackDivision),
    ),
    logo: row[logoIndex] || "",
    color: row[colorIndex] || COLORS[index % COLORS.length],
  }));
}

export function exportPlayersCSV(state, division = activeDivision(state)) {
  const teamById = new Map(state.teams.map((team) => [team.id, team.name]));
  const players = playersForDivision(state, division);
  const rows = [
    [
      "Gender",
      "Player ID",
      "Name",
      "Role",
      "Age",
      "Base Price",
      "Status",
      "Team Assigned",
      "Sold Price",
      "Is Retained",
      "Photo URL or Path",
    ],
    ...players.map((player) => [
      divisionLabel(player.division),
      player.playerNumber,
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
  downloadText(`auction-${filenameDivision(division)}-players.csv`, toCSV(rows), "text/csv");
}

export function exportTeamsCSV(state, division = activeDivision(state)) {
  const teams = teamsForDivision(state, division);
  const rows = [
    ["Gender", "Team Name", "Logo URL", "Color"],
    ...teams.map((team) => [divisionLabel(team.division), team.name, team.logo, team.color]),
  ];
  downloadText(`auction-${filenameDivision(division)}-teams.csv`, toCSV(rows), "text/csv");
}
