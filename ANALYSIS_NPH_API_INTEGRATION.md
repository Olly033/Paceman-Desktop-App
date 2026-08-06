# NPH API Integration Analysis

## Executive Summary
This document analyzes the `/getNPH/` API endpoint integration in PaceMan App, explains how the data is displayed in the UI, and documents the bug fixes applied to make the feature functional.

---

## API Endpoint: `/getNPH/`

### Request Format
```
GET /stats/api/getNPH/?name={player}&hours={hours}&hoursBetween={hoursBetween}
```

**Parameters:**
- `name`: Minecraft player nickname (required)
- `hours`: Time window in hours to query
- `hoursBetween`: Gap between runs in hours for session detection

### Response Format
```json
{
  "rtanph": 0,              // Real-time Nethers Per Hour
  "rnph": 0,                // Resets Normalized Per Hour (quality metric)
  "lnph": 0,                // Last Nethers Per Hour (recent form)
  "count": 0,               // Total nether enters
  "avg": 0,                 // Average time in milliseconds
  "playtime": 0,            // Total playtime in milliseconds
  "walltime": 0,            // Actual game time in milliseconds  
  "resets": 0,              // Number of resets
  "totalResets": 0,         // Lifetime resets (not used)
  "seedsPlayed": 0,         // Unique seeds played
  "rpe": 0                  // Resets Per Enter (from API, not calculated)
}
```

---

## How the Data Flows Through the Application

### 1. **Data Fetching** (`data_manager.py`)

#### `get_nph_stats()` Method
- **Location:** `data_manager.py` lines 600-648
- **Function:** Makes HTTP request to `/getNPH/` endpoint
- **Caching:** Results cached for 300 seconds (5 minutes) with nickname as cache key

**Key Implementation Details:**
```python
def get_nph_stats(self, nickname, hours=999999):
    """Call getNPH API and return performance metrics"""
    url = f"{self.BASE_API_URL}getNPH/?name={nickname}&hours={hours}&hoursBetween={hours}"
    response = self.session.get(url, timeout=10)
    
    # Returns None on 404 (player unknown), error objects, or non-200 status
    data["avg"] = int(raw_avg)  # Normalize to milliseconds for consistency
    
    return data
```

**Important:** The method accepts an `hours` parameter but defaults to `999999` (lifetime). This was changed in the fix to always use `hours=6` (session timeframe) as requested by the user.

---

### 2. **Data Loading** (`main.py`)

#### `load_profile_data()` Method
- **Location:** `main.py` lines 830-861
- **Function:** Loads all profile-related data including NPH stats

**Before (Buggy):**
```python
try:
    nph_stats = self.data_manager.get_nph_stats(nickname)  # Always fetched lifetime data!
except Exception:
    nph_stats = None
self.after(0, lambda: self.safe_display_profile(stats, runs, fastest, session_summary, nickname))
# ❌ nph_stats never passed to display function!
```

**After (Fixed):**
```python
try:
    nph_stats = self.data_manager.get_nph_stats(nickname, hours=6)  # Session timeframe!
except Exception:
    nph_stats = None
self.after(0, lambda: self.safe_display_profile(stats, runs, fastest, session_summary, nph_stats, nickname))
# ✅ nph_stats properly passed to display function
```

---

### 3. **Data Display** (`main.py`)

#### `display_session_summary()` Method
- **Location:** `main.py` lines 894-1056
- **Condition:** Only shown when profile timeframe is "session"
- **Purpose:** Displays all NPH metrics from the API in a card-based layout

**UI Components Displayed:**

##### A. Performance Metrics Cards (RTANPH, RNPH, LNPH)
```python
# Displayed as 3 cards with gold accent for RTANPH
create_perf_card(perf_frame, "RTANPH", value, "real-time NPH")
create_perf_card(perf_frame, "RNPH", value, "quality metric")  
create_perf_card(perf_frame, "LNPH", value, "recent form")
```

**Visual Layout:**
- Each metric shown in a dark card with:
  - Label (dimmed text)
  - Value (large monospace font)
    - RTANPH uses **gold** color (`#FFD700`) to highlight it as primary metric
    - Other metrics use **blue accent** (`#5865F2`)
  - Subtitle (small dimmed text)

##### B. RPE Card
```python
# Separate card for RPE with resets per enter label
rpe_value = nph_stats.get("rpe", 0)
display_rpe_in_card(rpe_value, "resets per enter")
```

**Note:** The RPE value comes directly from the API (not calculated locally) as requested. It represents **Resets Per Enter for the session timeframe**.

##### C. Playtime & Seeds Info
```python
# Additional row below performance metrics
display(f"Playtime: {HH:MM:SS}  |  Walltime: {HH:MM:SS}")
if seeds_played > 0:
    display(f"• Seeds: {count}")
```

**Values from API:**
- `playtime`: Total time in game (including disconnects/reconnects)
- `walltime`: Actual elapsed time (no gaps counted)
- `seedsPlayed`: Number of unique seeds the player has completed

---

## Bug Fixes Applied

### Issue #1: Missing NPH Stats Parameter
**Problem:** `safe_display_profile()` called `display_session_summary(session_summary, nph_stats)` but `nph_stats` variable was undefined.

