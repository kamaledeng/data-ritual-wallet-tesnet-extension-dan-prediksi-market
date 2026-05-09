const COINS = [
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
  { id: "ethereum", symbol: "ETH", name: "Ethereum" },
  { id: "solana", symbol: "SOL", name: "Solana" },
  { id: "binancecoin", symbol: "BNB", name: "BNB" },
  { id: "ripple", symbol: "XRP", name: "XRP" },
  { id: "dogecoin", symbol: "DOGE", name: "Dogecoin" },
];

const HISTORY_KEY = "ritual_prediction_history_v1";
const $ = (id) => document.getElementById(id);

let account = null;
let markets = [];
let selectedMarket = null;
let selectedChoice = "YES";

function setStatus(message, isError = false) {
  $("statusText").textContent = message;
  $("statusText").classList.toggle("negative", isError);
}

function formatUsd(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: value > 10 ? 2 : 6 }).format(value);
}

function formatChange(value) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveHistory(item) {
  const next = [item, ...getHistory()].slice(0, 20);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  renderHistory();
}

function renderHistory() {
  const history = getHistory();
  if (!history.length) {
    $("historyList").innerHTML = '<p class="muted">No signed predictions yet.</p>';
    return;
  }

  $("historyList").innerHTML = history.map((item) => `
    <article class="historyItem">
      <div>
        <strong>${item.symbol} ${item.choice} - ${item.window}</strong>
        <span class="${item.change24h >= 0 ? "positive" : "negative"}">${formatUsd(item.price)} | ${formatChange(item.change24h)}</span>
      </div>
      <code>${item.signature.slice(0, 18)}...${item.signature.slice(-12)}</code>
    </article>
  `).join("");
}

function updateWalletStatus() {
  if (!account) {
    $("walletStatus").textContent = "Not connected";
    $("connectButton").textContent = "Connect Wallet";
    return;
  }
  $("walletStatus").textContent = `${account.slice(0, 6)}...${account.slice(-4)}`;
  $("connectButton").textContent = `${account.slice(0, 6)}...${account.slice(-4)}`;
}

function chooseMarket(market) {
  selectedMarket = market;
  $("selectedMarketText").textContent = `${market.symbol}: ${formatUsd(market.current_price)} - predict direction`;
  renderMarkets();
  $("tickerCoin").textContent = market.symbol;
  $("tickerPrice").textContent = formatUsd(market.current_price);
  $("tickerChange").textContent = formatChange(market.price_change_percentage_24h || 0);
  $("tickerChange").className = (market.price_change_percentage_24h || 0) >= 0 ? "positive" : "negative";
}

function renderMarkets() {
  if (!markets.length) {
    $("marketGrid").innerHTML = '<p class="muted">No market data loaded.</p>';
    return;
  }

  $("marketGrid").innerHTML = markets.map((market) => {
    const change = market.price_change_percentage_24h || 0;
    const isSelected = selectedMarket?.id === market.id;
    return `
      <button class="marketCard ${isSelected ? "selected" : ""}" type="button" data-market="${market.id}">
        <div class="coinMeta">
          <div>
            <strong>${market.symbol.toUpperCase()}</strong>
            <p class="muted">${market.name}</p>
          </div>
          <img src="${market.image}" alt="" />
        </div>
        <div class="coinPrice">${formatUsd(market.current_price)}</div>
        <span class="${change >= 0 ? "positive" : "negative"}">${formatChange(change)} 24h</span>
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
  setStatus("Refreshing market data...");
  const ids = COINS.map((coin) => coin.id).join(",");
  const url = new URL("https://api.coingecko.com/api/v3/coins/markets");
  url.searchParams.set("vs_currency", "usd");
  url.searchParams.set("ids", ids);
  url.searchParams.set("order", "market_cap_desc");
  url.searchParams.set("per_page", "20");
  url.searchParams.set("page", "1");
  url.searchParams.set("sparkline", "false");
  url.searchParams.set("price_change_percentage", "24h");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`CoinGecko error ${response.status}`);
  markets = await response.json();
  if (!selectedMarket && markets[0]) chooseMarket(markets[0]);
  if (selectedMarket) {
    const refreshed = markets.find((market) => market.id === selectedMarket.id);
    if (refreshed) chooseMarket(refreshed);
  }
  renderMarkets();
  setStatus("Market data refreshed. Updates every 60 seconds.");
}

async function connectWallet() {
  if (!window.ethereum) {
    setStatus("Ritual wallet extension was not found in this browser.", true);
    return;
  }

  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  account = accounts[0] || null;
  updateWalletStatus();
  setStatus(account ? "Wallet connected." : "No account returned.", !account);
}

function buildOrder() {
  if (!selectedMarket) throw new Error("Choose a market first.");
  if (!account) throw new Error("Connect wallet first.");
  const amount = $("amountInput").value;
  if (!amount || Number(amount) <= 0) throw new Error("Enter a valid amount.");

  return {
    app: "Ritual Prediction Arena",
    type: "prediction_order",
    chainId: "0x7bb",
    account,
    market: {
      id: selectedMarket.id,
      symbol: selectedMarket.symbol.toUpperCase(),
      priceUsd: selectedMarket.current_price,
      change24h: selectedMarket.price_change_percentage_24h || 0,
    },
    choice: selectedChoice,
    amount,
    window: $("windowSelect").value,
    createdAt: new Date().toISOString(),
    dataSource: "CoinGecko",
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

$("connectButton").addEventListener("click", () => connectWallet().catch((error) => setStatus(error.message, true)));
$("refreshButton").addEventListener("click", () => loadMarkets().catch((error) => setStatus(error.message, true)));
$("signButton").addEventListener("click", signPrediction);
$("clearHistoryButton").addEventListener("click", () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
});

if (window.ethereum?.request) {
  window.ethereum.request({ method: "eth_accounts" }).then((accounts) => {
    account = accounts[0] || null;
    updateWalletStatus();
  }).catch(() => {});
}

loadMarkets().catch((error) => setStatus(error.message, true));
renderHistory();
updateWalletStatus();
setInterval(() => loadMarkets().catch((error) => setStatus(error.message, true)), 60000);
