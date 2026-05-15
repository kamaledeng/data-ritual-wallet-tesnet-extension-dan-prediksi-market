const COIN_SETS = {
  top: null,
  defi: "decentralized-finance-defi",
  ai: "artificial-intelligence",
  meme: "meme-token",
  layer1: "layer-1",
};

const HISTORY_KEY = "ritual_prediction_history_v1";
const DISCONNECT_KEY = "ritual_prediction_disconnected_v1";
const SESSION_LAST_ACTIVE_KEY = "ritual_prediction_last_active_at_v1";
const THEME_KEY = "ritual_prediction_theme_v1";
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const IDLE_CHECK_MS = 15000;
const $ = (id) => document.getElementById(id);

let account = null;
let chainId = null;
let markets = [];
let selectedMarket = null;
let selectedChoice = "YES";
let profileRequestId = 0;
let chartRequestId = 0;
let lastActivityPersistedAt = 0;
let profileSyncedAt = null;
let signingInProgress = false;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

function shortAddress(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function setStatus(message, isError = false) {
  $("statusText").textContent = message;
  $("statusText").classList.toggle("negative", isError);
}

function formatLastSyncText(timestamp) {
  if (!timestamp) return "Sync pending.";
  const deltaSeconds = Math.max(1, Math.round((Date.now() - timestamp) / 1000));
  if (deltaSeconds < 60) return `Synced ${deltaSeconds}s ago.`;
  const minutes = Math.round(deltaSeconds / 60);
  if (minutes < 60) return `Synced ${minutes}m ago.`;
  const hours = Math.round(minutes / 60);
  return `Synced ${hours}h ago.`;
}

function renderSyncMeta() {
  $("profileSyncText").textContent = formatLastSyncText(profileSyncedAt);
}

function setSignResult(message, tone = "pending") {
  const target = $("signResultText");
  if (!message) {
    target.textContent = "";
    target.className = "signResultText hidden";
    return;
  }
  target.textContent = message;
  target.className = `signResultText ${tone}`;
}

function validatePredictionForm() {
  const amount = Number($("amountInput").value);
  const valid = Number.isFinite(amount) && amount >= 0.01;
  $("amountErrorText").classList.toggle("hidden", valid);
  $("signButton").disabled = !valid || signingInProgress;
  return valid;
}

function applyTheme(theme) {
  const nextTheme = theme === "light" ? "light" : "dark";
  document.body.classList.toggle("lightTheme", nextTheme === "light");
  $("themeButtonText").textContent = nextTheme === "light" ? "Light" : "Dark";
  localStorage.setItem(THEME_KEY, nextTheme);
}

function toggleTheme() {
  applyTheme(document.body.classList.contains("lightTheme") ? "dark" : "light");
}

function formatUsd(value) {
  if (value == null) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value > 10 ? 2 : 6,
  }).format(value);
}

