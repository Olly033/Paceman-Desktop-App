# PaceMan Desktop Application

A lightweight, fast, and optimized desktop application for tracking Minecraft Speedrunning paces in real-time, based on [paceman.gg](https://paceman.gg).

## Features
- **Real-time Data**: Pulls live run data directly from PaceMan.gg.
- **Search Bar**: Quickly find specific players and their active runs.
- **Auto-Refresh**: Automatically updates every minute to keep you informed of the latest paces.
- **Optimized Performance**: Built with Python and CustomTkinter for a smooth, dark-themed experience.
- **Lightweight**: Minimal resource usage while staying connected to the live feed.

## How to Run
1. **Desktop Executable**: You can find the standalone executable in the `dist` folder.
2. **Python Script**: If you prefer running from source, ensure you have the dependencies installed:
   ```bash
   pip install customtkinter requests
   python main.py
   ```

## Technical Details
- **Frontend**: CustomTkinter (Modern UI for Python)
- **Data Source**: PaceMan.gg Live Runs API
- **Update Interval**: 60 seconds
- **Packaging**: PyInstaller (One-file executable)

---
*Note: This application requires an active internet connection to fetch real-time data.*
