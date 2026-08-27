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
    profile: { name: null, uuid: null, tf: "daily", allRuns: [], timeframeRuns: [], pbRun: null, page: 1, socials: null, chartVisible: true, allRunsSort: "newest" },
    leaderboard: { tf: "weekly", rows: null, sortBy: "enters", sortDir: "desc", pages: {} },
    dailyLeaderboardTop10: {},
    comparison: { active: false, tf: "session", player1: null, player2: null, bothLoaded: false },
  };

  const settings = {
    pbNotifications: JSON.parse(localStorage.getItem("paceman_settings_pb_notifications") || "true"),
    liveNotifications: JSON.parse(localStorage.getItem("paceman_settings_live_notifications") || "false"),
    notificationSound: JSON.parse(localStorage.getItem("paceman_settings_notification_sound") || "false"),
    notificationVolume: parseFloat(localStorage.getItem("paceman_settings_notification_volume") || "0.5"),
    animationsEnabled: JSON.parse(localStorage.getItem("paceman_settings_animations_enabled") || "true"),
  };

  const autoOpenedStreams = new Set();

  console.log('APP LOADED - looking for download button:', document.getElementById("downloadRunBtn"));
  
  let currentVod = { id: null, offset: 0, currentTime: 0 };
  let currentRunId = null;
  let currentRunData = null;
  let currentDownloadId = null;
  let splitDetailState = { split: null, runs: [], page: 1, perPage: 10, sortAsc: true };
  let vodTrimState = { active: false, timelineStart: 0, timelineDuration: 0, selectionStart: 0, selectionEnd: 0 };

  function playNotificationSound() {
    if (!settings.notificationSound) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const volume = Math.max(0, Math.min(1, settings.notificationVolume || 0.5));
      const now = ctx.currentTime;
      [523.25, 659.25].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(volume * 0.3, now + i * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.15);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.12);
        osc.stop(now + i * 0.12 + 0.2);
      });
    } catch (e) {
      console.warn("Notification sound failed", e);
    }
  }

  const formatTime = (totalSeconds) => {
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const mm = m.toString().padStart(2, "0");
    const ss = sec.toString().padStart(2, "0");
    if (h > 0) return `${h}:${mm}:${ss}`;
    return `${mm}:${ss}`;
  };

  const parseTime = (str) => {
    const text = String(str).trim();
    const parts = text.split(":").map(Number);
    if (parts.length === 3 && !parts.some(isNaN)) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2 && !parts.some(isNaN)) return parts[0] * 60 + parts[1];
    const num = Number(text);
    return isNaN(num) ? 0 : num;
  };

  function updateVodTrim(start, duration) {
    vodTrimState.timelineStart = start;
    vodTrimState.timelineDuration = Math.max(1, duration);
    vodTrimState.selectionStart = start;
    vodTrimState.selectionEnd = start + duration;
    const trimStart = document.getElementById("vodTrimStart");
    const trimEnd = document.getElementById("vodTrimEnd");
    const trimDuration = document.getElementById("vodTrimDuration");
    const trimEnabled = document.getElementById("vodTrimEnabled");
    const trim = document.getElementById("vodTrim");
    const trimInfo = document.getElementById("vodTrimInfo");
    const startMarker = document.getElementById("vodTrimStartMarker");
    const endMarker = document.getElementById("vodTrimEndMarker");
    const selectedRegion = document.getElementById("vodSelectedRegion");
    if (trimStart) trimStart.value = formatTime(vodTrimState.selectionStart);
    if (trimEnd) trimEnd.value = formatTime(vodTrimState.selectionEnd);
    if (trimDuration) trimDuration.value = formatTime(vodTrimState.selectionEnd - vodTrimState.selectionStart);
    if (trimEnabled) trimEnabled.checked = false;
    if (trim) trim.style.display = "none";
    if (!vodTrimState.timelineDuration) {
      if (trimInfo) trimInfo.textContent = "";
      if (startMarker) startMarker.style.left = "0%";
      if (endMarker) endMarker.style.left = "0%";
      if (selectedRegion) { selectedRegion.style.left = "0%"; selectedRegion.style.width = "0%"; }
      return;
    }
    updateTrimMarkers();
  }

  function updateSplitMarkers(run, vodOffset) {
    const container = document.getElementById("vodSplitMarkers");
    if (!container || !run) return;
    container.innerHTML = "";
    if (!vodTrimState.timelineDuration) return;
    
    for (const split of SPLIT_ORDER) {
      const igtMs = run[split];
      if (igtMs == null || igtMs <= 0) continue;
      const vodTime = vodOffset + igtMs / 1000;
      const pct = ((vodTime - vodTrimState.timelineStart) / vodTrimState.timelineDuration) * 100;
      if (pct < 0 || pct > 100) continue;
      
      const marker = document.createElement("div");
      marker.className = "vod-split-marker";
      marker.style.left = pct + "%";
      marker.dataset.label = SPLITS[split];
      marker.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!currentVod.id) return;
        currentVod.currentTime = vodTime;
        seekVod(0, vodTime);
      });
      container.appendChild(marker);
    }
  }

  const updateTrimMarkers = () => {
    if (!vodTrimState.timelineDuration) return;
    const startPct = Math.max(0, Math.min(100, ((vodTrimState.selectionStart - vodTrimState.timelineStart) / vodTrimState.timelineDuration) * 100));
    const endPct = Math.max(0, Math.min(100, ((vodTrimState.selectionEnd - vodTrimState.timelineStart) / vodTrimState.timelineDuration) * 100));
    const startMarker = document.getElementById("vodTrimStartMarker");
    const endMarker = document.getElementById("vodTrimEndMarker");
    const selectedRegion = document.getElementById("vodSelectedRegion");
    const trimInfo = document.getElementById("vodTrimInfo");
    const trimStart = document.getElementById("vodTrimStart");
    const trimEnd = document.getElementById("vodTrimEnd");
    const trimDuration = document.getElementById("vodTrimDuration");
    if (startMarker) startMarker.style.left = startPct + "%";
    if (endMarker) endMarker.style.left = endPct + "%";
    if (selectedRegion) {
      selectedRegion.style.left = startPct + "%";
      selectedRegion.style.width = Math.max(0, endPct - startPct) + "%";
    }
    if (trimInfo) trimInfo.textContent = `${formatTime(vodTrimState.selectionStart)} → ${formatTime(vodTrimState.selectionEnd)} (${formatTime(vodTrimState.selectionEnd - vodTrimState.selectionStart)})`;
    if (trimStart) trimStart.value = formatTime(vodTrimState.selectionStart);
    if (trimEnd) trimEnd.value = formatTime(vodTrimState.selectionEnd);
    if (trimDuration) trimDuration.value = formatTime(vodTrimState.selectionEnd - vodTrimState.selectionStart);
  };

  window.addEventListener("paceman-protocol-args", (e) => {
    const args = e.detail || {};
    if (args.path === "/run" && args.query && args.query.id) {
      const runId = String(args.query.id);
      const playerName = args.query.name || "";
      openRunDetail(runId, playerName, null);
    } else if (args.path.startsWith("/player/")) {
      const name = decodeURIComponent(args.path.replace("/player/", "").split("/")[0]);
      if (name) openProfile(name, null);
    }
  });

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
      let minDist = 14;
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
    const padding = { top: 24, right: 24, bottom: 32, left: 56 };
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

    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.moveTo(chartPoints[0].x, chartPoints[0].y);
    for (let i = 1; i < chartPoints.length; i++) {
      const prev = chartPoints[i - 1];
      const curr = chartPoints[i];
      const cpx = (prev.x + curr.x) / 2;
      ctx.bezierCurveTo(cpx, prev.y, cpx, curr.y, curr.x, curr.y);
    }
    ctx.strokeStyle = "#a78bfa";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    for (const p of chartPoints) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(124, 58, 237, 0.15)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "#a78bfa";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
    }

    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "11px Inter, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(fmt(maxTime), padding.left - 10, padding.top + 4);
    ctx.fillText(fmt(minTime), padding.left - 10, padding.top + chartH);

    ctx.textAlign = "center";
    ctx.fillText("Oldest", padding.left, height - 10);
    ctx.fillText("Newest", width - padding.right, height - 10);
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
      const time = run && run.current ? fmt(run.current) : null;

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

  async function getNextRunBoundary(runId, name) {
    try {
      const hours = TF_HOURS[state.profile.tf] || 24;
      const between = TF_BETWEEN[state.profile.tf] || 24;
      const runs = await getJSON(`${API}/getRecentRuns?name=${encodeURIComponent(name)}&hours=${hours}&hoursBetween=${between}&limit=5000`);
      if (!Array.isArray(runs) || runs.length < 2) return null;
      
      const currentIdx = runs.findIndex(r => (r.id || r.worldId || r.runId || r._id) == runId);
      if (currentIdx < 0 || currentIdx >= runs.length - 1) return null;
      
      const nextRun = runs[currentIdx + 1];
      if (nextRun.vodOffset != null) {
        return { type: 'vodOffset', value: nextRun.vodOffset };
      }
      if (nextRun.insertTime || nextRun.createdAt || nextRun.timestamp || nextRun.startTime) {
        const nextTs = nextRun.insertTime || nextRun.createdAt || nextRun.timestamp || nextRun.startTime;
        return { type: 'timestamp', value: nextTs };
      }
      return null;
    } catch (e) {
      return null;
    }
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
    state.profile = { name, uuid: uuid || null, tf: "daily", allRuns: [], timeframeRuns: [], pbRun: null, page: 1, socials: null, chartVisible: true, selectedSession: null, selectedSessionData: null };
    const profileName = document.getElementById("profileName");
    const profileStatsRow = document.getElementById("profileStatsRow");
    const profileSplits = document.getElementById("profileSplits");
    const profileBestRuns = document.getElementById("profileBestRuns");
    const headContainer = document.getElementById("head3dContainer");
    const socialLinks = document.getElementById("socialLinks");
    const sidebar = document.getElementById("profileSidebar");
    const toggleBtn = document.getElementById("sidebarToggleBtn");
    if (sidebar) sidebar.classList.add("hidden");
    if (toggleBtn) toggleBtn.classList.remove("active");
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
    if (uuid && headContainer) renderHeadForProfile(headContainer, uuid);
    addRecent(name);
    await Promise.all([loadProfileStats(), loadProfileRuns(), loadProfileSocials(name)]);
    await loadTwitchFromRuns(name);
    updateFavoriteButton();
    await updateSessionStats();
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
    await loadDailyTop10();
    const isTop10 = state.dailyLeaderboardTop10[uuid || name];
    if (isTop10) {
      const existing = document.getElementById("profileTop10Badge");
      if (!existing && profileStatsRow) {
        const badge = document.createElement("span");
        badge.id = "profileTop10Badge";
        badge.className = "stat-badge lb-top10-badge";
        const cats = isTop10.map((c) => SPLITS[c] || c).join(", ");
        badge.setAttribute("data-tooltip", `Top 10 Daily: ${cats}`);
        badge.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="margin-right:4px"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>Top 10 Daily`;
        profileStatsRow.insertBefore(badge, profileStatsRow.firstChild);
      }
    }
  }

  async function updateSessionStats() {
    const sessionBox = document.getElementById("sessionStats");
    const sessionWrap = document.getElementById("sessionStatsWrap");
    if (!sessionBox) return;
    const tf = state.profile.tf;
    const name = state.profile.name;
    if (!name) return;
    if (tf !== "session") {
      sessionBox.innerHTML = "";
      if (sessionWrap) sessionWrap.style.display = "none";
      return;
    }
    const hours = TF_HOURS[tf] || 24;
    const between = TF_BETWEEN[tf] || 24;
    if (tf === "session") {
      try {
        const nph = await getJSON(`${API}/getNPH?name=${encodeURIComponent(name)}&hours=${hours}&hoursBetween=${between}`);
        const duration = calcSessionDuration(state.profile.timeframeRuns);
        sessionBox.innerHTML = renderSessionStats(nph, duration);
        if (sessionWrap) sessionWrap.style.display = "";
      } catch (e) {
        sessionBox.innerHTML = "";
        if (sessionWrap) sessionWrap.style.display = "none";
      }
    } else {
      const duration = calcSessionDuration(state.profile.timeframeRuns);
      sessionBox.innerHTML = renderSessionStats({ rnph: 0, rpe: 0 }, duration);
      if (sessionWrap) sessionWrap.style.display = "";
    }
  }

  async function loadProfileStats() {
    const { name, tf } = state.profile;
    const hours = TF_HOURS[tf],
      between = TF_BETWEEN[tf];
    const wrap = document.getElementById("profileSplits");
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

  function calcSessionDuration(runs) {
    if (!runs || runs.length === 0) return null;
    const times = runs.map((r) => r.insertTime || r.createdAt || r.timestamp || r.startTime || r.lastUpdated || r.time || r.updatedTime || r.realUpdated || 0).filter((t) => t > 0);
    if (times.length === 0) return null;
    const min = Math.min(...times);
    const max = Math.max(...times);
    const diff = max - min;
    if (diff <= 0) return "0m";
    const hours = Math.floor(diff / 3600);
    const minutes = Math.floor((diff % 3600) / 60);
    if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h`;
    return `${minutes}m`;
  }

  function renderSessionStats(n, durationText) {
    const badges = [
      ["NPH", (n.rnph || 0).toFixed(2)],
      ["RPE", (n.rpe || 0).toFixed(2)],
    ];
    badges.push(["Session", durationText || "--"]);
    return badges
      .map(([l, v]) => `<span class="stat-badge"><b>${v}</b> ${l}</span>`)
      .join("");
  }

  function getRunTimestamp(r) {
    return r.insertTime || r.createdAt || r.timestamp || r.startTime || r.lastUpdated || r.time || r.updatedTime || r.realUpdated || 0;
  }

  function groupRunsIntoSessions(runs, gapHours = 2) {
    if (!runs || runs.length === 0) return [];
    const sorted = [...runs].sort((a, b) => getRunTimestamp(a) - getRunTimestamp(b));
    const sessions = [];
    let current = null;
    const gapSec = gapHours * 60 * 60;
    for (const run of sorted) {
      const ts = getRunTimestamp(run);
      if (ts <= 0) continue;
      if (!current || ts - current.endTime > gapSec) {
        current = { id: ts.toString(), startTime: ts, endTime: ts, runs: [], runCount: 0, duration: "0m", pb: null, avg: null, netherAvg: null, furthestState: null, furthestTime: null };
        sessions.push(current);
      }
      current.runs.push(run);
      current.runCount++;
      current.endTime = ts;
    }
    for (const s of sessions) {
      const times = s.runs.map(getRunTimestamp).filter((t) => t > 0);
      if (times.length > 0) {
        const min = Math.min(...times);
        const max = Math.max(...times);
        const diff = max - min;
        const hours = Math.floor(diff / 3600);
        const minutes = Math.floor((diff % 3600) / 60);
        s.duration = hours > 0 && minutes > 0 ? `${hours}h ${minutes}m` : hours > 0 ? `${hours}h` : `${minutes}m`;
        const finishes = s.runs.filter((r) => r.finish != null).map((r) => r.finish);
        if (finishes.length > 0) {
          s.pb = Math.min(...finishes);
          s.avg = finishes.reduce((a, b) => a + b, 0) / finishes.length;
        }
        const nethers = s.runs.filter((r) => r.nether != null).map((r) => r.nether);
        if (nethers.length > 0) {
          s.netherAvg = nethers.reduce((a, b) => a + b, 0) / nethers.length;
        }
        let bestIdx = -1;
        let bestTime = null;
        let bestKey = null;
        for (const r of s.runs) {
          const fi = furthestIndex(r);
          if (fi.idx > bestIdx || (fi.idx === bestIdx && fi.time < bestTime)) {
            bestIdx = fi.idx;
            bestTime = fi.time;
            bestKey = fi.key;
          }
        }
        if (bestKey) {
          s.furthestState = SPLITS[bestKey] || bestKey;
          s.furthestTime = bestTime;
        }
      }
      s.startTime = times.length > 0 ? Math.min(...times) : s.startTime;
      s.endTime = times.length > 0 ? Math.max(...times) : s.endTime;
    }
    return sessions.sort((a, b) => b.startTime - a.startTime);
  }

  function renderRecentSessions(sessions, activeSessionId) {
    const wrap = document.getElementById("recentSessions");
    if (!wrap) return;
    if (!sessions || sessions.length === 0) {
      wrap.innerHTML = '<div class="loading">No sessions yet.</div>';
      return;
    }
    const recent = (sessions || []).slice(0, 10);
    wrap.innerHTML = recent.map((s) => {
      const date = new Date(s.startTime * 1000);
      const dateStr = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      const timeStr = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
      const furthestStr = s.furthestState && s.furthestTime != null ? `${s.furthestState}: ${fmt(s.furthestTime)}` : "—";
      const avgStr = s.netherAvg != null ? fmt(Math.round(s.netherAvg)) : "—";
      const isActive = activeSessionId === s.id;
      return `<div class="session-card${isActive ? " active" : ""}" data-session-id="${s.id}">
        <div class="session-card-header">
          <div class="session-card-date">${dateStr}</div>
          <div class="session-card-time">${timeStr}</div>
        </div>
        <div class="session-card-body">
          <div class="session-card-stat"><span class="session-card-stat-label">Duration</span><span class="session-card-stat-value">${s.duration}</span></div>
          <div class="session-card-stat"><span class="session-card-stat-label">Runs</span><span class="session-card-stat-value">${s.runCount}</span></div>
          <div class="session-card-stat"><span class="session-card-stat-label">Avg Nether</span><span class="session-card-stat-value">${avgStr}</span></div>
        </div>
        <div class="session-card-footer">
          <div class="session-card-furthest">${furthestStr}</div>
        </div>
      </div>`;
    }).join("");
    wrap.querySelectorAll(".session-card").forEach((card) => {
      card.addEventListener("click", () => {
        const sessionId = card.dataset.sessionId;
        openSession(sessionId);
      });
    });
  }

  function showSessionInMain(session) {
    const splitsWrap = document.getElementById("profileSplits");
    const completionEl = document.getElementById("profileCompletion");
    const avgEl = document.getElementById("profileAvg");
    const bestRunsTitle = document.getElementById("profileBestRunsTitle");
    const bestRuns = document.getElementById("profileBestRuns");
    if (splitsWrap) splitsWrap.innerHTML = "";
    if (!session || !session.runs || session.runs.length === 0) {
      if (splitsWrap) splitsWrap.innerHTML = '<div class="loading">No runs in this session.</div>';
      return;
    }
    for (const key of SPLIT_ORDER) {
      const values = session.runs.filter((r) => r[key] != null).map((r) => r[key]);
      const count = values.length;
      const avg = count > 0 ? fmt(Math.round(values.reduce((a, b) => a + b, 0) / count)) : "0:00";
      const card = document.createElement("div");
      card.className = "split-card";
      card.innerHTML = `<div class="split-name">${SPLITS[key]}</div><div class="split-value">${count}</div><div class="split-count">Avg ${avg}</div>`;
      card.addEventListener("click", () => openSplitDetail(key));
      if (splitsWrap) splitsWrap.appendChild(card);
    }
    const finishes = session.runs.filter((r) => r.finish != null).map((r) => r.finish);
    const finCount = finishes.length;
    const finAvg = finCount > 0 ? fmt(Math.round(finishes.reduce((a, b) => a + b, 0) / finCount)) : "0:00";
    if (completionEl) completionEl.textContent = `${finCount} completions`;
    if (avgEl) avgEl.textContent = `Avg: ${finAvg}`;
    if (bestRunsTitle) bestRunsTitle.textContent = "Session Runs";
    if (bestRuns) {
      bestRuns.innerHTML = "";
      const ranked = session.runs
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
      for (const item of ranked) {
        const div = document.createElement("div");
        div.className = "run-item";
        const runId = item.r.id || item.r.worldId || item.r.runId || item.r._id || null;
        div.innerHTML = `<span class="run-split">${SPLITS[item.f.key] || "Run"}</span><span class="run-time">${fmt(item.f.time)}</span>`;
        div.addEventListener("click", () => {
          if (runId) openRunDetail(runId, state.profile.name, item.r);
        });
        bestRuns.appendChild(div);
      }
    }
  }

  function clearSessionSelection() {
    state.profile.selectedSession = null;
    state.profile.selectedSessionData = null;
    const backBtn = document.getElementById("sessionBackBtn");
    if (backBtn) backBtn.classList.remove("visible");
  }

  async function openSession(sessionId) {
    if (!state.profile.allRuns || state.profile.allRuns.length === 0) return;
    const sessions = groupRunsIntoSessions(state.profile.allRuns);
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    state.profile.tf = "session";
    state.profile.timeframeRuns = session.runs;
    state.profile.selectedSession = sessionId;
    state.profile.selectedSessionData = session;
    document.querySelectorAll("#profileTimeframes .timeframe-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.tf === "session");
    });
    renderRunHistoryChart();
    renderRecentSessions(sessions, sessionId);
    showSessionInMain(session);
    const backBtn = document.getElementById("sessionBackBtn");
    if (backBtn) backBtn.classList.add("visible");
    const shareBtn = document.getElementById("sessionShareBtn");
    if (shareBtn) shareBtn.title = "Copy session stats";
  }

  function renderProfileBestRuns() {
    const best = document.getElementById("profileBestRuns");
    const title = document.getElementById("profileBestRunsTitle");
    const tf = state.profile.tf;
    if (title) title.textContent = `Best ${tf.charAt(0).toUpperCase() + tf.slice(1)} Runs`;
    if (!best) return;
    const runs = state.profile.timeframeRuns || [];
    const ranked = runs
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

  async function loadProfileRuns() {
    const { name, tf } = state.profile;
    const generation = ++profileRunsGeneration;
    const best = document.getElementById("profileBestRuns");
    const title = document.getElementById("profileBestRunsTitle");
    if (title) title.textContent = `Best ${tf.charAt(0).toUpperCase() + tf.slice(1)} Runs`;
    if (best) best.innerHTML = '<div class="loading">Loading runs...</div>';
    try {
      const hours = TF_HOURS[tf] || 24;
      const between = TF_BETWEEN[tf] || 24;
      const [timeframe, all] = await Promise.all([
        safeGetRecentRuns(name, hours, between),
        safeGetRecentRuns(name, 999999, 999999),
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
        if (settings.pbNotifications && "Notification" in window && Notification.permission === "granted") {
          const notif = new Notification("New PB!", {
            body: `${name} got a new personal best: ${fmt(pb)}`,
            icon: "https://mc-heads.net/avatar/" + (state.profile.uuid || name) + "/64",
          });
          if (notif) notif.onclick = () => openProfile(name, state.profile.uuid);
          playNotificationSound();
        }
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
      if (!state.profile.selectedSession) {
        renderProfileBestRuns();
      }
      renderAllRunsPage();
      await loadTwitchFromRuns(name);
      renderRunHistoryChart();
      const sessions = groupRunsIntoSessions(state.profile.allRuns);
      renderRecentSessions(sessions, state.profile.selectedSession || null);
      if (state.profile.selectedSession) {
        const selected = sessions.find((s) => s.id === state.profile.selectedSession);
        if (selected) showSessionInMain(selected);
      }
    } catch (e) {
      if (generation !== profileRunsGeneration) return;
      if (best) best.innerHTML = '<div class="loading">Failed to load runs.</div>';
      if (typeof addDevLog === "function") addDevLog("error", "loadProfileRuns failed: " + (e && e.message ? e.message : e));
    } finally {
      await updateSessionStats();
    }
  }

  async function safeGetRecentRuns(name, hours, hoursBetween) {
    try {
      const data = await getJSON(`${API}/getRecentRuns?name=${encodeURIComponent(name)}&hours=${hours}&hoursBetween=${hoursBetween}&limit=5000`);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      if (e && e.message && e.message.includes("HTTP 404")) {
        return [];
      }
      throw e;
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
    const sortKey = state.profile.allRunsSort || "newest";
    const sorted = [...runs];
    if (sortKey === "newest") {
      sorted.sort((a, b) => (b.insertTime || 0) - (a.insertTime || 0));
    } else if (sortKey === "oldest") {
      sorted.sort((a, b) => (a.insertTime || 0) - (b.insertTime || 0));
    } else if (sortKey === "fastest") {
      sorted.sort((a, b) => (a.finish != null ? a.finish : Infinity) - (b.finish != null ? b.finish : Infinity));
    } else if (sortKey === "slowest") {
      sorted.sort((a, b) => (b.finish != null ? b.finish : -Infinity) - (a.finish != null ? a.finish : -Infinity));
    }
    const total = Math.max(1, Math.ceil(sorted.length / per));
    const slice = sorted.slice((page - 1) * per, page * per);
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
        const ts = r.insertTime || r.createdAt || r.timestamp || r.startTime || r.lastUpdated || r.time || r.updatedTime || r.realUpdated || null;
        const dateStr = ts ? new Date(ts * 1000).toLocaleString() : "";
        row.innerHTML = `<div class="run-row-head">${escapeHtml(state.profile.name)} <span class="run-row-sub">#${runId || "?"}</span></div><div class="run-cells">${cells}</div><div class="run-time-row">${dateStr}</div>`;
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
    currentRunData = null;
    const overlay = document.getElementById("runDetailOverlay");
    document.getElementById("runDetailTitle").textContent = name + " - Run #" + (id || "?");
    const dateEl = document.getElementById("runDetailDate");
    if (dateEl) {
      const run = fallbackRun || {};
      const ts = run.insertTime || run.createdAt || run.timestamp || run.startTime || run.lastUpdated || run.time || run.updatedTime || run.realUpdated || null;
      dateEl.textContent = ts ? new Date(ts * 1000).toLocaleString() : "";
    }
    overlay.classList.add("visible");

    const shareUrl = id ? `https://paceman.gg/stats/run/${id}/` : null;
    const shareBtn = document.getElementById("shareRunBtn");
    const copyLinkBtn = document.getElementById("copyRunLinkBtn");
    if (shareBtn) {
      shareBtn.style.display = shareUrl ? "" : "none";
      shareBtn.onclick = () => {
        if (!shareUrl) return;
        if (window.pacemanAPI && window.pacemanAPI.openExternal) {
          window.pacemanAPI.openExternal(shareUrl);
        } else {
          window.open(shareUrl, "_blank");
        }
      };
    }
    if (copyLinkBtn) {
      copyLinkBtn.style.display = shareUrl ? "" : "none";
      copyLinkBtn.onclick = async () => {
        if (!shareUrl) return;
        try {
          await navigator.clipboard.writeText(shareUrl);
          copyLinkBtn.classList.add("copied");
          copyLinkBtn.title = "Copied!";
          setTimeout(() => {
            copyLinkBtn.classList.remove("copied");
            copyLinkBtn.title = "Copy run link";
          }, 1500);
        } catch (e) {
          console.warn("Copy failed", e);
        }
      };
    }

    const d = fallbackRun || {};
    if (!d || Object.keys(d).length === 0) {
      if (id == null) {
        document.getElementById("runDetailSplits").innerHTML = '<div class="loading">Run details unavailable.</div>';
        document.getElementById("runDetailVod").style.display = "none";
        return;
      }
    }

    function renderSplits(data) {
      let html = "";
      for (const split of SPLIT_ORDER) {
        const igt = data[split];
        html += `<div class="detail-split" data-igt="${igt != null ? igt : ''}">
          <div class="detail-split-name">${SPLITS[split]}</div>
          <div class="detail-split-times">
            <span class="detail-igt">${igt == null ? "—" : fmt(igt)} <small>IGT</small></span>
          </div>
        </div>`;
      }
      document.getElementById("runDetailSplits").innerHTML = html;
    }

    function showVodLoading() {
      const existing = document.getElementById("vodLoading");
      if (existing) existing.remove();
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
        currentRunData = (data && data.data) || data || null;
        const full = currentRunData || {};
        if ((!name || name === "null") && (full.nickname || (full.user && full.user.nickname))) {
          const fetchedName = full.nickname || (full.user && full.user.nickname);
          document.getElementById("runDetailTitle").textContent = fetchedName + " - Run #" + (id || "?");
        }
        if (full.vodId) {
          renderVod(full.vodId, full.vodOffset || 0, full.twitch || null, webview);
          const finish = full.finish != null ? full.finish : 0;
          const furthest = furthestIndex(full);
          const duration = finish > 0 ? finish / 1000 + 30 : (furthest.time > 0 ? furthest.time / 1000 * 2 + 30 : 3600);
          updateVodTrim(full.vodOffset || 0, duration);
          updateSplitMarkers(full, full.vodOffset || 0);
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
        currentRunData = null;
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
    if (currentDownloadId && window.pacemanAPI && window.pacemanAPI.cancelDownloadVod) {
      window.pacemanAPI.cancelDownloadVod(currentDownloadId);
    }
    currentRunId = null;
    currentRunData = null;
    currentDownloadId = null;
    currentVod = { id: null, offset: 0, currentTime: 0 };
    const overlay = document.getElementById("runDetailOverlay");
    overlay.classList.remove("visible");
    const webview = document.getElementById("runVodWebview");
    if (webview) {
      webview.src = "about:blank";
      webview.style.display = "none";
    }
    const progressWrap = document.getElementById("downloadProgress");
    const progressFill = document.getElementById("downloadProgressFill");
    const progressText = document.getElementById("downloadProgressText");
    if (progressWrap) progressWrap.style.display = "none";
    if (progressFill) progressFill.style.width = "0%";
    const trim = document.getElementById("vodTrim");
    if (trim) trim.style.display = "none";
    const trimEnabled = document.getElementById("vodTrimEnabled");
    if (trimEnabled) trimEnabled.checked = false;
    const playhead = document.getElementById("vodPlayhead");
    if (playhead) playhead.style.left = "0%";
    const splitMarkers = document.getElementById("vodSplitMarkers");
    if (splitMarkers) splitMarkers.innerHTML = "";
    vodTrimState.active = false;
    vodTrimState.timelineStart = 0;
    vodTrimState.timelineDuration = 0;
    vodTrimState.selectionStart = 0;
    vodTrimState.selectionEnd = 0;
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
    updateSessionStats();
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

  function renderHeadForProfile(container, id) {
    if (settings.animationsEnabled) {
      renderHead3D(container, id);
    } else {
      renderHead3DStatic(container, id);
    }
  }

  /* ---------------- Leaderboard ---------------- */

  async function loadDailyTop10() {
    if (Object.keys(state.dailyLeaderboardTop10).length > 0) return;
    try {
      const fetched = await Promise.all(
        LB_CATEGORIES.map((c) =>
          getJSON(`${API}/getLeaderboard?category=${c}&type=count&days=1&limit=10`).catch(() => [])
        )
      );
      LB_CATEGORIES.forEach((cat, i) => {
        const players = fetched[i] || [];
        for (const p of players) {
          const key = p.uuid || p.name;
          if (!key) continue;
          if (!state.dailyLeaderboardTop10[key]) state.dailyLeaderboardTop10[key] = [];
          state.dailyLeaderboardTop10[key].push(cat);
        }
      });
    } catch (e) {
      console.warn("Failed to load daily leaderboard top 10", e);
    }
  }

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
           getJSON(`${API}/getLeaderboard?category=${c}&type=count&days=${LB_DAYS[tf]}&limit=100`).catch(() => [])
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
        byCat[cat] = raw.slice(0, 100);
      });
      state.leaderboard.rows = byCat;
      if (tf === "daily") {
        state.dailyLeaderboardTop10 = {};
        for (const cat of LB_CATEGORIES) {
          const players = byCat[cat] || [];
          for (const p of players) {
            const key = p.uuid || p.name;
            if (!key) continue;
            if (!state.dailyLeaderboardTop10[key]) state.dailyLeaderboardTop10[key] = [];
            state.dailyLeaderboardTop10[key].push(cat);
          }
        }
      }
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
    const perPage = 10;
    for (const cat of LB_CATEGORIES) {
      const players = byCat[cat] || [];
      const card = document.createElement("div");
      card.className = "lb-card";
      const totalPages = Math.max(1, Math.ceil(players.length / perPage));
      const catPage = Math.min(state.leaderboard.pages[cat] || 1, totalPages);
      const start = (catPage - 1) * perPage;
      const pagePlayers = players.slice(start, start + perPage);
      let rowsHtml = "";
      for (let i = 0; i < pagePlayers.length; i++) {
        const p = pagePlayers[i];
        const globalIdx = start + i + 1;
        const rankClass = globalIdx === 1 ? "lb-rank-1" : globalIdx === 2 ? "lb-rank-2" : globalIdx === 3 ? "lb-rank-3" : "";
        const avatar = avatarUrl(p.uuid || p.name, 32);
        const mainVal = sortBy === "avg" ? fmt(p.avg) : p.count;
        const mainLabel = sortBy === "avg" ? "Avg" : "Enters";
        const otherVal = sortBy === "avg" ? p.count : fmt(p.avg);
        const otherLabel = sortBy === "avg" ? "Enters" : "Avg";
        rowsHtml += `<div class="lb-card-row ${rankClass}" data-name="${escapeHtml(p.name)}" data-uuid="${escapeHtml(p.uuid || "")}">
          <div class="lb-card-rank">${globalIdx}</div>
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
      const paginationHtml = players.length > perPage ? `
        <div class="lb-pagination">
          <button class="lb-page-btn" data-cat="${cat}" data-dir="prev" ${catPage <= 1 ? "disabled" : ""}>&lt;</button>
          <span class="lb-page-info">${catPage} / ${totalPages}</span>
          <button class="lb-page-btn" data-cat="${cat}" data-dir="next" ${catPage >= totalPages ? "disabled" : ""}>&gt;</button>
        </div>
      ` : "";
      card.innerHTML = `<div class="lb-card-head">${SPLITS[cat]} <span class="lb-card-rank-label">${rankLabel}</span></div><div class="lb-card-list">${rowsHtml || '<div class="loading">No data.</div>'}</div>${paginationHtml}`;
      grid.appendChild(card);
    }
    grid.querySelectorAll(".lb-card-row").forEach((row) => {
      row.addEventListener("click", () => openProfile(row.dataset.name, row.dataset.uuid));
    });
    grid.querySelectorAll(".lb-page-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cat = btn.dataset.cat;
        const dir = btn.dataset.dir;
        const currentPage = state.leaderboard.pages[cat] || 1;
        if (dir === "prev" && currentPage > 1) {
          state.leaderboard.pages[cat] = currentPage - 1;
          renderLeaderboard(state.leaderboard.rows);
        } else if (dir === "next") {
          state.leaderboard.pages[cat] = currentPage + 1;
          renderLeaderboard(state.leaderboard.rows);
        }
      });
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
    input.addEventListener("paste", (e) => {
      const text = (e.clipboardData || window.clipboardData).getData("text");
      const match = text.match(/https?:\/\/(?:www\.)?paceman\.gg\/stats\/run\/([^\/?#]+)/);
      if (match) {
        e.preventDefault();
        const runId = match[1];
        input.value = "";
        closeSearch();
        openRunDetail(runId, null, null);
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

  function initCustomSelect(id, onChange) {
    const el = document.getElementById(id);
    if (!el) return;
    const trigger = el.querySelector(".custom-select-trigger");
    const options = el.querySelectorAll(".custom-select-option");
    el._currentValue = null;
    Object.defineProperty(el, "value", {
      get() { return el._currentValue; },
      set(val) {
        el._currentValue = val;
        const opt = el.querySelector(`.custom-select-option[data-value="${val}"]`);
        if (opt) {
          options.forEach((o) => o.classList.remove("selected"));
          opt.classList.add("selected");
          if (trigger) trigger.textContent = opt.textContent;
        }
      },
    });
    const open = () => {
      document.querySelectorAll(".custom-select.open").forEach((c) => c.classList.remove("open"));
      el.classList.add("open");
    };
    const close = () => el.classList.remove("open");
    const select = (opt) => {
      options.forEach((o) => o.classList.remove("selected"));
      opt.classList.add("selected");
      if (trigger) trigger.textContent = opt.textContent;
      el._currentValue = opt.dataset.value;
      close();
      if (onChange) onChange(opt.dataset.value);
    };
    if (trigger) trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      el.classList.contains("open") ? close() : open();
    });
    options.forEach((opt) => opt.addEventListener("click", (e) => {
      e.stopPropagation();
      select(opt);
    }));
    document.addEventListener("click", () => close());
    const initialOpt = el.querySelector(".custom-select-option.selected");
    if (initialOpt) el._currentValue = initialOpt.dataset.value;
    return el;
  }

  function initThemes() {
    const opts = document.getElementById("themeOptions");
    if (opts) {
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
    }
    
    const themeSelect = document.getElementById("settingTheme");
    if (themeSelect) {
      const currentTheme = localStorage.getItem("paceman_theme") || THEMES[0].name;
      themeSelect.value = currentTheme;
      const trigger = themeSelect.querySelector(".custom-select-trigger");
      const selectedOpt = themeSelect.querySelector(`.custom-select-option[data-value="${currentTheme}"]`);
      if (selectedOpt && trigger) trigger.textContent = selectedOpt.textContent;
      initCustomSelect("settingTheme", (val) => applyTheme(val));
    }
    
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
        clearSessionSelection();
        loadProfileStats();
        loadProfileRuns().then(() => renderRunHistoryChart());
        const shareBtn = document.getElementById("sessionShareBtn");
        if (shareBtn) {
          const tf = b.dataset.tf || "daily";
          const labels = {
            session: "Copy session stats",
            daily: "Copy daily stats",
            weekly: "Copy weekly stats",
            monthly: "Copy monthly stats",
            lifetime: "Copy lifetime stats",
          };
          shareBtn.title = labels[tf] || `Copy ${tf} stats`;
        }
      });
    });
    const backBtn = document.getElementById("sessionBackBtn");
    if (backBtn) {
      backBtn.addEventListener("click", () => {
        clearSessionSelection();
        state.profile.tf = "daily";
        document.querySelectorAll("#profileTimeframes .timeframe-btn").forEach((x) => x.classList.remove("active"));
        const dailyBtn = document.querySelector("#profileTimeframes .timeframe-btn[data-tf=\"daily\"]");
        if (dailyBtn) dailyBtn.classList.add("active");
        loadProfileStats();
        loadProfileRuns().then(() => renderRunHistoryChart());
      });
    }
    document.querySelectorAll("#leaderboardTimeframes .timeframe-btn").forEach((b) => {
      b.addEventListener("click", () => {
        state.leaderboard.tf = b.dataset.tf;
        state.leaderboard.rows = null;
        state.leaderboard.pages = {};
        document.querySelectorAll("#leaderboardTimeframes .timeframe-btn").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        loadLeaderboard(true);
      });
    });
    document.querySelectorAll("#lbSortToggle .lb-sort-btn").forEach((b) => {
      b.addEventListener("click", () => {
        state.leaderboard.sortBy = b.dataset.sort;
        state.leaderboard.rows = null;
        state.leaderboard.pages = {};
        document.querySelectorAll("#lbSortToggle .lb-sort-btn").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        loadLeaderboard(true);
      });
    });
    document.getElementById("viewAllRunsBtn").addEventListener("click", () => {
      const sortSelect = document.getElementById("allRunsSort");
      if (sortSelect) sortSelect.value = state.profile.allRunsSort || "newest";
      document.getElementById("allRunsModal").classList.add("visible");
      renderAllRunsPage();
    });
    initCustomSelect("allRunsSort", (val) => {
      state.profile.allRunsSort = val;
      state.profile.page = 1;
      renderAllRunsPage();
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
    (async () => {
      const protoArgs = await window.pacemanAPI.getProtocolArgs();
      if (!protoArgs || protoArgs.consumed === true) return;
      if (protoArgs.path === "/run" && protoArgs.query && protoArgs.query.id) {
        const runId = String(protoArgs.query.id);
        const playerName = protoArgs.query.name || "";
        openRunDetail(runId, playerName, null);
      } else if (protoArgs.path.startsWith("/player/")) {
        const name = decodeURIComponent(protoArgs.path.replace("/player/", "").split("/")[0]);
        if (name) openProfile(name, null);
      }
    })();
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
    const sidebarToggleBtn = document.getElementById("sidebarToggleBtn");
    if (sidebarToggleBtn) {
      sidebarToggleBtn.addEventListener("click", () => {
        const sidebar = document.getElementById("profileSidebar");
        if (!sidebar) return;
        const isHidden = sidebar.classList.contains("hidden");
        if (isHidden) {
          sidebar.classList.remove("hidden");
          sidebarToggleBtn.classList.add("active");
        } else {
          sidebar.classList.add("hidden");
          sidebarToggleBtn.classList.remove("active");
        }
      });
    }
    initCustomSelect("chartStatSelect", () => {
      renderRunHistoryChart();
    });
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
    const sessionShareBtn = document.getElementById("sessionShareBtn");
    if (sessionShareBtn) {
      const getActiveTimeframe = () => {
        const activeBtn = document.querySelector("#profileTimeframes .timeframe-btn.active");
        if (activeBtn && activeBtn.dataset && activeBtn.dataset.tf) return activeBtn.dataset.tf;
        const tf = state.profile.tf;
        if (tf) return tf;
        return "daily";
      };
      const updateSessionShareTooltip = () => {
        const tf = getActiveTimeframe();
        const labels = {
          session: "Copy session stats",
          daily: "Copy daily stats",
          weekly: "Copy weekly stats",
          monthly: "Copy monthly stats",
          lifetime: "Copy lifetime stats",
        };
        sessionShareBtn.title = labels[tf] || `Copy ${tf} stats`;
      };
      updateSessionShareTooltip();
      sessionShareBtn.addEventListener("click", async () => {
        const sessionBox = document.getElementById("sessionStats");
        if (!sessionBox) return;
        const name = state.profile.name || "Player";
        const tf = getActiveTimeframe();
        const hours = TF_HOURS[tf] || 24;
        const between = TF_BETWEEN[tf] || 24;
        const selectedSessionId = state.profile.selectedSession;
        const selectedSessionData = state.profile.selectedSessionData;
        let header = "";
        if (tf === "session") header = `${name} session stats:`;
        else if (tf === "daily") header = `${name} daily stats:`;
        else if (tf === "weekly") header = `${name} weekly stats:`;
        else if (tf === "monthly") header = `${name} monthly stats:`;
        else if (tf === "lifetime") header = `${name} lifetime stats:`;
        else header = `${name} ${tf} stats:`;
        let text = header + "\n";
        try {
          const runs = selectedSessionData ? selectedSessionData.runs : (state.profile.timeframeRuns || []);
          for (const key of SPLIT_ORDER) {
            if (key === "bastion" || key === "fortress") continue;
            const values = runs.filter((r) => r[key] != null).map((r) => r[key]);
            const count = values.length;
            const avg = count > 0 ? fmt(Math.round(values.reduce((a, b) => a + b, 0) / count)) : "0:00";
            if (count > 0) {
              text += `${SPLITS[key]}: ${count}x avg ${avg}\n`;
            }
          }
          const firstStructureTimes = [];
          const secondStructureTimes = [];
          for (const r of runs) {
            const bastion = r.bastion;
            const fortress = r.fortress;
            if (bastion != null && fortress != null) {
              if (bastion < fortress) {
                firstStructureTimes.push(bastion);
                secondStructureTimes.push(fortress);
              } else if (fortress < bastion) {
                firstStructureTimes.push(fortress);
                secondStructureTimes.push(bastion);
              }
            }
          }
          if (firstStructureTimes.length > 0 || secondStructureTimes.length > 0) {
            const firstCount = firstStructureTimes.length;
            const secondCount = secondStructureTimes.length;
            const firstAvg = firstCount > 0 ? fmt(Math.round(firstStructureTimes.reduce((a, b) => a + b, 0) / firstCount)) : "0:00";
            const secondAvg = secondCount > 0 ? fmt(Math.round(secondStructureTimes.reduce((a, b) => a + b, 0) / secondCount)) : "0:00";
            text += `First Structure: ${firstCount}x avg ${firstAvg}\n`;
            text += `Second Structure: ${secondCount}x avg ${secondAvg}\n`;
          }
          const finishes = runs.filter((r) => r.finish != null).map((r) => r.finish);
          const finCount = finishes.length;
          const finAvg = finCount > 0 ? fmt(Math.round(finishes.reduce((a, b) => a + b, 0) / finCount)) : "0:00";
          if (finCount > 0) {
            text += `Completion: ${finCount}x avg ${finAvg}\n`;
          }
          const duration = calcSessionDuration(runs);
          if (duration) {
            text += `Session length: ${duration}\n`;
          }
          if (tf === "session" && selectedSessionData) {
            const nph = selectedSessionData.nph;
            if (nph) {
              text += `NPH: ${(nph.rnph || 0).toFixed(2)}\n`;
              text += `RPE: ${(nph.rpe || 0).toFixed(2)}\n`;
            }
          }
        } catch (e) {
          const badges = sessionBox.querySelectorAll(".stat-badge");
          badges.forEach((badge) => {
            const valueEl = badge.querySelector("b");
            if (!valueEl) return;
            const valueText = valueEl.textContent.trim();
            const raw = badge.innerHTML.replace(valueEl.outerHTML, "").trim();
            const labelText = raw.replace(/<[^>]*>/g, "").trim();
            if (labelText && valueText) {
              text += `${labelText}: ${valueText}\n`;
            }
          });
        }
        try {
          await navigator.clipboard.writeText(text.trim());
          sessionShareBtn.classList.add("copied");
          setTimeout(() => sessionShareBtn.classList.remove("copied"), 1500);
        } catch (e) {
          console.log("Share session stats failed", e);
        }
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
    const openVodBtn = document.getElementById("openVodBtn");
    if (openVodBtn) {
      openVodBtn.addEventListener("click", () => {
        if (!currentVod.id) return;
        const url = `https://twitch.tv/videos/${currentVod.id}${currentVod.offset ? "?t=" + Math.floor(currentVod.offset) : ""}`;
        if (window.pacemanAPI && window.pacemanAPI.openExternal) {
          window.pacemanAPI.openExternal(url);
        } else {
          window.open(url, "_blank");
        }
      });
    }
    const downloadRunBtn = document.getElementById("downloadRunBtn");
    console.log('Download button element:', downloadRunBtn);
    if (downloadRunBtn) {
      console.log('Attaching download button listener');
      const progressWrap = document.getElementById("downloadProgress");
      const progressFill = document.getElementById("downloadProgressFill");
      const progressText = document.getElementById("downloadProgressText");
      console.log('Progress elements:', { progressWrap, progressFill, progressText });
      
      const updateProgress = (data) => {
        if (!progressWrap || !progressFill || !progressText) return;
        progressWrap.style.display = "flex";
        const percent = Math.max(0, Math.min(100, data.percent || 0));
        progressFill.style.width = percent + "%";
        const total = data.total || "";
        const speed = data.speed || "";
        const eta = data.eta || "";
        progressText.textContent = `Downloading ${percent.toFixed(1)}%${total ? ` of ${total}` : ""}${speed ? ` at ${speed}` : ""}${eta ? ` ETA ${eta}` : ""}`;
      };
      
      const finishProgress = () => {
        if (progressWrap) progressWrap.style.display = "none";
        if (progressFill) progressFill.style.width = "0%";
        currentDownloadId = null;
      };
      
      const onProgress = (e) => {
        console.log('Progress event received:', e.detail);
        if (e.detail && e.detail.downloadId === currentDownloadId) {
          updateProgress(e.detail);
        }
      };
      
      window.addEventListener('paceman-download-vod-progress', onProgress);
      
      const startVodDownload = async () => {
        if (!currentRunId) return;
        if (!window.pacemanAPI || !window.pacemanAPI.downloadVod) return;
        
        const trim = document.getElementById("vodTrim");
        const trimEnabled = document.getElementById("vodTrimEnabled");
        if (trim && trimEnabled && !trimEnabled.checked) {
          trimEnabled.checked = true;
          trim.style.display = "block";
        }
        
        try {
          let vodId = currentVod.id;
          let vodOffset = currentVod.offset || 0;
          if (!vodId && currentRunData) {
            vodId = currentRunData.vodId || null;
            vodOffset = currentRunData.vodOffset || 0;
          }
          if (!vodId) return;
          downloadRunBtn.classList.add("downloading");
          if (progressWrap) progressWrap.style.display = "flex";
          if (progressFill) progressFill.style.width = "0%";
          if (progressText) progressText.textContent = "Starting download...";
          
          currentDownloadId = Date.now().toString();
          const runData = currentRunData || await getJSON(`${API}/getWorld?worldId=${encodeURIComponent(currentRunId)}`).then(d => (d && d.data) || d).catch(() => ({}));
          const finish = runData && runData.finish != null ? runData.finish : null;
          let startTime = vodOffset || 0;
          let endTime = null;
          
          if (vodTrimEnabled && vodTrimEnabled.checked && vodTrimState.selectionEnd > vodTrimState.selectionStart) {
            startTime = vodTrimState.selectionStart;
            endTime = vodTrimState.selectionEnd;
          } else if (finish) {
            endTime = startTime + finish / 1000 + 30;
          } else {
            let nextBoundary = null;
            if (state.profile.name) {
              nextBoundary = await getNextRunBoundary(currentRunId, state.profile.name);
            }
            if (nextBoundary && nextBoundary.type === 'vodOffset' && nextBoundary.value > startTime) {
              endTime = nextBoundary.value;
            } else if (nextBoundary && nextBoundary.type === 'timestamp') {
              const currentRunTs = runData && (runData.insertTime || runData.createdAt || runData.timestamp || runData.startTime) || 0;
              const nextTs = nextBoundary.value;
              if (nextTs > currentRunTs) {
                const diffSeconds = (nextTs - currentRunTs) / 1000;
                endTime = startTime + diffSeconds;
              }
            }
            if (endTime === null) {
              if (progressText) progressText.textContent = "Enable manual trim to select download range.";
              setTimeout(() => finishProgress(), 2500);
              downloadRunBtn.classList.remove("downloading");
              if (trim && trimEnabled) {
                trimEnabled.checked = true;
                trim.style.display = "block";
              }
              return;
            }
          }
          
          const result = await window.pacemanAPI.downloadVod({
            downloadId: currentDownloadId,
            vodId,
            startTime,
            endTime,
          });
          
          if (result && result.success) {
            if (progressFill) progressFill.style.width = "100%";
            if (progressText) progressText.textContent = "Download complete!";
            downloadRunBtn.classList.add("downloaded");
            setTimeout(() => {
              finishProgress();
              downloadRunBtn.classList.remove("downloading");
              downloadRunBtn.classList.remove("downloaded");
            }, 1500);
            return;
          }
          if (progressText) progressText.textContent = result && result.error ? result.error : "Download failed.";
          setTimeout(() => finishProgress(), 3000);
          downloadRunBtn.classList.remove("downloading");
        } catch (e) {
          console.log("Download failed", e);
          if (progressText) progressText.textContent = "Download failed.";
          setTimeout(() => finishProgress(), 3000);
          downloadRunBtn.classList.remove("downloading");
        }
      };
      
      downloadRunBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await startVodDownload();
      });
      
      const vodTrimDownloadBtn = document.getElementById("vodTrimDownload");
      if (vodTrimDownloadBtn) {
        vodTrimDownloadBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          await startVodDownload();
        });
      }
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

    let trimDragging = null;

    const setTrimFromClientX = (clientX) => {
      if (!vodTrimState.timelineDuration) return;
      const timeline = document.getElementById("vodTimeline");
      if (!timeline) return;
      const rect = timeline.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const clickTime = vodTrimState.timelineStart + pct * vodTrimState.timelineDuration;
      if (trimDragging === "start") {
        vodTrimState.selectionStart = Math.max(vodTrimState.timelineStart, Math.min(clickTime, vodTrimState.selectionEnd - 1));
      } else if (trimDragging === "end") {
        vodTrimState.selectionEnd = Math.min(vodTrimState.timelineStart + vodTrimState.timelineDuration, Math.max(clickTime, vodTrimState.selectionStart + 1));
      }
      updateTrimMarkers();
    };

    const startHandle = document.getElementById("vodTrimStartMarker");
    const endHandle = document.getElementById("vodTrimEndMarker");
    const timeline = document.getElementById("vodTimeline");

    if (startHandle) {
      startHandle.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); trimDragging = "start"; });
      startHandle.addEventListener("touchstart", (e) => { e.preventDefault(); trimDragging = "start"; }, { passive: false });
    }
    if (endHandle) {
      endHandle.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); trimDragging = "end"; });
      endHandle.addEventListener("touchstart", (e) => { e.preventDefault(); trimDragging = "end"; }, { passive: false });
    }

    document.addEventListener("mousemove", (e) => { if (trimDragging) { e.preventDefault(); setTrimFromClientX(e.clientX); } });
    document.addEventListener("touchmove", (e) => { if (trimDragging && e.touches.length > 0) { e.preventDefault(); setTrimFromClientX(e.touches[0].clientX); } }, { passive: false });
    document.addEventListener("mouseup", () => { trimDragging = null; });
    document.addEventListener("touchend", () => { trimDragging = null; });

    if (timeline) {
      timeline.addEventListener("click", (e) => {
        if (trimDragging) return;
        if (!vodTrimState.timelineDuration || !currentVod.id) return;
        const rect = timeline.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const seekTime = vodTrimState.timelineStart + pct * vodTrimState.timelineDuration;
        currentVod.currentTime = seekTime;
        seekVod(0, seekTime);
      });
    }

    const playSelectionBtn = document.getElementById("vodTrimPlaySelection");
    if (playSelectionBtn) {
      playSelectionBtn.addEventListener("click", () => {
        if (!currentVod.id) return;
        currentVod.currentTime = vodTrimState.selectionStart;
        seekVod(0, vodTrimState.selectionStart);
      });
    }

    const resetTrimBtn = document.getElementById("vodTrimReset");
    if (resetTrimBtn) {
      resetTrimBtn.addEventListener("click", async () => {
        if (!currentRunId) return;
        const runData = currentRunData || await getJSON(`${API}/getWorld?worldId=${encodeURIComponent(currentRunId)}`).then(d => (d && d.data) || d).catch(() => ({}));
        const finish = runData && runData.finish != null ? runData.finish : null;
        const start = currentVod.offset || 0;
        let duration = 0;
        if (finish) {
          duration = finish / 1000 + 30;
        } else {
          const nextBoundary = await getNextRunBoundary(currentRunId, state.profile.name);
          if (nextBoundary && nextBoundary.type === "vodOffset" && nextBoundary.value > start) {
            duration = nextBoundary.value - start;
          } else if (nextBoundary && nextBoundary.type === "timestamp") {
            const currentRunTs = runData && (runData.insertTime || runData.createdAt || runData.timestamp || runData.startTime) || 0;
            const nextTs = nextBoundary.value;
            if (nextTs > currentRunTs) {
              duration = (nextTs - currentRunTs) / 1000;
            }
          }
          if (duration <= 0) {
            const furthestEv = furthestEvent(runData);
            const furthestSplit = furthestIndex(runData);
            const realTimeMs = (furthestEv && furthestEv.rta != null) ? furthestEv.rta : (furthestSplit.time > 0 ? furthestSplit.time * 2 : 0);
            duration = realTimeMs > 0 ? realTimeMs / 1000 + 30 : 3600;
          }
        }
        updateVodTrim(start, duration);
        updateSplitMarkers(runData, start);
        seekVod(0, start);
      });
    }

    if (vodTrimEnabled) {
      vodTrimEnabled.addEventListener("change", () => {
        vodTrimState.active = vodTrimEnabled.checked;
        if (vodTrim) vodTrim.style.display = vodTrimState.active ? "block" : "none";
        if (vodTrimState.active && vodTrimState.timelineDuration > 0) {
          updateTrimMarkers();
        }
      });
    }

    const playheadInterval = setInterval(() => {
      if (!currentVod.id) return;
      const webview = document.getElementById("runVodWebview");
      if (!webview || webview.style.display === "none") return;
      webview.executeJavaScript(`document.querySelector('video')?.currentTime || 0`).then((time) => {
        if (time != null && vodTrimState.timelineDuration > 0) {
          const playhead = document.getElementById("vodPlayhead");
          if (playhead) {
            const pct = Math.max(0, Math.min(100, ((time - vodTrimState.timelineStart) / vodTrimState.timelineDuration) * 100));
            playhead.style.left = pct + "%";
          }
        }
      }).catch(() => {});
    }, 1000);

    if (vodTrim) {
      vodTrim.style.display = "none";
    }
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
        renderHeadForProfile(document.getElementById("head3dContainer"), state.profile.uuid);
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

    const applyAnimationsSetting = () => {
      if (settings.animationsEnabled) {
        document.body.classList.remove("no-animations");
      } else {
        document.body.classList.add("no-animations");
      }
      if (state.profile.uuid && document.getElementById("page-profile").classList.contains("active")) {
        renderHeadForProfile(document.getElementById("head3dContainer"), state.profile.uuid);
      }
    };

    const exportFavBtn = document.getElementById("settingExportFav");
    if (exportFavBtn) {
      exportFavBtn.addEventListener("click", async () => {
        const data = {
          favorites: state.favorites,
          favoritePBs: state.favoritePBs,
          exportedAt: new Date().toISOString(),
        };
        if (window.pacemanAPI && window.pacemanAPI.showSaveDialog) {
          const result = await window.pacemanAPI.showSaveDialog({
            title: "Export favorites",
            defaultPath: "paceman-favorites.json",
            filters: [{ name: "JSON", extensions: ["json"] }],
          });
          if (!result.canceled && result.filePath) {
            const writeResult = await window.pacemanAPI.writeFile(result.filePath, JSON.stringify(data, null, 2));
            if (!writeResult || !writeResult.success) {
              alert("Failed to save file: " + (writeResult ? writeResult.error : "unknown error"));
            }
          }
        }
      });
    }

    const importFavBtn = document.getElementById("settingImportFav");
    if (importFavBtn) {
      importFavBtn.addEventListener("click", async () => {
        if (window.pacemanAPI && window.pacemanAPI.showOpenDialog) {
          const result = await window.pacemanAPI.showOpenDialog({
            title: "Import favorites",
            filters: [{ name: "JSON", extensions: ["json"] }],
            properties: ["openFile"],
          });
          if (!result.canceled && result.filePaths && result.filePaths[0]) {
            const readResult = await window.pacemanAPI.readFile(result.filePaths[0]);
            if (readResult && readResult.success) {
              const data = JSON.parse(readResult.data);
              if (Array.isArray(data.favorites)) {
                state.favorites = Array.from(new Set([...state.favorites, ...data.favorites]));
                localStorage.setItem("paceman_favorites", JSON.stringify(state.favorites));
              }
              if (data.favoritePBs && typeof data.favoritePBs === "object") {
                state.favoritePBs = { ...state.favoritePBs, ...data.favoritePBs };
                localStorage.setItem("paceman_favorite_pbs", JSON.stringify(state.favoritePBs));
              }
              alert("Favorites imported.");
            } else {
              alert("Failed to read file: " + (readResult ? readResult.error : "unknown error"));
            }
          }
        }
      });
    }

    const clearCacheBtn = document.getElementById("settingClearCache");
    if (clearCacheBtn) {
      clearCacheBtn.addEventListener("click", async () => {
        if (!confirm("Clear all local cache and history? This cannot be undone.")) return;
        localStorage.clear();
        if (window.pacemanAPI && window.pacemanAPI.clearCache) {
          await window.pacemanAPI.clearCache();
        }
        location.reload();
      });
    }

    const settingsOverlay = document.getElementById("settingsOverlay");
    const settingsBtn = document.getElementById("settingsBtn");
    const closeSettingsBtn = document.getElementById("closeSettings");

    const openSettings = () => {
      if (!settingsOverlay) return;
      const pbToggle = document.getElementById("settingPbNotifications");
      const liveToggle = document.getElementById("settingLiveNotifications");
      const soundToggle = document.getElementById("settingNotificationSound");
      const animationsToggle = document.getElementById("settingAnimations");
      const volumeSlider = document.getElementById("settingNotificationVolume");
      if (pbToggle) pbToggle.checked = settings.pbNotifications;
      if (liveToggle) liveToggle.checked = settings.liveNotifications;
      if (soundToggle) soundToggle.checked = settings.notificationSound;
      if (animationsToggle) animationsToggle.checked = settings.animationsEnabled;
      if (volumeSlider) volumeSlider.value = settings.notificationVolume;
      settingsOverlay.classList.add("visible");
    };

    const closeSettings = () => {
      if (!settingsOverlay) return;
      settingsOverlay.classList.remove("visible");
      const pbToggle = document.getElementById("settingPbNotifications");
      const liveToggle = document.getElementById("settingLiveNotifications");
      const soundToggle = document.getElementById("settingNotificationSound");
      const animationsToggle = document.getElementById("settingAnimations");
      const volumeSlider = document.getElementById("settingNotificationVolume");
      if (pbToggle) settings.pbNotifications = pbToggle.checked;
      if (liveToggle) settings.liveNotifications = liveToggle.checked;
      if (soundToggle) settings.notificationSound = soundToggle.checked;
      if (animationsToggle) settings.animationsEnabled = animationsToggle.checked;
      if (volumeSlider) settings.notificationVolume = parseFloat(volumeSlider.value);
      localStorage.setItem("paceman_settings_pb_notifications", settings.pbNotifications);
      localStorage.setItem("paceman_settings_live_notifications", settings.liveNotifications);
      localStorage.setItem("paceman_settings_notification_sound", settings.notificationSound);
      localStorage.setItem("paceman_settings_notification_volume", settings.notificationVolume);
      localStorage.setItem("paceman_settings_animations_enabled", settings.animationsEnabled);
      applyAnimationsSetting();
    };

    if (settingsBtn) {
      settingsBtn.addEventListener("click", openSettings);
    }
    if (closeSettingsBtn) {
      closeSettingsBtn.addEventListener("click", closeSettings);
    }
    if (settingsOverlay) {
      settingsOverlay.addEventListener("click", (e) => {
        if (e.target === settingsOverlay) closeSettings();
      });
    }

    const animationsToggle = document.getElementById("settingAnimations");
    if (animationsToggle) {
      animationsToggle.addEventListener("change", () => {
        settings.animationsEnabled = animationsToggle.checked;
        localStorage.setItem("paceman_settings_animations_enabled", settings.animationsEnabled);
        applyAnimationsSetting();
      });
    }

    const volumeSlider = document.getElementById("settingNotificationVolume");
    if (volumeSlider) {
      volumeSlider.value = settings.notificationVolume;
      volumeSlider.addEventListener("input", () => {
        settings.notificationVolume = parseFloat(volumeSlider.value);
        localStorage.setItem("paceman_settings_notification_volume", settings.notificationVolume);
      });
    }
    const previewSoundBtn = document.getElementById("settingPreviewSound");
    if (previewSoundBtn) {
      previewSoundBtn.addEventListener("click", () => {
        playNotificationSound();
      });
    }

    const previewNotificationBtn = document.getElementById("settingPreviewNotification");
    if (previewNotificationBtn) {
      previewNotificationBtn.addEventListener("click", () => {
        if (!("Notification" in window)) {
          alert("Notifications are not supported in this browser.");
          return;
        }
        if (Notification.permission === "granted") {
          const notif = new Notification("Paceman Preview", {
            body: "This is how Paceman notifications will look and sound.",
            icon: "https://mc-heads.net/avatar/Paceman/64",
          });
          if (notif) {
            notif.onclick = () => window.focus();
            playNotificationSound();
          }
        } else if (Notification.permission !== "denied") {
          Notification.requestPermission().then((perm) => {
            if (perm === "granted") {
              const notif = new Notification("Paceman Preview", {
                body: "This is how Paceman notifications will look and sound.",
                icon: "https://mc-heads.net/avatar/Paceman/64",
              });
              if (notif) {
                notif.onclick = () => window.focus();
                playNotificationSound();
              }
            } else {
              alert("Notification permission denied. Please enable notifications in your system settings.");
            }
          });
        } else {
          alert("Notifications are blocked. Please enable notifications in your system settings.");
        }
      });
    }

    const checkUpdateBtn = document.getElementById("settingCheckUpdate");
    if (checkUpdateBtn) {
      checkUpdateBtn.addEventListener("click", async () => {
        checkUpdateBtn.classList.add("checking");
        checkUpdateBtn.textContent = "Checking...";
        checkUpdateBtn.disabled = true;
        try {
          const result = await window.pacemanAPI.checkForUpdates();
          if (result && result.success && result.isNewer) {
            checkUpdateBtn.textContent = `Update available: v${result.latest}`;
            checkUpdateBtn.classList.add("has-update");
            if (confirm(`A newer version is available: v${result.latest}\nYou are on v${result.current}.\n\nOpen the release page?`)) {
              window.pacemanAPI.openExternal(result.downloadUrl);
            }
          } else if (result && result.success) {
            checkUpdateBtn.textContent = `You are on the latest version (v${result.current})`;
            setTimeout(() => {
              checkUpdateBtn.textContent = "Check for Updates";
              checkUpdateBtn.classList.remove("has-update");
              checkUpdateBtn.disabled = false;
            }, 2000);
          } else {
            checkUpdateBtn.textContent = "Update check failed";
            setTimeout(() => {
              checkUpdateBtn.textContent = "Check for Updates";
              checkUpdateBtn.disabled = false;
            }, 2000);
          }
        } catch (e) {
          checkUpdateBtn.textContent = "Update check failed";
          setTimeout(() => {
            checkUpdateBtn.textContent = "Check for Updates";
            checkUpdateBtn.disabled = false;
          }, 2000);
        }
      });
    }

    setTimeout(() => {
      window.pacemanAPI.checkForUpdates().then((result) => {
        if (result && result.success && result.isNewer && checkUpdateBtn) {
          checkUpdateBtn.textContent = `Update available: v${result.latest}`;
          checkUpdateBtn.classList.add("has-update");
        }
      }).catch(() => {});
    }, 5000);
    window.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d") {
        toggleDevMode();
      }
    });
    applyAnimationsSetting();
  }

  const setupOverlay = document.getElementById("setupOverlay");
  const setupNextBtn = document.getElementById("setupNext");
  const setupSkipBtn = document.getElementById("setupSkip");
  const setupImportFavBtn = document.getElementById("setupImportFav");
  const setupThemeGrid = document.getElementById("setupThemeGrid");
  let setupStep = 1;
  const totalSetupSteps = 4;

  function showSetupStep(step) {
    document.querySelectorAll(".setup-step").forEach((el) => el.classList.remove("active"));
    const stepEl = document.querySelector(`.setup-step[data-step="${step}"]`);
    if (stepEl) stepEl.classList.add("active");
    setupNextBtn.textContent = step === totalSetupSteps ? "Finish" : "Next";
  }

  function collectSetupSettings() {
    const themeEl = document.querySelector(".setup-theme-option.selected");
    const theme = themeEl ? themeEl.dataset.theme : localStorage.getItem("paceman_theme") || "amethyst";
    settings.pbNotifications = document.getElementById("setupPbNotifications").checked;
    settings.liveNotifications = document.getElementById("setupLiveNotifications").checked;
    settings.notificationSound = document.getElementById("setupNotificationSound").checked;
    settings.animationsEnabled = document.getElementById("setupAnimations").checked;
    localStorage.setItem("paceman_theme", theme);
    localStorage.setItem("paceman_settings_pb_notifications", settings.pbNotifications);
    localStorage.setItem("paceman_settings_live_notifications", settings.liveNotifications);
    localStorage.setItem("paceman_settings_notification_sound", settings.notificationSound);
    localStorage.setItem("paceman_settings_animations_enabled", settings.animationsEnabled);
    applyTheme(theme);
    applyAnimationsSetting();
  }

  function completeSetup() {
    try {
      console.log("completeSetup called");
      collectSetupSettings();
      localStorage.setItem("paceman_setup_complete", "true");
      if (setupOverlay) setupOverlay.classList.remove("visible");
      setTimeout(() => location.reload(), 100);
    } catch (e) {
      console.error("Setup completion failed:", e);
      localStorage.setItem("paceman_setup_complete", "true");
      if (setupOverlay) setupOverlay.classList.remove("visible");
      setTimeout(() => location.reload(), 100);
    }
  }

  // Fallback: force-show setup if it should be visible but isn't
  window.addEventListener("load", () => {
    if (!localStorage.getItem("paceman_setup_complete") && setupOverlay) {
      console.log("Fallback: showing setup overlay on window load");
      setTimeout(() => setupOverlay.classList.add("visible"), 300);
    }
  });

  if (setupOverlay && !localStorage.getItem("paceman_setup_complete")) {
    if (setupThemeGrid) {
      setupThemeGrid.innerHTML = THEMES.map((t) => `
        <div class="setup-theme-option" data-theme="${t.name}">
          <div class="setup-theme-swatch" style="background: var(--swatch-${t.name});"></div>
          <div class="setup-theme-label">${t.label}</div>
        </div>
      `).join("");
      setupThemeGrid.addEventListener("click", (e) => {
        const option = e.target.closest(".setup-theme-option");
        if (!option) return;
        setupThemeGrid.querySelectorAll(".setup-theme-option").forEach((o) => o.classList.remove("selected"));
        option.classList.add("selected");
        const selectedTheme = option.dataset.theme;
        if (selectedTheme) {
          applyTheme(selectedTheme);
        }
      });
      const defaultTheme = localStorage.getItem("paceman_theme") || THEMES[0].name;
      const defaultOption = setupThemeGrid.querySelector(`[data-theme="${defaultTheme}"]`);
      if (defaultOption) defaultOption.classList.add("selected");
    }
    showSetupStep(1);
    setTimeout(() => {
      if (setupOverlay) setupOverlay.classList.add("visible");
    }, 100);
  }

  const setupCloseBtn = document.getElementById("setupCloseBtn");
  if (setupCloseBtn) {
    setupCloseBtn.addEventListener("click", () => {
      completeSetup();
    });
  }

  if (setupOverlay) {
    setupOverlay.addEventListener("click", (e) => {
      if (e.target === setupOverlay) {
        completeSetup();
      }
    });
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && setupOverlay && setupOverlay.classList.contains("visible")) {
      completeSetup();
    }
  });

  if (setupNextBtn) {
    setupNextBtn.addEventListener("click", () => {
      console.log("Setup next clicked, step:", setupStep, "total:", totalSetupSteps);
      if (setupStep < totalSetupSteps) {
        setupStep++;
        showSetupStep(setupStep);
      } else {
        completeSetup();
      }
    });
  }

  if (setupSkipBtn) {
    setupSkipBtn.addEventListener("click", () => {
      completeSetup();
    });
  }

  if (setupImportFavBtn) {
    setupImportFavBtn.addEventListener("click", async () => {
      if (window.pacemanAPI && window.pacemanAPI.showOpenDialog) {
        const result = await window.pacemanAPI.showOpenDialog({
          title: "Import favorites",
          filters: [{ name: "JSON", extensions: ["json"] }],
          properties: ["openFile"],
        });
        if (!result.canceled && result.filePaths && result.filePaths[0]) {
          const readResult = await window.pacemanAPI.readFile(result.filePaths[0]);
          if (readResult && readResult.success) {
            const data = JSON.parse(readResult.data);
            if (Array.isArray(data.favorites)) {
              state.favorites = Array.from(new Set([...state.favorites, ...data.favorites]));
              localStorage.setItem("paceman_favorites", JSON.stringify(state.favorites));
            }
            if (data.favoritePBs && typeof data.favoritePBs === "object") {
              state.favoritePBs = { ...state.favoritePBs, ...data.favoritePBs };
              localStorage.setItem("paceman_favorite_pbs", JSON.stringify(state.favoritePBs));
            }
          }
        }
      }
      completeSetup();
    });
  }

  const exportPrefsBtn = document.getElementById("settingExportPrefs");
  if (exportPrefsBtn) {
    exportPrefsBtn.addEventListener("click", async () => {
      const prefs = {
        theme: localStorage.getItem("paceman_theme"),
        pbNotifications: settings.pbNotifications,
        liveNotifications: settings.liveNotifications,
        notificationSound: settings.notificationSound,
        notificationVolume: settings.notificationVolume,
        animationsEnabled: settings.animationsEnabled,
        autoOpenTwitch: state.autoOpenTwitch,
        favorites: state.favorites,
        favoritePBs: state.favoritePBs,
        recents: state.recents,
        exportedAt: new Date().toISOString(),
      };
      if (window.pacemanAPI && window.pacemanAPI.showSaveDialog) {
        const result = await window.pacemanAPI.showSaveDialog({
          title: "Export preferences",
          defaultPath: "paceman-preferences.json",
          filters: [{ name: "JSON", extensions: ["json"] }],
        });
        if (!result.canceled && result.filePath) {
          const writeResult = await window.pacemanAPI.writeFile(result.filePath, JSON.stringify(prefs, null, 2));
          if (!writeResult || !writeResult.success) {
            alert("Failed to save file: " + (writeResult ? writeResult.error : "unknown error"));
          }
        }
      }
    });
  }

  const importPrefsBtn = document.getElementById("settingImportPrefs");
  if (importPrefsBtn) {
    importPrefsBtn.addEventListener("click", async () => {
      if (window.pacemanAPI && window.pacemanAPI.showOpenDialog) {
        const result = await window.pacemanAPI.showOpenDialog({
          title: "Import preferences",
          filters: [{ name: "JSON", extensions: ["json"] }],
          properties: ["openFile"],
        });
        if (!result.canceled && result.filePaths && result.filePaths[0]) {
          const readResult = await window.pacemanAPI.readFile(result.filePaths[0]);
          if (readResult && readResult.success) {
            const data = JSON.parse(readResult.data);
            if (data.theme) {
              localStorage.setItem("paceman_theme", data.theme);
              applyTheme(data.theme);
            }
            if (typeof data.pbNotifications === "boolean") {
              settings.pbNotifications = data.pbNotifications;
              localStorage.setItem("paceman_settings_pb_notifications", data.pbNotifications);
            }
            if (typeof data.liveNotifications === "boolean") {
              settings.liveNotifications = data.liveNotifications;
              localStorage.setItem("paceman_settings_live_notifications", data.liveNotifications);
            }
            if (typeof data.notificationSound === "boolean") {
              settings.notificationSound = data.notificationSound;
              localStorage.setItem("paceman_settings_notification_sound", data.notificationSound);
            }
            if (typeof data.notificationVolume === "number") {
              settings.notificationVolume = data.notificationVolume;
              localStorage.setItem("paceman_settings_notification_volume", data.notificationVolume);
            }
            if (typeof data.animationsEnabled === "boolean") {
              settings.animationsEnabled = data.animationsEnabled;
              localStorage.setItem("paceman_settings_animations_enabled", data.animationsEnabled);
            }
            if (typeof data.autoOpenTwitch === "boolean") {
              state.autoOpenTwitch = data.autoOpenTwitch;
              localStorage.setItem("paceman_autoOpenTwitch", data.autoOpenTwitch);
            }
            if (Array.isArray(data.favorites)) {
              state.favorites = Array.from(new Set([...state.favorites, ...data.favorites]));
              localStorage.setItem("paceman_favorites", JSON.stringify(state.favorites));
            }
            if (data.favoritePBs && typeof data.favoritePBs === "object") {
              state.favoritePBs = { ...state.favoritePBs, ...data.favoritePBs };
              localStorage.setItem("paceman_favorite_pbs", JSON.stringify(state.favoritePBs));
            }
            if (Array.isArray(data.recents)) {
              state.recents = data.recents.slice(0, 5);
              localStorage.setItem("paceman_recents", JSON.stringify(state.recents));
            }
            alert("Preferences imported. Reloading app...");
            location.reload();
          } else {
            alert("Failed to read file: " + (readResult ? readResult.error : "unknown error"));
          }
        }
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