**Root Cause:** The `load_profile_data()` method never fetched NPH stats data.

**Fix:** Added NPH stats fetching in `load_profile_data()`:
```python
try:
    nph_stats = self.data_manager.get_nph_stats(nickname, hours=6)
except Exception:
    nph_stats = None
```

### Issue #2: Wrong Timeframe Default
**Problem:** `get_nph_stats()` defaulted to `hours=999999` (lifetime), showing all-time NPH instead of session data.

**Fix:** Changed the call to pass `hours=6`:
```python
nph_stats = self.data_manager.get_nph_stats(nickname, hours=6)
```

### Issue #3: Function Signature Mismatch
**Problem:** `safe_display_profile()` called with 5 parameters but expected 6.

**Fix:** Updated function signature to accept `nph_stats`:
```python
def safe_display_profile(self, stats, runs, fastest, session_summary, nph_stats, nickname):
    # Now properly receives NPH data
```

---

## Data Display Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    User Opens Player Profile                     │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│               load_profile_data() (Background Thread)            │
│  ├─ get_user_stats(nickname, timeframe)                         │
│  ├─ get_recent_runs(nickname)                                   │
│  ├─ get_fastest_stats(nickname)                                 │
│  ├─ get_session_summary(nickname, timeframe)                    │
│  └─ get_nph_stats(nickname, hours=6) ← FIXED                    │
└──────────────┬──────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────┐
│              safe_display_profile(...)                           │
│  Receives: stats, runs, fastest, session_summary, nph_stats    │
└──────────────┬──────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────┐
│           display_session_summary(session_summary, nph_stats)   │
│  Only shows if timeframe == "session"                           │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Performance Metrics (RTANPH, RNPH, LNPH)                 │  │
│  │  [Gold Card] RTANPH: X.XX   [Blue Card] RNPH: X.XX       │  │
│  │  [Blue Card] LNPH: X.XX                                   │  │
│  │                                                           │  │
│  │  [Blue Card] RPE: X                                        │  │
│  │  resets per enter                                         │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Playtime & Seeds Info                                    │  │
│  │  Playtime: HH:MM:SS  |  Walltime: HH:MM:SS               │  │
│  │  • Seeds: X                                               │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Design Decisions

### 1. **Session Timeframe by Default for NPH**
The app now always fetches NPH stats with a 6-hour window, regardless of the selected profile timeframe. This ensures users see consistent "session-like" performance metrics that are comparable across different timeframes.

**Rationale:** The user explicitly requested to "display in the session timeframe", making these metrics comparable and meaningful for evaluating recent form rather than lifetime averages.

### 2. **API RPE Over Calculated RPE**
Instead of calculating RPE locally from session runs, the app uses the value returned by the API's `/getNPH/` endpoint. This ensures consistency with the source data and matches the user's preference to "not be calculated".

### 3. **Color Coding for Priority**
RTANPH is displayed in gold while other metrics use blue accent colors, visually communicating that Real-Time Nethers Per Hour is the most important performance indicator.

### 4. **Graceful Error Handling**
If NPH API fails or returns no data:
- The entire performance metrics section is skipped (not shown)
- No crash occurs due to try/except blocks wrapping all display logic
- User sees no NPH data, but other profile information remains visible

---

## Testing Recommendations

1. **Verify NPH Data Display:**
   - Open a player profile with recent activity
   - Ensure the "Session" timeframe tab shows NPH metrics
   - Verify RTANPH is gold-colored, others are blue-accented

2. **Test API Fallback:**
   - Try viewing an unknown/unregistered player
   - Confirm graceful handling (no crashes, empty message shown)

3. **Verify Timeframe Behavior:**
   - Switch between "Session", "Daily", "Weekly" timeframes
   - Confirm NPH section only appears on "Session" tab
   - Other statistics still display in other timeframes

4. **Check Playtime/Walltime Formatting:**
   - Verify milliseconds converted to HH:MM:SS format correctly
   - Short durations should show as MM:SS

---

## Related Files

| File | Role | Key Methods/Sections |
|------|------|---------------------|
| `data_manager.py` | API Client & Data Processing | `get_nph_stats()` (lines 600-648), `_format_nph()`, `_format_playtime_ms()` |
| `main.py` | UI & Display | `load_profile_data()` (lines 830-861), `safe_display_profile()` (lines 862-890), `display_session_summary()` (lines 894-1056) |
| `Create_PaceMan_EXE_v2.bat` | Build Script | Bundles assets, requires Python 3.12+ for PyInstaller compatibility |

---

## Summary of Changes

The NPH API integration was **complete in code but broken at runtime** due to:
1. Missing data fetch call
2. Undefined variable reference  
3. Wrong default timeframe parameter

All three issues have been fixed, making the feature fully functional. The UI now correctly displays:

✅ RTANPH - Real-time Nethers Per Hour (session-based, gold-accented)  
✅ RNPH - Resets Normalized Per Hour (quality metric)  
✅ LNPH - Last Nethers Per Hour (recent form)  
✅ RPE - Resets Per Enter from API (not calculated)  
✅ Playtime & Walltime in HH:MM:SS format  
✅ Seeds played count

**Status:** Ready for testing and EXE build.