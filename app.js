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

  const THEMES = [
    { name: "amethyst", label: "Amethyst" },
    { name: "ocean", label: "Ocean" },
    { name: "emerald", label: "Emerald" },
    { name: "sunset", label: "Sunset" },
    { name: "midnight", label: "Midnight" },
  ];

  const state = {
    page: "home",
    liveRuns: [],
    liveSort: "stage",
    openTwitch: new Set(),
    focusedChannel: null,
    dockLayout: "bottom",
    filters: { streamingOnly: false, maxTime: null },
    autoOpenTwitch: JSON.parse(localStorage.getItem("paceman_autoOpenTwitch") || "false"),
    recents: JSON.parse(localStorage.getItem("paceman_recents") || "[]"),
    playerCache: {},
    profile: { name: null, uuid: null, tf: "daily", allRuns: [], dailyRuns: [], page: 1 },
    leaderboard: { tf: "weekly", rows: null, sortBy: "enters", sortDir: "desc" },
  };

  const autoOpenedStreams = new Set();

  let currentVod = { id: null, offset: 0, currentTime: 0 };

  const navHistory = [];
  let navIndex = -1;
  let suppressNavPush = false;

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

  function formatTime(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
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

  function avatarUrl(id, size) {
    return `${MCHEADS}/avatar/${id}/${size}`;
  }

  function skinUrl(id) {
    return `${MCHEADS}/skin/${id}`;
  }

  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  async function resolveUUID(name) {
    try {
      const data = await getJSON(`${MOJANG}/${encodeURIComponent(name)}`);
      const raw = data.id || null;
      if (!raw) return null;
      const formatted = raw.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
      cachePlayer(name, formatted);
      return formatted;
    } catch (e) {
      return null;
    }
  }

  async function getCurrentNameForUUID(uuid) {
    try {
      const history = await getJSON(`https://api.mojang.com/user/profiles/${uuid}/names`);
      if (!Array.isArray(history) || history.length === 0) return null;
      return history[history.length - 1].name || null;
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
    const runs = sortLiveRuns(state.liveRuns.filter(passesFilters));
    if (runs.length === 0) {
      list.innerHTML = '<div class="loading">No runs match the current filters.</div>';
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
      card.innerHTML = `
        <img src="${avatarUrl(id, 64)}" alt="${escapeHtml(name)}" onerror="this.style.visibility='hidden'">
        <div class="run-info">
          <div class="run-name">
            ${escapeHtml(name)}
            ${streaming ? `<img class="twitch-icon" src="${TWITCH_ICON}" title="Watch ${escapeHtml(twitch)} on Twitch" alt="Twitch">` : ""}
            ${streaming ? `<span class="live-pill"><span class="live-dot"></span>LIVE</span>` : ""}
          </div>
          <div class="run-state">Reached ${stateLabel}</div>
        </div>
        <div class="run-time">${fmt(time)}</div>`;
      card.addEventListener("click", () => openProfile(name, r.user && r.user.uuid));
      if (twitch) {
        card.querySelector(".twitch-icon").addEventListener("click", (e) => {
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
    pushNav({ page: "profile", name, uuid });
    showPage("profile");
    state.profile = { name, uuid: uuid || null, tf: "daily", allRuns: [], dailyRuns: [], page: 1 };
    document.getElementById("profileName").textContent = name;
    document.getElementById("profileStatsRow").innerHTML =
      '<span class="stat-badge" id="profileCompletion">0 completions</span>' +
      '<span class="stat-badge" id="profileAvg">Avg: 0:00</span>' +
      '<span class="stat-badge" id="profilePB">PB: --</span>';
    document.getElementById("profileSplits").innerHTML = '<div class="loading">Loading stats...</div>';
    document.getElementById("profileBestRuns").innerHTML = '<div class="loading">Loading runs...</div>';
    document.querySelectorAll("#profileTimeframes .timeframe-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.tf === "daily");
    });
    if (!uuid) uuid = await resolveUUID(name);
    state.profile.uuid = uuid;
    if (uuid) renderHead3D(document.getElementById("head3dContainer"), uuid);

    const noticeEl = document.getElementById("profileNameNotice");
    const noticeTextEl = document.getElementById("profileNameNoticeText");
    const noticeLinkEl = document.getElementById("profileNameNoticeLink");
    console.log("Notice elements:", !!noticeEl, !!noticeTextEl, !!noticeLinkEl);
    if (noticeEl) noticeEl.style.display = "none";
    if (uuid) {
      const currentName = await getCurrentNameForUUID(uuid);
      console.log("Name check:", name, "->", currentName, "changed?", currentName && currentName !== name);
      if (currentName && currentName !== name) {
        if (noticeTextEl) noticeTextEl.textContent = `${name} is now known as ${currentName}`;
        if (noticeLinkEl) {
          noticeLinkEl.href = `#/player/${encodeURIComponent(currentName)}`;
          noticeLinkEl.onclick = (e) => {
            e.preventDefault();
            openProfile(currentName, uuid);
          };
        }
        if (noticeEl) noticeEl.style.display = "flex";
      }
    }

    addRecent(name);
    await Promise.all([loadProfileStats(), loadProfileRuns()]);
  }

  async function loadProfileStats() {
    const { name, tf } = state.profile;
    const hours = TF_HOURS[tf],
      between = TF_BETWEEN[tf];
    const wrap = document.getElementById("profileSplits");
    const sessionBox = document.getElementById("sessionStats");
    sessionBox.innerHTML = "";
    try {
      const stats = await getJSON(`${API}/getSessionStats?name=${encodeURIComponent(name)}&hours=${hours}&hoursBetween=${between}`);
      wrap.innerHTML = "";
      for (const key of SPLIT_ORDER) {
        const s = stats[key] || { count: 0, avg: "0:00" };
        const card = document.createElement("div");
        card.className = "split-card";
        card.innerHTML = `<div class="split-name">${SPLITS[key]}</div><div class="split-value">${s.count}</div><div class="split-count">Avg ${s.avg}</div>`;
        wrap.appendChild(card);
      }
      const fin = stats.finish || { count: 0, avg: "0:00" };
      document.getElementById("profileCompletion").textContent = `${fin.count} completions`;
      document.getElementById("profileAvg").textContent = `Avg: ${fin.avg}`;
      if (tf === "session") {
        try {
          const nph = await getJSON(`${API}/getNPH?name=${encodeURIComponent(name)}&hours=${hours}&hoursBetween=${between}`);
          sessionBox.innerHTML = renderSessionStats(nph);
        } catch (e) {
          sessionBox.innerHTML = "";
        }
      }
    } catch (e) {
      wrap.innerHTML = '<div class="loading">No stats available.</div>';
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
    const { name } = state.profile;
    try {
      const [daily, all] = await Promise.all([
        getJSON(`${API}/getRecentRuns?name=${encodeURIComponent(name)}&hours=24&limit=50`),
        getJSON(`${API}/getRecentRuns?name=${encodeURIComponent(name)}&hours=999999&limit=5000`),
      ]);
      state.profile.dailyRuns = daily || [];
      state.profile.allRuns = all || [];
      let pb = null;
      for (const r of state.profile.allRuns) {
        if (r.finish != null && (pb == null || r.finish < pb)) pb = r.finish;
      }
      document.getElementById("profilePB").textContent = pb != null ? `PB: ${fmt(pb)}` : "PB: --";
      const ranked = state.profile.dailyRuns
        .map((r) => ({ r, f: furthestIndex(r) }))
        .sort((a, b) => b.f.idx - a.f.idx || a.f.time - b.f.time)
        .slice(0, 5);
      const best = document.getElementById("profileBestRuns");
      best.innerHTML = "";
      if (ranked.length === 0) {
        best.innerHTML = '<div class="loading">No daily runs yet.</div>';
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
      renderAllRunsPage();
    } catch (e) {
      document.getElementById("profileBestRuns").innerHTML = '<div class="loading">No recent runs.</div>';
    }
  }

  function renderAllRunsPage() {
    const runs = state.profile.allRuns;
    const per = 10,
      page = state.profile.page;
    const total = Math.max(1, Math.ceil(runs.length / per));
    const slice = runs.slice((page - 1) * per, page * per);
    const list = document.getElementById("allRunsList");
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
        row.innerHTML = `<div class="run-row-head">${escapeHtml(state.profile.name)} <span class="run-row-sub">#${runId || "?"}</span></div><div class="run-cells">${cells}</div>`;
        row.addEventListener("click", () => openRunDetail(runId, state.profile.name, r));
        list.appendChild(row);
      }
    }
    renderPagination(total, page);
  }

  function renderPagination(total, page) {
    const pag = document.getElementById("runsPagination");
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
    const overlay = document.getElementById("runDetailOverlay");
    document.getElementById("runDetailTitle").textContent = name + " - Run #" + (id || "?");
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
        if ((!name || name === "null") && (full.nickname || (full.user && full.user.nickname))) {
          const fetchedName = full.nickname || (full.user && full.user.nickname);
          document.getElementById("runDetailTitle").textContent = fetchedName + " - Run #" + (id || "?");
        }
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
    const overlay = document.getElementById("runDetailOverlay");
    overlay.classList.remove("visible");
  }

  async function seekVod(seconds, targetTime) {
    if (!currentVod.id) return;
    const webview = document.getElementById("runVodWebview");
    if (!webview) return;
    if (typeof targetTime === "number") {
      currentVod.currentTime = Math.max(0, Math.floor(targetTime));
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

  function renderHead3D(container, id) {
    container.innerHTML = "";
    const skin = skinUrl(id);
    const S = container.clientWidth || 100;
    const scene = document.createElement("div");
    scene.style.cssText = `width:${S}px;height:${S}px;position:relative;transform-style:preserve-3d;transition:transform .25s cubic-bezier(.25,.46,.45,.94);`;
    const positions = {
      front: [14.2857, 14.2857, `translateZ(${S / 2}px)`],
      back: [42.8571, 14.2857, `rotateY(180deg) translateZ(${S / 2}px)`],
      right: [28.5714, 14.2857, `rotateY(90deg) translateZ(${S / 2}px)`],
      left: [0, 14.2857, `rotateY(-90deg) translateZ(${S / 2}px)`],
      top: [14.2857, 0, `rotateX(90deg) translateZ(${S / 2}px)`],
      bottom: [28.5714, 0, `rotateX(-90deg) translateZ(${S / 2}px)`],
    };
    for (const face in positions) {
      const f = document.createElement("div");
      f.style.cssText = `position:absolute;width:${S}px;height:${S}px;background-image:url('${skin}');background-size:800% 800%;background-position:${positions[face][0]}% ${positions[face][1]}%;transform:${positions[face][2]};image-rendering:pixelated;`;
      scene.appendChild(f);
    }
    container.style.perspective = "800px";
    container.appendChild(scene);

    if (headMoveHandler) document.removeEventListener("mousemove", headMoveHandler);
    let targetRy = 0,
      targetRx = 0,
      currentRy = 0,
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
      targetRy = Math.max(-30, Math.min(30, angleY * (180 / Math.PI) * 0.55));
      targetRx = Math.max(-20, Math.min(20, -angleX * (180 / Math.PI) * 0.55));
    };
    document.addEventListener("mousemove", headMoveHandler);
    (function animate() {
      currentRy += (targetRy - currentRy) * 0.08;
      currentRx += (targetRx - currentRx) * 0.08;
      scene.style.transform = `rotateY(${currentRy.toFixed(2)}deg) rotateX(${currentRx.toFixed(2)}deg)`;
      requestAnimationFrame(animate);
    })();
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
          if (sortBy === "avg") {
            if (b.avg !== a.avg) return a.avg - b.avg;
            return b.count - a.count;
          }
          if (sortDir === "asc") return a.count - b.count;
          if (b.count !== a.count) return b.count - a.count;
          return a.avg - b.avg;
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
      const uuid = state.playerCache[name.toLowerCase()];
      item.innerHTML = `<img src="${avatarUrl(uuid || name, 32)}" onerror="this.style.visibility='hidden'"><span class="search-item-name">${escapeHtml(name)}</span>`;
      item.addEventListener("click", () => {
        openProfile(name, uuid);
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
          <button class="time-arrow time-arrow-down" data-split="${split}" type="button">&#9660;</button>
          <input type="text" id="filterSplit_${split}" placeholder="0:00" min="0">
          <button class="time-arrow time-arrow-up" data-split="${split}" type="button">&#9650;</button>
          <span>m:s</span>
        </div>`;
      wrap.appendChild(field);
    }
  }

  function initFilters() {
    buildSplitFilters();
    const overlay = document.getElementById("filterOverlay");
    document.getElementById("filterBtn").addEventListener("click", () => {
      document.getElementById("filterStreamingOnly").checked = state.filters.streamingOnly;
      for (const split of SPLIT_ORDER) {
        const input = document.getElementById(`filterSplit_${split}`);
        const raw = state.filters.maxTime && state.filters.maxTime[split] != null ? state.filters.maxTime[split] : "";
        input.value = raw !== "" ? formatTime(raw) : "";
      }
      overlay.classList.add("visible");
    });
    document.getElementById("closeFilter").addEventListener("click", () => overlay.classList.remove("visible"));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.remove("visible");
    });
    document.querySelectorAll(".time-arrow-up").forEach((btn) => {
      btn.addEventListener("click", () => {
        const split = btn.dataset.split;
        const input = document.getElementById(`filterSplit_${split}`);
        const current = parseTimeToSec(input.value) || 0;
        input.value = formatTime(current + 30);
      });
    });
    document.querySelectorAll(".time-arrow-down").forEach((btn) => {
      btn.addEventListener("click", () => {
        const split = btn.dataset.split;
        const input = document.getElementById(`filterSplit_${split}`);
        const current = parseTimeToSec(input.value) || 0;
        const next = Math.max(0, current - 30);
        input.value = next === 0 ? "" : formatTime(next);
      });
    });
    document.querySelectorAll(".filter-split .time-input input").forEach((input) => {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Backspace" || e.key === "Delete") {
          const val = input.value;
          const selStart = input.selectionStart;
          const selEnd = input.selectionEnd;
          const colonIdx = val.indexOf(":");
          if (colonIdx >= 0 && selStart <= colonIdx && selEnd >= colonIdx) {
            e.preventDefault();
          }
        }
      });
      input.addEventListener("input", () => {
        const raw = input.value.replace(/[^\d]/g, "");
        if (raw.length === 0) {
          input.value = "";
          return;
        }
        const totalSec = parseInt(raw, 10) || 0;
        input.value = formatTime(totalSec);
      });
      input.addEventListener("blur", () => {
        const sec = parseTimeToSec(input.value);
        input.value = sec != null ? formatTime(sec) : "";
      });
    });
    document.getElementById("applyFilters").addEventListener("click", () => {
      state.filters.streamingOnly = document.getElementById("filterStreamingOnly").checked;
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
      state.filters = { streamingOnly: false, maxTime: null };
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
    if (state.page === p) return;
    state.page = p;
    document.querySelectorAll(".page").forEach((el) => el.classList.remove("active"));
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    if (p === "home") {
      document.getElementById("page-home").classList.add("active");
      document.querySelector('[data-page="home"]').classList.add("active");
      loadLiveRuns();
      if (!suppressNavPush) pushNav({ page: "home" });
    } else if (p === "leaderboard") {
      document.getElementById("page-leaderboard").classList.add("active");
      document.querySelector('[data-page="leaderboard"]').classList.add("active");
      state.leaderboard.rows = null;
      state.leaderboard.pages = {};
      loadLeaderboard(true);
      if (!suppressNavPush) pushNav({ page: "leaderboard" });
    } else if (p === "profile") {
      document.getElementById("page-profile").classList.add("active");
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

  function init() {
    initRouter();
    initSearch();
    initFilters();
    initThemes();
    seedSuggestions();
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
    document.getElementById("closeRunDetail").addEventListener("click", closeRunDetail);
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
    showPage("home");
    loadLiveRuns();
    navHistory.length = 0;
    navHistory.push({ page: "home" });
    navIndex = 0;
    document.addEventListener("mousedown", (e) => {
      if (e.button === 3) { e.preventDefault(); goBack(); }
      if (e.button === 4) { e.preventDefault(); goForward(); }
    });
    setInterval(() => {
      if (state.page === "home") loadLiveRuns();
    }, 3000);
    window.addEventListener("resize", () => {
      if (state.profile.uuid && document.getElementById("page-profile").classList.contains("active")) {
        renderHead3D(document.getElementById("head3dContainer"), state.profile.uuid);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
