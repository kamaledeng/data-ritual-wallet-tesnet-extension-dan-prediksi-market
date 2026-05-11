const runtimeBoard = globalThis.__ritualLeaderboardBoard ?? new Map();
globalThis.__ritualLeaderboardBoard = runtimeBoard;

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.end(JSON.stringify(payload));
}

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

async function readBoard() {
  return new Map(runtimeBoard);
}

async function writeBoard(board) {
  runtimeBoard.clear();
  for (const [key, value] of board) runtimeBoard.set(key, value);
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
    .slice(0, 100)
    .map((row, index) => ({ rank: index + 1, ...row }));
}

function supabaseConfig() {
  const url = [
    process.env.SUPABASE_URL,
    process.env.STORAGE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_STORAGE_URL,
  ].find(Boolean);

  const key = [
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_ANON_KEY,
    process.env.SUPABASE_PUBLISHABLE_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    process.env.STORAGE_ANON_KEY,
    process.env.STORAGE_PUBLISHABLE_KEY,
    process.env.NEXT_PUBLIC_STORAGE_ANON_KEY,
    process.env.NEXT_PUBLIC_STORAGE_PUBLISHABLE_KEY,
  ].find(Boolean);

  if (!url || !key) return null;
  return { url: String(url).replace(/\/+$/, ""), key };
}

async function supabaseRequest(config, path, init = {}) {
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Supabase error ${response.status}${text ? `: ${text}` : ""}`);
  }

  return response;
}

async function getSupabaseRows(config) {
  const response = await supabaseRequest(
    config,
    "ritual_leaderboard?select=*&order=xp.desc,dailyClaims.desc,streak.desc,updatedAt.desc&limit=100",
    { method: "GET" },
  );
  const rows = await response.json();
  return Array.isArray(rows) ? rows.map((row, index) => ({ rank: index + 1, ...row })) : [];
}

async function getSupabaseRowByAddress(config, address) {
  const response = await supabaseRequest(
    config,
    `ritual_leaderboard?select=*&address=eq.${encodeURIComponent(address)}&limit=1`,
    { method: "GET" },
  );
  const rows = await response.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : {};
}

async function upsertSupabaseRow(config, row) {
  await supabaseRequest(config, "ritual_leaderboard?on_conflict=address", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify([row]),
  });
}

module.exports = async function handler(request, response) {
  if (request.method === "OPTIONS") return sendJson(response, 200, { ok: true });
  const supabase = supabaseConfig();
  const board = !supabase ? await readBoard() : null;

  if (request.method === "GET") {
    try {
      if (supabase) {
        return sendJson(response, 200, {
          rows: await getSupabaseRows(supabase),
          updatedAt: new Date().toISOString(),
          storage: "supabase",
        });
      }
      return sendJson(response, 200, {
        rows: rankedRows(board),
        updatedAt: new Date().toISOString(),
        storage: "memory",
      });
    } catch (error) {
      return sendJson(response, 500, { error: error.message || "Could not load leaderboard rows" });
    }
  }

  if (request.method !== "POST") {
    return sendJson(response, 405, { error: "Method not allowed" });
  }

  try {
    const body = await parseBody(request);
    const address = String(body.address || "").toLowerCase();
    if (!validAddress(address)) return sendJson(response, 400, { error: "Valid wallet address is required" });

    const taskId = String(body.task?.id || "");
    const nowIso = new Date().toISOString();
    const existing = supabase ? await getSupabaseRowByAddress(supabase, address) : (board.get(address) || {});

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

    if (supabase) {
      await upsertSupabaseRow(supabase, next);
    } else {
      board.set(address, next);
      await writeBoard(board);
    }

    const rows = supabase ? await getSupabaseRows(supabase) : rankedRows(board);

    return sendJson(response, 200, {
      ok: true,
      row: next,
      rows,
      updatedAt: nowIso,
      storage: supabase ? "supabase" : "memory",
    });
  } catch (error) {
    return sendJson(response, 400, { error: error.message || "Leaderboard update failed" });
  }
};
