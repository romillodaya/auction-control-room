import {
  COLORS,
  createDefaultState,
  divisionLabel,
  makePlayer,
  makeTeam,
  normalizeDivision,
  normalizeState,
  uid,
} from "./domain.mjs";
import { downloadText } from "./storage.mjs";

const SPREADSHEET_NS = "urn:schemas-microsoft-com:office:spreadsheet";

const SETTINGS = [
  ["auctionName", "Auction Name"],
  ["currencyLabel", "Currency Label"],
  ["initialBudget", "Initial Budget"],
  ["maxPlayers", "Max Players Per Team"],
  ["minBid", "Minimum Bid"],
  ["bidIncrement", "Bid Increment"],
  ["maxRetained", "Max Retained Per Team"],
];

function cleanXml(value) {
  return String(value ?? "").replaceAll(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

function escapeXml(value) {
  return cleanXml(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function cellXml(value) {
  const text = cleanXml(value);
  const type = typeof value === "number" && Number.isFinite(value) ? "Number" : "String";
  return `<Cell><Data ss:Type="${type}">${escapeXml(text)}</Data></Cell>`;
}

function rowXml(row) {
  return `<Row>${row.map(cellXml).join("")}</Row>`;
}

function worksheetXml(name, rows) {
  return html`
    <Worksheet ss:Name="${escapeXml(name)}">
      <Table>
        ${rows.map(rowXml).join("")}
      </Table>
    </Worksheet>
  `;
}

function html(strings, ...values) {
  return strings.reduce((out, part, index) => out + part + (values[index] ?? ""), "");
}

export function exportExcelBackup(state) {
  const normalized = normalizeState(state);
  const teamById = new Map(normalized.teams.map((team) => [team.id, team.name]));

  const settingsRows = [
    ["Key", "Setting", "Value"],
    ...SETTINGS.map(([key, label]) => [key, label, normalized.settings[key] ?? ""]),
  ];

  const teamRows = [
    ["ID", "Gender", "Team Name", "Logo URL or Path", "Color"],
    ...normalized.teams.map((team) => [
      team.id,
      divisionLabel(team.division),
      team.name,
      team.logo,
      team.color,
    ]),
  ];

  const playerRows = [
    [
      "ID",
      "Gender",
      "Player ID",
      "Name",
      "Role",
      "Age",
      "Base Price",
      "Status",
      "Team Assigned",
      "Team ID",
      "Sold Price",
      "Is Retained",
      "Photo URL or Path",
    ],
    ...normalized.players.map((player) => [
      player.id,
      divisionLabel(player.division),
      player.playerNumber,
      player.name,
      player.role,
      player.age,
      player.basePrice,
      player.status,
      player.teamId ? teamById.get(player.teamId) || "" : "",
      player.teamId || "",
      player.soldPrice,
      player.isRetained ? "Yes" : "No",
      player.photo,
    ]),
  ];

  const eventRows = [
    ["ID", "At", "Type", "Label", "Detail JSON"],
    ...normalized.events.map((event) => [
      event.id,
      event.at,
      event.type,
      event.label,
      JSON.stringify(event.detail || {}),
    ]),
  ];

  const rosterRows = [
    [
      "Gender",
      "Team Name",
      "Logo URL or Path",
      "Retained Player",
      "Purchased Players",
      "Player Count",
      "Points Spent",
      "Points Left",
    ],
    ...normalized.teams.map((team) => {
      const players = normalized.players.filter((player) => player.teamId === team.id);
      const retained = players
        .filter((player) => player.isRetained)
        .map((player) => `${player.playerNumber} - ${player.name} (${player.role})`)
        .join(", ");
      const purchased = players
        .filter((player) => !player.isRetained)
        .map((player) => `${player.playerNumber} - ${player.name} (${player.role}) - ${player.soldPrice}`)
        .join("\n");
      const spent = players.reduce((sum, player) => sum + Number(player.soldPrice || 0), 0);

      return [
        divisionLabel(team.division),
        team.name,
        team.logo,
        retained,
        purchased,
        players.length,
        spent,
        normalized.settings.initialBudget - spent,
      ];
    }),
  ];

  const workbook = html`
    <?xml version="1.0"?>
    <?mso-application progid="Excel.Sheet"?>
    <Workbook xmlns="${SPREADSHEET_NS}"
      xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns:ss="${SPREADSHEET_NS}">
      ${worksheetXml("Settings", settingsRows)}
      ${worksheetXml("Teams", teamRows)}
      ${worksheetXml("Players", playerRows)}
      ${worksheetXml("Team Rosters", rosterRows)}
      ${worksheetXml("Events", eventRows)}
    </Workbook>
  `.trim();

  downloadText(
    `auction-excel-${new Date().toISOString().slice(0, 10)}.xls`,
    workbook,
    "application/vnd.ms-excel",
  );
}

function descendantsByLocalName(root, localName) {
  return Array.from(root.getElementsByTagName("*")).filter((node) => node.localName === localName);
}

function childElementsByLocalName(root, localName) {
  return Array.from(root.children).filter((node) => node.localName === localName);
}

function attr(node, name) {
  return node.getAttribute(name) || node.getAttribute(`ss:${name}`) || "";
}

function worksheetRows(doc, sheetName) {
  const worksheet = descendantsByLocalName(doc, "Worksheet").find((node) => attr(node, "Name") === sheetName);
  if (!worksheet) return [];
  const table = descendantsByLocalName(worksheet, "Table")[0];
  if (!table) return [];

  return childElementsByLocalName(table, "Row").map((row) => {
    const values = [];
    let columnIndex = 1;

    for (const cell of childElementsByLocalName(row, "Cell")) {
      const explicitIndex = Number.parseInt(attr(cell, "Index"), 10);
      if (Number.isFinite(explicitIndex)) {
        while (columnIndex < explicitIndex) {
          values.push("");
          columnIndex += 1;
        }
      }

      const data = descendantsByLocalName(cell, "Data")[0];
      values.push(data?.textContent?.trim() ?? "");
      columnIndex += 1;
    }

    return values;
  });
}

function rowsByHeader(rows) {
  const headers = rows[0] || [];
  return rows.slice(1).map((row) => {
    const record = {};
    headers.forEach((header, index) => {
      record[String(header || "").trim().toLowerCase()] = row[index] ?? "";
    });
    return record;
  });
}

function truthy(value) {
  return ["yes", "true", "1", "retained"].includes(String(value || "").trim().toLowerCase());
}

function parseDetail(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

export function stateFromExcelBackup(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (descendantsByLocalName(doc, "parsererror").length) {
    throw new Error("Could not read Excel file. Import the .xls file exported by this app.");
  }

  const settingsSheet = worksheetRows(doc, "Settings");
  const teamSheet = worksheetRows(doc, "Teams");
  const playerSheet = worksheetRows(doc, "Players");
  const eventSheet = worksheetRows(doc, "Events");

  if (!settingsSheet.length || !teamSheet.length || !playerSheet.length) {
    throw new Error("Excel backup must include Settings, Teams, and Players sheets.");
  }

  const settingsRows = rowsByHeader(settingsSheet);
  const teamRows = rowsByHeader(teamSheet);
  const playerRows = rowsByHeader(playerSheet);
  const eventRows = rowsByHeader(eventSheet);

  const settings = { ...createDefaultState().settings };
  for (const row of settingsRows) {
    if (row.key) settings[row.key] = row.value;
  }

  const teams = teamRows
    .filter((row) => row["team name"])
    .map((row, index) => ({
      ...makeTeam(row["team name"], index),
      id: row.id || uid("team"),
      division: normalizeDivision(row.gender || row.division || row.auction, "men"),
      logo: row["logo url or path"] || row["logo url"] || "",
      color: row.color || COLORS[index % COLORS.length],
    }));

  const teamById = new Map(teams.map((team) => [team.id, team.id]));
  const teamByName = new Map(teams.map((team) => [`${team.division}:${team.name.toLowerCase()}`, team.id]));

  const players = playerRows
    .filter((row) => row.name)
    .map((row, index) => {
      const rawStatus = String(row.status || "available").trim().toLowerCase();
      const status = ["available", "sold", "unsold"].includes(rawStatus) ? rawStatus : "available";
      const division = normalizeDivision(row.gender || row.division || row.auction, "men");
      const teamId =
        teamById.get(row["team id"]) ||
        teamByName.get(`${division}:${String(row["team assigned"] || "").trim().toLowerCase()}`) ||
        null;

      return makePlayer(
        {
          id: row.id || uid("player"),
          division,
          playerNumber: row["player id"] || row["player number"] || row["photo id"] || "",
          name: row.name,
          role: row.role,
          age: row.age,
          basePrice: row["base price"],
          status,
          teamId: status === "sold" ? teamId : null,
          soldPrice: row["sold price"],
          isRetained: truthy(row["is retained"]),
          photo: row["photo url or path"] || row["photo url"] || "",
        },
        index,
      );
    });

  const events = eventRows
    .filter((row) => row.label)
    .map((row) => ({
      id: row.id || uid("event"),
      at: row.at || new Date().toISOString(),
      type: row.type || "action",
      label: row.label,
      detail: parseDetail(row["detail json"]),
    }));

  return normalizeState({
    version: 1,
    settings,
    teams,
    players,
    events,
    undoStack: [],
    auction: {
      currentPlayerId: players.find((player) => player.status !== "sold")?.id ?? null,
      currentBid: 0,
      highestBidderId: null,
    },
    ui: {
      tab: "auction",
      message: "",
      search: "",
      statusFilter: "all",
    },
  });
}
