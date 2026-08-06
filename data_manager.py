import requests
import time
import json
import os
import threading
import subprocess
import sys
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta


class PaceManDataManager:
    BASE_API_URL = "https://paceman.gg/stats/api/"
    LIVE_RUNS_URL = "https://paceman.gg/api/ars/liveruns"

    def __init__(self):
        if sys.platform == "win32":
            base = os.environ.get("APPDATA", os.path.expanduser("~"))
        else:
            base = os.path.expanduser("~")
        self.DATA_DIR = os.path.join(base, ".paceman_app")
        if not os.path.exists(self.DATA_DIR):
            os.makedirs(self.DATA_DIR)
            if sys.platform == "win32":
                try:
                    subprocess.run(["attrib", "+h", self.DATA_DIR], check=True)
                except Exception:
                    pass

        self.RECENTS_FILE = os.path.join(self.DATA_DIR, "recents.json")
        self.PLAYERS_FILE = os.path.join(self.DATA_DIR, "all_players.json")

        self.cached_live_runs = []
        self.last_update_time = 0
        self.recents = self.load_json(self.RECENTS_FILE, [])
        self.all_players = self.load_json(self.PLAYERS_FILE, [])
        self.known_players = set(self.all_players)

        self.stats_cache = {}
        self.runs_cache = {}
        self.fastest_cache = {}
        self.session_summary_cache = {}
        self.avatar_cache = {}
        self.twitch_cache = {}
        self.leaderboard_cache = {}
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": "PaceMan-App/1.0"})
        # Retry adapter for transient network errors
        adapter = requests.adapters.HTTPAdapter(max_retries=2)
        self.session.mount("https://", adapter)
        self.session.mount("http://", adapter)

        threading.Thread(target=self.refresh_global_player_list, daemon=True).start()

    # ------------------------------------------------------------------
    # JSON helpers
    # ------------------------------------------------------------------

    def load_json(self, path, default):
        try:
            if os.path.exists(path):
                with open(path, "r") as f:
                    return json.load(f)
        except Exception:
            pass
        return default

    def save_json(self, path, data):
        try:
            with open(path, "w") as f:
                json.dump(data, f)
        except Exception:
            pass

    def save_recents(self):
        self.save_json(self.RECENTS_FILE, self.recents[:20])

    def save_all_players(self):
        self.save_json(self.PLAYERS_FILE, list(self.known_players))

    # ------------------------------------------------------------------
    # Player list
    # ------------------------------------------------------------------

    def refresh_global_player_list(self):
        try:
            url = (
                f"{self.BASE_API_URL}getLeaderboard"
                "?category=nether&type=count&days=9999&limit=5000"
            )
            response = self.session.get(url, timeout=15)
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    for entry in data:
                        name = entry.get("name")
                        if name:
                            self.known_players.add(name)
                    self.save_all_players()
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Global leaderboards
    # ------------------------------------------------------------------

    def _leaderboard_days_for_timeframe(self, timeframe):
        mapping = {
            "session": 1,
            "daily": 1,
            "weekly": 7,
            "monthly": 30,
            "lifetime": 9999,
        }
        return mapping.get(timeframe, 1)

    def _leaderboard_top_entries(self, data, mode, top_n=3):
        if not isinstance(data, list):
            return []

        rows = []
        for entry in data:
            if not isinstance(entry, dict):
                continue

            name = (
                entry.get("name")
                or entry.get("nickname")
                or entry.get("player")
                or entry.get("user")
            )
            if not isinstance(name, str) or not name.strip():
                continue
            name = name.strip()

            numeric_value = None
            if mode == "count":
                for key in ("count", "value", "stat", "amount", "entries"):
                    v = entry.get(key)
                    if isinstance(v, (int, float)):
                        numeric_value = int(v)
                        break
            else:
                for key in ("avg", "value", "time", "ms"):
                    v = entry.get(key)
                    if isinstance(v, (int, float)):
                        numeric_value = int(v)
                        break
                    if isinstance(v, str):
                        parsed = self._time_string_to_ms(v)
                        if parsed is not None:
                            numeric_value = int(parsed)
                            break

            if numeric_value is None:
                continue
            if mode == "avg" and numeric_value <= 0:
                continue
            if mode == "count" and numeric_value < 0:
                continue

            rows.append({"name": name, "value": numeric_value})

        if not rows:
            return []

        if mode == "count":
            rows.sort(key=lambda x: x["value"], reverse=True)
        else:
            rows.sort(key=lambda x: x["value"])

        unique_rows = []
        seen = set()
        for row in rows:
            name_key = row["name"].lower()
            if name_key in seen:
                continue
            seen.add(name_key)
            unique_rows.append(row)
            if len(unique_rows) >= max(1, int(top_n)):
                break
        return unique_rows

    def _fetch_leaderboard_mode(self, split_key, mode, days, limit):
        try:
            url = (
                f"{self.BASE_API_URL}getLeaderboard"
                f"?category={split_key}&type={mode}&days={int(days)}&limit={int(limit)}"
            )
            response = self.session.get(url, timeout=12)
            if response.status_code != 200:
                return None
            payload = response.json()
            if not isinstance(payload, list):
                return None
            return self._leaderboard_top_entries(payload, mode, top_n=3)
        except Exception:
            return []

    def get_global_leaderboard(self, timeframe="daily", limit=250):
        """Return per-split global leaders for count and average time."""
        cache_key = (timeframe, int(limit))
        if cache_key in self.leaderboard_cache:
            ts, cached = self.leaderboard_cache[cache_key]
            if time.time() - ts < 300:
                return cached

        days = self._leaderboard_days_for_timeframe(timeframe)
        split_keys = [
            "nether",
            "bastion",
            "fortress",
            "first_portal",
            "stronghold",
            "end",
            "finish",
            "first_structure",
            "second_structure",
        ]

        result = {
            "timeframe": timeframe,
            "days": days,
            "updated_at": int(time.time()),
            "splits": {
                key: {
                    "count_leader": None,
                    "avg_leader": None,
                    "count_top": [],
                    "avg_top": [],
                }
                for key in split_keys
            },
        }

        tasks = {}
        with ThreadPoolExecutor(max_workers=8) as executor:
            for split_key in split_keys:
                for mode in ("count", "avg"):
                    future = executor.submit(
                        self._fetch_leaderboard_mode,
                        split_key,
                        mode,
                        days,
                        limit,
                    )
                    tasks[future] = (split_key, mode)

            for future in as_completed(tasks):
                split_key, mode = tasks[future]
                try:
                    top_rows = future.result()
                except Exception:
                    top_rows = []

                if mode == "count":
                    result["splits"][split_key]["count_top"] = top_rows
                    result["splits"][split_key]["count_leader"] = top_rows[0] if top_rows else None
                else:
                    result["splits"][split_key]["avg_top"] = top_rows
                    result["splits"][split_key]["avg_leader"] = top_rows[0] if top_rows else None

        self.leaderboard_cache[cache_key] = (time.time(), result)
        return result

    # ------------------------------------------------------------------
    # Recents
    # ------------------------------------------------------------------

    def add_to_recents(self, nickname):
        if not nickname:
            return
        if nickname in self.recents:
            self.recents.remove(nickname)
        self.recents.insert(0, nickname)
        self.recents = self.recents[:20]
        self.save_recents()

    def clear_recents(self):
        """Remove all entries from the recents list and persist the change."""
        self.recents = []
        self.save_recents()

    # ------------------------------------------------------------------
    # Live runs
    # ------------------------------------------------------------------

    def fetch_live_runs(self):
        try:
            response = self.session.get(self.LIVE_RUNS_URL, timeout=5)
            if response.status_code == 200:
                data = response.json()
                if not isinstance(data, list):
                    data = []
                for run in data:
                    user_obj = run.get("user") or {}
                    run["twitch"] = self._normalize_twitch_account(user_obj.get("liveAccount"))
                self.cached_live_runs = sorted(
                    data, key=lambda x: x.get("lastUpdated", 0), reverse=True
                )
                for run in self.cached_live_runs:
                    nickname = run.get("nickname")
                    if nickname:
                        self.known_players.add(nickname)
                        twitch_name = run.get("twitch")
                        if twitch_name:
                            self.twitch_cache[nickname.lower()] = (time.time(), twitch_name)
                self.last_update_time = time.time()
        except Exception:
            # Keep last successful data to avoid a blank screen on transient errors
            pass
        return self.cached_live_runs

    def _normalize_twitch_account(self, raw_value):
        if not isinstance(raw_value, str):
            return None

        value = raw_value.strip()
        if not value:
            return None

        lower_value = value.lower()
        marker = "twitch.tv/"
        if marker in lower_value:
            idx = lower_value.find(marker)
            value = value[idx + len(marker):]

        value = value.strip().strip("/")
        if value.startswith("@"):
            value = value[1:]

        for sep in ("?", "#", "/", " "):
            if sep in value:
                value = value.split(sep, 1)[0]

        value = value.strip()
        if not value:
            return None

        return value

    def _extract_twitch_from_runs(self, nickname, runs):
        if not nickname or not isinstance(runs, list):
            return None

        target = nickname.lower()
        for run in runs:
            if not isinstance(run, dict):
                continue

            run_name = (run.get("nickname") or "").lower()
            if run_name and run_name != target:
                continue

            direct = self._normalize_twitch_account(run.get("twitch"))
            if direct:
                return direct

            user_obj = run.get("user")
            if isinstance(user_obj, dict):
                for key in ("liveAccount", "twitch", "twitchAccount", "streamAccount"):
                    val = self._normalize_twitch_account(user_obj.get(key))
                    if val:
                        return val

        return None

    def get_player_twitch(self, nickname, runs=None):
        """Resolve a player's Twitch name without blocking the UI thread."""
        if not nickname:
            return None

        key = nickname.lower()
        cached = self.twitch_cache.get(key)
        if cached is not None:
            ts, name = cached
            if (time.time() - ts) < 3600 and name:
                return name

        for run in self.cached_live_runs:
            if (run.get("nickname") or "").lower() != key:
                continue
            live_name = self._normalize_twitch_account(run.get("twitch"))
            if live_name:
                self.twitch_cache[key] = (time.time(), live_name)
                return live_name

        inferred = self._extract_twitch_from_runs(nickname, runs)
        if inferred:
            self.twitch_cache[key] = (time.time(), inferred)
            return inferred

        return None

    def fetch_player_twitch_from_profile_page(self, nickname):
        """Try to resolve real Twitch handle from Paceman player page metadata."""
        if not nickname:
            return None

        key = nickname.lower()
        cached = self.twitch_cache.get(key)
        if cached is not None:
            ts, name = cached
            # Allow cached positive values to live longer than fast in-memory lookups.
            if name and (time.time() - ts) < 43200:
                return name

        try:
            url = f"https://paceman.gg/stats/player/{nickname}"
            resp = self.session.get(
                url,
                timeout=12,
                headers={"User-Agent": "Mozilla/5.0 PaceMan-App/1.0"},
            )
            if resp.status_code != 200:
                return None

            html = resp.text
            if not isinstance(html, str) or not html:
                return None

            patterns = [
                r'"liveAccount"\s*:\s*"([^"]+)"',
                r'liveAccount\\"\s*:\s*\\"([^\\"]+)\\"',
                r'twitch\.tv/([A-Za-z0-9_]+)',
            ]

            for pat in patterns:
                matches = re.findall(pat, html, flags=re.I)
                if not matches:
                    continue
                for raw in matches:
                    normalized = self._normalize_twitch_account(raw)
                    if normalized:
                        self.twitch_cache[key] = (time.time(), normalized)
                        return normalized

            return None
        except Exception:
            return None

    # ------------------------------------------------------------------
    # Search / recommendations
    # ------------------------------------------------------------------

    def get_recommendations(self, query):
        if not query:
            return []
        query_lower = query.lower()
        matches = [p for p in self.known_players if p and query_lower in p.lower()]
        matches.sort(
            key=lambda x: (
                x.lower() != query_lower,
                not x.lower().startswith(query_lower),
                x.lower(),
            )
        )
        return matches[:15]

    # ------------------------------------------------------------------
    # Player statistics
    # ------------------------------------------------------------------

    def get_user_stats(self, nickname, timeframe="lifetime"):
        """
        Fetch user stats for the given timeframe.

        Strategy:
          1. Try getSessionStats with the correct hours/hoursBetween values.
          2. If that returns None, force calculation from runs data.
          3. A 404 means the player is unknown — return None so the UI shows
             a friendly "No data found" message.
          4. Always return stats if we have any runs data (even if zeros).
        """
        cache_key = (nickname, timeframe)
        if cache_key in self.stats_cache:
            ts, data = self.stats_cache[cache_key]
            if time.time() - ts < 300:
                return data

        # Try the API first
        hours_map = {
            "session": 6,
            "daily": 24,
            "weekly": 168,
            "monthly": 720,
            "lifetime": 999999,
        }
        hours_between_map = {
            "session": 6,
            "daily": 24,
            "weekly": 168,
            "monthly": 720,
            "lifetime": 999999,
        }
        hours = hours_map.get(timeframe, 999999)
        hours_between = hours_between_map.get(timeframe, 999999)

        result = self._fetch_session_stats(nickname, hours, hours_between)
        
        # If API returns None, force calculation from runs
        if result is None:
            runs = self._fetch_recent_runs(nickname, hours=999999, limit=999999)
            if runs:
                result = self._calculate_stats_from_runs(runs, timeframe)
        
        if result is not None:
            self.stats_cache[cache_key] = (time.time(), result)
        return result

    def _fetch_session_stats(self, nickname, hours, hours_between):
        """
        Internal: call getSessionStats and return a normalised dict or None.
        """
        try:
            url = (
                f"{self.BASE_API_URL}getSessionStats"
                f"?name={nickname}&hours={hours}&hoursBetween={hours_between}"
            )
            response = self.session.get(url, timeout=10)

            # 404 = player unknown to the API
            if response.status_code == 404:
                return None

            if response.status_code != 200:
                return None

            try:
                data = response.json()
            except Exception:
                return None

            # API returned an error object
            if isinstance(data, dict) and "error" in data:
                return None

            # Unexpected type
            if not isinstance(data, dict):
                return None

            # Normalise: ensure every expected key exists so the UI never
            # crashes on a missing key.
            expected_keys = [
                "nether", "bastion", "fortress",
                "first_portal", "stronghold", "end", "finish",
                "first_structure", "second_structure",
            ]
            for key in expected_keys:
                if key not in data:
                    data[key] = {"count": 0, "avg": "0:00"}
                else:
                    entry = data[key]
                    if not isinstance(entry, dict):
                        data[key] = {"count": 0, "avg": "0:00"}
                    else:
                        entry.setdefault("count", 0)
                        entry.setdefault("avg", "0:00")

            return data

        except requests.exceptions.Timeout:
            return None
        except requests.exceptions.ConnectionError:
            return None
        except Exception:
            return None

    # ------------------------------------------------------------------
    # Recent runs (profile view — latest 5)
    # ------------------------------------------------------------------

    def get_recent_runs(self, nickname):
        """Return up to 5 recent runs for the profile view."""
        runs = self._fetch_recent_runs(nickname, hours=999999, limit=100000)
        return runs[:5] if runs else []

    # ------------------------------------------------------------------
    # All runs (all-runs view with pagination)
    # ------------------------------------------------------------------

    def get_all_runs(self, nickname):
        """Fetch all available runs for the all-runs view."""
        cache_key = nickname
        if cache_key in self.runs_cache:
            ts, data = self.runs_cache[cache_key]
            if time.time() - ts < 60:  # Fresh enough
                return data

        runs = self._fetch_recent_runs(nickname, hours=999999, limit=5000)
        if runs is not None:
            self.runs_cache[cache_key] = (time.time(), runs)
            return runs

        # Fallback to stale cache
        if cache_key in self.runs_cache:
            return self.runs_cache[cache_key][1]
        return []

    # ------------------------------------------------------------------
    # Fastest stats (personal bests for each milestone + fastest run)
    # ------------------------------------------------------------------

    def get_fastest_stats(self, nickname):
        """
        Calculate the fastest time for each milestone across all runs,
        and identify the fastest completed run (finish time).

        Returns a dict like:
        {
            "fastest_run": {
                "id": 12345,
                "nether": 120000,
                "bastion": 150000,
                "fortress": 280000,
                "first_portal": 420000,
                "stronghold": 540000,
                "end": 560000,
                "finish": 600000,
            },
            "fastest_milestones": {
                "nether": 120000,
                "bastion": 140000,
                "fortress": 270000,
                "first_portal": 410000,
                "stronghold": 520000,
                "end": 540000,
                "finish": 590000,
            }
        }
        """
        cache_key = nickname
        if cache_key in self.fastest_cache:
            ts, data = self.fastest_cache[cache_key]
            if time.time() - ts < 300:
                return data

        # Fetch all runs
        runs = self._fetch_recent_runs(nickname, hours=999999, limit=999999)
        if not runs:
            return None

        fastest_milestones = {
            "nether": None,
            "bastion": None,
            "fortress": None,
            "first_portal": None,
            "stronghold": None,
            "end": None,
            "finish": None,
        }

        fastest_run = None
        best_finish = None

        for run in runs:
            if not isinstance(run, dict):
                continue

            # Track fastest milestones
            for key in fastest_milestones.keys():
                ms = run.get(key)
                if ms is not None and isinstance(ms, (int, float)):
                    if fastest_milestones[key] is None or ms < fastest_milestones[key]:
                        fastest_milestones[key] = ms

            # Track fastest finish (completed run)
            finish_time = run.get("finish")
            if finish_time is not None and isinstance(finish_time, (int, float)):
                if best_finish is None or finish_time < best_finish:
                    best_finish = finish_time
                    fastest_run = run

        result = {
            "fastest_run": fastest_run,
            "fastest_milestones": fastest_milestones,
        }

        self.fastest_cache[cache_key] = (time.time(), result)
        return result

    # ------------------------------------------------------------------
    # Session summary (advanced metrics)
    # ------------------------------------------------------------------

    def _get_run_timestamp(self, run):
        """
        Extract a Unix timestamp from a run dict.
        The API returns runs with a 'time' field (Unix int).
        Fallback to 'date' or 'timestamp' for older formats.
        Returns float or None.
        """
        # Primary field used by paceman.gg API
        t = run.get("time")
        if t is not None:
            try:
                return float(t)
            except (TypeError, ValueError):
                pass

        # Legacy / alternative fields
        for field in ("date", "timestamp", "updatedTime", "realUpdated"):
            t = run.get(field)
            if t is not None:
                if isinstance(t, (int, float)):
                    return float(t)
                if isinstance(t, str):
                    try:
                        if "Z" in t:
                            return datetime.fromisoformat(
                                t.replace("Z", "+00:00")
                            ).timestamp()
                        return datetime.strptime(t, "%Y-%m-%d %H:%M:%S").timestamp()
                    except Exception:
                        pass
        return None

    def get_session_summary(self, nickname, timeframe="session"):
        """Calculate a detailed session summary with advanced metrics."""
        cache_key = (nickname, timeframe)
        if cache_key in self.session_summary_cache:
            ts, data = self.session_summary_cache[cache_key]
            if time.time() - ts < 60:  # Cache for 1 minute
                return data

        # Check if we have cached runs first to avoid redundant API calls
        runs = None
        if nickname in self.runs_cache:
            ts, cached_runs = self.runs_cache[nickname]
            if time.time() - ts < 120:  # Use cached runs if less than 2 mins old
                runs = cached_runs

        if runs is None:
            runs = self._fetch_recent_runs(nickname, hours=999999, limit=999999)
            if runs is not None:
                self.runs_cache[nickname] = (time.time(), runs)

        if not runs:
            return None

        # Determine the time window based on timeframe
        if timeframe == "session":
            hours = 6
        elif timeframe == "daily":
            hours = 24
        elif timeframe == "weekly":
            hours = 168
        elif timeframe == "monthly":
            hours = 720
        else:  # lifetime
            hours = 999999

        now = time.time()
        cutoff_time = now - (hours * 3600)

        # Filter runs within the timeframe using the correct 'time' field
        filtered_runs = []
        for run in runs:
            if not isinstance(run, dict):
                continue
            run_time = self._get_run_timestamp(run)
            if run_time is not None:
                if timeframe == "lifetime" or run_time >= cutoff_time:
                    filtered_runs.append(run)
            else:
                # No timestamp — include only for lifetime
                if timeframe == "lifetime":
                    filtered_runs.append(run)

        # For "session": detect sessions by gaps >1 hour between nether enters.
        if not filtered_runs and timeframe == "session" and runs:
            sorted_runs = []
            for run in runs:
                rt = self._get_run_timestamp(run)
                if rt is not None:
                    sorted_runs.append((rt, run))

            sorted_runs.sort(key=lambda x: x[0])  # oldest first

            if sorted_runs:
                # Find the last session: cluster runs with <=1h gaps
                last_session = [sorted_runs[-1][1]]
                for i in range(len(sorted_runs) - 2, -1, -1):
                    rt, run = sorted_runs[i]
                    if rt >= (sorted_runs[i + 1][0] - 3600):  # <= 1 hour gap
                        last_session.insert(0, run)
                    else:
                        break
                filtered_runs = last_session

        if not filtered_runs:
            return None

        # Calculate metrics
        nether_times = []
        first_structure_times = []
        second_structure_times = []
        end_times = []
        nether_count = 0
        reset_count = 0

        for run in filtered_runs:
            # Nether
            nether_ms = run.get("nether")
            if nether_ms is not None and isinstance(nether_ms, (int, float)):
                nether_times.append(nether_ms)
                nether_count += 1

            # First structure (bastion or fortress first)
            fs_ms = run.get("first_structure")
            if fs_ms is not None and isinstance(fs_ms, (int, float)):
                first_structure_times.append(fs_ms)

            # Second structure
            ss_ms = run.get("second_structure")
            if ss_ms is not None and isinstance(ss_ms, (int, float)):
                second_structure_times.append(ss_ms)

            # End enter — use the dedicated 'end' field from the API
            end_ms = run.get("end")
            if end_ms is not None and isinstance(end_ms, (int, float)):
                end_times.append(end_ms)

            # Try to extract reset count (if available)
            resets = run.get("resets", 0)
            if isinstance(resets, (int, float)):
                reset_count += resets

        # Calculate session duration (from first to last run)
        session_duration_ms = 0
        run_timestamps = []
        for run in filtered_runs:
            rt = self._get_run_timestamp(run)
            if rt is not None:
                run_timestamps.append(rt)

        if run_timestamps:
            span_sec = max(run_timestamps) - min(run_timestamps)
            if span_sec == 0:
                span_sec = 300  # Default to 5 mins if only one run
            session_duration_ms = int(span_sec * 1000)

        # Calculate time ago (from the oldest run)
        oldest_run_time = now
        if run_timestamps:
            oldest_run_time = min(run_timestamps)
        time_ago_str = self._format_time_ago(oldest_run_time)

        # Calculate RNPH using actual session span rather than the full
        # timeframe window so the number is meaningful.
        session_hours = session_duration_ms / (3600 * 1000) if session_duration_ms > 0 else 0
        rnph = round(nether_count / session_hours, 2) if session_hours > 0 else 0

        result = {
            "session_duration_ms": session_duration_ms,
            "session_start_time": int(now),
            "time_ago_str": time_ago_str,
            "nethers": {
                "count": nether_count,
                "avg_ms": int(sum(nether_times) / len(nether_times)) if nether_times else 0,
                "nph": self._calculate_nph(nether_count, session_duration_ms),
                "rnph": rnph,
                "rpe": self._calculate_rpe(reset_count, nether_count),
            },
            "first_structures": {
                "count": len(first_structure_times),
                "avg_ms": int(sum(first_structure_times) / len(first_structure_times)) if first_structure_times else 0,
            },
            "second_structures": {
                "count": len(second_structure_times),
                "avg_ms": int(sum(second_structure_times) / len(second_structure_times)) if second_structure_times else 0,
            },
            "end_enters": {
                "count": len(end_times),
                "avg_ms": int(sum(end_times) / len(end_times)) if end_times else 0,
            },
        }

        self.session_summary_cache[cache_key] = (time.time(), result)
        return result

    def _calculate_nph(self, nether_count, duration_ms):
        """Calculate Nethers Per Hour."""
        if duration_ms <= 0 or nether_count == 0:
            return 0.0
        hours = duration_ms / (3600 * 1000)
        nph = nether_count / hours
        return round(nph, 2)

    def _calculate_rpe(self, reset_count, nether_count):
        """Calculate Resets Per Enter."""
        if nether_count == 0:
            return 0
        rpe = reset_count / nether_count
        return round(rpe, 0)

    def get_nph_stats(self, nickname, hours=6):  # Changed default to 6 hours (session timeframe)
        """
        Call getNPH and return detailed performance metrics.
        Returns a dict with rtanph, rnph, lnph, count, avg (ms), resets, rpe, playtime, walltime, seedsPlayed
        """
        cache_key = nickname
        if cache_key in self.stats_cache:
            ts, data = self.stats_cache[cache_key]
            if time.time() - ts < 300:
                return data

        try:
            url = (
                f"{self.BASE_API_URL}getNPH/"
                f"?name={nickname}&hours={hours}&hoursBetween={hours}"
            )
            response = self.session.get(url, timeout=10)

            if response.status_code == 404:
                return None

            if response.status_code != 200:
                return None

            try:
                data = response.json()
            except Exception:
                return None

            if isinstance(data, dict) and "error" in data:
                return None

            if not isinstance(data, dict):
                return None

            # Normalize avg to milliseconds for consistency
            raw_avg = data.get("avg", 0)
            if isinstance(raw_avg, (int, float)):
                data["avg"] = int(raw_avg)  # Already in ms from API

            self.stats_cache[cache_key] = (time.time(), data)
            return data

        except requests.exceptions.Timeout:
            return None
        except requests.exceptions.ConnectionError:
            return None
        except Exception:
            return None

    def _format_time_ago(self, timestamp):
        """Format a Unix timestamp as 'X time ago'."""
        now = time.time()
        diff_seconds = int(now - timestamp)

        if diff_seconds < 60:
            return f"{diff_seconds}s ago"
        elif diff_seconds < 3600:
            minutes = diff_seconds // 60
            return f"{minutes}m ago"
        elif diff_seconds < 86400:
            hours = diff_seconds // 3600
            return f"{hours}h ago"
        else:
            days = diff_seconds // 86400
            return f"{days}d ago"

    def _format_nph(self, value):
        """Format NPH values to display as X.XX with appropriate label."""
        if value is None or value == 0:
            return "--.--"
        return str(round(value, 2))

    def _format_playtime_ms(self, ms):
        """Format milliseconds as HH:MM:SS or MM:SS."""
        if ms is None or ms <= 0:
            return "0:00"
        total_seconds = int(ms / 1000)
        hours = total_seconds // 3600
        minutes = (total_seconds % 3600) // 60
        seconds = total_seconds % 60
        if hours > 0:
            return f"{hours}:{minutes:02d}:{seconds:02d}"
        return f"{minutes}:{seconds:02d}"

    # ------------------------------------------------------------------
    # Internal fetch helper
    # ------------------------------------------------------------------

    def _time_string_to_ms(self, time_str):
        """
        Convert a time string like '3:47' to milliseconds.
        Returns int or None if invalid.
        """
        if not time_str or time_str == "0:00":
            return 0
        try:
            parts = time_str.split(":")
            if len(parts) == 2:
                minutes, seconds = int(parts[0]), int(parts[1])
                return (minutes * 60 + seconds) * 1000
            elif len(parts) == 3:
                hours, minutes, seconds = int(parts[0]), int(parts[1]), int(parts[2])
                return (hours * 3600 + minutes * 60 + seconds) * 1000
        except (ValueError, IndexError):
            pass
        return None

    def _calculate_stats_from_runs(self, runs, timeframe="session"):
        """
        Force calculation of stats from runs data, bypassing the API's
        getSessionStats endpoint. This ensures stats always display.
        
        Returns a dict matching the getSessionStats response format.
        """
        if not runs:
            return None

        # Determine the time window based on timeframe
        if timeframe == "session":
            hours = 6
        elif timeframe == "daily":
            hours = 24
        elif timeframe == "weekly":
            hours = 168
        elif timeframe == "monthly":
            hours = 720
        else:  # lifetime
            hours = 999999

        now = time.time()
        cutoff_time = now - (hours * 3600)

        # Filter runs within the timeframe
        filtered_runs = []
        for run in runs:
            if not isinstance(run, dict):
                continue
            run_time = self._get_run_timestamp(run)
            if run_time is not None:
                if timeframe == "lifetime" or run_time >= cutoff_time:
                    filtered_runs.append(run)
            else:
                if timeframe == "lifetime":
                    filtered_runs.append(run)

        # For "session": if nothing in the last 6h, fall back to most recent cluster
        if not filtered_runs and timeframe == "session" and runs:
            sorted_runs = []
            for run in runs:
                rt = self._get_run_timestamp(run)
                if rt is not None:
                    sorted_runs.append((rt, run))
            sorted_runs.sort(key=lambda x: x[0], reverse=True)
            if sorted_runs:
                most_recent_time = sorted_runs[0][0]
                session_cutoff = most_recent_time - (6 * 3600)
                for rt, run in sorted_runs:
                    if rt >= session_cutoff:
                        filtered_runs.append(run)
                    else:
                        break

        if not filtered_runs:
            return None

        # Calculate metrics from runs
        stats = {
            "nether": {"count": 0, "avg": "0:00"},
            "bastion": {"count": 0, "avg": "0:00"},
            "fortress": {"count": 0, "avg": "0:00"},
            "first_portal": {"count": 0, "avg": "0:00"},
            "stronghold": {"count": 0, "avg": "0:00"},
            "end": {"count": 0, "avg": "0:00"},
            "finish": {"count": 0, "avg": "0:00"},
            "first_structure": {"count": 0, "avg": "0:00"},
            "second_structure": {"count": 0, "avg": "0:00"},
        }

        # Aggregate data from runs
        for key in stats.keys():
            times = []
            for run in filtered_runs:
                val = run.get(key)
                if val is not None and isinstance(val, (int, float)):
                    times.append(val)
            
            if times:
                count = len(times)
                avg_ms = sum(times) / count
                # Convert ms to time string MM:SS or HH:MM:SS
                total_secs = int(avg_ms / 1000)
                hours_part = total_secs // 3600
                minutes = (total_secs % 3600) // 60
                seconds = total_secs % 60
                if hours_part > 0:
                    avg_str = f"{hours_part}:{minutes:02d}:{seconds:02d}"
                else:
                    avg_str = f"{minutes}:{seconds:02d}"
                stats[key] = {"count": count, "avg": avg_str}

        return stats

    def _fetch_recent_runs(self, nickname, hours=999999, limit=999999):
        """
        Call getRecentRuns and return a list of runs (only those that reached
        nether), an empty list if the player is unknown, or None on failure.
        """
        try:
            url = (
                f"{self.BASE_API_URL}getRecentRuns"
                f"?name={nickname}&hours={hours}&limit={limit}"
            )
            response = self.session.get(url, timeout=30 if limit > 5000 else 10)

            # 404 = player unknown — return empty list so the UI shows
            # "No recent runs found" rather than crashing.
            if response.status_code == 404:
                return []

            if response.status_code != 200:
                return None

            try:
                data = response.json()
            except Exception:
                return None

            if isinstance(data, dict) and "error" in data:
                return []

            if not isinstance(data, list):
                return []

            # Only keep runs that at least reached nether
            nether_runs = [r for r in data if r.get("nether") is not None]
            return nether_runs

        except requests.exceptions.Timeout:
            return None
        except requests.exceptions.ConnectionError:
            return None
        except Exception:
            return None

    def fetch_player_avatar(self, nickname):
        """Fetch a Minecraft full skin texture for the given player."""
        if not nickname:
            return None

        cache_key = f"skin_v2:{nickname.lower()}"
        if cache_key in self.avatar_cache:
            ts, img = self.avatar_cache[cache_key]
            if time.time() - ts < 3600:
                return img

        try:
            from io import BytesIO
            from PIL import Image

            # Use full skin endpoints so avatar rendering can project real textures onto all cube faces.
            candidates = [
                f"https://mc-heads.net/skin/{nickname}",
                f"https://minotar.net/skin/{nickname}",
            ]

            for url in candidates:
                try:
                    response = self.session.get(url, timeout=4)
                except Exception:
                    continue
                if response.status_code != 200:
                    continue

                try:
                    img = Image.open(BytesIO(response.content)).convert("RGBA")
                except Exception:
                    continue

                # Valid classic/modern skin sheets are at least 64x32.
                if img.width < 64 or img.height < 32:
                    continue

                # Normalize to 64x64 to simplify texture addressing in the renderer.
                if img.size != (64, 64):
                    normalized = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
                    normalized.paste(img.crop((0, 0, min(64, img.width), min(64, img.height))), (0, 0))
                    img = normalized

                self.avatar_cache[cache_key] = (time.time(), img)
                return img

            return None
        except Exception:
            return None

    def fetch_player_face(self, nickname, size=24):
        """Fetch a small 2D player face icon for list rows."""
        if not nickname:
            return None

        cache_key = f"face_v1:{nickname.lower()}:{int(size)}"
        if cache_key in self.avatar_cache:
            ts, img = self.avatar_cache[cache_key]
            if time.time() - ts < 3600:
                return img

        try:
            from io import BytesIO
            from PIL import Image

            url = f"https://mc-heads.net/avatar/{nickname}/{int(size)}"
            response = self.session.get(url, timeout=4)
            if response.status_code != 200:
                return None

            img = Image.open(BytesIO(response.content)).convert("RGBA")
            self.avatar_cache[cache_key] = (time.time(), img)
            return img
        except Exception:
            return None
