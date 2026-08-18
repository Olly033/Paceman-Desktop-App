(() => {
  "use strict";

  const API = "https://paceman.gg/stats/api";
  const LIVERUNS = "https://paceman.gg/api/ars/liveruns";
  const MCHEADS = "https://mc-heads.net";
  const MOJANG = "https://api.mojang.com/users/profiles/minecraft";

  const SPLITS = {
    nether: "Nether",
    bastion: "Bastion",
    fortress: "Fortress",
    first_portal: "Blind Portal",
    stronghold: "Stronghold",
    end: "End",
    finish: "Completion",
  };
  const SPLIT_ORDER = ["nether", "bastion", "fortress", "first_portal", "stronghold", "end", "finish"];
  const EVENT_TO_SPLIT = {
    "enter_nether": "nether",
    "enter_bastion": "bastion",
    "enter_fortress": "fortress",
    "first_portal": "first_portal",
    "stronghold": "stronghold",
    "end": "end",
    "finish": "finish",
  };
  const LB_CATEGORIES = ["nether", "bastion", "fortress", "first_portal", "stronghold", "end", "finish"];

  const TF_HOURS = { session: 24, daily: 24, weekly: 168, monthly: 730, lifetime: 999999 };
  const TF_BETWEEN = { session: 1, daily: 24, weekly: 168, monthly: 730, lifetime: 999999 };
  const LB_DAYS = { daily: 1, weekly: 7, monthly: 30, lifetime: 9999 };

  const TWITCH_ICON =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="#a78bfa">' +
      '<path d="M4 2L3 6v13h4v3h3l3-3h4l5-5V2H4zm16 9l-3 3h-5l-3 3v-3H6V4h14v7z"/>' +
      '<path d="M15 7h2v4h-2zM10 7h2v4h-2z"/></svg>'
    );

  let headMoveHandler = null;
  let headTargetRy = 0,
    headTargetRx = 0;
  let headAnimFrameId = null;

  const THEMES = [
    { name: "amethyst", label: "Amethyst" },
    { name: "ocean", label: "Ocean" },
    { name: "emerald", label: "Emerald" },
    { name: "sunset", label: "Sunset" },
    { name: "blackout", label: "Blackout" },
    { name: "light", label: "Light" },
  ];

  const state = {
    page: "home",
    liveRuns: [],
    liveSort: "stage",
    openTwitch: new Set(),
    focusedChannel: null,
    dockLayout: "bottom",
    filters: { streamingOnly: false, maxTime: null, favoritesOnly: false },
    autoOpenTwitch: JSON.parse(localStorage.getItem("paceman_autoOpenTwitch") || "false"),
    recents: JSON.parse(localStorage.getItem("paceman_recents") || "[]"),
    playerCache: {},
    favorites: JSON.parse(localStorage.getItem("paceman_favorites") || "[]"),
    favoritePBs: JSON.parse(localStorage.getItem("paceman_favorite_pbs") || "{}"),
    profile: { name: null, uuid: null, tf: "daily", allRuns: [], timeframeRuns: [], pbRun: null, page: 1, socials: null, chartVisible: true },
    leaderboard: { tf: "weekly", rows: null, sortBy: "enters", sortDir: "desc" },
    comparison: { active: false, tf: "session", player1: null, player2: null, bothLoaded: false },
  };

  const autoOpenedStreams = new Set();

  let currentVod = { id: null, offset: 0, currentTime: 0 };
  let currentRunId = null;
  let splitDetailState = { split: null, runs: [], page: 1, perPage: 10, sortAsc: true };

  const navHistory = [];
  let navIndex = -1;
  let suppressNavPush = false;
  let liveRunsIntervalId = null;
  const MAX_LIVE_RUNS = 200;
  const MAX_PROFILE_RUNS = 1000;

  function startLiveRunsPolling() {
    if (liveRunsIntervalId) return;
    loadLiveRuns();
    liveRunsIntervalId = setInterval(() => {
      if (state.page === "home" && document.hasFocus()) {
        loadLiveRuns();
      }
    }, 5000);
  }

  function stopLiveRunsPolling() {
    if (liveRunsIntervalId) {
      clearInterval(liveRunsIntervalId);
      liveRunsIntervalId = null;
    }
  }

  function pruneRuns() {
    if (state.liveRuns.length > MAX_LIVE_RUNS) {
      state.liveRuns = state.liveRuns.slice(0, MAX_LIVE_RUNS);
    }
    if (state.profile.timeframeRuns.length > MAX_PROFILE_RUNS) {
      state.profile.timeframeRuns = state.profile.timeframeRuns.slice(0, MAX_PROFILE_RUNS);
    }
    if (state.profile.allRuns.length > MAX_PROFILE_RUNS) {
      state.profile.allRuns = state.profile.allRuns.slice(0, MAX_PROFILE_RUNS);
    }
  }

  function isFavorite(name) {
    if (!name) return false;
    const lower = name.toLowerCase();
    return state.favorites.some((f) => f.toLowerCase() === lower);
  }

  function toggleFavorite(name) {
    if (!name) return;
    const lower = name.toLowerCase();
    const idx = state.favorites.findIndex((f) => f.toLowerCase() === lower);
    if (idx >= 0) {
      const removed = state.favorites[idx];
      state.favorites.splice(idx, 1);
      delete state.favoritePBs[removed || name];
    } else {
      state.favorites.push(name);
    }
    localStorage.setItem("paceman_favorites", JSON.stringify(state.favorites));
    localStorage.setItem("paceman_favorite_pbs", JSON.stringify(state.favoritePBs));
    updateFavoriteButton();
  }

  function saveFavoritePB(name, time) {
    if (!isFavorite(name)) return;
    const current = state.favoritePBs[name];
    if (current == null || time < current) {
      state.favoritePBs[name] = time;
      localStorage.setItem("paceman_favorite_pbs", JSON.stringify(state.favoritePBs));
      return true;
    }
    return false;
  }

  function updateFavoriteButton() {
    const btn = document.getElementById("favoriteBtn");
    if (!btn) return;
    const name = state.profile.name;
    if (name && isFavorite(name)) {
      btn.classList.add("active");
      btn.querySelector("svg").setAttribute("fill", "currentColor");
    } else {
      btn.classList.remove("active");
      btn.querySelector("svg").setAttribute("fill", "none");
    }
  }

  let profileRunsGeneration = 0;
  let chartPoints = [];
  let chartCanvas = null;

  function renderRunHistoryChart() {
    const container = document.getElementById("chartContainer");
    const chartEl = document.getElementById("profileChart");
    if (!container || !chartEl) return;

    if (!state.profile.chartVisible) {
      container.innerHTML = "";
      chartPoints = [];
      chartCanvas = null;
      return;
    }

    const tf = state.profile.tf;
    if (tf === "session") {
      container.innerHTML = "";
      chartPoints = [];
      chartCanvas = null;
      return;
    }

    const select = document.getElementById("chartStatSelect");
    const statKey = select ? select.value : "finish";

    const runs = state.profile.timeframeRuns || [];
    const finished = runs.filter((r) => r[statKey] != null).sort((a, b) => (a.insertTime || 0) - (b.insertTime || 0));
    if (finished.length < 2) {
      container.innerHTML = finished.length === 1 ? '<div class="loading">Only 1 run with this split in this timeframe. Need at least 2 to show a chart.</div>' : "";
      chartPoints = [];
      chartCanvas = null;
      return;
    }

    const canvas = document.createElement("canvas");
    container.innerHTML = "";
    container.appendChild(canvas);
    chartCanvas = canvas;

    canvas.addEventListener("click", (e) => {
      if (!chartPoints.length) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = (container.clientWidth || 600) / rect.width;
      const scaleY = 180 / rect.height;
      const mx = (e.clientX - rect.left) * scaleX;
      const my = (e.clientY - rect.top) * scaleY;
      let closest = null;
      let minDist = 12;
      for (const p of chartPoints) {
        const dist = Math.hypot(p.x - mx, p.y - my);
        if (dist < minDist) {
          minDist = dist;
          closest = p;
        }
      }
      if (closest && closest.run) {
        openRunDetail(closest.run.id, state.profile.name, closest.run);
      }
    });

    const dpr = window.devicePixelRatio || 1;
    canvas.width = (container.clientWidth || 600) * dpr;
    canvas.height = 180 * dpr;
    canvas.style.width = "100%";
    canvas.style.height = "180px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const width = container.clientWidth || 600;
    const height = 180;
    const padding = { top: 20, right: 20, bottom: 30, left: 50 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const times = finished.map((r) => r[statKey]);
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const range = maxTime - minTime || 1;

    chartPoints = finished.map((r, i) => ({
      x: padding.left + (finished.length > 1 ? (i / (finished.length - 1)) * chartW : chartW / 2),
      y: padding.top + chartH - ((r[statKey] - minTime) / range) * chartH,
      run: r,
    }));

    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
    }

    const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
    gradient.addColorStop(0, "rgba(124, 58, 237, 0.3)");
    gradient.addColorStop(1, "rgba(124, 58, 237, 0.0)");

    ctx.beginPath();
    ctx.moveTo(chartPoints[0].x, padding.top + chartH);
    for (const p of chartPoints) ctx.lineTo(p.x, p.y);
    ctx.lineTo(chartPoints[chartPoints.length - 1].x, padding.top + chartH);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(chartPoints[0].x, chartPoints[0].y);
    for (let i = 1; i < chartPoints.length; i++) ctx.lineTo(chartPoints[i].x, chartPoints[i].y);
    ctx.strokeStyle = "#a78bfa";
    ctx.lineWidth = 2;
    ctx.stroke();

    for (const p of chartPoints) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#a78bfa";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
    }

    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "11px Inter, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(formatTime(maxTime), padding.left - 8, padding.top + 4);
    ctx.fillText(formatTime(minTime), padding.left - 8, padding.top + chartH);

    ctx.textAlign = "center";
    ctx.fillText("Oldest", padding.left, height - 8);
    ctx.fillText("Newest", width - padding.right, height - 8);
  }

  function renderFavorites() {
    const list = document.getElementById("favoritesList");
    const pageFav = document.getElementById("page-favorites");
    if (!list || !pageFav) return;

    if (state.favorites.length === 0) {
      list.innerHTML = '<div class="loading">No favorite players yet. Search for players from the home page or profile pages to add them here.</div>';
      return;
    }

    list.innerHTML = "";
    const favRuns = state.liveRuns.filter((r) => r.nickname && isFavorite(r.nickname));
    const activeNames = new Set(favRuns.map((r) => r.nickname));

    for (const name of state.favorites) {
      const row = document.createElement("div");
      row.className = "run-row is-favorite";
      const isRunning = activeNames.has(name);
      const run = isRunning ? favRuns.find((r) => r.nickname === name) : null;
      const user = run ? run.user : {};
      const uuid = user.uuid || state.playerCache[name.toLowerCase()] || null;
      const channel = user.liveAccount || null;
      const stage = run ? (run.stage || "Unknown") : "Offline";
      const time = run && run.current ? formatTime(run.current) : null;
      const rta = run && run.rta != null ? formatTime(run.rta) : null;

      row.innerHTML = `
        <div class="run-row-head">
          <img src="${avatarUrl(uuid || name, 28)}" onerror="this.style.visibility='hidden'">
          ${escapeHtml(name)}
          ${isRunning ? `<span class="live-pill"><span class="live-dot"></span>LIVE</span>` : ""}
          ${channel && isRunning ? `<a class="run-twitch" href="https://twitch.tv/${escapeHtml(channel)}" target="_blank" rel="noopener">Twitch</a>` : ""}
          <button class="fav-remove-btn" data-name="${escapeHtml(name)}" title="Remove from favorites">&times;</button>
        </div>
        <div class="run-cells">
          <div class="run-cell"><b>Stage:</b> ${escapeHtml(stage)}</div>
          ${rta ? `<div class="run-cell"><b>RTA:</b> ${rta}</div>` : ""}
          ${time ? `<div class="run-cell run-pb-indicator">IGT: ${time}</div>` : ""}
        </div>
      `;
      const removeBtn = row.querySelector(".fav-remove-btn");
      if (removeBtn) {
        removeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleFavorite(name);
          renderFavorites();
        });
      }
      row.addEventListener("click", () => openProfile(name, uuid));
      list.appendChild(row);
    }
  }

  function pushNav(entry) {
    if (suppressNavPush) return;
    navHistory.length = navIndex + 1;
    navHistory.push(entry);
    navIndex = navHistory.length - 1;
  }

  function navigateTo(entry) {
    suppressNavPush = true;
    if (entry.page === "profile" && entry.name) {
      openProfile(entry.name, entry.uuid);
    } else {
      showPage(entry.page);
    }
    suppressNavPush = false;
  }

  function goBack() {
    if (navIndex > 0) {
      navIndex--;
      navigateTo(navHistory[navIndex]);
    } else if (navIndex === 0 && navHistory.length > 0) {
      navIndex = -1;
      navigateTo({ page: "home" });
    }
  }

  function goForward() {
    if (navIndex < navHistory.length - 1) {
      navIndex++;
      navigateTo(navHistory[navIndex]);
    }
  }

  function parseTimeToSec(v) {
    v = String(v == null ? "" : v).trim();
    if (v === "") return null;
    if (v.includes(":")) {
      const parts = v.split(":").map((p) => parseFloat(p));
      if (parts.some((n) => isNaN(n))) return null;
      let sec = 0;
      for (const p of parts) sec = sec * 60 + p;
      return sec > 0 ? sec : null;
    }
    const n = parseFloat(v);
    return isNaN(n) || n <= 0 ? null : n;
  }

  function fmt(ms) {
    if (ms == null || ms === 0 || isNaN(ms)) return "0:00";
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    if (m >= 60) {
      const h = Math.floor(m / 60);
      const mm = m % 60;
      return `${h}:${String(mm).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    }
    return `${m}:${String(sec).padStart(2, "0")}`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function debounce(fn, ms) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function avatarUrl(id, size) {
    return `${MCHEADS}/avatar/${id}/${size}`;
  }

  function skinUrl(id) {
    return `${MCHEADS}/skin/${id}`;
  }

  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    try {
      return await res.json();
    } catch (e) {
      throw new Error("Invalid JSON response from " + url);
    }
  }

  async function resolveUUID(name) {
    try {
      const data = await getJSON(`${MOJANG}/${encodeURIComponent(name)}`);
      return data.id || null;
    } catch (e) {
      return null;
    }
  }

  function cachePlayer(name, uuid) {
    if (name) state.playerCache[name.toLowerCase()] = uuid || null;
  }

  function cachePlayersFromRuns(runs) {
    for (const r of runs) {
      if (r.nickname && r.user && r.user.uuid) cachePlayer(r.nickname, r.user.uuid);
    }
  }

  function furthestEvent(run) {
    let best = null;
    for (const ev of run.eventList || []) {
      const key = EVENT_TO_SPLIT[ev.eventId.replace("rsg.", "")];
      if (key) best = { key, igt: ev.igt, rta: ev.rta };
    }
    return best;
  }

  function furthestIndex(run) {
    let idx = -1,
      time = 0,
      key = null;
    for (const k of SPLIT_ORDER) {
      if (run[k] != null) {
        idx = SPLIT_ORDER.indexOf(k);
        time = run[k];
        key = k;
      }
    }
    return { idx, time, key };
  }

  function splitTimes(run) {
    const t = {};
    for (const ev of run.eventList || []) {
      const key = EVENT_TO_SPLIT[ev.eventId.replace("rsg.", "")];
      if (key) t[key] = ev.igt;
    }
    return t;
  }

  /* ---------------- Live Runs ---------------- */

  async function loadLiveRuns() {
    const list = document.getElementById("runsList");
    if (state.liveRuns.length === 0) list.innerHTML = '<div class="loading">Loading live runs...</div>';
    try {
      const runs = await getJSON(LIVERUNS);
      state.liveRuns = runs.filter(
        (r) => !r.isHidden && !r.isCheated && (r.gameVersion || "").startsWith("1.16") && !r.numLeaves
      );
      cachePlayersFromRuns(runs);
      cleanupAutoOpenedStreams(state.liveRuns);
      pruneRuns();
      renderLiveRuns();
    } catch (e) {
      list.innerHTML = '<div class="loading">Failed to load live runs. Check your connection.</div>';
    }
  }

  function passesFilters(run) {
    if (state.filters.streamingOnly && !(run.user && run.user.liveAccount)) return false;
    const mt = state.filters.maxTime;
    if (mt) {
      const t = splitTimes(run);
      for (const split in mt) {
        const v = t[split];
        if (v != null && v > mt[split] * 1000) return false;
      }
    }
    return true;
  }

  function cleanupAutoOpenedStreams(liveRuns) {
    if (!state.autoOpenTwitch) return;
    const liveTwitch = new Set(
      liveRuns.filter((r) => r.user && r.user.liveAccount).map((r) => r.user.liveAccount)
    );
    for (const channel of autoOpenedStreams) {
      if (!liveTwitch.has(channel)) {
        closeTwitch(channel);
        autoOpenedStreams.delete(channel);
      }
    }
  }

  function sortLiveRuns(runs) {
    const arr = runs.slice();
    if (state.liveSort === "time") {
      arr.sort((a, b) => (furthestEvent(a)?.igt || 0) - (furthestEvent(b)?.igt || 0));
    } else {
      arr.sort((a, b) => {
        const fa = furthestEvent(a),
          fb = furthestEvent(b);
        const ia = fa ? SPLIT_ORDER.indexOf(fa.key) : -1;
        const ib = fb ? SPLIT_ORDER.indexOf(fb.key) : -1;
        if (ib !== ia) return ib - ia;
        return (fa?.igt || 0) - (fb?.igt || 0);
      });
    }
    return arr;
  }

  function renderLiveRuns() {
    const list = document.getElementById("runsList");
    let runs = sortLiveRuns(state.liveRuns.filter(passesFilters));
    if (state.filters.favoritesOnly) {
      runs = runs.filter((r) => r.nickname && isFavorite(r.nickname));
    }
    if (runs.length === 0) {
      const msg = state.filters.favoritesOnly ? "None of your favorite players are currently running." : "No runs match the current filters.";
      list.innerHTML = `<div class="loading">${msg}</div>`;
      return;
    }
    list.innerHTML = "";
    for (const r of runs) {
      const card = document.createElement("div");
      card.className = "run-card";
      const id = (r.user && r.user.uuid) || r.nickname;
      const name = r.nickname;
      const f = furthestEvent(r);
      const stateLabel = f ? SPLITS[f.key] : "Unknown";
      const time = f ? f.igt : 0;
      const twitch = r.user && r.user.liveAccount ? r.user.liveAccount : null;
      const streaming = !!twitch;
      if (isFavorite(name)) card.classList.add("is-favorite");
      card.innerHTML = `
        <img src="${avatarUrl(id, 64)}" alt="${escapeHtml(name)}" onerror="this.style.visibility='hidden'">
        <div class="run-info">
          <div class="run-name">
            ${escapeHtml(name)}
            <button class="run-fav-btn ${isFavorite(name) ? 'is-fav' : ''}" data-name="${escapeHtml(name)}" title="Favorite">
              ${isFavorite(name) ? '★' : '☆'}
            </button>
            ${streaming ? `<img class="twitch-icon" src="${TWITCH_ICON}" title="Watch ${escapeHtml(twitch)} on Twitch" alt="Twitch">` : ""}
            ${streaming ? `<span class="live-pill"><span class="live-dot"></span>LIVE</span>` : ""}
          </div>
          <div class="run-state">Reached ${stateLabel}</div>
        </div>
        <div class="run-time">${fmt(time)}</div>`;
      const favBtn = card.querySelector(".run-fav-btn");
      if (favBtn) {
        favBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleFavorite(name);
          renderLiveRuns();
        });
      }
      card.addEventListener("click", () => openProfile(name, r.user && r.user.uuid));
      const twitchIcon = card.querySelector(".twitch-icon");
      if (twitchIcon) {
        twitchIcon.addEventListener("click", (e) => {
          e.stopPropagation();
          openTwitch(twitch);
        });
      }
      list.appendChild(card);
    }
    if (state.autoOpenTwitch) {
      for (const r of runs) {
        const twitch = r.user && r.user.liveAccount ? r.user.liveAccount : null;
        if (twitch && !autoOpenedStreams.has(twitch)) {
          autoOpenedStreams.add(twitch);
          openTwitch(twitch);
        }
      }
    }
  }

  /* ---------------- Profile ---------------- */

  async function openProfile(name, uuid) {
    if (state.comparison && state.comparison.active) {
      await toggleComparison();
    }
    pushNav({ page: "profile", name, uuid });
    showPage("profile");
    state.profile = { name, uuid: uuid || null, tf: "daily", allRuns: [], timeframeRuns: [], pbRun: null, page: 1, socials: null, chartVisible: true };
    const profileName = document.getElementById("profileName");
    const profileStatsRow = document.getElementById("profileStatsRow");
    const profileSplits = document.getElementById("profileSplits");
    const profileBestRuns = document.getElementById("profileBestRuns");
    const headContainer = document.getElementById("head3dContainer");
    const socialLinks = document.getElementById("socialLinks");
    if (profileName) profileName.textContent = name;
    if (profileStatsRow) {
      profileStatsRow.innerHTML =
        '<span class="stat-badge" id="profileCompletion">0 completions</span>' +
        '<span class="stat-badge" id="profileAvg">Avg: 0:00</span>' +
        '<span class="stat-badge clickable" id="profilePB">PB: --</span>';
    }
    if (socialLinks) socialLinks.innerHTML = "";
    if (profileSplits) profileSplits.innerHTML = '<div class="loading">Loading stats...</div>';
    if (profileBestRuns) profileBestRuns.innerHTML = '<div class="loading">Loading runs...</div>';
    const title = document.getElementById("profileBestRunsTitle");
    if (title) title.textContent = "Best Daily Runs";
    document.querySelectorAll("#profileTimeframes .timeframe-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.tf === "daily");
    });
    if (!uuid) uuid = await resolveUUID(name);
    state.profile.uuid = uuid;
    if (uuid && headContainer) renderHead3D(headContainer, uuid);
    addRecent(name);
    await Promise.all([loadProfileStats(), loadProfileRuns(), loadProfileSocials(name)]);
    await loadTwitchFromRuns(name);
    updateFavoriteButton();
    const chartToggleBtn = document.getElementById("chartToggleBtn");
    const profileChart = document.getElementById("profileChart");
    if (chartToggleBtn) {
      chartToggleBtn.classList.remove("hidden");
    }
    if (profileChart) {
      profileChart.classList.remove("hidden");
    }
    renderRunHistoryChart();
    const pbBadge = document.getElementById("profilePB");
    if (pbBadge) {
      pbBadge.onclick = () => {
        const run = state.profile.pbRun;
        if (run) {
          const runId = run.id || run.worldId || run.runId || run._id || null;
          if (runId) openRunDetail(runId, state.profile.name, run);
        }
      };
    }
  }

  async function loadProfileStats() {
    const { name, tf } = state.profile;
    const hours = TF_HOURS[tf],
      between = TF_BETWEEN[tf];
    const wrap = document.getElementById("profileSplits");
    const sessionBox = document.getElementById("sessionStats");
    if (sessionBox) sessionBox.innerHTML = "";
    if (wrap) wrap.innerHTML = '<div class="loading">Loading stats...</div>';
    try {
      const stats = await getJSON(`${API}/getSessionStats?name=${encodeURIComponent(name)}&hours=${hours}&hoursBetween=${between}`);
      if (wrap) wrap.innerHTML = "";
      for (const key of SPLIT_ORDER) {
        const s = stats[key] || { count: 0, avg: "0:00" };
        const card = document.createElement("div");
        card.className = "split-card";
        card.innerHTML = `<div class="split-name">${SPLITS[key]}</div><div class="split-value">${s.count}</div><div class="split-count">Avg ${s.avg}</div>`;
        card.addEventListener("click", () => openSplitDetail(key));
        if (wrap) wrap.appendChild(card);
      }
      const fin = stats.finish || { count: 0, avg: "0:00" };
      const completionEl = document.getElementById("profileCompletion");
      const avgEl = document.getElementById("profileAvg");
      if (completionEl) completionEl.textContent = `${fin.count} completions`;
      if (avgEl) avgEl.textContent = `Avg: ${fin.avg}`;
      if (tf === "session") {
        try {
          const nph = await getJSON(`${API}/getNPH?name=${encodeURIComponent(name)}&hours=${hours}&hoursBetween=${between}`);
          if (sessionBox) sessionBox.innerHTML = renderSessionStats(nph);
        } catch (e) {
          if (sessionBox) sessionBox.innerHTML = "";
        }
      }
    } catch (e) {
      if (wrap) wrap.innerHTML = '<div class="loading">No stats available.</div>';
    }
  }

  async function loadProfileSocials(name) {
    state.profile.socials = null;
  }


  async function loadTwitchFromRuns(name) {
    const runs = state.profile.timeframeRuns || [];
    const allRuns = state.profile.allRuns || [];
    const combined = [...runs, ...allRuns];

    const finishedRuns = combined.filter((r) => r && r.finish != null && (r.id || r.worldId));
    if (finishedRuns.length === 0) {
      renderSocialLinks(state.profile.socials);
      return;
    }

    const seen = new Set();
    for (const run of finishedRuns.slice(0, 10)) {
      const worldId = run.id || run.worldId;
      if (!worldId || seen.has(worldId)) continue;
      seen.add(worldId);

      try {
        const data = await getJSON(`${API}/getWorld?worldId=${encodeURIComponent(worldId)}`);
        const full = (data && data.data) || {};
        const twitch = full.twitch;
        if (twitch && typeof twitch === "string" && twitch.trim() !== "") {
          const existing = state.profile.socials || {};
          existing.twitch = { id: twitch.trim(), name: twitch.trim() };
          state.profile.socials = existing;
          renderSocialLinks(existing);
          return;
        }
      } catch (e) {
        // ignore and try next run
      }
    }

    renderSocialLinks(state.profile.socials);
  }

  function renderSocialLinks(connections, container) {
    if (!connections) return;
    const socialLinks = container || document.getElementById("socialLinks");
    if (!socialLinks) return;

    const links = [];
    if (connections.twitch && connections.twitch.id) {
      links.push({
        platform: "twitch",
        url: `https://twitch.tv/${connections.twitch.id}`,
        icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>`
      });
    }

    socialLinks.innerHTML = "";
    for (const link of links) {
      const btn = document.createElement("button");
      btn.className = `social-link ${link.platform}`;
      btn.title = link.platform.charAt(0).toUpperCase() + link.platform.slice(1);
      btn.innerHTML = link.icon;
      btn.addEventListener("click", () => {
        if (window.pacemanAPI && window.pacemanAPI.openExternal) {
          window.pacemanAPI.openExternal(link.url);
        }
      });
      socialLinks.appendChild(btn);
    }
  }

  function renderSessionStats(n) {
    const badges = [
      ["NPH (IGT)", (n.rnph || 0).toFixed(2)],
      ["RPE", (n.rpe || 0).toFixed(2)],
    ];
    return badges
      .map(([l, v]) => `<span class="stat-badge"><b>${v}</b> ${l}</span>`)
      .join("");
  }

  async function loadProfileRuns() {
    const { name, tf } = state.profile;
    const generation = ++profileRunsGeneration;
    const best = document.getElementById("profileBestRuns");
    const title = document.getElementById("profileBestRunsTitle");
    if (title) title.textContent = `Best ${tf.charAt(0).toUpperCase() + tf.slice(1)} Runs`;
    if (best) best.innerHTML = '<div class="loading">Loading runs...</div>';
    try {
      const hours = TF_HOURS[tf] || 24;
      const [timeframe, all] = await Promise.all([
        getJSON(`${API}/getRecentRuns?name=${encodeURIComponent(name)}&hours=${hours}&limit=5000`),
        getJSON(`${API}/getRecentRuns?name=${encodeURIComponent(name)}&hours=999999&limit=5000`),
      ]);
      if (generation !== profileRunsGeneration) return;
      state.profile.timeframeRuns = timeframe || [];
      state.profile.allRuns = all || [];
      pruneRuns();
      let pb = null;
      let pbRun = null;
      for (const r of state.profile.allRuns) {
        if (r.finish != null && (pb == null || r.finish < pb)) {
          pb = r.finish;
          pbRun = r;
        }
      }
      state.profile.pbRun = pbRun;
      const pbEl = document.getElementById("profilePB");
      if (pbEl) pbEl.textContent = pb != null ? `PB: ${fmt(pb)}` : "PB: --";

      if (isFavorite(name) && pbRun && saveFavoritePB(name, pb)) {
        const notif = new Notification("New PB!", {
          body: `${name} got a new personal best: ${fmt(pb)}`,
          icon: "https://mc-heads.net/avatar/" + (state.profile.uuid || name) + "/64",
        });
        if (notif) notif.onclick = () => openProfile(name, state.profile.uuid);
      }
      if (generation !== profileRunsGeneration) return;
      const ranked = state.profile.timeframeRuns
        .map((r) => ({ r, f: furthestIndex(r) }))
        .sort((a, b) => {
          const aFinished = a.r.finish != null;
          const bFinished = b.r.finish != null;
          if (aFinished && bFinished) return a.r.finish - b.r.finish;
          if (aFinished) return -1;
          if (bFinished) return 1;
          if (a.f.idx !== b.f.idx) return b.f.idx - a.f.idx;
          return a.f.time - b.f.time;
        })
        .slice(0, 5);
      if (best) {
        best.innerHTML = "";
        if (ranked.length === 0) {
          best.innerHTML = '<div class="loading">No runs yet.</div>';
        } else {
          for (const item of ranked) {
            const div = document.createElement("div");
            div.className = "run-item";
            const runId = item.r.id || item.r.worldId || item.r.runId || item.r._id || null;
            div.innerHTML = `<span class="run-split">${SPLITS[item.f.key] || "Run"}</span><span class="run-time">${fmt(item.f.time)}</span>`;
            div.addEventListener("click", () => {
              if (runId) openRunDetail(runId, state.profile.name, item.r);
            });
            best.appendChild(div);
          }
        }
      }
      renderAllRunsPage();
      await loadTwitchFromRuns(name);
      renderRunHistoryChart();
    } catch (e) {
      if (generation !== profileRunsGeneration) return;
      if (best) best.innerHTML = '<div class="loading">Failed to load runs.</div>';
    }
  }

  function timeAgo(ms) {
    if (!ms) return "";
    const d = new Date(ms);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "just now";
    if (diffMins < 60) return diffMins + "m ago";
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return diffHours + "h ago";
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return diffDays + "d ago";
    const diffWeeks = Math.floor(diffDays / 7);
    if (diffWeeks < 4) return diffWeeks + "w ago";
    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths < 12) return diffMonths + "mo ago";
    return Math.floor(diffDays / 365) + "y ago";
  }

  function renderAllRunsPage() {
    const runs = state.profile.allRuns;
    const per = 10,
      page = state.profile.page;
    const total = Math.max(1, Math.ceil(runs.length / per));
    const slice = runs.slice((page - 1) * per, page * per);
    const list = document.getElementById("allRunsList");
    if (!list) return;
    list.innerHTML = "";
    if (slice.length === 0) {
      list.innerHTML = '<div class="loading">No runs.</div>';
    } else {
      for (const r of slice) {
        const row = document.createElement("div");
        row.className = "run-row";
        let cells = "";
        for (const split of SPLIT_ORDER) {
          const t = r[split];
          cells += `<div class="run-cell ${t == null ? "empty" : ""}">${t == null ? "—" : fmt(t)}</div>`;
        }
        const runId = r.id || r.worldId || r.runId || r._id || null;
        const ts = r.createdAt || r.timestamp || r.startTime || r.insertTime || r.lastUpdated || r.time || r.updatedTime || r.realUpdated || null;
        const timeStr = ts ? timeAgo(new Date(ts * 1000).getTime()) : "";
        row.innerHTML = `<div class="run-row-head">${escapeHtml(state.profile.name)} <span class="run-row-sub">#${runId || "?"}</span></div><div class="run-cells">${cells}<div class="run-cell run-time-ago">${timeStr}</div></div>`;
        row.addEventListener("click", () => openRunDetail(runId, state.profile.name, r));
        list.appendChild(row);
      }
    }
    renderPagination(total, page);
  }

  function renderPagination(total, page) {
    const pag = document.getElementById("runsPagination");
    if (!pag) return;
    pag.innerHTML = "";
    const mk = (label, target, disabled, active) => {
      const b = document.createElement("button");
      b.className = "page-btn" + (active ? " active" : "") + (disabled ? " disabled" : "");
      b.textContent = label;
      if (!disabled) b.onclick = () => { state.profile.page = target; renderAllRunsPage(); };
      pag.appendChild(b);
    };
    mk("‹", Math.max(1, page - 1), page === 1, false);
    const windowSize = 5;
    let start = Math.max(1, page - Math.floor(windowSize / 2));
    let end = Math.min(total, start + windowSize - 1);
    start = Math.max(1, end - windowSize + 1);
    if (start > 1) mk("1", 1, false, false);
    if (start > 2) {
      const dots = document.createElement("span");
      dots.className = "page-dots";
      dots.textContent = "…";
      pag.appendChild(dots);
    }
    for (let i = start; i <= end; i++) mk(String(i), i, false, i === page);
    if (end < total - 1) {
      const dots = document.createElement("span");
      dots.className = "page-dots";
      dots.textContent = "…";
      pag.appendChild(dots);
    }
    if (end < total) mk(String(total), total, false, false);
    mk("›", Math.min(total, page + 1), page === total, false);
  }

  /* ---------------- Run Detail + Twitch ---------------- */

  function openTwitch(channel) {
    if (!state.openTwitch.has(channel)) {
      state.openTwitch.add(channel);
      addTwitchTile(channel);
      updateStreamsUI();
    }
    const dock = document.getElementById("twitchDock");
    dock.classList.add("visible");
    dock.classList.remove("collapsed");
    renderDockLayout();
  }

  function addTwitchTile(channel) {
    const main = document.getElementById("twitchDockMain");
    const tile = document.createElement("div");
    tile.className = "twitch-tile";
    tile.dataset.channel = channel;
    tile.innerHTML = `
      <div class="twitch-tile-bar">
        <span class="twitch-tile-name">${escapeHtml(channel)}</span>
        <div class="twitch-tile-actions">
          <button class="twitch-tile-focus" title="Focus / expand">&#9634;</button>
          <button class="twitch-tile-browser" title="Open in browser">&#8599;</button>
          <button class="twitch-tile-close" title="Close">&times;</button>
        </div>
      </div>
      <div class="twitch-tile-body"></div>`;
    const body = tile.querySelector(".twitch-tile-body");
    const wv = document.createElement("webview");
    wv.className = "twitch-tile-webview";
    wv.setAttribute("allowpopups", "");
    wv.src = `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=player.twitch.tv&muted=true`;
    body.appendChild(wv);
    tile.querySelector(".twitch-tile-focus").addEventListener("click", () => {
      state.focusedChannel = state.focusedChannel === channel ? null : channel;
      renderDockLayout();
    });
    tile.querySelector(".twitch-tile-close").addEventListener("click", () => closeTwitch(channel));
    tile.querySelector(".twitch-tile-browser").addEventListener("click", () =>
      window.pacemanAPI.openExternal(`https://twitch.tv/${channel}`)
    );
    main.appendChild(tile);
  }

  function closeTwitch(channel) {
    state.openTwitch.delete(channel);
    if (state.focusedChannel === channel) state.focusedChannel = null;
    const tile = document.querySelector(`.twitch-tile[data-channel="${CSS.escape(channel)}"]`);
    if (tile) {
      const wv = tile.querySelector("webview");
      if (wv) wv.src = "about:blank";
      tile.remove();
    }
    updateStreamsUI();
    renderDockLayout();
    if (state.openTwitch.size === 0) document.getElementById("twitchDock").classList.remove("visible");
  }

  function renderDockLayout() {
    const dock = document.getElementById("twitchDock");
    const main = document.getElementById("twitchDockMain");
    const thumbs = document.getElementById("twitchDockThumbs");
    const tiles = Array.from(document.querySelectorAll(".twitch-tile"));
    const focused = state.focusedChannel && state.openTwitch.has(state.focusedChannel) ? state.focusedChannel : null;
    dock.classList.toggle("focused", !!focused);
    dock.classList.toggle("focus-bottom", !!focused && state.dockLayout === "bottom");
    dock.classList.toggle("focus-side", !!focused && state.dockLayout === "side");
    dock.classList.toggle("layout-side", state.dockLayout === "side");
    for (const tile of tiles) {
      const ch = tile.dataset.channel;
      if (focused && ch === focused) {
        if (tile.parentElement !== main) main.appendChild(tile);
        tile.classList.add("featured");
      } else if (focused) {
        if (tile.parentElement !== thumbs) thumbs.appendChild(tile);
        tile.classList.remove("featured");
      } else {
        if (tile.parentElement !== main) main.appendChild(tile);
        tile.classList.remove("featured");
      }
    }
    refreshDockLayout();
  }

  function updateStreamsUI() {
    const n = state.openTwitch.size;
    const countEl = document.getElementById("streamsCount");
    if (countEl) countEl.textContent = n;
    const toggle = document.getElementById("streamsToggle");
    if (toggle) toggle.style.display = n > 0 ? "flex" : "none";
  }

  function refreshDockLayout() {
    const app = document.querySelector(".app");
    const dock = document.getElementById("twitchDock");
    const open = dock.classList.contains("visible") && !dock.classList.contains("collapsed");
    const collapsed = dock.classList.contains("visible") && dock.classList.contains("collapsed");
    const focused = open && dock.classList.contains("focused");
    const side = open && state.dockLayout === "side";
    app.classList.toggle("dock-open", open);
    app.classList.toggle("dock-collapsed", collapsed);
    app.classList.toggle("dock-focused", focused);
    app.classList.toggle("dock-side", side);
  }

  function openRunDetail(id, name, fallbackRun) {
    currentRunId = id;
    const overlay = document.getElementById("runDetailOverlay");
    document.getElementById("runDetailTitle").textContent = name + " - Run #" + (id || "?");
    overlay.classList.add("visible");

    const d = fallbackRun || {};
    if (!d || Object.keys(d).length === 0) {
      document.getElementById("runDetailSplits").innerHTML = '<div class="loading">Run details unavailable.</div>';
      document.getElementById("runDetailVod").style.display = "none";
      return;
    }

    function renderSplits(data) {
      let html = "";
      for (const split of SPLIT_ORDER) {
        const igt = data[split];
        const rta = data[split + "Rta"];
        html += `<div class="detail-split" data-igt="${igt != null ? igt : ''}">
          <div class="detail-split-name">${SPLITS[split]}</div>
          <div class="detail-split-times">
            <span class="detail-igt">${igt == null ? "—" : fmt(igt)} <small>IGT</small></span>
            <span class="detail-rta">${rta == null ? "—" : fmt(rta)} <small>RTA</small></span>
          </div>
        </div>`;
      }
      document.getElementById("runDetailSplits").innerHTML = html;
    }

    function showVodLoading() {
      document.getElementById("runDetailVod").style.display = "";
      document.getElementById("runVodWebview").style.display = "none";
      document.getElementById("runDetailSplits").insertAdjacentHTML("afterend", '<div class="vod-loading" id="vodLoading"><div class="vod-loading-bar-track"><div class="vod-loading-bar-fill"></div></div><div class="vod-loading-text">Loading VOD...</div></div>');
    }

    function renderVod(vodId, vodOffset, twitchChannel, webview) {
      const vodSection = document.getElementById("runDetailVod");
      const loadingEl = document.getElementById("vodLoading");
      if (loadingEl) loadingEl.remove();
      if (!vodId) { vodSection.style.display = "none"; return; }
      currentVod = { id: vodId, offset: vodOffset, currentTime: vodOffset };
      const embedUrl = "https://player.twitch.tv/?video=" + vodId + "&parent=player.twitch.tv&time=" + vodOffset + "&autoplay=true&muted=true";
      webview.src = embedUrl;
      webview.style.display = "";
      const speedBtn = document.getElementById("vodSpeed");
      if (speedBtn) {
        speedBtn.textContent = "1x";
        speedBtn.classList.remove("active");
      }
      attachSplitSeek(vodId, vodOffset, webview);
      webview.addEventListener("did-fail-load", function() {
        webview.style.display = "none";
        attachSplitSeek(null, 0, webview);
      });
    }

    renderSplits(d);
    const webview = document.getElementById("runVodWebview");
    webview.src = "about:blank";
    webview.style.display = "none";

    document.querySelectorAll(".detail-split").forEach(function(el) {
      el.style.cursor = "default";
      el.onclick = null;
    });

    function attachSplitSeek(vodId, vodOffset, webview) {
      currentVod = { id: vodId, offset: vodOffset, currentTime: vodOffset };
      document.querySelectorAll(".detail-split").forEach(function(el) {
        const igtMs = parseFloat(el.dataset.igt);
        el.style.cursor = (vodId && !isNaN(igtMs)) ? "pointer" : "default";
        el.onclick = function() {
          if (!vodId || isNaN(igtMs)) return;
          const vodTime = Math.floor(vodOffset + (igtMs / 1000));
          currentVod.currentTime = vodTime;
          seekVod(0, vodTime);
        };
      });
    }

    if (id != null && !isNaN(id)) {
      showVodLoading();
      getJSON(API + "/getWorld?worldId=" + encodeURIComponent(id)).then(function(data) {
        const full = (data && data.data) || {};
        if (full.vodId) {
          renderVod(full.vodId, full.vodOffset || 0, full.twitch || null, webview);
        } else {
          document.getElementById("runDetailVod").style.display = "none";
          const loadingEl = document.getElementById("vodLoading");
          if (loadingEl) loadingEl.remove();
          attachSplitSeek(null, 0, webview);
        }
        const needsUpdate = SPLIT_ORDER.some(function(s) { return full[s] != null && d[s] !== full[s]; });
        if (needsUpdate) {
          renderSplits(full);
          if (full.vodId) {
            attachSplitSeek(full.vodId, full.vodOffset || 0, webview);
          }
        }
      }).catch(function() {
        const loadingEl = document.getElementById("vodLoading");
        if (loadingEl) loadingEl.remove();
        document.getElementById("runDetailVod").style.display = "none";
        attachSplitSeek(null, 0, webview);
      });
    } else {
      document.getElementById("runDetailVod").style.display = "none";
      attachSplitSeek(null, 0, webview);
    }
  }

  function closeRunDetail() {
    currentRunId = null;
    const overlay = document.getElementById("runDetailOverlay");
    overlay.classList.remove("visible");
    const webview = document.getElementById("runVodWebview");
    if (webview) {
      webview.src = "about:blank";
      webview.style.display = "none";
    }
  }

  function openSplitDetail(splitKey) {
    const panel = document.getElementById("splitDetailPanel");
    const titleEl = document.getElementById("splitDetailTitle");
    if (!panel || !titleEl) return;

    const runs = (state.profile.timeframeRuns || []).filter((r) => r[splitKey] != null);
    if (runs.length === 0) {
      titleEl.textContent = SPLITS[splitKey] || splitKey;
      document.getElementById("splitDetailList").innerHTML = '<div class="loading">No runs with this split in the current timeframe.</div>';
      document.getElementById("splitDetailPagination").innerHTML = "";
      panel.classList.add("visible");
      return;
    }

    splitDetailState = { split: splitKey, runs, page: 1, perPage: 10, sortAsc: true };
    titleEl.textContent = SPLITS[splitKey] || splitKey;
    renderSplitDetail();
    panel.classList.add("visible");
  }

  function closeSplitDetail() {
    const panel = document.getElementById("splitDetailPanel");
    if (panel) panel.classList.remove("visible");
  }

  function renderSplitDetail() {
    const { split, runs, page, perPage, sortAsc } = splitDetailState;
    const listEl = document.getElementById("splitDetailList");
    const paginationEl = document.getElementById("splitDetailPagination");
    const sortBtn = document.getElementById("splitDetailSort");
    if (!listEl) return;

    const sorted = [...runs].sort((a, b) => sortAsc ? a[split] - b[split] : b[split] - a[split]);
    const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * perPage;
    const pageRuns = sorted.slice(start, start + perPage);

    listEl.innerHTML = "";
    for (const r of pageRuns) {
      const row = document.createElement("div");
      row.className = "split-detail-row";
      const runId = r.id || r.worldId || r.runId || r._id || null;
      const timeStr = fmt(r[split]);
      const furthest = furthestIndex(r);
      const furthestText = furthest.key ? SPLITS[furthest.key] || furthest.key : "—";
      row.innerHTML = `<span class="split-detail-time">${timeStr}</span><span class="split-detail-furthest">Furthest: ${furthestText}</span><span class="split-detail-id">#${runId != null ? runId : "?"}</span>`;
      row.addEventListener("click", () => {
        if (runId) openRunDetail(runId, state.profile.name, r);
      });
      listEl.appendChild(row);
    }

    if (paginationEl) {
      paginationEl.innerHTML = `
        <button class="split-page-btn" data-page="prev" ${safePage <= 1 ? "disabled" : ""}>&lt;</button>
        <span class="split-page-info">${safePage} / ${totalPages}</span>
        <button class="split-page-btn" data-page="next" ${safePage >= totalPages ? "disabled" : ""}>&gt;</button>
      `;
      paginationEl.querySelectorAll(".split-page-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const dir = btn.dataset.page;
          if (dir === "prev" && safePage > 1) {
            splitDetailState.page = safePage - 1;
            renderSplitDetail();
          } else if (dir === "next" && safePage < totalPages) {
            splitDetailState.page = safePage + 1;
            renderSplitDetail();
          }
        });
      });
    }

    if (sortBtn) {
      sortBtn.classList.toggle("active", !sortAsc);
      sortBtn.title = sortAsc ? "Show slowest first" : "Show fastest first";
    }
  }

  function initSplitDetail() {
    const closeBtn = document.getElementById("closeSplitDetail");
    if (closeBtn) closeBtn.addEventListener("click", closeSplitDetail);
    const sortBtn = document.getElementById("splitDetailSort");
    if (sortBtn) {
      sortBtn.addEventListener("click", () => {
        splitDetailState.sortAsc = !splitDetailState.sortAsc;
        splitDetailState.page = 1;
        renderSplitDetail();
      });
    }
    const panel = document.getElementById("splitDetailPanel");
    if (panel) {
      panel.addEventListener("click", (e) => {
        if (e.target === panel) closeSplitDetail();
      });
    }
  }

  async function seekVod(seconds, targetTime) {
    if (!currentVod.id) return;
    const webview = document.getElementById("runVodWebview");
    if (!webview) return;
    let actualTime = null;
    if (typeof targetTime !== "number") {
      try {
        actualTime = await webview.executeJavaScript(`
          (function() {
            var video = document.querySelector('video');
            return video ? Math.floor(video.currentTime) : null;
          })();
        `);
      } catch (e) {
        actualTime = null;
      }
    }
    if (typeof targetTime === "number") {
      currentVod.currentTime = Math.max(0, Math.floor(targetTime));
    } else if (actualTime !== null) {
      currentVod.currentTime = Math.max(0, Math.floor(actualTime + seconds));
    } else {
      currentVod.currentTime = Math.max(0, Math.floor(currentVod.currentTime + seconds));
    }
    try {
      await webview.executeJavaScript(`
        (function() {
          var video = document.querySelector('video');
          if (video) {
            video.currentTime = ${currentVod.currentTime};
            return true;
          }
          return false;
        })();
      `);
    } catch (e) {
      webview.src = "about:blank";
      setTimeout(function() {
        webview.src = "https://player.twitch.tv/?video=" + currentVod.id + "&parent=player.twitch.tv&time=" + currentVod.currentTime + "&autoplay=true&muted=true&_=" + Date.now();
      }, 100);
    }
  }

  async function setVodSpeed(speed) {
    const webview = document.getElementById("runVodWebview");
    if (!webview || !currentVod.id) return;
    try {
      await webview.executeJavaScript(`
        (function() {
          var video = document.querySelector('video');
          if (video) {
            video.playbackRate = ${speed};
            return true;
          }
          return false;
        })();
      `);
    } catch (e) {
      console.log("Speed control failed", e);
    }
  }

  function toggleVodSpeed() {
    const btn = document.getElementById("vodSpeed");
    if (!btn || !currentVod.id) return;
    const isActive = btn.classList.contains("active");
    const newSpeed = isActive ? 1 : 2;
    btn.textContent = newSpeed + "x";
    btn.classList.toggle("active", !isActive);
    setVodSpeed(newSpeed);
  }

  /* ---------------- 3D Head ---------------- */

  function pauseHeadAnimation() {
    if (headAnimFrameId) {
      cancelAnimationFrame(headAnimFrameId);
      headAnimFrameId = null;
    }
  }

  function renderHead3D(container, id) {
    container.innerHTML = "";
    const skin = skinUrl(id);
    const S = container.clientWidth || 100;
    const scene = document.createElement("div");
    scene.style.cssText = `width:${S}px;height:${S}px;position:relative;transform-style:preserve-3d;transition:transform .25s cubic-bezier(.25,.46,.45,.94);`;
    const basePositions = {
      front: [14.2857, 14.2857, `translateZ(${S / 2}px)`],
      back: [42.8571, 14.2857, `rotateY(180deg) translateZ(${S / 2}px)`],
      right: [28.5714, 14.2857, `rotateY(90deg) translateZ(${S / 2}px)`],
      left: [0, 14.2857, `rotateY(-90deg) translateZ(${S / 2}px)`],
      top: [14.2857, 0, `rotateX(90deg) translateZ(${S / 2}px)`],
      bottom: [28.5714, 0, `rotateX(-90deg) translateZ(${S / 2}px)`],
    };
    const overlayPositions = {
      front: [71.4286, 14.2857, `translateZ(${S / 2}px)`],
      back: [100, 14.2857, `rotateY(180deg) translateZ(${S / 2}px)`],
      right: [57.1429, 14.2857, `rotateY(90deg) translateZ(${S / 2}px)`],
      left: [85.7143, 14.2857, `rotateY(-90deg) translateZ(${S / 2}px)`],
      top: [14.2857, 57.1429, `rotateX(90deg) translateZ(${S / 2}px)`],
      bottom: [28.5714, 57.1429, `rotateX(-90deg) translateZ(${S / 2}px)`],
    };

    function createCube(positions) {
      const s = document.createElement("div");
      s.style.cssText = `width:${S}px;height:${S}px;position:absolute;top:0;left:0;transform-style:preserve-3d;`;
      for (const face in positions) {
        const f = document.createElement("div");
        const p = positions[face];
        f.style.cssText = `position:absolute;width:${S}px;height:${S}px;background-image:url('${skin}');background-size:800% 800%;background-position:${p[0]}% ${p[1]}%;transform:${p[2]};image-rendering:pixelated;backface-visibility:hidden;`;
        s.appendChild(f);
      }
      return s;
    }

    const baseScene = createCube(basePositions);
    container.appendChild(baseScene);
    const overlayScene = createCube(overlayPositions);
    overlayScene.style.transform = "scale(1.05)";
    container.appendChild(overlayScene);
    container.style.perspective = "800px";

    if (headMoveHandler) document.removeEventListener("mousemove", headMoveHandler);
    if (headAnimFrameId) cancelAnimationFrame(headAnimFrameId);
    headTargetRy = 0;
    headTargetRx = 0;
    let currentRy = 0,
      currentRx = 0;
    headMoveHandler = (e) => {
      const rect = container.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const maxDist = Math.sqrt(window.innerWidth * window.innerWidth + window.innerHeight * window.innerHeight) / 2;
      const influence = Math.min(1, dist / (maxDist * 0.6));
      const angleX = Math.atan2(dy, window.innerWidth / 2);
      const angleY = Math.atan2(dx, window.innerHeight / 2);
      headTargetRy = Math.max(-30, Math.min(30, angleY * (180 / Math.PI) * 0.55));
      headTargetRx = Math.max(-20, Math.min(20, -angleX * (180 / Math.PI) * 0.55));
    };
    document.addEventListener("mousemove", headMoveHandler);
    (function animate() {
      currentRy += (headTargetRy - currentRy) * 0.08;
      currentRx += (headTargetRx - currentRx) * 0.08;
      const transform = `rotateY(${currentRy.toFixed(2)}deg) rotateX(${currentRx.toFixed(2)}deg)`;
      baseScene.style.transform = `scale(1) ${transform}`;
      overlayScene.style.transform = `scale(1.05) ${transform}`;
      headAnimFrameId = requestAnimationFrame(animate);
    })();
  }

  function renderHead3DStatic(container, id) {
    container.innerHTML = "";
    const skin = skinUrl(id);
    const S = container.clientWidth || 100;
    const basePositions = {
      front: [14.2857, 14.2857, `translateZ(${S / 2}px)`],
      back: [42.8571, 14.2857, `rotateY(180deg) translateZ(${S / 2}px)`],
      right: [28.5714, 14.2857, `rotateY(90deg) translateZ(${S / 2}px)`],
      left: [0, 14.2857, `rotateY(-90deg) translateZ(${S / 2}px)`],
      top: [14.2857, 0, `rotateX(90deg) translateZ(${S / 2}px)`],
      bottom: [28.5714, 0, `rotateX(-90deg) translateZ(${S / 2}px)`],
    };
    const overlayPositions = {
      front: [71.4286, 14.2857, `translateZ(${S / 2}px)`],
      back: [100, 14.2857, `rotateY(180deg) translateZ(${S / 2}px)`],
      right: [57.1429, 14.2857, `rotateY(90deg) translateZ(${S / 2}px)`],
      left: [85.7143, 14.2857, `rotateY(-90deg) translateZ(${S / 2}px)`],
      top: [14.2857, 57.1429, `rotateX(90deg) translateZ(${S / 2}px)`],
      bottom: [28.5714, 57.1429, `rotateX(-90deg) translateZ(${S / 2}px)`],
    };

    function createCube(positions) {
      const scene = document.createElement("div");
      scene.style.cssText = `width:${S}px;height:${S}px;position:absolute;top:0;left:0;transform-style:preserve-3d;`;
      for (const face in positions) {
        const f = document.createElement("div");
        const p = positions[face];
        f.style.cssText = `position:absolute;width:${S}px;height:${S}px;background-image:url('${skin}');background-size:800% 800%;background-position:${p[0]}% ${p[1]}%;transform:${p[2]};image-rendering:pixelated;backface-visibility:hidden;`;
        scene.appendChild(f);
      }
      return scene;
    }

    const baseScene = createCube(basePositions);
    container.appendChild(baseScene);
    const overlayScene = createCube(overlayPositions);
    overlayScene.style.transform = "scale(1.05)";
    container.appendChild(overlayScene);
    container.style.perspective = "800px";
  }

  /* ---------------- Leaderboard ---------------- */

  async function loadLeaderboard(force) {
    const { tf, sortBy, sortDir } = state.leaderboard;
    const grid = document.getElementById("leaderboardGrid");
    if (!force && state.leaderboard.rows) {
      renderLeaderboard(state.leaderboard.rows);
      return;
    }
    grid.innerHTML = '<div class="loading">Loading leaderboard...</div>';
    try {
      const fetched = await Promise.all(
        LB_CATEGORIES.map((c) =>
          getJSON(`${API}/getLeaderboard?category=${c}&type=count&days=${LB_DAYS[tf]}&limit=50`).catch(() => [])
        )
      );
      const byCat = {};
      LB_CATEGORIES.forEach((cat, i) => {
        const raw = (fetched[i] || []).map((p) => ({
          uuid: p.uuid,
          name: p.name,
          count: p.value || 0,
          avg: p.avg || 0,
        }));
        raw.sort((a, b) => {
          const av = sortBy === "avg" ? a.avg : a.count;
          const bv = sortBy === "avg" ? b.avg : b.count;
          if (av === bv) return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
          if (sortBy === "avg") return av - bv;
          return sortDir === "asc" ? av - bv : bv - av;
        });
        byCat[cat] = raw.slice(0, 3);
      });
      state.leaderboard.rows = byCat;
      renderLeaderboard(byCat);
    } catch (e) {
      grid.innerHTML = '<div class="loading">Failed to load leaderboard.</div>';
    }
  }

  function renderLeaderboard(byCat) {
    const grid = document.getElementById("leaderboardGrid");
    grid.innerHTML = "";
    if (!byCat) return;
    const sortBy = state.leaderboard.sortBy;
    const rankLabel = sortBy === "avg" ? "Best Avg" : "Most Enters";
    for (const cat of LB_CATEGORIES) {
      const players = byCat[cat] || [];
      const card = document.createElement("div");
      card.className = "lb-card";
      let rowsHtml = "";
      for (let i = 0; i < players.length; i++) {
        const p = players[i];
        const avatar = avatarUrl(p.uuid || p.name, 32);
        const mainVal = sortBy === "avg" ? fmt(p.avg) : p.count;
        const mainLabel = sortBy === "avg" ? "Avg" : "Enters";
        const otherVal = sortBy === "avg" ? p.count : fmt(p.avg);
        const otherLabel = sortBy === "avg" ? "Enters" : "Avg";
        rowsHtml += `<div class="lb-card-row" data-name="${escapeHtml(p.name)}" data-uuid="${escapeHtml(p.uuid || "")}">
          <div class="lb-card-rank">${i + 1}</div>
          <div class="lb-card-player">
            <img src="${avatar}" onerror="this.style.visibility='hidden'">
            <span class="lb-card-name">${escapeHtml(p.name)}</span>
          </div>
          <div class="lb-card-stats">
            <div class="lb-card-stat lb-card-stat-primary">
              <div class="lb-card-stat-val">${mainVal}</div>
              <div class="lb-card-stat-label">${mainLabel}</div>
            </div>
            <div class="lb-card-stat">
              <div class="lb-card-stat-val">${otherVal}</div>
              <div class="lb-card-stat-label">${otherLabel}</div>
            </div>
          </div>
        </div>`;
      }
      card.innerHTML = `<div class="lb-card-head">${SPLITS[cat]} <span class="lb-card-rank-label">${rankLabel}</span></div><div class="lb-card-list">${rowsHtml || '<div class="loading">No data.</div>'}</div>`;
      grid.appendChild(card);
    }
    grid.querySelectorAll(".lb-card-row").forEach((row) => {
      row.addEventListener("click", () => openProfile(row.dataset.name, row.dataset.uuid));
    });
  }

  /* ---------------- Search ---------------- */

  function seedSuggestions() {
    getJSON(`${API}/getLeaderboard?category=nether&type=count&days=30&limit=100`)
      .then((arr) => {
        for (const p of arr || []) if (p.name) cachePlayer(p.name, p.uuid);
      })
      .catch(() => {});
  }

  function addRecent(name) {
    state.recents = state.recents.filter((n) => n.toLowerCase() !== name.toLowerCase());
    state.recents.unshift(name);
    state.recents = state.recents.slice(0, 5);
    localStorage.setItem("paceman_recents", JSON.stringify(state.recents));
  }

  function renderRecents() {
    const wrap = document.getElementById("recentsList");
    if (state.recents.length === 0) {
      wrap.innerHTML = '<div class="loading">No recent searches yet.</div>';
      return;
    }
    wrap.innerHTML = "";
    for (const name of state.recents) {
      const item = document.createElement("div");
      item.className = "search-item";
      item.innerHTML = `<img src="${avatarUrl(name, 32)}" onerror="this.style.visibility='hidden'"><span class="search-item-name">${escapeHtml(name)}</span>`;
      item.addEventListener("click", () => {
        openProfile(name, state.playerCache[name.toLowerCase()]);
        closeSearch();
      });
      wrap.appendChild(item);
    }
  }

  function updateResults(q) {
    const wrap = document.getElementById("resultsList");
    const query = q.trim().toLowerCase();
    if (query === "") {
      wrap.innerHTML = '<div class="loading">Type a name to search.</div>';
      return;
    }
    const matches = Object.keys(state.playerCache)
      .filter((n) => n.includes(query))
      .slice(0, 10);
    if (matches.length === 0) {
      wrap.innerHTML = `<div class="loading">No matches. Press Enter to open "${escapeHtml(q.trim())}".</div>`;
      return;
    }
    wrap.innerHTML = "";
    for (const name of matches) {
      const uuid = state.playerCache[name];
      const item = document.createElement("div");
      item.className = "search-item";
      item.innerHTML = `<img src="${avatarUrl(uuid || name, 32)}" onerror="this.style.visibility='hidden'"><span class="search-item-name">${escapeHtml(name)}</span>`;
      item.addEventListener("click", () => {
        openProfile(name, uuid);
        closeSearch();
      });
      wrap.appendChild(item);
    }
  }

  function closeSearch() {
    document.getElementById("searchDropdown").classList.remove("visible");
    const input = document.getElementById("searchInput");
    input.blur();
  }

  function initSearch() {
    const input = document.getElementById("searchInput");
    const dropdown = document.getElementById("searchDropdown");
    input.addEventListener("focus", () => {
      dropdown.classList.add("visible");
      document.getElementById("searchResults").style.display = "none";
      document.getElementById("searchRecents").style.display = "block";
      renderRecents();
    });
    input.addEventListener("input", () => {
      document.getElementById("searchResults").style.display = "block";
      updateResults(input.value);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && input.value.trim() !== "") {
        const name = input.value.trim();
        openProfile(name, state.playerCache[name.toLowerCase()]);
        closeSearch();
      }
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".search-container")) dropdown.classList.remove("visible");
    });
  }

  /* ---------------- Filters ---------------- */

  function buildSplitFilters() {
    const wrap = document.getElementById("filterSplits");
    wrap.innerHTML = "";
    for (const split of SPLIT_ORDER) {
      const field = document.createElement("div");
      field.className = "filter-split";
      field.innerHTML = `
        <label>${SPLITS[split]}</label>
        <div class="time-input">
          <input type="text" id="filterSplit_${split}" placeholder="e.g. 2:30" min="0">
          <span>m:s</span>
        </div>`;
      wrap.appendChild(field);
    }
  }

  function initFilters() {
    buildSplitFilters();
    const overlay = document.getElementById("filterOverlay");
    const favCheckbox = document.getElementById("filterFavoritesOnly");
    document.getElementById("filterBtn").addEventListener("click", () => {
      document.getElementById("filterStreamingOnly").checked = state.filters.streamingOnly;
      if (favCheckbox) favCheckbox.checked = state.filters.favoritesOnly;
      for (const split of SPLIT_ORDER) {
        document.getElementById(`filterSplit_${split}`).value =
          state.filters.maxTime && state.filters.maxTime[split] != null ? state.filters.maxTime[split] : "";
      }
      overlay.classList.add("visible");
    });
    document.getElementById("closeFilter").addEventListener("click", () => overlay.classList.remove("visible"));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.remove("visible");
    });
    document.getElementById("applyFilters").addEventListener("click", () => {
      state.filters.streamingOnly = document.getElementById("filterStreamingOnly").checked;
      state.filters.favoritesOnly = favCheckbox ? favCheckbox.checked : false;
      const mt = {};
      for (const split of SPLIT_ORDER) {
        const sec = parseTimeToSec(document.getElementById(`filterSplit_${split}`).value);
        if (sec != null) mt[split] = sec;
      }
      state.filters.maxTime = Object.keys(mt).length ? mt : null;
      overlay.classList.remove("visible");
      renderLiveRuns();
    });
    document.getElementById("resetFilters").addEventListener("click", () => {
      state.filters = { streamingOnly: false, maxTime: null, favoritesOnly: false };
      overlay.classList.remove("visible");
      renderLiveRuns();
    });
  }

  /* ---------------- Themes ---------------- */

  function applyTheme(name) {
    if (!THEMES.some((t) => t.name === name)) name = THEMES[0].name;
    document.documentElement.dataset.theme = name;
    localStorage.setItem("paceman_theme", name);
    document.querySelectorAll("#themeOptions .theme-swatch").forEach((s) => {
      s.classList.toggle("active", s.dataset.theme === name);
    });
  }

  function initThemes() {
    const opts = document.getElementById("themeOptions");
    opts.innerHTML = "";
    for (const t of THEMES) {
      const sw = document.createElement("button");
      sw.className = "theme-swatch";
      sw.dataset.theme = t.name;
      sw.title = t.label;
      sw.style.background = `var(--swatch-${t.name})`;
      sw.addEventListener("click", () => applyTheme(t.name));
      opts.appendChild(sw);
    }
    document.getElementById("themeBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      opts.classList.toggle("visible");
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#themeSwitcher")) opts.classList.remove("visible");
    });
    applyTheme(localStorage.getItem("paceman_theme") || THEMES[0].name);
  }

  /* ---------------- Router ---------------- */

  function showPage(p) {
    if (state.page === p && p !== "profile" && p !== "home") return;
    state.page = p;
    document.querySelectorAll(".page").forEach((el) => el.classList.remove("active"));
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    if (state.comparison && state.comparison.active && p !== "profile") {
      state.comparison.active = false;
      const btn = document.getElementById("compareBtn");
      const panel = document.getElementById("comparePanel");
      const page = document.getElementById("page-profile");
      if (btn) btn.classList.remove("active");
      if (page) page.classList.remove("compare-mode");
      if (panel) panel.style.display = "none";
    }
    if (p === "home") {
      document.getElementById("page-home").classList.add("active");
      document.querySelector('[data-page="home"]').classList.add("active");
      document.getElementById("runsList").style.display = "";
      startLiveRunsPolling();
      if (!suppressNavPush) pushNav({ page: "home" });
    } else if (p === "favorites") {
      document.getElementById("page-favorites").classList.add("active");
      document.querySelector('[data-page="favorites"]').classList.add("active");
      renderFavorites();
      stopLiveRunsPolling();
      if (!suppressNavPush) pushNav({ page: "favorites" });
    } else if (p === "leaderboard") {
      document.getElementById("page-leaderboard").classList.add("active");
      document.querySelector('[data-page="leaderboard"]').classList.add("active");
      loadLeaderboard(false);
      stopLiveRunsPolling();
      if (!suppressNavPush) pushNav({ page: "leaderboard" });
    } else if (p === "profile") {
      document.getElementById("page-profile").classList.add("active");
    }
    const footer = document.getElementById("appFooter");
    if (footer) footer.style.display = p === "home" || p === "favorites" ? "" : "none";

    if (p !== "profile") {
      pauseHeadAnimation();
    }
  }

  function initRouter() {
    document.querySelector(".logo").addEventListener("click", () => showPage("home"));
    document.querySelectorAll(".nav-btn").forEach((b) => {
      b.addEventListener("click", () => showPage(b.dataset.page));
    });
    document.querySelectorAll("#liveSort .sort-btn").forEach((b) => {
      b.addEventListener("click", () => {
        state.liveSort = b.dataset.sort;
        document.querySelectorAll("#liveSort .sort-btn").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        renderLiveRuns();
      });
    });
    document.querySelectorAll("#profileTimeframes .timeframe-btn").forEach((b) => {
      b.addEventListener("click", () => {
        state.profile.tf = b.dataset.tf;
        document.querySelectorAll("#profileTimeframes .timeframe-btn").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        loadProfileStats();
        loadProfileRuns().then(() => renderRunHistoryChart());
      });
    });
    document.querySelectorAll("#leaderboardTimeframes .timeframe-btn").forEach((b) => {
      b.addEventListener("click", () => {
        state.leaderboard.tf = b.dataset.tf;
        state.leaderboard.rows = null;
        document.querySelectorAll("#leaderboardTimeframes .timeframe-btn").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        loadLeaderboard(true);
      });
    });
    document.querySelectorAll("#lbSortToggle .lb-sort-btn").forEach((b) => {
      b.addEventListener("click", () => {
        state.leaderboard.sortBy = b.dataset.sort;
        state.leaderboard.rows = null;
        document.querySelectorAll("#lbSortToggle .lb-sort-btn").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        loadLeaderboard(true);
      });
    });
    document.getElementById("viewAllRunsBtn").addEventListener("click", () => {
      document.getElementById("allRunsModal").classList.add("visible");
    });
    document.getElementById("closeAllRuns").addEventListener("click", () => {
      document.getElementById("allRunsModal").classList.remove("visible");
    });
    document.getElementById("allRunsModal").addEventListener("click", (e) => {
      if (e.target === document.getElementById("allRunsModal")) e.target.classList.remove("visible");
    });
  }

  /* ---------------- Comparison ---------------- */

  function parseAvg(avg) {
    if (typeof avg === 'number') return avg;
    if (!avg) return null;
    const sec = parseTimeToSec(avg);
    return sec != null ? sec : null;
  }

  function getStatArrow(type, val1, val2) {
    if (val1 == null && val2 == null) return '';
    if (val1 == null) return '<span class="cmp-arrow cmp-worse">▼</span>';
    if (val2 == null) return '<span class="cmp-arrow cmp-better">▲</span>';

    let isBetter;
    if (type === 'count' || type === 'rnph') {
      isBetter = val1 > val2;
    } else if (type === 'avg' || type === 'rpe') {
      isBetter = val1 < val2;
    } else {
      return '';
    }

    if (val1 === val2) return '<span class="cmp-arrow cmp-equal">=</span>';
    return isBetter
      ? '<span class="cmp-arrow cmp-better">▲</span>'
      : '<span class="cmp-arrow cmp-worse">▼</span>';
  }

  async function toggleComparison() {
    state.comparison.active = !state.comparison.active;
    const btn = document.getElementById("compareBtn");
    const panel = document.getElementById("comparePanel");
    const page = document.getElementById("page-profile");

    if (state.comparison.active) {
      btn.classList.add("active");
      page.classList.add("compare-mode");
      panel.style.display = "flex";

      state.comparison.tf = "session";
      state.comparison.player1 = {
        name: state.profile.name,
        uuid: state.profile.uuid,
        tf: "session",
        splits: null,
        nph: null
      };
      state.comparison.player2 = null;

      document.getElementById("compareCol1").innerHTML = "";
      document.getElementById("compareContent2").innerHTML = '<div class="loading">Search for a player to compare</div>';
      document.getElementById("compareResultsList").innerHTML = "";
      const searchInput = document.getElementById("compareSearchInput");
      if (searchInput) searchInput.value = "";

      buildComparisonCol1();
      await Promise.all([loadComparisonStats(1), loadComparisonSocials(1)]);
    } else {
      btn.classList.remove("active");
      page.classList.remove("compare-mode");
      panel.style.display = "none";
      state.comparison.player2 = null;
    }
  }

  function buildComparisonCol1() {
    const col = document.getElementById("compareCol1");
    const p1 = state.comparison.player1;
    col.innerHTML = `
      <div class="compare-spacer"></div>
      <div class="compare-player-header">
        <div class="profile-head-container" id="compareHead1"></div>
        <div class="profile-info">
          <h1 id="compareName1">${escapeHtml(p1.name)}</h1>
          <div class="profile-stats-row" id="compareStatsRow1"></div>
          <div class="social-links" id="compareSocials1"></div>
        </div>
      </div>
      <div class="timeframe-tabs compare-timeframes" id="compareTimeframes1">
        <button class="timeframe-btn active" data-tf="session">Session</button>
        <button class="timeframe-btn" data-tf="daily">Daily</button>
        <button class="timeframe-btn" data-tf="weekly">Weekly</button>
        <button class="timeframe-btn" data-tf="monthly">Monthly</button>
        <button class="timeframe-btn" data-tf="lifetime">Lifetime</button>
      </div>
      <div class="session-stats" id="compareSessionStats1"></div>
      <div class="profile-splits" id="compareSplits1"></div>
    `;

    if (p1.uuid) renderHead3DStatic(document.getElementById("compareHead1"), p1.uuid);
    loadComparisonSocials(1);

    document.querySelectorAll("#compareTimeframes1 .timeframe-btn").forEach((b) => {
      b.addEventListener("click", () => {
        state.comparison.tf = b.dataset.tf;
        document.querySelectorAll("#compareTimeframes1 .timeframe-btn").forEach((x) => x.classList.toggle("active", x.dataset.tf === b.dataset.tf));
        document.querySelectorAll("#compareTimeframes2 .timeframe-btn").forEach((x) => x.classList.toggle("active", x.dataset.tf === b.dataset.tf));
        Promise.all([loadComparisonStats(1), loadComparisonStats(2)]).then(() => {
          renderComparisonSide(1);
          renderComparisonSide(2);
        });
      });
    });
  }

  async function loadComparisonStats(side) {
    const player = side === 1 ? state.comparison.player1 : state.comparison.player2;
    if (!player || !player.name) return;

    const tf = state.comparison.tf;
    const hours = TF_HOURS[tf];
    const between = TF_BETWEEN[tf];

    try {
      const [stats, nph] = await Promise.all([
        getJSON(`${API}/getSessionStats?name=${encodeURIComponent(player.name)}&hours=${hours}&hoursBetween=${between}`),
        tf === "session" ? getJSON(`${API}/getNPH?name=${encodeURIComponent(player.name)}&hours=${hours}&hoursBetween=${between}`).catch(() => null) : Promise.resolve(null)
      ]);

      player.splits = stats;
      player.nph = nph;
      player.tf = tf;

      const p1 = state.comparison.player1;
      const p2 = state.comparison.player2;
      state.comparison.bothLoaded = !!(p1 && p1.splits && p2 && p2.splits);

      if (state.comparison.bothLoaded) {
        renderComparisonSide(1);
        renderComparisonSide(2);
      } else {
        renderComparisonSide(side);
      }
    } catch (e) {
      console.error("Failed to load comparison stats:", e);
    }
  }

  async function loadComparisonSocials(side) {
    const player = side === 1 ? state.comparison.player1 : state.comparison.player2;
    if (!player || !player.name) return;

    const socialsContainer = document.getElementById(`compareSocials${side}`);
    if (!socialsContainer) return;

    socialsContainer.innerHTML = "";
  }

  function renderComparisonSide(side) {
    const p1 = state.comparison.player1;
    const p2 = state.comparison.player2;
    const player = side === 1 ? p1 : p2;
    const other = side === 1 ? p2 : p1;
    const showArrows = state.comparison.bothLoaded;

    if (!player || !player.splits) return;

    const splitsContainer = document.getElementById(`compareSplits${side}`);
    if (splitsContainer) {
      splitsContainer.innerHTML = "";
      for (const key of SPLIT_ORDER) {
        const s = player.splits[key] || { count: 0, avg: "0:00" };
        const otherS = showArrows && other && other.splits ? (other.splits[key] || { count: 0, avg: "0:00" }) : null;

        const countArrow = showArrows ? getStatArrow("count", s.count, otherS ? otherS.count : null) : "";
        const avgArrow = showArrows ? getStatArrow("avg", parseAvg(s.avg), otherS ? parseAvg(otherS.avg) : null) : "";

        const card = document.createElement("div");
        card.className = "split-card";
        card.innerHTML = `<div class="split-name">${SPLITS[key]}</div><div class="split-value">${s.count}<span class="cmp-arrow-wrap">${countArrow}</span></div><div class="split-count">Avg ${s.avg}<span class="cmp-arrow-wrap">${avgArrow}</span></div>`;
        splitsContainer.appendChild(card);
      }
    }

    if (player.tf === "session" && player.nph) {
      const sessionContainer = document.getElementById(`compareSessionStats${side}`);
      if (sessionContainer) {
        const otherNph = showArrows && other && other.nph ? other.nph : null;
        const rnphArrow = showArrows ? getStatArrow("rnph", player.nph.rnph, otherNph ? otherNph.rnph : null) : "";
        const rpeArrow = showArrows ? getStatArrow("rpe", player.nph.rpe, otherNph ? otherNph.rpe : null) : "";
        sessionContainer.innerHTML = `
          <span class="stat-badge"><b>${player.nph.rnph.toFixed(2)}<span class="cmp-arrow-wrap">${rnphArrow}</span></b> NPH (IGT)</span>
          <span class="stat-badge"><b>${player.nph.rpe.toFixed(2)}<span class="cmp-arrow-wrap">${rpeArrow}</span></b> RPE</span>
        `;
      }
    } else {
      const sessionContainer = document.getElementById(`compareSessionStats${side}`);
      if (sessionContainer) sessionContainer.innerHTML = "";
    }

    const statsRow = document.getElementById(`compareStatsRow${side}`);
    if (statsRow) {
      const fin = player.splits.finish || { count: 0, avg: "0:00" };
      const otherFin = showArrows && other && other.splits ? (other.splits.finish || { count: 0, avg: "0:00" }) : null;
      statsRow.innerHTML = `
        <span class="stat-badge">${fin.count} <span class="cmp-arrow-wrap">${showArrows ? getStatArrow("count", fin.count, otherFin ? otherFin.count : null) : ""}</span> completions</span>
        <span class="stat-badge">Avg: ${fin.avg} <span class="cmp-arrow-wrap">${showArrows ? getStatArrow("avg", parseAvg(fin.avg), otherFin ? parseAvg(otherFin.avg) : null) : ""}</span></span>
      `;
    }
  }

  async function removeComparisonPlayer2() {
    state.comparison.player2 = null;
    state.comparison.bothLoaded = false;

    const content = document.getElementById("compareContent2");
    if (content) {
      content.innerHTML = '<div class="loading">Search for a player to compare</div>';
    }

    const clearBtn = document.getElementById("compareClearBtn");
    if (clearBtn) clearBtn.classList.remove("visible");

    const searchInput = document.getElementById("compareSearchInput");
    if (searchInput) searchInput.value = "";

    const resultsList = document.getElementById("compareResultsList");
    if (resultsList) resultsList.innerHTML = "";

    renderComparisonSide(1);
  }

  async function loadComparisonPlayer2(name, uuid) {
    if (!name) return;

    state.comparison.player2 = {
      name: name,
      uuid: uuid,
      tf: state.comparison.tf,
      splits: null,
      nph: null
    };

    const clearBtn = document.getElementById("compareClearBtn");
    if (clearBtn) clearBtn.classList.add("visible");

    const content = document.getElementById("compareContent2");
    content.innerHTML = `
      <div class="compare-player-header">
        <div class="profile-head-container" id="compareHead2"></div>
        <div class="profile-info">
          <h1 id="compareName2">${escapeHtml(name)}</h1>
          <div class="profile-stats-row" id="compareStatsRow2"></div>
          <div class="social-links" id="compareSocials2"></div>
        </div>
      </div>
      <div class="timeframe-tabs compare-timeframes" id="compareTimeframes2">
        <button class="timeframe-btn active" data-tf="session">Session</button>
        <button class="timeframe-btn" data-tf="daily">Daily</button>
        <button class="timeframe-btn" data-tf="weekly">Weekly</button>
        <button class="timeframe-btn" data-tf="monthly">Monthly</button>
        <button class="timeframe-btn" data-tf="lifetime">Lifetime</button>
      </div>
      <div class="session-stats" id="compareSessionStats2"></div>
      <div class="profile-splits" id="compareSplits2"></div>
    `;

    if (!uuid) uuid = await resolveUUID(name);
    state.comparison.player2.uuid = uuid;

    if (uuid) renderHead3DStatic(document.getElementById("compareHead2"), uuid);

    document.querySelectorAll("#compareTimeframes2 .timeframe-btn").forEach((b) => {
      b.addEventListener("click", () => {
        state.comparison.tf = b.dataset.tf;
        document.querySelectorAll("#compareTimeframes1 .timeframe-btn").forEach((x) => x.classList.toggle("active", x.dataset.tf === b.dataset.tf));
        document.querySelectorAll("#compareTimeframes2 .timeframe-btn").forEach((x) => x.classList.toggle("active", x.dataset.tf === b.dataset.tf));
        Promise.all([loadComparisonStats(1), loadComparisonStats(2)]).then(() => {
          renderComparisonSide(1);
          renderComparisonSide(2);
        });
      });
    });

    await Promise.all([loadComparisonStats(2), loadComparisonSocials(2)]);
  }

  function initComparisonSearch() {
    const input = document.getElementById("compareSearchInput");
    const dropdown = document.getElementById("compareSearchDropdown");
    const resultsList = document.getElementById("compareResultsList");

    if (!input) return;

    input.addEventListener("focus", () => {
      dropdown.classList.add("visible");
      renderComparisonRecents();
    });

    input.addEventListener("input", () => {
      dropdown.classList.add("visible");
      updateComparisonResults(input.value);
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && input.value.trim() !== "") {
        const name = input.value.trim();
        loadComparisonPlayer2(name, state.playerCache[name.toLowerCase()]);
        dropdown.classList.remove("visible");
      }
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".compare-search")) dropdown.classList.remove("visible");
    });
  }

  function initFavoritesSearch() {
    const input = document.getElementById("favSearchInput");
    const dropdown = document.getElementById("favSearchDropdown");
    const resultsList = document.getElementById("favResultsList");

    if (!input) return;

    input.addEventListener("focus", () => {
      dropdown.classList.add("visible");
      resultsList.innerHTML = '<div class="loading">Type a name to search and add to favorites.</div>';
    });

    input.addEventListener("input", () => {
      dropdown.classList.add("visible");
      updateFavoritesSearchResults(input.value);
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && input.value.trim() !== "") {
        const name = input.value.trim();
        if (!isFavorite(name)) {
          toggleFavorite(name);
        }
        renderFavorites();
        input.value = "";
        dropdown.classList.remove("visible");
      }
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".search-container") || !e.target.closest("#page-favorites")) {
        dropdown.classList.remove("visible");
      }
    });
  }

  function updateFavoritesSearchResults(q) {
    const wrap = document.getElementById("favResultsList");
    const query = q.trim().toLowerCase();
    if (query === "") {
      wrap.innerHTML = '<div class="loading">Type a name to search and add to favorites.</div>';
      return;
    }
    const matches = Object.keys(state.playerCache)
      .filter((n) => n.includes(query))
      .slice(0, 10);
    if (matches.length === 0) {
      wrap.innerHTML = `<div class="loading">No matches. Press Enter to add "${escapeHtml(q.trim())}" as a favorite.</div>`;
      return;
    }
    wrap.innerHTML = "";
    for (const name of matches) {
      const uuid = state.playerCache[name];
      const item = document.createElement("div");
      item.className = "search-item";
      const isFav = isFavorite(name);
      item.innerHTML = `<img src="${avatarUrl(uuid || name, 32)}" onerror="this.style.visibility='hidden'"><span class="search-item-name">${escapeHtml(name)}</span>${isFav ? '<span class="search-item-meta">★ Favorited</span>' : ''}`;
      item.addEventListener("click", () => {
        if (!isFavorite(name)) {
          toggleFavorite(name);
        }
        renderFavorites();
        document.getElementById("favSearchDropdown").classList.remove("visible");
        document.getElementById("favSearchInput").value = "";
      });
      wrap.appendChild(item);
    }
  }

  function renderComparisonRecents() {
    const wrap = document.getElementById("compareResultsList");
    if (state.recents.length === 0) {
      wrap.innerHTML = '<div class="loading">No recent searches yet.</div>';
      return;
    }
    wrap.innerHTML = "";
    for (const name of state.recents) {
      const item = document.createElement("div");
      item.className = "search-item";
      item.innerHTML = `<img src="${avatarUrl(name, 32)}" onerror="this.style.visibility='hidden'"><span class="search-item-name">${escapeHtml(name)}</span>`;
      item.addEventListener("click", () => {
        loadComparisonPlayer2(name, state.playerCache[name.toLowerCase()]);
        document.getElementById("compareSearchDropdown").classList.remove("visible");
      });
      wrap.appendChild(item);
    }
  }

  function updateComparisonResults(q) {
    const wrap = document.getElementById("compareResultsList");
    const query = q.trim().toLowerCase();
    if (query === "") {
      wrap.innerHTML = '<div class="loading">Type a name to search.</div>';
      return;
    }
    const matches = Object.keys(state.playerCache)
      .filter((n) => n.includes(query))
      .slice(0, 10);
    if (matches.length === 0) {
      wrap.innerHTML = `<div class="loading">No matches. Press Enter to search "${escapeHtml(q.trim())}".</div>`;
      return;
    }
    wrap.innerHTML = "";
    for (const name of matches) {
      const uuid = state.playerCache[name];
      const item = document.createElement("div");
      item.className = "search-item";
      item.innerHTML = `<img src="${avatarUrl(uuid || name, 32)}" onerror="this.style.visibility='hidden'"><span class="search-item-name">${escapeHtml(name)}</span>`;
      item.addEventListener("click", () => {
        loadComparisonPlayer2(name, uuid);
        document.getElementById("compareSearchDropdown").classList.remove("visible");
      });
      wrap.appendChild(item);
    }
  }

  let devMode = false;

  function addDevLog(type, message) {
    const consoleEl = document.getElementById("devConsole");
    if (!consoleEl) return;
    const entry = document.createElement("div");
    entry.className = "log-entry";
    const time = new Date().toLocaleTimeString();
    entry.innerHTML = `<span class="log-time">${time}</span><span class="log-type ${type}">${type.toUpperCase()}</span><span class="log-message">${escapeHtml(String(message))}</span>`;
    consoleEl.appendChild(entry);
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  function toggleDevMode() {
    devMode = !devMode;
    const panel = document.getElementById("devPanel");
    const btn = document.getElementById("devModeBtn");
    if (devMode) {
      panel.classList.add("visible");
      btn.classList.add("active");
      addDevLog("info", "Dev mode enabled");
    } else {
      panel.classList.remove("visible");
      btn.classList.remove("active");
      addDevLog("info", "Dev mode disabled");
    }
  }

  function devClearCache() {
    try {
      localStorage.clear();
      addDevLog("info", "localStorage cleared");
    } catch (e) {
      addDevLog("error", "Failed to clear cache: " + e.message);
    }
  }

  function init() {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    initRouter();
    initSearch();
    initFilters();
    initThemes();
    seedSuggestions();
    const compareBtn = document.getElementById("compareBtn");
    if (compareBtn) {
      compareBtn.addEventListener("click", toggleComparison);
    }
    const compareClearBtn = document.getElementById("compareClearBtn");
    if (compareClearBtn) {
      compareClearBtn.addEventListener("click", removeComparisonPlayer2);
    }
    const favoriteBtn = document.getElementById("favoriteBtn");
    if (favoriteBtn) {
      favoriteBtn.addEventListener("click", () => {
        if (state.profile.name) {
          toggleFavorite(state.profile.name);
        }
      });
    }
    const chartStatSelect = document.getElementById("chartStatSelect");
    if (chartStatSelect) {
      chartStatSelect.addEventListener("change", () => {
        renderRunHistoryChart();
      });
    }
    const chartToggleBtn = document.getElementById("chartToggleBtn");
    if (chartToggleBtn) {
      chartToggleBtn.addEventListener("click", () => {
        state.profile.chartVisible = !state.profile.chartVisible;
        chartToggleBtn.classList.toggle("hidden", !state.profile.chartVisible);
        const profileChart = document.getElementById("profileChart");
        if (profileChart) {
          profileChart.classList.toggle("hidden", !state.profile.chartVisible);
        }
        renderRunHistoryChart();
      });
    }
    initComparisonSearch();
    initFavoritesSearch();
    initSplitDetail();
    const autoOpenBtn = document.getElementById("autoOpenTwitchBtn");
    if (autoOpenBtn) {
      autoOpenBtn.classList.toggle("active", state.autoOpenTwitch);
      autoOpenBtn.addEventListener("click", () => {
        state.autoOpenTwitch = !state.autoOpenTwitch;
        localStorage.setItem("paceman_autoOpenTwitch", state.autoOpenTwitch);
        autoOpenBtn.classList.toggle("active", state.autoOpenTwitch);
        if (state.autoOpenTwitch) {
          autoOpenedStreams.clear();
          for (const r of state.liveRuns) {
            const twitch = r.user && r.user.liveAccount ? r.user.liveAccount : null;
            if (twitch) {
              autoOpenedStreams.add(twitch);
              openTwitch(twitch);
            }
          }
        }
      });
    }
    const refreshBtn = document.getElementById("refreshBtn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", async () => {
        refreshBtn.classList.add("refreshing");
        try {
          if (state.page === "home") {
            await loadLiveRuns();
          } else if (state.page === "profile") {
            await Promise.all([loadProfileStats(), loadProfileRuns()]);
          } else if (state.page === "leaderboard") {
            await loadLeaderboard(true);
          }
        } finally {
          refreshBtn.classList.remove("refreshing");
        }
      });
    }
    document.getElementById("closeRunDetail").addEventListener("click", closeRunDetail);
    const shareRunBtn = document.getElementById("shareRunBtn");
    if (shareRunBtn) {
      shareRunBtn.addEventListener("click", async () => {
        if (!currentRunId) return;
        const url = `${API}/getWorld?worldId=${encodeURIComponent(currentRunId)}`;
        try {
          await navigator.clipboard.writeText(url);
          shareRunBtn.classList.add("copied");
          setTimeout(() => shareRunBtn.classList.remove("copied"), 1500);
        } catch (e) {
          console.log("Share failed", e);
        }
      });
    }
    document.getElementById("runDetailOverlay").addEventListener("click", (e) => {
      if (e.target === document.getElementById("runDetailOverlay")) closeRunDetail();
    });
    document.getElementById("vodSeekBack").addEventListener("click", () => {
      if (document.getElementById("runDetailVod").style.display !== "none") seekVod(-5);
    });
    document.getElementById("vodSeekForward").addEventListener("click", () => {
      if (document.getElementById("runDetailVod").style.display !== "none") seekVod(5);
    });
    document.getElementById("vodSpeed").addEventListener("click", toggleVodSpeed);
    document.addEventListener("mouseleave", () => {
      headTargetRy = 0;
      headTargetRx = 0;
    });
    document.getElementById("streamsToggle").addEventListener("click", () => {
      const dock = document.getElementById("twitchDock");
      if (!dock.classList.contains("visible")) {
        dock.classList.add("visible");
        dock.classList.remove("collapsed");
      } else {
        dock.classList.toggle("collapsed");
      }
      refreshDockLayout();
    });
    document.getElementById("twitchDockCollapse").addEventListener("click", () => {
      document.getElementById("twitchDock").classList.toggle("collapsed");
      refreshDockLayout();
    });
    document.getElementById("twitchDockLayout").addEventListener("click", () => {
      state.dockLayout = state.dockLayout === "bottom" ? "side" : "bottom";
      renderDockLayout();
    });
    updateStreamsUI();
    loadLiveRuns();
    navHistory.length = 0;
    navHistory.push({ page: "home" });
    navIndex = 0;
    document.addEventListener("mousedown", (e) => {
      if (e.button === 3) { e.preventDefault(); goBack(); }
      if (e.button === 4) { e.preventDefault(); goForward(); }
    });
    startLiveRunsPolling();
    window.addEventListener("focus", () => {
      if (state.page === "home") startLiveRunsPolling();
    });
    window.addEventListener("blur", () => {
      stopLiveRunsPolling();
    });
    const debouncedResizeHead = debounce(() => {
      if (state.profile.uuid && document.getElementById("page-profile").classList.contains("active")) {
        renderHead3D(document.getElementById("head3dContainer"), state.profile.uuid);
      }
    }, 200);
    window.addEventListener("resize", debouncedResizeHead);
    const footerLink = document.querySelector(".footer-link");
    if (footerLink) {
      footerLink.addEventListener("click", (e) => {
        e.preventDefault();
        if (window.pacemanAPI && window.pacemanAPI.openExternal) {
          window.pacemanAPI.openExternal(footerLink.href);
        }
      });
    }
    const devModeBtn = document.getElementById("devModeBtn");
    if (devModeBtn) {
      devModeBtn.addEventListener("click", toggleDevMode);
    }
    const devClearCacheBtn = document.getElementById("devClearCacheBtn");
    if (devClearCacheBtn) {
      devClearCacheBtn.addEventListener("click", devClearCache);
    }
    const devClosePanelBtn = document.getElementById("devClosePanelBtn");
    if (devClosePanelBtn) {
      devClosePanelBtn.addEventListener("click", toggleDevMode);
    }
    window.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d") {
        toggleDevMode();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
