const seedRows = [
  { address: "0x8a9f000000000000000000000000000000007c1", name: "Ritual Alpha", xp: 940, streak: 18, actions: 34, lastTask: "Daily Claim", updatedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString() },
  { address: "0x4e2b0000000000000000000000000000000091b", name: "Ritual Runner", xp: 710, streak: 12, actions: 22, lastTask: "Ritual Check-in", updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
  { address: "0x71dd000000000000000000000000000000003af", name: "Prediction Scout", xp: 260, streak: 5, actions: 8, lastTask: "Prediction Arena", updatedAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString() },
];

const board = globalThis.__ritualLeaderboardBoard ?? new Map();
globalThis.__ritualLeaderboardBoard = board;

for (const row of seedRows) {
  if (!board.has(row.address.toLowerCase())) {
    board.set(row.address.toLowerCase(), row);
  }
}

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.end(JSON.stringify(payload));
}

function parseBody(request) {
  if (request.body && typeof request.body === "object") return Promise.resolve(request.body);
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 100_000) reject(new Error("Payload too large"));
    });
    request.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function rows() {
  return Array.from(board.values())
    .sort((a, b) => Number(b.xp || 0) - Number(a.xp || 0))
    .slice(0, 100)
    .map((row, index) => ({ rank: index + 1, ...row }));
}

module.exports = async function handler(request, response) {
  if (request.method === "OPTIONS") return sendJson(response, 200, { ok: true });
  if (request.method === "GET") return sendJson(response, 200, { rows: rows(), updatedAt: new Date().toISOString() });
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });

  try {
    const body = await parseBody(request);
    const address = String(body.address || "").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(address)) {
      return sendJson(response, 400, { error: "Valid wallet address is required" });
    }

    const existing = board.get(address) || {};
    const completed = body.completed && typeof body.completed === "object" ? body.completed : {};
    const actions = Math.max(
      Number(existing.actions || 0),
      Object.keys(completed).length,
      Number(existing.actions || 0) + 1,
    );
    const next = {
      address,
      name: String(body.name || existing.name || `${address.slice(0, 6)}...${address.slice(-4)}`).slice(0, 32),
      xp: Math.max(Number(existing.xp || 0), Number(body.xp || 0)),
      streak: Math.max(Number(existing.streak || 0), Number(body.streak || 0)),
      actions,
      cratBalance: Number(body.cratBalance || existing.cratBalance || 0),
      lastTask: String(body.task?.title || existing.lastTask || "Ritual task").slice(0, 40),
      updatedAt: new Date().toISOString(),
    };
    board.set(address, next);
    return sendJson(response, 200, { ok: true, row: next, rows: rows(), updatedAt: new Date().toISOString() });
  } catch (error) {
    return sendJson(response, 400, { error: error.message || "Leaderboard update failed" });
  }
};