function formatCompact(value) {
  if (value == null) return "-";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatRitualBalance(hexValue) {
  if (!hexValue) return "0 RITUAL";
  const wei = BigInt(hexValue);
  const whole = wei / 10n ** 18n;
  const fraction = wei % (10n ** 18n);
  const fractionText = fraction.toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
  return `${whole.toLocaleString()}${fractionText ? `.${fractionText}` : ""} RITUAL`;
}

function scoreFromProfile(balanceHex, txCount, signedCount) {
  const wholeBalance = balanceHex ? Number(BigInt(balanceHex) / 10n ** 18n) : 0;
  const balancePoints = Math.min(500, Math.floor(wholeBalance * 8));
  const txPoints = Math.min(3000, Number(txCount || 0) * 35);
  const signedPoints = Math.min(1500, Number(signedCount || 0) * 50);
  return balancePoints + txPoints + signedPoints;
}

function chainLabel(value) {
  if (!value) return "Ritual Testnet";
  const numeric = Number(BigInt(value));
  return numeric === 1979 ? "Ritual Testnet" : `Chain ${numeric}`;
}

function formatChange(value) {
  const safeValue = Number(value || 0);
  const sign = safeValue >= 0 ? "+" : "";
  return `${sign}${safeValue.toFixed(2)}%`;
}

function syntheticYes(change) {
  const value = Math.round(50 + Math.max(-25, Math.min(25, Number(change || 0))) * 1.4);
  return Math.max(5, Math.min(95, value));
}

function sparklinePath(prices, width = 360, height = 150, padding = 12) {
  if (!prices.length) return { line: "", area: "", min: 0, max: 0, last: 0 };
  const values = prices.map((item) => Number(item[1])).filter(Number.isFinite);
  if (!values.length) return { line: "", area: "", min: 0, max: 0, last: 0 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((value, index) => {
    const x = padding + (index / Math.max(1, values.length - 1)) * (width - padding * 2);
    const y = height - padding - ((value - min) / range) * (height - padding * 2);
    return [x, y];
  });
  const line = points.map(([x, y], index) => `${index ? "L" : "M"} ${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const area = `${line} L ${width - padding} ${height - padding} L ${padding} ${height - padding} Z`;
  return { line, area, min, max, last: values.at(-1) ?? 0 };
}

function renderChartShell(message = "Loading live chart...") {
  $("chartCanvas").innerHTML = `<span class="muted">${escapeHtml(message)}</span>`;
}

function renderMarketChart(market, prices) {
  const width = 360;
  const height = 150;
  const chart = sparklinePath(prices, width, height);
  const positive = (market.price_change_percentage_24h || 0) >= 0;
  const tone = positive ? "positiveLine" : "negativeLine";
  $("chartCanvas").innerHTML = `
    <svg class="marketChartSvg ${tone}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(market.symbol.toUpperCase())} 24 hour price chart">
      <defs>
        <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="currentColor" stop-opacity="0.28" />
          <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path class="chartGridLine" d="M 12 38 H 348 M 12 75 H 348 M 12 112 H 348" />
      <path class="chartArea" d="${chart.area}" />
      <path class="chartLine" d="${chart.line}" />
      <circle class="chartDot" cx="348" cy="${(height - 12 - ((chart.last - chart.min) / ((chart.max - chart.min) || 1)) * (height - 24)).toFixed(2)}" r="4" />
    </svg>
  `;
  $("chartTitle").textContent = `${market.symbol.toUpperCase()} 24h market`;
  $("chartHighText").textContent = formatUsd(Math.max(chart.max, market.high_24h || 0));
  $("chartLowText").textContent = formatUsd(Math.min(chart.min, market.low_24h || chart.min));
  $("chartVolumeText").textContent = formatCompact(market.total_volume);
  $("chartSourceLink").href = `https://www.coingecko.com/en/coins/${encodeURIComponent(market.id)}`;
  $("chartStatus").textContent = `Live source: CoinGecko | Updated ${new Date().toLocaleTimeString()}`;
}

async function loadMarketChart(market) {
  const requestId = ++chartRequestId;
  $("chartTitle").textContent = `${market.symbol.toUpperCase()} live market`;
  $("chartStatus").textContent = "Loading CoinGecko 24h chart...";
  renderChartShell("Syncing 24h price action...");

  try {
    const url = new URL(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(market.id)}/market_chart`);
    url.searchParams.set("vs_currency", "usd");
    url.searchParams.set("days", "1");
    const response = await fetch(url);
    if (!response.ok) throw new Error(`CoinGecko chart error ${response.status}`);
    const payload = await response.json();
    if (requestId !== chartRequestId || selectedMarket?.id !== market.id) return;
    renderMarketChart(market, payload.prices || []);
  } catch (error) {
    if (requestId !== chartRequestId) return;
    renderChartShell("Chart temporarily unavailable. Try Refresh.");
    $("chartStatus").textContent = error.message || "Could not load chart.";
    $("chartHighText").textContent = formatUsd(market.high_24h);
    $("chartLowText").textContent = formatUsd(market.low_24h);
    $("chartVolumeText").textContent = formatCompact(market.total_volume);
  }
}

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveHistory(item) {
  const next = [item, ...getHistory()].slice(0, 30);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  renderHistory();
}

function renderHistory() {
  const history = getHistory();
  renderPortfolioStats(history);
  if (!history.length) {
    $("historyList").innerHTML = '<p class="muted">No signed predictions yet.</p>';
    return;
  }

  $("historyList").innerHTML = history.map((item) => `
    <article class="historyItem">
      <div>
        <strong>${escapeHtml(item.symbol)} ${escapeHtml(item.choice)} - ${escapeHtml(item.window)}</strong>
        <span class="${item.change24h >= 0 ? "positive" : "negative"}">
          ${formatUsd(item.price)} | ${formatChange(item.change24h)} | ${escapeHtml(item.amount)} RITUAL
        </span>
      </div>
      <code>${escapeHtml(item.signature.slice(0, 18))}...${escapeHtml(item.signature.slice(-12))}</code>
    </article>
  `).join("");
}

function renderPortfolioStats(history = getHistory()) {
  const totalAmount = history.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const yesCount = history.filter((item) => item.choice === "YES").length;
  const noCount = history.filter((item) => item.choice === "NO").length;
  $("statTotalPredictions").textContent = history.length.toString();
  $("statSignedVolume").textContent = totalAmount ? `${totalAmount.toFixed(2)} RITUAL` : "0";
  $("statFavoriteSide").textContent = yesCount || noCount ? (yesCount >= noCount ? "YES" : "NO") : "-";
  $("profilePageSignedText").textContent = history.length.toString();
}

function timeAgo(value) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "-";
  const seconds = Math.max(1, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function updateWalletStatus() {
  const connected = Boolean(account);
  const networkText = chainLabel(chainId);
  $("walletBox").classList.toggle("connected", connected);
  $("walletStatus").textContent = connected ? shortAddress(account) : "Not connected";
  $("walletButtonText").textContent = connected ? shortAddress(account) : "Connect Wallet";
  $("networkBadgeText").textContent = networkText;
  $("portfolioWallet").textContent = connected ? shortAddress(account) : "Not connected";
  $("profileAddressText").textContent = connected ? account : "Connect wallet first";
  $("profileNetworkText").textContent = connected ? networkText : "Ritual Testnet";
  $("modalAddressText").textContent = connected ? shortAddress(account) : "0x000...0000";
  if (!connected) {
    $("accountModal").classList.add("hidden");
    $("modalBalanceText").textContent = "-";
    $("profilePageBalanceText").textContent = "-";
    $("profilePageTxText").textContent = "-";
    $("profilePageScoreText").textContent = "-";
    $("profilePageSignedText").textContent = getHistory().length.toString();
    $("profilePageHint").textContent = "Connect wallet to load profile stats from Ritual RPC.";
  }
}

async function refreshWalletProfile() {
  if (!account || !window.ethereum?.request) return;
  const requestId = ++profileRequestId;
  $("profilePageBalanceText").textContent = "...";
  $("profilePageTxText").textContent = "...";
  $("profilePageScoreText").textContent = "...";
  $("profilePageHint").textContent = "Loading Ritual RPC profile...";

  try {
    const [balanceHex, txCountHex] = await Promise.all([
      window.ethereum.request({ method: "eth_getBalance", params: [account, "latest"] }),
      window.ethereum.request({ method: "eth_getTransactionCount", params: [account, "latest"] }),
    ]);
    if (requestId !== profileRequestId) return;

    const txCount = Number(BigInt(txCountHex || "0x0"));
    const signedCount = getHistory().length;
    const balanceText = formatRitualBalance(balanceHex);
    const txText = txCount.toLocaleString();
    const scoreText = scoreFromProfile(balanceHex, txCount, signedCount).toLocaleString();
    const hintText = `Real Ritual RPC stats. Score also includes ${signedCount} local signed prediction${signedCount === 1 ? "" : "s"}.`;
    $("profilePageBalanceText").textContent = balanceText;
    $("modalBalanceText").textContent = balanceText;
    $("profilePageTxText").textContent = txText;
    $("profilePageScoreText").textContent = scoreText;
    $("profilePageSignedText").textContent = signedCount.toLocaleString();
    $("profilePageHint").textContent = hintText;
    profileSyncedAt = Date.now();
    renderSyncMeta();
  } catch (error) {
    if (requestId !== profileRequestId) return;
    $("profilePageBalanceText").textContent = "-";
    $("profilePageTxText").textContent = "-";
    $("profilePageScoreText").textContent = "-";
    $("profilePageSignedText").textContent = getHistory().length.toString();
    $("profilePageHint").textContent = error.message || "Could not load Ritual RPC profile.";
    renderSyncMeta();
  }
}

function filteredMarkets() {
  const query = $("searchInput").value.trim().toLowerCase();
  if (!query) return markets;
  return markets.filter((coin) => (
    coin.name.toLowerCase().includes(query) ||
    coin.symbol.toLowerCase().includes(query)
  ));
}

function updateTicker(market) {
  const yes = syntheticYes(market.price_change_percentage_24h);
  $("tickerCoin").textContent = market.symbol.toUpperCase();
  $("tickerPrice").textContent = formatUsd(market.current_price);
  $("tickerChange").textContent = formatChange(market.price_change_percentage_24h);
  $("tickerChange").className = market.price_change_percentage_24h >= 0 ? "positive" : "negative";
  $("tickerOdds").style.width = `${yes}%`;
  $("tickerOddsText").textContent = `YES ${yes} / NO ${100 - yes}`;
}

function chooseMarket(market) {
  selectedMarket = market;
  const yes = syntheticYes(market.price_change_percentage_24h);
  $("selectedMarketText").textContent = `${market.symbol.toUpperCase()}: ${formatUsd(market.current_price)}`;
  $("selectedMarketMeta").textContent = `${formatChange(market.price_change_percentage_24h)} 24h | YES ${yes} / NO ${100 - yes} | Vol ${formatCompact(market.total_volume)}`;
  updateTicker(market);
  loadMarketChart(market);
  renderMarkets();
}

function renderMarkets() {
  const coins = filteredMarkets();
  $("marketCount").textContent = `${coins.length} markets`;

  if (!coins.length) {
    $("marketGrid").innerHTML = '<p class="muted">No coins found.</p>';
    return;
  }

  $("marketGrid").innerHTML = coins.map((market) => {
    const change = market.price_change_percentage_24h || 0;
    const yes = syntheticYes(change);
    const isSelected = selectedMarket?.id === market.id;
    const symbol = escapeHtml(market.symbol.toUpperCase());
    const name = escapeHtml(market.name);
    const image = escapeHtml(market.image);
    return `
      <button class="marketCard ${isSelected ? "selected" : ""}" type="button" data-market="${escapeHtml(market.id)}">
        <div class="coinMeta">
          <div>
            <strong>${symbol}</strong>
            <p class="muted">${name}</p>
          </div>
          <img src="${image}" alt="" />
        </div>
        <div class="coinPrice">${formatUsd(market.current_price)}</div>
        <span class="${change >= 0 ? "positive" : "negative"}">${formatChange(change)} 24h</span>
        <div class="oddsBar" aria-hidden="true"><span style="width:${yes}%"></span></div>
        <small>YES ${yes} / NO ${100 - yes} | Vol ${formatCompact(market.total_volume)}</small>
      </button>
    `;
  }).join("");

  document.querySelectorAll("[data-market]").forEach((button) => {
    button.addEventListener("click", () => {
      const market = markets.find((item) => item.id === button.dataset.market);
      if (market) chooseMarket(market);
    });
  });
}

async function loadMarkets() {
  $("marketStatus").textContent = "Updating live prices...";
  setStatus("Refreshing market data...");
  const category = COIN_SETS[$("coinSet").value];
  const url = new URL("https://api.coingecko.com/api/v3/coins/markets");
  url.searchParams.set("vs_currency", "usd");
  url.searchParams.set("order", "market_cap_desc");
  url.searchParams.set("per_page", "50");
  url.searchParams.set("page", "1");
  url.searchParams.set("sparkline", "false");
  url.searchParams.set("price_change_percentage", "24h");
  if (category) url.searchParams.set("category", category);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`CoinGecko error ${response.status}`);
  markets = await response.json();

  if (!selectedMarket || !markets.some((market) => market.id === selectedMarket.id)) {
    selectedMarket = markets[0] ?? null;
  } else {
    selectedMarket = markets.find((market) => market.id === selectedMarket.id);
  }

  if (selectedMarket) chooseMarket(selectedMarket);
  renderMarkets();
  $("marketStatus").textContent = `Live: ${new Date().toLocaleTimeString()}`;
  setStatus("Market data refreshed. Updates every 60 seconds.");
}

async function connectWallet() {
  if (!window.ethereum) {
    setStatus("Ritual wallet extension was not found in this browser.", true);
    return;
  }

  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  account = accounts[0] || null;
  chainId = await window.ethereum.request({ method: "eth_chainId" }).catch(() => null);
  localStorage.removeItem(DISCONNECT_KEY);
  rememberSessionActivity(true);
  updateWalletStatus();
  await refreshWalletProfile();
  setStatus(account ? "Wallet connected." : "No account returned.", !account);
}

function disconnectWallet(reason = "manual") {
  account = null;
  chainId = null;
  localStorage.setItem(DISCONNECT_KEY, "1");
  updateWalletStatus();
  renderPortfolioStats();
  setStatus(
    reason === "idle"
      ? "Wallet auto-disconnected after inactivity."
      : "Wallet disconnected on this dApp. Clear connected sites in the extension to revoke permission.",
  );
}

async function handleAccountsChanged(nextAccounts = []) {
  const nextAccount = nextAccounts[0] || null;
  account = nextAccount;
  if (!account) {
    chainId = null;
    updateWalletStatus();
    renderPortfolioStats();
    setStatus("Wallet account disconnected.");
    return;
  }

  localStorage.removeItem(DISCONNECT_KEY);
  rememberSessionActivity(true);
  chainId = await window.ethereum?.request?.({ method: "eth_chainId" }).catch(() => chainId);
  updateWalletStatus();
  await refreshWalletProfile();
  setStatus(`Active wallet switched to ${shortAddress(account)}.`);
}

async function handleChainChanged(nextChainId) {
  chainId = nextChainId || chainId;
  updateWalletStatus();
  await refreshWalletProfile();
}

function setupWalletEventBridge() {
  if (!window.ethereum?.on) return;
  window.ethereum.on("accountsChanged", (nextAccounts) => {
    handleAccountsChanged(nextAccounts).catch((error) => setStatus(error.message, true));
  });
  window.ethereum.on("chainChanged", (nextChainId) => {
    handleChainChanged(nextChainId).catch((error) => setStatus(error.message, true));
  });
}

function rememberSessionActivity(force = false) {
  if (!account) return;
  const now = Date.now();
  if (!force && now - lastActivityPersistedAt < 5000) return;
  lastActivityPersistedAt = now;
  localStorage.setItem(SESSION_LAST_ACTIVE_KEY, String(now));
}

function hasSessionExpired() {
  const stored = Number(localStorage.getItem(SESSION_LAST_ACTIVE_KEY) || "0");
  if (!stored) return false;
  return Date.now() - stored > IDLE_TIMEOUT_MS;
}

function setupIdleDisconnect() {
  const activityEvents = ["pointerdown", "keydown", "scroll", "touchstart"];
  for (const eventName of activityEvents) {
    document.addEventListener(eventName, () => rememberSessionActivity(), { passive: true });
  }
  window.addEventListener("focus", () => rememberSessionActivity());
  setInterval(() => {
    if (!account) return;
    if (hasSessionExpired()) disconnectWallet("idle");
  }, IDLE_CHECK_MS);
}

async function restoreWalletSession() {
  if (!window.ethereum?.request) return;
  if (localStorage.getItem(DISCONNECT_KEY) === "1") return;
  if (hasSessionExpired()) {
    localStorage.setItem(DISCONNECT_KEY, "1");
    setStatus("Previous wallet session expired due to inactivity.");
    return;
  }
  try {
    const accounts = await window.ethereum.request({ method: "eth_accounts" });
    account = accounts[0] || null;
    if (!account) return;
    chainId = await window.ethereum.request({ method: "eth_chainId" }).catch(() => null);
    rememberSessionActivity(true);
    updateWalletStatus();
    await refreshWalletProfile();
    setStatus("Wallet session restored.");
  } catch (error) {
    setStatus(error.message || "Could not restore wallet session.", true);
  }
}

function openAccountModal() {
  if (!account) return;
  $("accountModal").classList.remove("hidden");
}

function closeAccountModal() {
  $("accountModal").classList.add("hidden");
}

function openNetworkModal() {
  $("networkModal").classList.remove("hidden");
}

function closeNetworkModal() {
  $("networkModal").classList.add("hidden");
}

function closeAllModals() {
  closeAccountModal();
  closeNetworkModal();
}

async function copyAddress() {
  if (!account) return;
  await navigator.clipboard.writeText(account);
  setStatus("Wallet address copied.");
}

function buildOrder() {
  if (!selectedMarket) throw new Error("Choose a market first.");
  if (!account) throw new Error("Connect wallet first.");
  const amount = $("amountInput").value;
  if (!amount || Number(amount) <= 0) throw new Error("Enter a valid amount.");

  return {
    app: "Ritual Prediction Arena",
    type: "prediction_order",
    chainId: chainId || "0x7bb",
    account,
    market: {
      id: selectedMarket.id,
      symbol: selectedMarket.symbol.toUpperCase(),
      priceUsd: selectedMarket.current_price,
      change24h: selectedMarket.price_change_percentage_24h || 0,
      yesOdds: syntheticYes(selectedMarket.price_change_percentage_24h),
    },
    choice: selectedChoice,
    amount,
    window: $("windowSelect").value,
    createdAt: new Date().toISOString(),
    dataSource: "CoinGecko",
    nonce: Date.now(),
  };
}

async function signPrediction() {
  if (!validatePredictionForm()) {
    setStatus("Amount must be at least 0.01 RITUAL.", true);
    return;
  }
  signingInProgress = true;
  $("signButton").disabled = true;
  try {
    if (!window.ethereum) throw new Error("Ritual wallet extension was not found.");
    if (!account) await connectWallet();
    setSignResult("Waiting for wallet signature approval...", "pending");
    const order = buildOrder();
    const message = JSON.stringify(order, null, 2);
    const signature = await window.ethereum.request({
      method: "personal_sign",
      params: [message, account],
    });

    saveHistory({
      ...order.market,
      choice: order.choice,
      amount: order.amount,
      window: order.window,
      signature,
      createdAt: order.createdAt,
    });
    setStatus("Prediction signed and saved locally.");
    setSignResult("Order signed successfully. Local history has been updated.", "success");
  } catch (error) {
    setStatus(error.message || "Failed to sign prediction.", true);
    setSignResult(error.message || "Signature request failed.", "error");
  } finally {
    signingInProgress = false;
    validatePredictionForm();
  }
}

document.querySelectorAll(".choiceButton").forEach((button) => {
  button.addEventListener("click", () => {
    selectedChoice = button.dataset.choice;
    document.querySelectorAll(".choiceButton").forEach((item) => item.classList.remove("selected"));
    button.classList.add("selected");
  });
});

document.querySelectorAll(".arenaTab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".arenaTab").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".arenaView").forEach((item) => item.classList.add("hidden"));
    button.classList.add("active");
    $(button.dataset.arenaTab).classList.remove("hidden");
    renderPortfolioStats();
  });
});

$("connectButton").addEventListener("click", async () => {
  if (account) {
    openAccountModal();
    return;
  }
  await connectWallet().catch((error) => setStatus(error.message, true));
});
$("closeAccountModal").addEventListener("click", closeAccountModal);
$("modalDisconnectButton").addEventListener("click", disconnectWallet);
$("copyAddressButton").addEventListener("click", () => copyAddress().catch((error) => setStatus(error.message, true)));
$("accountModal").addEventListener("click", (event) => {
  if (event.target === $("accountModal")) closeAccountModal();
});
$("networkBadge").addEventListener("click", openNetworkModal);
$("closeNetworkModal").addEventListener("click", closeNetworkModal);
$("ritualNetworkOption").addEventListener("click", closeNetworkModal);
$("networkModal").addEventListener("click", (event) => {
  if (event.target === $("networkModal")) closeNetworkModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeAllModals();
});
$("profileRefreshButton").addEventListener("click", refreshWalletProfile);
$("themeButton").addEventListener("click", toggleTheme);
$("refreshButton").addEventListener("click", () => loadMarkets().catch((error) => {
  $("marketStatus").textContent = error.message;
  setStatus(error.message, true);
}));
$("searchInput").addEventListener("input", renderMarkets);
$("coinSet").addEventListener("change", () => loadMarkets().catch((error) => setStatus(error.message, true)));
$("signButton").addEventListener("click", signPrediction);
$("amountInput").addEventListener("input", validatePredictionForm);
$("clearHistoryButton").addEventListener("click", () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
});
window.addEventListener("beforeunload", () => rememberSessionActivity(true));
loadMarkets().catch((error) => {
  $("marketStatus").textContent = error.message;
  setStatus(error.message, true);
});
renderHistory();
applyTheme(localStorage.getItem(THEME_KEY) || "dark");
updateWalletStatus();
setupWalletEventBridge();
setupIdleDisconnect();
restoreWalletSession();
renderSyncMeta();
validatePredictionForm();
setInterval(() => loadMarkets().catch((error) => setStatus(error.message, true)), 60000);
