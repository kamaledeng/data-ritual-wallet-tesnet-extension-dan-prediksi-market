const COIN_SETS = {
  top: null,
  defi: "decentralized-finance-defi",
  ai: "artificial-intelligence",
  meme: "meme-token",
  layer1: "layer-1",
};

const HISTORY_KEY = "ritual_prediction_history_v1";
const DISCONNECT_KEY = "ritual_prediction_disconnected_v1";
const THEME_KEY = "ritual_prediction_theme_v1";
const $ = (id) => document.getElementById(id);

let account = null;
let chainId = null;
let markets = [];
let selectedMarket = null;
let selectedChoice = "YES";
let profileRequestId = 0;

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

function updateWalletStatus() {
  const connected = Boolean(account);
  const networkText = chainLabel(chainId);
  $("walletBox").classList.toggle("connected", connected);
  $("walletStatus").textContent = connected ? shortAddress(account) : "Not connected";
  $("walletButtonText").textContent = connected ? shortAddress(account) : "Connect Wallet";
  $("walletButtonMeta").textContent = connected ? networkText : "Ritual testnet";
  $("walletAddressText").textContent = connected ? account : "Not connected";
  $("chainText").textContent = networkText;
  $("networkBadgeText").textContent = networkText;
  $("portfolioWallet").textContent = connected ? shortAddress(account) : "Not connected";
  $("profileAddressText").textContent = connected ? account : "Connect wallet first";
  $("profileNetworkText").textContent = connected ? networkText : "Ritual Testnet";
  $("profileConnectButton").textContent = connected ? shortAddress(account) : "Connect Wallet";
  $("walletMenu").classList.add("hidden");
  if (!connected) {
    $("profileBalanceText").textContent = "-";
    $("profileTxText").textContent = "-";
    $("profileScoreText").textContent = "-";
    $("profilePageBalanceText").textContent = "-";
    $("profilePageTxText").textContent = "-";
    $("profilePageScoreText").textContent = "-";
    $("profilePageSignedText").textContent = getHistory().length.toString();
    $("profileHint").textContent = "Connect wallet to load Ritual testnet stats.";
    $("profilePageHint").textContent = "Connect wallet to load profile stats from Ritual RPC.";
  }
}

async function refreshWalletProfile() {
  if (!account || !window.ethereum?.request) return;
  const requestId = ++profileRequestId;
  $("profileBalanceText").textContent = "...";
  $("profileTxText").textContent = "...";
  $("profileScoreText").textContent = "...";
  $("profilePageBalanceText").textContent = "...";
  $("profilePageTxText").textContent = "...";
  $("profilePageScoreText").textContent = "...";
  $("profileHint").textContent = "Loading Ritual RPC profile...";
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
    $("profileBalanceText").textContent = balanceText;
    $("profileTxText").textContent = txText;
    $("profileScoreText").textContent = scoreText;
    $("profilePageBalanceText").textContent = balanceText;
    $("profilePageTxText").textContent = txText;
    $("profilePageScoreText").textContent = scoreText;
    $("profilePageSignedText").textContent = signedCount.toLocaleString();
    $("profileHint").textContent = hintText;
    $("profilePageHint").textContent = hintText;
  } catch (error) {
    if (requestId !== profileRequestId) return;
    $("profileBalanceText").textContent = "-";
    $("profileTxText").textContent = "-";
    $("profileScoreText").textContent = "-";
    $("profilePageBalanceText").textContent = "-";
    $("profilePageTxText").textContent = "-";
    $("profilePageScoreText").textContent = "-";
    $("profilePageSignedText").textContent = getHistory().length.toString();
    $("profileHint").textContent = error.message || "Could not load Ritual RPC profile.";
    $("profilePageHint").textContent = error.message || "Could not load Ritual RPC profile.";
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
  updateWalletStatus();
  await refreshWalletProfile();
  setStatus(account ? "Wallet connected." : "No account returned.", !account);
}

function disconnectWallet() {
  account = null;
  chainId = null;
  localStorage.setItem(DISCONNECT_KEY, "1");
  updateWalletStatus();
  setStatus("Wallet disconnected on this dApp. Clear connected sites in the extension to revoke permission.");
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
  try {
    if (!window.ethereum) throw new Error("Ritual wallet extension was not found.");
    if (!account) await connectWallet();
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
  } catch (error) {
    setStatus(error.message || "Failed to sign prediction.", true);
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
    $("walletMenu").classList.toggle("hidden");
    if (!$("walletMenu").classList.contains("hidden")) refreshWalletProfile();
    return;
  }
  await connectWallet().catch((error) => setStatus(error.message, true));
});
$("profileConnectButton").addEventListener("click", async () => {
  if (account) {
    $("walletMenu").classList.remove("hidden");
    refreshWalletProfile();
    return;
  }
  await connectWallet().catch((error) => setStatus(error.message, true));
});
$("disconnectButton").addEventListener("click", disconnectWallet);
$("refreshProfileButton").addEventListener("click", refreshWalletProfile);
$("profileRefreshButton").addEventListener("click", refreshWalletProfile);
$("themeButton").addEventListener("click", toggleTheme);
$("refreshButton").addEventListener("click", () => loadMarkets().catch((error) => {
  $("marketStatus").textContent = error.message;
  setStatus(error.message, true);
}));
$("searchInput").addEventListener("input", renderMarkets);
$("coinSet").addEventListener("change", () => loadMarkets().catch((error) => setStatus(error.message, true)));
$("signButton").addEventListener("click", signPrediction);
$("clearHistoryButton").addEventListener("click", () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
});
document.addEventListener("click", (event) => {
  if (!$("walletBox").contains(event.target)) $("walletMenu").classList.add("hidden");
});

if (window.ethereum?.request && localStorage.getItem(DISCONNECT_KEY) !== "1") {
  window.ethereum.request({ method: "eth_accounts" }).then(async (accounts) => {
    account = accounts[0] || null;
    if (account) chainId = await window.ethereum.request({ method: "eth_chainId" }).catch(() => null);
    updateWalletStatus();
    if (account) refreshWalletProfile();
  }).catch(() => {});
}

loadMarkets().catch((error) => {
  $("marketStatus").textContent = error.message;
  setStatus(error.message, true);
});
renderHistory();
applyTheme(localStorage.getItem(THEME_KEY) || "dark");
updateWalletStatus();
setInterval(() => loadMarkets().catch((error) => setStatus(error.message, true)), 60000);
