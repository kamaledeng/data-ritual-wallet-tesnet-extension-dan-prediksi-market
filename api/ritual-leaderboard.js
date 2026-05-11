<<<<<<< HEAD
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

=======
const runtimeBoard = globalThis.__ritualLeaderboardBoard ?? new Map();
globalThis.__ritualLeaderboardBoard = runtimeBoard;

let kv = null;
try {
  ({ kv } = require("@vercel/kv"));
} catch {
  kv = null;
}

const KV_KEY = "ritual:leaderboard:v1";

>>>>>>> e80faac (Add real-claim leaderboard API with persistence fallback)
function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.end(JSON.stringify(payload));
}

<<<<<<< HEAD
=======
function validAddress(address) {
  return /^0x[a-f0-9]{40}$/.test(address);
}

function sanitizeName(name, address) {
  const fallback = `${address.slice(0, 6)}...${address.slice(-4)}`;
  return String(name || fallback).trim().slice(0, 32) || fallback;
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

>>>>>>> e80faac (Add real-claim leaderboard API with persistence fallback)
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

<<<<<<< HEAD
function rows() {
  return Array.from(board.values())
    .sort((a, b) => Number(b.xp || 0) - Number(a.xp || 0))
=======
async function readBoard() {
  if (!kv) return new Map(runtimeBoard);
  const rows = (await kv.get(KV_KEY)) ?? [];
  return new Map(rows.map((row) => [String(row.address).toLowerCase(), row]));
}

async function writeBoard(board) {
  if (!kv) {
    runtimeBoard.clear();
    for (const [key, value] of board) runtimeBoard.set(key, value);
    return;
  }
  await kv.set(KV_KEY, Array.from(board.values()));
}

function rankedRows(board) {
  return Array.from(board.values())
    .sort((a, b) => {
      const xpDelta = toNumber(b.xp) - toNumber(a.xp);
      if (xpDelta) return xpDelta;
      const dailyDelta = toNumber(b.dailyClaims) - toNumber(a.dailyClaims);
      if (dailyDelta) return dailyDelta;
      const streakDelta = toNumber(b.streak) - toNumber(a.streak);
      if (streakDelta) return streakDelta;
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    })
>>>>>>> e80faac (Add real-claim leaderboard API with persistence fallback)
    .slice(0, 100)
    .map((row, index) => ({ rank: index + 1, ...row }));
}

module.exports = async function handler(request, response) {
  if (request.method === "OPTIONS") return sendJson(response, 200, { ok: true });
<<<<<<< HEAD
  if (request.method === "GET") return sendJson(response, 200, { rows: rows(), updatedAt: new Date().toISOString() });
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });
=======

  const board = await readBoard();

  if (request.method === "GET") {
    return sendJson(response, 200, {
      rows: rankedRows(board),
      updatedAt: new Date().toISOString(),
      storage: kv ? "vercel-kv" : "memory",
    });
  }

  if (request.method !== "POST") {
    return sendJson(response, 405, { error: "Method not allowed" });
  }
>>>>>>> e80faac (Add real-claim leaderboard API with persistence fallback)

  try {
    const body = await parseBody(request);
    const address = String(body.address || "").toLowerCase();
<<<<<<< HEAD
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
=======
    if (!validAddress(address)) return sendJson(response, 400, { error: "Valid wallet address is required" });

    const taskId = String(body.task?.id || "");
    const nowIso = new Date().toISOString();
    const existing = board.get(address) || {};

    // Extension already gates most rituals behind positive CRAT balance.
    // Here we additionally store the latest reported balance for auditing/debug.
    const cratBalance = Math.max(0, toNumber(body.cratBalance, toNumber(existing.cratBalance)));
    const hasFaucetBalance = cratBalance > 0;

    let dailyClaims = toNumber(existing.dailyClaims);
    let lastDailyClaimAt = toNumber(existing.lastDailyClaimAt);
    if (taskId === "daily_claim") {
      const incomingClaimAt = Date.now();
      if (!lastDailyClaimAt || incomingClaimAt - lastDailyClaimAt > 60_000) {
        dailyClaims += 1;
        lastDailyClaimAt = incomingClaimAt;
      }
    }

    const next = {
      address,
      name: sanitizeName(body.name, address),
      xp: Math.max(toNumber(existing.xp), toNumber(body.xp)),
      streak: Math.max(toNumber(existing.streak), toNumber(body.streak)),
      dailyClaims,
      actions: Math.max(toNumber(existing.actions), dailyClaims),
      cratBalance,
      hasFaucetBalance,
      lastTask: String(body.task?.title || existing.lastTask || "Ritual task").slice(0, 48),
      lastTaskId: taskId || existing.lastTaskId || "",
      lastDailyClaimAt,
      updatedAt: nowIso,
      source: String(body.source || existing.source || "ritual-wallet-extension").slice(0, 64),
    };

    board.set(address, next);
    await writeBoard(board);

    return sendJson(response, 200, {
      ok: true,
      row: next,
      rows: rankedRows(board),
      updatedAt: nowIso,
      storage: kv ? "vercel-kv" : "memory",
    });
>>>>>>> e80faac (Add real-claim leaderboard API with persistence fallback)
  } catch (error) {
    return sendJson(response, 400, { error: error.message || "Leaderboard update failed" });
  }
};
