import customtkinter as ctk
from data_manager import PaceManDataManager
import threading
from concurrent.futures import ThreadPoolExecutor
import time
import os
import sys
import math
import json
import webbrowser
from PIL import Image, ImageDraw, ImageOps
from tkinter import PhotoImage


def resource_path(relative_path):
    try:
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)


class TimeInput(ctk.CTkFrame):
    def __init__(self, master, label, callback, **kwargs):
        super().__init__(master, fg_color="transparent", **kwargs)
        self.callback = callback
        self.label_widget = ctk.CTkLabel(
            self, text=label,
            font=ctk.CTkFont(size=11, weight="bold"),
            text_color="#A0A0A0"
        )
        self.label_widget.pack(side="top")

        self.controls = ctk.CTkFrame(self, fg_color="#2B2B2B", corner_radius=6)
        self.controls.pack(side="top", pady=2)

        self.entry = ctk.CTkEntry(
            self.controls, width=60, height=24, border_width=0,
            fg_color="transparent", justify="center",
            placeholder_text="00:00", font=ctk.CTkFont(size=12)
        )
        self.entry.pack(side="left", padx=2)
        self.entry.bind("<KeyRelease>", lambda e: self.callback())

        btn_frame = ctk.CTkFrame(self.controls, fg_color="transparent")
        btn_frame.pack(side="left", padx=(0, 2))

        self.up_btn = ctk.CTkButton(
            btn_frame, text="▲", width=16, height=10,
            fg_color="#222222", hover_color="#4D4D4D",
            font=ctk.CTkFont(size=7), command=lambda: self.adjust_time(30)
        )
        self.up_btn.pack(side="top", pady=1)

        self.down_btn = ctk.CTkButton(
            btn_frame, text="▼", width=16, height=10,
            fg_color="#3D3D3D", hover_color="#4D4D4D",
            font=ctk.CTkFont(size=7), command=lambda: self.adjust_time(-30)
        )
        self.down_btn.pack(side="top", pady=1)

    def apply_theme(self, colors):
        self.label_widget.configure(text_color=colors["text_dim"])
        self.controls.configure(fg_color=colors["panel_alt"], border_color=colors["line"])
        self.entry.configure(
            fg_color=colors["bg"],
            text_color=colors["text"],
            placeholder_text_color=colors["muted"],
            border_color=colors["line"]
        )
        self.up_btn.configure(
            fg_color=colors["card_alt"],
            hover_color=colors["accent_soft"],
            text_color=colors["text"]
        )
        self.down_btn.configure(
            fg_color=colors["card_alt"],
            hover_color=colors["accent_soft"],
            text_color=colors["text"]
        )

    def adjust_time(self, delta_secs):
        current = self.entry.get()
        total_secs = 0
        if current:
            try:
                if ":" in current:
                    m, s = map(int, current.split(":"))
                    total_secs = m * 60 + s
                else:
                    total_secs = int(current)
            except Exception:
                total_secs = 0
        total_secs = max(0, total_secs + delta_secs)
        m, s = divmod(total_secs, 60)
        self.entry.delete(0, "end")
        self.entry.insert(0, f"{m:02d}:{s:02d}")
        self.callback()

    def get_ms(self):
        val = self.entry.get()
        if not val or val == "00:00":
            return None
        try:
            if ":" in val:
                m, s = map(int, val.split(":"))
                return (m * 60 + s) * 1000
            return int(val) * 1000
        except Exception:
            return None

    def clear(self):
        self.entry.delete(0, "end")
        self.entry.insert(0, "00:00")


class PaceManApp(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("PaceMan App")
        self.geometry("1120x820")
        self.minsize(980, 700)

        self.themes = {
            "midnight": {
                "bg": "#05070b",
                "bg_alt": "#0b1017",
                "panel": "#0f141b",
                "panel_alt": "#131b26",
                "card": "#121c29",
                "card_alt": "#182738",
                "accent": "#d9a566",
                "accent_hover": "#f0c084",
                "accent_soft": "#382d1c",
                "text": "#f5f4f1",
                "text_dim": "#b8b1aa",
                "muted": "#8a7d73",
                "twitch": "#9146ff",
                "gold": "#f3d28d",
                "danger": "#dc6a62",
                "danger_hover": "#ee8a81",
                "line": "#2b3039",
                "success": "#68d7a1",
            },
            "ivory": {
                "bg": "#f5f1ea",
                "bg_alt": "#efe7dd",
                "panel": "#fbf8f4",
                "panel_alt": "#f1eadf",
                "card": "#f8f3ed",
                "card_alt": "#eadcc8",
                "accent": "#4a5fc6",
                "accent_hover": "#3d4eb1",
                "accent_soft": "#e4ebff",
                "text": "#1d2430",
                "text_dim": "#586778",
                "muted": "#77839a",
                "twitch": "#9146ff",
                "gold": "#b78322",
                "danger": "#cb5f5a",
                "danger_hover": "#b84d49",
                "line": "#d9cdbb",
                "success": "#3a8d68",
            },
            "noir": {
                "bg": "#000000",
                "bg_alt": "#050505",
                "panel": "#070707",
                "panel_alt": "#0d0d0d",
                "card": "#0f0f0f",
                "card_alt": "#121212",
                "accent": "#d9a566",
                "accent_hover": "#f0c084",
                "accent_soft": "#2d2116",
                "text": "#f2f2f2",
                "text_dim": "#b9b9b9",
                "muted": "#8a8a8a",
                "twitch": "#9146ff",
                "gold": "#f3d28d",
                "danger": "#dc6a62",
                "danger_hover": "#ee8a81",
                "line": "#1b1b1b",
                "success": "#68d7a1",
            },
            "sandstone": {
                "bg": "#f2e9e1",
                "bg_alt": "#eadbcf",
                "panel": "#f9f4ef",
                "panel_alt": "#efe1d3",
                "card": "#f4e7dc",
                "card_alt": "#e1c9b2",
                "accent": "#8a5d3d",
                "accent_hover": "#734a32",
                "accent_soft": "#f4dcc8",
                "text": "#2a241d",
                "text_dim": "#63584f",
                "muted": "#7b6d61",
                "twitch": "#9146ff",
                "gold": "#b57e2e",
                "danger": "#c9615a",
                "danger_hover": "#af4f46",
                "line": "#d4bca3",
                "success": "#549370",
            },
        }

        self.theme_cycle = ["midnight", "ivory", "noir", "sandstone"]
        self.current_theme = "midnight"
        self.colors = self.themes[self.current_theme]

        self.assets_path = resource_path("assets")
        icon_png_path = os.path.join(self.assets_path, "icon.png")
        icon_ico_path = os.path.join(self.assets_path, "icon.ico")

        if os.path.exists(icon_png_path):
            try:
                self.iconphoto(False, PhotoImage(file=icon_png_path))
            except Exception:
                pass

        if os.path.exists(icon_ico_path):
            try:
                self.iconbitmap(icon_ico_path)
            except Exception:
                pass

        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")
        self.configure(fg_color=self.colors["bg"])

        # Navigation History
        self.history = []
        self.future = []
        self.is_navigating = False

        # Pagination
        self.runs_per_page = 25
        self.current_page = 0

        # Load Assets
        self.twitch_img = None
        twitch_icon_path = os.path.join(self.assets_path, "twitch.png")
        if os.path.exists(twitch_icon_path):
            try:
                img = Image.open(twitch_icon_path).convert("RGBA")
                self.twitch_img = ctk.CTkImage(
                    light_image=img, dark_image=img, size=(18, 18)
                )
            except Exception:
                pass

        self.data_manager = PaceManDataManager()
        self.current_view = "live"
        self.profile_nickname = None
        self.profile_timeframe = "lifetime"
        self.leaderboard_timeframe = "daily"
        self.leaderboard_mode = "count"
        self.leaderboard_split = "nether"
        self._leaderboard_last_data = None
        self.leader_face_cache = {}
        self.leader_face_loading = set()
        self.leaderboard_split_labels = [
            ("Nether", "nether"),
            ("Bastion", "bastion"),
            ("Fortress", "fortress"),
            ("Blind", "first_portal"),
            ("Stronghold", "stronghold"),
            ("End Enter", "end"),
            ("Finish", "finish"),
            ("First Structure", "first_structure"),
            ("Second Structure", "second_structure"),
        ]
        self.leaderboard_split_to_label = {k: v for v, k in self.leaderboard_split_labels}
        self.leaderboard_label_to_split = {v: k for v, k in self.leaderboard_split_labels}
        self.row_widgets = {}
        self.live_face_cache = {}
        self.live_face_loading = set()
        self.filters_visible = False
        self.avatar_tilt = (0.0, 0.0)
        self.avatar_tilt_velocity = (0.0, 0.0)
        self.avatar_target_tilt = (0.0, 0.0)
        self.avatar_tracking_active = False
        self._avatar_tracking_job = None
        self._avatar_tracking_interval_ms = 8  # balanced smoothness/performance preset
        self._avatar_last_tick_time = time.perf_counter()
        self._avatar_render_cache = {}
        self._avatar_last_render_key = None
        self._avatar_source_nickname = None
        self._avatar_prepared_layers = None
        self._avatar_quant_step = 0.045
        self._avatar_internal_size = 200
        self._avatar_display_size = 164
        self._avatar_face_scale = 4
        self._profile_twitch_resolving = set()
        self._profile_twitch_last_attempt = {}
        self._profile_refreshing = False
        self._profile_section_signatures = {}

        # Layout
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(0, weight=0)
        self.grid_rowconfigure(1, weight=0)
        self.grid_rowconfigure(2, weight=0)
        self.grid_rowconfigure(3, weight=1)

        # ---- Header ----
        self.header_frame = ctk.CTkFrame(
            self,
            fg_color="transparent",
            height=38,
            corner_radius=12,
            border_width=0,
            border_color=self.colors["line"],
        )
        self.header_frame.grid(row=0, column=0, sticky="ew", padx=12, pady=(8, 0))

        self.header_frame.grid_columnconfigure(0, weight=0)
        self.header_frame.grid_columnconfigure(1, weight=1)
        self.header_frame.grid_columnconfigure(2, weight=0)

        self.header_left = ctk.CTkFrame(self.header_frame, fg_color="transparent", height=1)
        self.header_left.grid(row=0, column=0, sticky="w", padx=(6, 0))

        self.header_center = ctk.CTkFrame(self.header_frame, fg_color="transparent", height=1)
        self.header_center.grid(row=0, column=1, sticky="ew")

        self.header_right = ctk.CTkFrame(self.header_frame, fg_color="transparent", height=1)
        self.header_right.grid(row=0, column=2, sticky="e", padx=(0, 8))

        self.title_label = ctk.CTkLabel(
            self.header_left, text="PACEMAN",
            font=ctk.CTkFont(family="Segoe UI Black", size=27, weight="bold"),
            text_color=self.colors["accent"], cursor="hand2"
        )
        self.title_label.pack(anchor="w", pady=(0, 0))
        self.title_label.bind("<Button-1>", lambda e: self.navigate_to("live"))

        self.header_actions = ctk.CTkFrame(self.header_right, fg_color="transparent")
        self.header_actions.pack(side="right", padx=(4, 0))

        self.refresh_btn = ctk.CTkButton(
            self.header_actions, text="↻", width=24, height=24,
            font=ctk.CTkFont(size=12, weight="bold"), corner_radius=7,
            fg_color=self.colors["panel_alt"], hover_color=self.colors["accent_soft"],
            command=self.manual_refresh
        )
        self.refresh_btn.pack(side="left", padx=1)

        self.theme_toggle_btn = ctk.CTkButton(
            self.header_actions, text="☰", width=24, height=24,
            font=ctk.CTkFont(family="Segoe UI Symbol", size=11),
            corner_radius=7,
            fg_color=self.colors["panel_alt"], hover_color=self.colors["accent_soft"],
            text_color=self.colors["text"],
            command=self.toggle_theme_menu
        )
        self.theme_toggle_btn.pack(side="left", padx=1)

        self.theme_menu_frame = ctk.CTkFrame(
            self,
            fg_color=self.colors["panel"],
            corner_radius=14,
            border_width=1,
            border_color=self.colors["line"],
            width=170,
            height=180,
        )
        self.theme_menu_frame.place_forget()

        self.theme_menu_buttons = {}
        for theme_name in self.theme_cycle:
            is_dark = theme_name in ["midnight", "noir"]
            theme_label = f"{theme_name.title()} • {'Dark' if is_dark else 'Light'}"
            btn = ctk.CTkButton(
                self.theme_menu_frame,
                text=theme_label,
                width=140,
                height=32,
                corner_radius=10,
                fg_color="transparent",
                hover_color=self.colors["accent_soft"],
                text_color=self.colors["text"],
                font=ctk.CTkFont(size=11),
                command=lambda name=theme_name: self.select_theme(name),
            )
            btn.pack(fill="x", padx=8, pady=4)
            self.theme_menu_buttons[theme_name] = btn

        self.filter_toggle_btn = ctk.CTkButton(
            self.header_actions, text="⚙", width=24, height=24,
            font=ctk.CTkFont(family="Segoe UI Symbol", size=11, weight="bold"),
            corner_radius=7,
            fg_color=self.colors["panel_alt"], hover_color=self.colors["accent_soft"],
            text_color=self.colors["text"],
            command=self.toggle_filters
        )
        self.filter_toggle_btn.pack(side="left", padx=1)

        self.leaderboard_btn = ctk.CTkButton(
            self.header_actions, text="LB", width=28, height=24,
            font=ctk.CTkFont(size=10, weight="bold"),
            corner_radius=7,
            fg_color=self.colors["panel_alt"], hover_color=self.colors["accent_soft"],
            text_color=self.colors["text"],
            command=lambda: self.navigate_to("leaderboards")
        )
        self.leaderboard_btn.pack(side="left", padx=1)

        self.search_container = ctk.CTkFrame(
            self.header_right, fg_color="transparent"
        )
        self.search_container.pack(side="right", padx=(4, 0))

        self.search_focused = False
        self.search_entry = ctk.CTkEntry(
            self.search_container, placeholder_text="Search players...",
            width=160, height=24, border_width=1,
            fg_color=self.colors["panel"], border_color=self.colors["line"],
            placeholder_text_color=self.colors["muted"], text_color=self.colors["text"]
        )
        self.search_entry.pack(anchor="e")
        self.search_entry.bind("<KeyRelease>", self.on_search_typing)
        self.search_entry.bind("<Return>", self.submit_search_result)
        self.search_entry.bind("<FocusIn>", self.on_search_focus_in)
        self.search_entry.bind("<FocusOut>", self.on_search_focus_out)

        self.search_results_frame = ctk.CTkFrame(
            self,
            fg_color=self.colors["panel"],
            corner_radius=14,
            border_width=1,
            border_color=self.colors["line"],
            width=280,
            height=240,
        )
        self.search_results_frame.place_forget()

        # ---- Filter Bar (Live) ----
        self.filter_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.filter_frame.grid(row=1, column=0, padx=16, pady=(2, 0), sticky="ew")
        self.filter_frame.grid_remove()

        self.filter_inner = ctk.CTkFrame(
            self.filter_frame,
            fg_color=self.colors["panel"],
            corner_radius=14,
            border_width=1,
            border_color=self.colors["line"],
        )
        self.filter_inner.pack(fill="x")

        ctk.CTkLabel(
            self.filter_inner, text="FILTERS",
            font=ctk.CTkFont(size=10, weight="bold"),
            text_color=self.colors["accent"]
        ).pack(side="left", padx=(10, 6), pady=4)

        self.live_only_var = ctk.BooleanVar(value=False)
        self.live_only_switch = ctk.CTkSwitch(
            self.filter_inner, text="Streaming", variable=self.live_only_var,
            command=self.update_ui, progress_color=self.colors["accent"],
            fg_color=self.colors["panel_alt"], text_color=self.colors["text"]
        )
        self.live_only_switch.pack(side="left", padx=6, pady=3)

        self.time_filters = {}
        filter_configs = [
            ("Nether", "nether"), ("Bastion", "bastion"),
            ("Fortress", "fortress"), ("Blind", "first_portal"),
            ("Stronghold", "stronghold"), ("End Enter", "end"),
            ("Finish", "finish"),
        ]
        for label, key in filter_configs:
            f = TimeInput(self.filter_inner, label, self.update_ui)
            f.pack(side="left", padx=4, pady=3)
            self.time_filters[key] = f

        self.clear_filters_btn = ctk.CTkButton(
            self.filter_inner, text="CLEAR", width=66, height=30,
            fg_color=self.colors["danger"], hover_color=self.colors["danger_hover"], corner_radius=8,
            font=ctk.CTkFont(size=11, weight="bold"), command=self.clear_filters
        )
        self.clear_filters_btn.pack(side="right", padx=(6, 10), pady=3)

        # ---- Filter Bar (All Runs) ----
        self.runs_filter_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.runs_filter_frame.grid(row=1, column=0, padx=16, pady=(0, 0), sticky="ew")
        self.runs_filter_frame.grid_remove()

        runs_filter_card = ctk.CTkFrame(
            self.runs_filter_frame, fg_color=self.colors["card"], corner_radius=8
        )
        runs_filter_card.pack(fill="x")

        runs_top_row = ctk.CTkFrame(runs_filter_card, fg_color="transparent")
        runs_top_row.pack(fill="x", padx=8, pady=(3, 2))

        ctk.CTkButton(
            runs_top_row, text="← BACK TO PROFILE", width=140, height=28,
            fg_color=self.colors["panel_alt"], hover_color=self.colors["accent_soft"],
            text_color=self.colors["text"],
            font=ctk.CTkFont(size=11, weight="bold"),
            command=lambda: self.navigate_to("profile", self.profile_nickname),
        ).pack(side="left")

        ctk.CTkLabel(
            runs_top_row, text="RUN FILTERS",
            font=ctk.CTkFont(size=11, weight="bold"),
            text_color=self.colors["accent"]
        ).pack(side="left", padx=10)

        self.completed_only_var = ctk.BooleanVar(value=False)
        self.completed_only_switch = ctk.CTkSwitch(
            runs_top_row, text="Completed Only", variable=self.completed_only_var,
            command=self.update_ui, progress_color=self.colors["accent"]
        )
        self.completed_only_switch.pack(side="left", padx=6)

        self.clear_runs_filters_btn = ctk.CTkButton(
            runs_top_row, text="CLEAR", width=60, height=28,
            fg_color=self.colors["danger"], hover_color=self.colors["danger_hover"],
            font=ctk.CTkFont(size=11, weight="bold"), command=self.clear_runs_filters
        )
        self.clear_runs_filters_btn.pack(side="right")

        runs_filter_row = ctk.CTkFrame(runs_filter_card, fg_color="transparent")
        runs_filter_row.pack(fill="x", padx=10, pady=(0, 8))

        ctk.CTkLabel(
            runs_filter_row, text="Max split time:",
            font=ctk.CTkFont(size=10, weight="bold"),
            text_color=self.colors["text_dim"]
        ).pack(side="left", padx=(5, 10))

        self.runs_time_filters = {}
        for label, key in filter_configs:
            f = TimeInput(runs_filter_row, label, self.update_ui)
            f.pack(side="left", padx=8, pady=4)
            self.runs_time_filters[key] = f

        # ---- Main Content ----
        self.content_title_label = ctk.CTkLabel(
            self, text="",
            font=ctk.CTkFont(size=14, weight="bold"),
            text_color=self.colors["accent"]
        )
        self.content_title_label.grid(row=2, column=0, padx=16, pady=(0, 0), sticky="ew")

        self.scrollable_frame = ctk.CTkScrollableFrame(
            self, fg_color="transparent",
            label_text="",
            label_font=ctk.CTkFont(size=14, weight="bold"),
            label_text_color=self.colors["accent"]
        )
        self.scrollable_frame.grid(
            row=3, column=0, padx=16, pady=(0, 0), sticky="nsew"
        )
        self.scrollable_frame.grid_columnconfigure(0, weight=1)

        self.status_label = ctk.CTkLabel(
            self, text="Ready",
            font=ctk.CTkFont(size=11), text_color=self.colors["text_dim"]
        )
        self.status_label.grid(row=4, column=0, padx=25, pady=5, sticky="w")

        self.apply_theme()

        self.is_updating = False
        threading.Thread(target=self.background_update, daemon=True).start()

    # ------------------------------------------------------------------
    # Navigation Logic
    # ------------------------------------------------------------------

    def navigate_to(self, view, data=None, push_history=True):
        if self.search_results_frame.winfo_ismapped():
            self.search_results_frame.place_forget()

        if push_history and not self.is_navigating:
            state = {
                "view": self.current_view,
                "nickname": self.profile_nickname,
                "page": self.current_page,
            }
            if not self.history or self.history[-1] != state:
                self.history.append(state)
            self.future = []

        self.current_view = view

        if view == "live":
            self.show_live()
        elif view == "profile":
            self.open_profile(data)
        elif view == "all_runs":
            self.show_all_runs(data)
        elif view == "leaderboards":
            self.open_leaderboards()
        elif view == "search":
            self.on_search_typing(None)

        self.update_nav_buttons()

    def go_back(self):
        if not self.history:
            return
        self.is_navigating = True
        current_state = {
            "view": self.current_view,
            "nickname": self.profile_nickname,
            "page": self.current_page,
        }
        self.future.append(current_state)
        state = self.history.pop()
        self.current_page = state.get("page", 0)
        self.navigate_to(state["view"], state["nickname"], push_history=False)
        self.is_navigating = False
        self.update_nav_buttons()

    def go_forward(self):
        if not self.future:
            return
        self.is_navigating = True
        current_state = {
            "view": self.current_view,
            "nickname": self.profile_nickname,
            "page": self.current_page,
        }
        self.history.append(current_state)
        state = self.future.pop()
        self.current_page = state.get("page", 0)
        self.navigate_to(state["view"], state["nickname"], push_history=False)
        self.is_navigating = False
        self.update_nav_buttons()

    def update_nav_buttons(self):
        pass

    def apply_theme(self):
        self.colors = self.themes[self.current_theme]
        self.configure(fg_color=self.colors["bg"])
        self.header_frame.configure(fg_color="transparent", border_width=0)
        if hasattr(self, "nav_frame"):
            self.nav_frame.configure(fg_color=self.colors["panel_alt"], border_color=self.colors["line"])
        self.title_label.configure(text_color=self.colors["accent"])
        self.search_entry.configure(
            fg_color=self.colors["panel"],
            border_color=self.colors["line"],
            text_color=self.colors["text"],
            placeholder_text_color=self.colors["muted"]
        )
        if hasattr(self, "search_results_frame"):
            self.search_results_frame.configure(
                fg_color=self.colors["panel"],
                border_color=self.colors["line"],
                corner_radius=18,
            )
        self.theme_toggle_btn.configure(
            text="☰",
            fg_color=self.colors["panel_alt"],
            text_color=self.colors["text"],
            hover_color=self.colors["accent_soft"]
        )
        if hasattr(self, "filter_toggle_btn"):
            self.filter_toggle_btn.configure(
                fg_color=self.colors["panel_alt"],
                hover_color=self.colors["accent_soft"],
                text_color=self.colors["text"]
            )
        if hasattr(self, "leaderboard_btn"):
            self.leaderboard_btn.configure(
                fg_color=self.colors["panel_alt"],
                hover_color=self.colors["accent_soft"],
                text_color=self.colors["text"]
            )
        if hasattr(self, "theme_menu_frame"):
            self.theme_menu_frame.configure(
                fg_color=self.colors["panel"],
                border_color=self.colors["line"]
            )
            for theme_name, button in self.theme_menu_buttons.items():
                is_selected = theme_name == self.current_theme
                button.configure(
                    fg_color=self.colors["accent_soft"] if is_selected else "transparent",
                    text_color=self.colors["text"],
                    hover_color=self.colors["accent_soft"],
                    font=ctk.CTkFont(size=11, weight="bold" if is_selected else "normal")
                )

        if hasattr(self, "refresh_btn"):
            self.refresh_btn.configure(
                fg_color=self.colors["panel_alt"],
                hover_color=self.colors["accent_soft"],
                text_color=self.colors["text"]
            )
        if hasattr(self, "filter_inner"):
            self.filter_inner.configure(fg_color=self.colors["panel"], border_color=self.colors["line"])
        if hasattr(self, "live_only_switch"):
            self.live_only_switch.configure(
                fg_color=self.colors["panel_alt"],
                text_color=self.colors["text"],
                progress_color=self.colors["accent"]
            )

        if hasattr(self, "filter_frame"):
            for child in self.filter_frame.winfo_children():
                if isinstance(child, ctk.CTkFrame):
                    child.configure(fg_color=self.colors["panel"], border_color=self.colors["line"])

        if hasattr(self, "time_filters"):
            for filt in self.time_filters.values():
                filt.apply_theme(self.colors)

        if hasattr(self, "runs_filter_frame"):
            if self.runs_filter_frame.winfo_exists():
                for child in self.runs_filter_frame.winfo_children():
                    if isinstance(child, ctk.CTkFrame):
                        child.configure(fg_color=self.colors["panel"], border_color=self.colors["line"])

        if hasattr(self, "status_label"):
            self.status_label.configure(text_color=self.colors["text_dim"])

        if hasattr(self, "content_title_label"):
            self.content_title_label.configure(text_color=self.colors["accent"])

        if hasattr(self, "scrollable_frame"):
            self.scrollable_frame.configure(
                fg_color=self.colors["bg_alt"],
                label_text_color=self.colors["accent"]
            )

        if self.current_view == "live":
            self.show_live()
        elif self.current_view == "profile":
            self.render_profile_skeleton()
            self.load_profile_data()
            self.load_profile_avatar()
        elif self.current_view == "all_runs":
            self.show_all_runs(self.profile_nickname)
        elif self.current_view == "leaderboards":
            self.open_leaderboards()
        elif self.current_view == "search":
            self.on_search_typing(None)

    def toggle_theme_menu(self):
        if not hasattr(self, "theme_menu_frame"):
            return
        if self.theme_menu_frame.winfo_ismapped():
            self.theme_menu_frame.place_forget()
        else:
            self.update_idletasks()
            self.theme_menu_frame.update_idletasks()

            x = self.theme_toggle_btn.winfo_rootx() - self.winfo_rootx()
            y = self.theme_toggle_btn.winfo_rooty() - self.winfo_rooty() + self.theme_toggle_btn.winfo_height() + 6

            menu_w = self.theme_menu_frame.winfo_reqwidth()
            menu_h = self.theme_menu_frame.winfo_reqheight()
            win_w = self.winfo_width()
            win_h = self.winfo_height()

            max_x = max(8, win_w - menu_w - 8)
            max_y = max(8, win_h - menu_h - 8)
            x = min(max(8, x), max_x)
            y = min(max(8, y), max_y)

            self.theme_menu_frame.place(x=x, y=y)
            self.theme_menu_frame.lift()

    def select_theme(self, theme_name):
        self.current_theme = theme_name
        ctk.set_appearance_mode("dark" if theme_name in ["dark", "midnight"] else "light")
        self.theme_menu_frame.place_forget()
        self.apply_theme()

    def toggle_theme(self):
        current_index = self.theme_cycle.index(self.current_theme)
        next_index = (current_index + 1) % len(self.theme_cycle)
        self.current_theme = self.theme_cycle[next_index]
        ctk.set_appearance_mode("dark" if self.current_theme in ["dark", "midnight"] else "light")
        self.apply_theme()

    def toggle_filters(self):
        if not hasattr(self, "filter_frame"):
            return
        self.filters_visible = not self.filters_visible
        if self.filters_visible:
            self.filter_frame.grid(row=1, column=0, padx=16, pady=(2, 0), sticky="ew")
        else:
            self.filter_frame.grid_remove()

    # ------------------------------------------------------------------
    # UI Logic
    # ------------------------------------------------------------------

    def clear_filters(self):
        self.live_only_var.set(False)
        for f in self.time_filters.values():
            f.clear()
        if self.current_view == "live":
            self.update_live_ui()
        else:
            self.update_ui()

    def clear_runs_filters(self):
        self.completed_only_var.set(False)
        for f in self.runs_time_filters.values():
            f.clear()
        self.current_page = 0
        if self.current_view == "all_runs":
            self.update_all_runs_ui()
        else:
            self.update_ui()

    def background_update(self):
        while True:
            if not self.is_updating:
                self.data_manager.fetch_live_runs()
                if self.current_view == "live":
                    self.after(0, self.update_ui)
                elif self.current_view == "profile":
                    self.after(0, self.load_profile_data)
            time.sleep(2)

    def manual_refresh(self):
        if self.is_updating:
            return
        self.is_updating = True
        self.refresh_btn.configure(text="...", state="disabled")

        def task():
            self.data_manager.fetch_live_runs()
            self.after(0, self.finish_manual_refresh)

        threading.Thread(target=task, daemon=True).start()

    def finish_manual_refresh(self):
        self.is_updating = False
        self.refresh_btn.configure(text="↻", state="normal")
        if self.current_view == "live":
            self.update_ui()
        elif self.current_view == "profile":
            self.load_profile_data()
        elif self.current_view == "all_runs":
            self.load_all_runs_data()

    def show_live(self):
        self.row_widgets = {}
        if self.filters_visible:
            self.filter_frame.grid(row=1, column=0, padx=16, pady=(2, 0), sticky="ew")
        else:
            self.filter_frame.grid_remove()
        self.runs_filter_frame.grid_remove()
        self.scrollable_frame.configure(label_text="")
        self.content_title_label.configure(text="ACTIVE RUNS")
        for widget in self.scrollable_frame.winfo_children():
            widget.destroy()
        self.update_live_ui()

    def on_search_focus_in(self, event=None):
        self.search_focused = True
        self.on_search_typing(None)

    def on_search_focus_out(self, event=None):
        def delayed_hide():
            widget = self.focus_get()
            if widget is not None and widget.winfo_exists():
                try:
                    if widget in self.search_results_frame.winfo_children() or widget == self.search_results_frame:
                        return
                except Exception:
                    pass
            self.search_focused = False
            if self.search_results_frame.winfo_ismapped():
                self.search_results_frame.place_forget()

        self.after(120, delayed_hide)

    def select_search_result(self, name):
        self.search_entry.delete(0, "end")
        self.search_focused = False
        self.search_results_frame.place_forget()
        self.navigate_to("profile", name)

    def submit_search_result(self, event=None):
        query = self.search_entry.get().strip()
        if not query:
            return
        recos = self.data_manager.get_recommendations(query)
        if recos:
            self.select_search_result(recos[0])
        else:
            self.select_search_result(query)

    def on_search_typing(self, event):
        query = self.search_entry.get().strip()

        if not self.search_focused:
            if self.search_results_frame.winfo_ismapped():
                self.search_results_frame.place_forget()
            return

        if not query:
            self.show_recent_searches()
            return

        recos = self.data_manager.get_recommendations(query)
        self.update_search_ui(recos)

    def update_ui(self):
        if self.current_view == "live":
            self.update_live_ui()
        elif self.current_view == "all_runs":
            self.update_all_runs_ui()
        elif self.current_view == "profile":
            self.load_profile_data()
        elif self.current_view == "leaderboards":
            self.load_leaderboards_data()

    def _request_live_face(self, nickname):
        if not nickname:
            return
        key = nickname.lower()
        if key in self.live_face_cache or key in self.live_face_loading:
            return

        self.live_face_loading.add(key)

        def task():
            img = self.data_manager.fetch_player_face(nickname, size=20)
            self.after(0, lambda: self._apply_live_face(nickname, img))

        threading.Thread(target=task, daemon=True).start()

    def _apply_live_face(self, nickname, img):
        key = nickname.lower() if nickname else ""
        self.live_face_loading.discard(key)

        icon = None
        if img is not None:
            try:
                icon = ctk.CTkImage(light_image=img, dark_image=img, size=(20, 20))
                self.live_face_cache[key] = icon
            except Exception:
                icon = None

        for row in self.row_widgets.values():
            if row.get("nickname") != nickname:
                continue
            face_label = row.get("face_label")
            if not face_label or not face_label.winfo_exists():
                continue
            if icon is not None:
                face_label.configure(image=icon, text="")
                face_label.image = icon
            else:
                face_label.configure(image=None, text="")

    def update_live_ui(self):
        f_vals = {
            k: f_input.get_ms()
            for k, f_input in self.time_filters.items()
            if f_input.get_ms()
        }
        live_only = self.live_only_var.get()
        runs = self.data_manager.cached_live_runs
        filtered_runs = []

        stage_order = {
            "Just Started": 0,
            "Enter Nether": 1,
            "Enter Bastion": 2,
            "Enter Fortress": 2,
            "First Structure": 2,
            "Second Structure": 3,
            "Enter Portal": 4,
            "First Portal": 4,
            "Second Portal": 4,
            "Enter Stronghold": 5,
            "Enter End": 6,
            "Credits": 7
        }

        for run in runs:
            if live_only and not run.get("twitch"):
                continue
            
            events = run.get("eventList", [])
            last_event = events[-1] if events else {}
            last_split = (
                last_event.get("eventId", "")
                .replace("rsg.", "").replace("_", " ").title()
                if events else "Just Started"
            )
            
            # Calculate stage score for sorting
            stage_score = stage_order.get(last_split, 0)
            # Within same stage, sort by IGT (further in is better)
            igt = last_event.get("igt", 0)
            run["_sort_score"] = (stage_score, igt)

            event_map = {
                e.get("eventId"): e.get("igt", 0)
                for e in run.get("eventList", [])
            }
            mapping = {
                "nether": "rsg.enter_nether",
                "bastion": "rsg.enter_bastion",
                "fortress": "rsg.enter_fortress",
                "first_portal": "rsg.first_portal",
                "stronghold": "rsg.enter_stronghold",
                "end": "rsg.enter_end",
                "finish": "rsg.credits",
            }
            passed = True
            for f_key, api_key in mapping.items():
                if f_key in f_vals:
                    t = event_map.get(api_key)
                    if t is not None and t > f_vals[f_key]:
                        passed = False
                        break
            if passed:
                filtered_runs.append(run)

        # Sort by stage score descending, then IGT descending
        filtered_runs.sort(key=lambda x: x.get("_sort_score", (0, 0)), reverse=True)

        current_ids = [r.get("worldId", r.get("nickname")) for r in filtered_runs]
        new_row_widgets = {}
        visible_ids = set(current_ids)

        for wid in list(self.row_widgets.keys()):
            if wid not in visible_ids:
                try:
                    self.row_widgets[wid]["frame"].destroy()
                except Exception:
                    pass
                del self.row_widgets[wid]

        for i, run in enumerate(filtered_runs):
            wid = run.get("worldId", run.get("nickname"))
            nickname = run.get("nickname", "Unknown")
            twitch = run.get("twitch")
            events = run.get("eventList", [])
            last_event = events[-1] if events else {}
            last_split = (
                last_event.get("eventId", "")
                .replace("rsg.", "").replace("_", " ").title()
                if events else "Just Started"
            )
            igt = last_event.get("igt", 0)
            time_str = f"{int(igt / 60000):02d}:{int((igt / 1000) % 60):02d}"

            if wid in self.row_widgets:
                w = self.row_widgets[wid]
                try:
                    w["frame"].grid(row=i, column=0, padx=5, pady=2, sticky="ew")
                    w["frame"].configure(
                        fg_color=self.colors["card"] if i % 2 == 0 else self.colors["panel_alt"]
                    )
                    w["split_label"].configure(text=last_split)
                    w["time_label"].configure(text=time_str)
                    w["nickname"] = nickname

                    key = nickname.lower()
                    face_label = w.get("face_label")
                    if face_label and face_label.winfo_exists():
                        icon = self.live_face_cache.get(key)
                        if icon is not None:
                            face_label.configure(image=icon, text="")
                            face_label.image = icon
                        else:
                            face_label.configure(image=None, text="")
                            self._request_live_face(nickname)

                    new_row_widgets[wid] = w
                except Exception:
                    pass
            else:
                row_frame = ctk.CTkFrame(
                    self.scrollable_frame,
                    fg_color=self.colors["card"] if i % 2 == 0 else self.colors["panel_alt"],
                    corner_radius=12,
                    border_width=1,
                    border_color=self.colors["line"],
                )
                row_frame.grid(row=i, column=0, padx=(2, 5), pady=4, sticky="ew")
                row_frame.grid_columnconfigure(2, minsize=170)
                row_frame.grid_columnconfigure(4, weight=1)
                row_frame.grid_columnconfigure(5, weight=0)

                accent_bar = ctk.CTkFrame(row_frame, fg_color=self.colors["accent"], width=4, height=38)
                accent_bar.grid(row=0, column=0, padx=(8, 0), pady=8, sticky="ns")

                face_label = ctk.CTkLabel(
                    row_frame, text="", width=22, height=22,
                    fg_color="transparent"
                )
                face_label.grid(row=0, column=1, padx=(8, 4), pady=8, sticky="w")

                key = nickname.lower()
                icon = self.live_face_cache.get(key)
                if icon is not None:
                    face_label.configure(image=icon, text="")
                    face_label.image = icon
                else:
                    self._request_live_face(nickname)

                name_btn = ctk.CTkButton(
                    row_frame, text=nickname,
                    font=ctk.CTkFont(family="Segoe UI", size=14, weight="bold"),
                    width=165, anchor="w",
                    fg_color="transparent", hover_color=self.colors["accent_soft"],
                    text_color=self.colors["text"],
                    command=lambda n=nickname: self.navigate_to("profile", n),
                )
                name_btn.grid(row=0, column=2, padx=(2, 2), pady=8, sticky="w")

                twitch_frame = ctk.CTkFrame(row_frame, fg_color="transparent", width=46, height=32)
                twitch_frame.grid(row=0, column=3, padx=(0, 8), pady=8, sticky="w")
                twitch_frame.pack_propagate(False)

                if twitch and self.twitch_img:
                    ctk.CTkButton(
                        twitch_frame,
                        image=self.twitch_img,
                        text="",
                        width=22,
                        height=22,
                        fg_color="transparent",
                        hover_color=self.colors["twitch"],
                        corner_radius=7,
                        border_width=0,
                        command=lambda t=twitch: webbrowser.open(
                            f"https://twitch.tv/{t}"
                        ),
                    ).pack(expand=True, padx=1, pady=1)

                split_lbl = ctk.CTkLabel(
                    row_frame, text=last_split,
                    font=ctk.CTkFont(family="Segoe UI", size=12),
                    text_color=self.colors["text_dim"], anchor="w",
                )
                split_lbl.grid(row=0, column=4, padx=(8, 10), sticky="w")

                time_lbl = ctk.CTkLabel(
                    row_frame, text=time_str,
                    font=ctk.CTkFont(family="Consolas", size=13, weight="bold"),
                    text_color=self.colors["accent"], width=78, anchor="e",
                )
                time_lbl.grid(row=0, column=5, padx=(8, 15), sticky="e")

                new_row_widgets[wid] = {
                    "frame": row_frame,
                    "nickname": nickname,
                    "face_label": face_label,
                    "split_label": split_lbl,
                    "time_label": time_lbl,
                }

        self.row_widgets = new_row_widgets
        self.status_label.configure(
            text=f"LAST UPDATE: {time.strftime('%H:%M:%S')} | {len(filtered_runs)} ACTIVE PACES"
        )

    # ------------------------------------------------------------------
    # Leaderboards
    # ------------------------------------------------------------------

    def _request_leader_face(self, nickname, label_widget, size=46):
        if not nickname or label_widget is None:
            return

        key = f"{nickname.lower()}:{int(size)}"
        cached = self.leader_face_cache.get(key)
        if cached is not None:
            try:
                if label_widget.winfo_exists():
                    label_widget.configure(image=cached, text="")
                    label_widget.image = cached
            except Exception:
                pass
            return

        if key in self.leader_face_loading:
            return
        self.leader_face_loading.add(key)

        def task():
            img = self.data_manager.fetch_player_face(nickname, size=size)

            def apply_icon():
                self.leader_face_loading.discard(key)
                icon = None
                if img is not None:
                    try:
                        icon = ctk.CTkImage(light_image=img, dark_image=img, size=(size, size))
                        self.leader_face_cache[key] = icon
                    except Exception:
                        icon = None

                if icon is not None:
                    try:
                        if label_widget.winfo_exists():
                            label_widget.configure(image=icon, text="")
                            label_widget.image = icon
                    except Exception:
                        pass

            self.after(0, apply_icon)

        threading.Thread(target=task, daemon=True).start()

    def open_leaderboards(self):
        self.filter_frame.grid_remove()
        self.runs_filter_frame.grid_remove()
        self.render_leaderboards_skeleton()
        self.load_leaderboards_data()

    def render_leaderboards_skeleton(self):
        try:
            for widget in self.scrollable_frame.winfo_children():
                widget.destroy()
        except Exception:
            return

        self.scrollable_frame.configure(label_text="")
        self.content_title_label.configure(text="GLOBAL LEADERBOARDS")

        header_row = ctk.CTkFrame(self.scrollable_frame, fg_color="transparent")
        header_row.grid(row=0, column=0, sticky="ew", padx=5, pady=(6, 10))
        header_row.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(
            header_row,
            text="Select a Leaderboard and View Top 3",
            font=ctk.CTkFont(size=13, weight="bold"),
            text_color=self.colors["accent"],
        ).pack(side="left", padx=(6, 0))

        tf_frame = ctk.CTkFrame(
            self.scrollable_frame,
            fg_color=self.colors["card"],
            corner_radius=10,
        )
        tf_frame.grid(row=1, column=0, sticky="ew", padx=5, pady=(0, 8))

        for tf in ["session", "daily", "weekly", "monthly", "lifetime"]:
            btn = ctk.CTkButton(
                tf_frame,
                text=tf.upper(),
                width=84,
                height=30,
                fg_color=self.colors["accent"] if self.leaderboard_timeframe == tf else "transparent",
                hover_color=self.colors["accent_hover"],
                font=ctk.CTkFont(size=10, weight="bold"),
                command=lambda t=tf: self.change_leaderboard_timeframe(t),
            )
            btn.pack(side="left", padx=2, pady=2)

        select_frame = ctk.CTkFrame(
            self.scrollable_frame,
            fg_color=self.colors["card"],
            corner_radius=10,
        )
        select_frame.grid(row=2, column=0, sticky="ew", padx=5, pady=(0, 8))

        ctk.CTkLabel(
            select_frame,
            text="SPLIT",
            font=ctk.CTkFont(size=10, weight="bold"),
            text_color=self.colors["text_dim"],
        ).pack(side="left", padx=(10, 6), pady=6)

        split_labels = [label for label, _ in self.leaderboard_split_labels]
        current_label = self.leaderboard_split_to_label.get(self.leaderboard_split, split_labels[0])
        self.leaderboard_split_menu = ctk.CTkOptionMenu(
            select_frame,
            values=split_labels,
            width=190,
            height=30,
            command=self.change_leaderboard_split,
        )
        self.leaderboard_split_menu.pack(side="left", padx=(0, 12), pady=6)
        self.leaderboard_split_menu.set(current_label)

        ctk.CTkLabel(
            select_frame,
            text="MODE",
            font=ctk.CTkFont(size=10, weight="bold"),
            text_color=self.colors["text_dim"],
        ).pack(side="left", padx=(4, 6), pady=6)

        for mode, label in (("count", "COUNT"), ("avg", "AVG TIME")):
            ctk.CTkButton(
                select_frame,
                text=label,
                width=92,
                height=30,
                fg_color=self.colors["accent"] if self.leaderboard_mode == mode else "transparent",
                hover_color=self.colors["accent_hover"],
                font=ctk.CTkFont(size=10, weight="bold"),
                command=lambda m=mode: self.change_leaderboard_mode(m),
            ).pack(side="left", padx=2, pady=6)

        self.leaderboard_container = ctk.CTkFrame(
            self.scrollable_frame,
            fg_color=self.colors["card"],
            corner_radius=10,
        )
        self.leaderboard_container.grid(row=3, column=0, sticky="nsew", padx=5, pady=5)

        ctk.CTkLabel(
            self.leaderboard_container,
            text="Loading leaderboard...",
            text_color=self.colors["text_dim"],
        ).pack(pady=18)

    def change_leaderboard_timeframe(self, timeframe):
        self.leaderboard_timeframe = timeframe
        self.render_leaderboards_skeleton()
        self.load_leaderboards_data()

    def change_leaderboard_mode(self, mode):
        if mode not in ("count", "avg"):
            return
        self.leaderboard_mode = mode
        self.render_leaderboards_skeleton()
        if self._leaderboard_last_data is not None:
            self.display_leaderboards(self._leaderboard_last_data, self.leaderboard_timeframe)
        else:
            self.load_leaderboards_data()

    def change_leaderboard_split(self, label):
        split_key = self.leaderboard_label_to_split.get(label)
        if not split_key:
            return
        self.leaderboard_split = split_key
        if self._leaderboard_last_data is not None:
            self.display_leaderboards(self._leaderboard_last_data, self.leaderboard_timeframe)
        else:
            self.load_leaderboards_data()

    def load_leaderboards_data(self):
        if self.current_view != "leaderboards":
            return

        timeframe = self.leaderboard_timeframe

        def task():
            data = None
            try:
                data = self.data_manager.get_global_leaderboard(timeframe=timeframe, limit=250)
            except Exception:
                data = None

            def apply_data():
                self._leaderboard_last_data = data
                self.display_leaderboards(data, timeframe)

            self.after(0, apply_data)

        threading.Thread(target=task, daemon=True).start()

    def _fmt_ms_compact(self, ms):
        if ms is None:
            return "--:--"
        try:
            ms = int(ms)
            if ms <= 0:
                return "--:--"
            total_seconds = ms // 1000
            hours = total_seconds // 3600
            minutes = (total_seconds % 3600) // 60
            seconds = total_seconds % 60
            if hours > 0:
                return f"{hours}:{minutes:02d}:{seconds:02d}"
            return f"{minutes}:{seconds:02d}"
        except Exception:
            return "--:--"

    def display_leaderboards(self, data, timeframe):
        if self.current_view != "leaderboards" or timeframe != self.leaderboard_timeframe:
            return
        if not hasattr(self, "leaderboard_container") or not self.leaderboard_container.winfo_exists():
            return

        try:
            for widget in self.leaderboard_container.winfo_children():
                widget.destroy()
        except Exception:
            return

        if not isinstance(data, dict):
            ctk.CTkLabel(
                self.leaderboard_container,
                text="Failed to load leaderboard data.",
                text_color=self.colors["danger"],
            ).pack(pady=16)
            return

        split_data = data.get("splits", {}) if isinstance(data, dict) else {}
        split_entry = split_data.get(self.leaderboard_split, {}) if isinstance(split_data, dict) else {}

        top_key = "count_top" if self.leaderboard_mode == "count" else "avg_top"
        top_entries = split_entry.get(top_key, []) if isinstance(split_entry, dict) else []
        if not isinstance(top_entries, list):
            top_entries = []
        top_entries = top_entries[:3]

        selected_split_label = self.leaderboard_split_to_label.get(self.leaderboard_split, self.leaderboard_split)
        selected_mode_label = "COUNT" if self.leaderboard_mode == "count" else "AVG TIME"

        ctk.CTkLabel(
            self.leaderboard_container,
            text=f"{selected_split_label} • {selected_mode_label} • {timeframe.upper()}",
            font=ctk.CTkFont(size=12, weight="bold"),
            text_color=self.colors["accent"],
        ).pack(anchor="w", padx=14, pady=(10, 4))

        ctk.CTkLabel(
            self.leaderboard_container,
            text=f"Updated: {time.strftime('%H:%M:%S')}",
            font=ctk.CTkFont(size=10),
            text_color=self.colors["text_dim"],
        ).pack(anchor="w", padx=14, pady=(0, 10))

        if not top_entries:
            ctk.CTkLabel(
                self.leaderboard_container,
                text="No leaderboard data for this selection.",
                text_color=self.colors["text_dim"],
            ).pack(pady=16)
            self.status_label.configure(text=f"LEADERBOARD: {timeframe.upper()} • {selected_split_label} • {selected_mode_label}")
            return

        podium_frame = ctk.CTkFrame(self.leaderboard_container, fg_color="transparent")
        podium_frame.pack(fill="x", padx=12, pady=(4, 14))
        podium_frame.grid_columnconfigure(0, weight=1)
        podium_frame.grid_columnconfigure(1, weight=1)
        podium_frame.grid_columnconfigure(2, weight=1)

        visual_order = [1, 0, 2]  # 2nd, 1st, 3rd (center winner)
        pedestal_heights = {1: 86, 2: 62, 3: 48}

        for col, idx in enumerate(visual_order):
            entry = top_entries[idx] if idx < len(top_entries) else None
            rank = idx + 1

            col_frame = ctk.CTkFrame(podium_frame, fg_color="transparent")
            col_frame.grid(row=0, column=col, padx=8, sticky="n")

            card = ctk.CTkFrame(
                col_frame,
                fg_color=self.colors["panel_alt"] if rank != 1 else self.colors["card_alt"],
                corner_radius=10,
                border_width=1,
                border_color=self.colors["line"],
                width=190,
                height=190,
            )
            card.pack(fill="x")
            card.pack_propagate(False)

            rank_color = self.colors["gold"] if rank == 1 else self.colors["text_dim"]
            ctk.CTkLabel(
                card,
                text=f"#{rank}",
                font=ctk.CTkFont(size=14, weight="bold"),
                text_color=rank_color,
            ).pack(pady=(8, 4))

            face_label = ctk.CTkLabel(card, text="", width=46, height=46, fg_color="transparent")
            face_label.pack(pady=(0, 6))

            if entry and isinstance(entry, dict):
                player_name = entry.get("name", "Unknown")
                value = entry.get("value", 0)
                value_text = str(int(value)) if self.leaderboard_mode == "count" else self._fmt_ms_compact(value)

                self._request_leader_face(player_name, face_label, size=46)

                ctk.CTkButton(
                    card,
                    text=player_name,
                    fg_color="transparent",
                    hover_color=self.colors["accent_soft"],
                    text_color=self.colors["text"],
                    font=ctk.CTkFont(size=12, weight="bold"),
                    height=26,
                    command=lambda n=player_name: self.navigate_to("profile", n),
                ).pack(padx=8, fill="x")

                ctk.CTkLabel(
                    card,
                    text=value_text,
                    font=ctk.CTkFont(family="Consolas", size=14, weight="bold"),
                    text_color=self.colors["accent"],
                ).pack(pady=(4, 2))
            else:
                ctk.CTkLabel(
                    card,
                    text="--",
                    font=ctk.CTkFont(size=13, weight="bold"),
                    text_color=self.colors["text_dim"],
                ).pack(pady=(8, 0))

            pedestal = ctk.CTkFrame(
                col_frame,
                fg_color=self.colors["accent_soft"] if rank == 1 else self.colors["panel_alt"],
                corner_radius=8,
                width=150,
                height=pedestal_heights.get(rank, 48),
            )
            pedestal.pack(pady=(6, 0))
            pedestal.pack_propagate(False)
            ctk.CTkLabel(
                pedestal,
                text=f"{rank}",
                font=ctk.CTkFont(size=13, weight="bold"),
                text_color=self.colors["text_dim"],
            ).pack(expand=True)

        self.status_label.configure(text=f"LEADERBOARD: {timeframe.upper()} • {selected_split_label} • {selected_mode_label}")

    # ------------------------------------------------------------------
    # Profile
    # ------------------------------------------------------------------

    def open_profile(self, nickname):
        if not nickname:
            return
        self.profile_nickname = nickname
        self.filter_frame.grid_remove()
        self.runs_filter_frame.grid_remove()
        self.data_manager.add_to_recents(nickname)
        self.render_profile_skeleton()
        self.load_profile_data()
        self.load_profile_avatar()

    def render_profile_skeleton(self):
        try:
            for widget in self.scrollable_frame.winfo_children():
                widget.destroy()
        except Exception:
            pass

        # Force a fresh first paint for this profile layout, then incremental updates after.
        self._profile_section_signatures = {}

        self.scrollable_frame.configure(label_text="")
        self.content_title_label.configure(text="")

        # ---- Player header (name + Minecraft face) ----
        self.profile_header = ctk.CTkFrame(
            self.scrollable_frame, fg_color="transparent"
        )
        self.profile_header.grid(row=0, column=0, sticky="ew", padx=0, pady=(0, 0))

        self.profile_avatar_label = ctk.CTkLabel(
            self.profile_header, text="",
            width=self._avatar_display_size, height=self._avatar_display_size, fg_color="transparent", corner_radius=0
        )
        self.profile_avatar_label.pack(side="left", padx=(0, 0), pady=0)
        self.avatar_tracking_active = True
        self._start_avatar_tracking_loop()

        self.profile_identity_frame = ctk.CTkFrame(
            self.profile_header, fg_color="transparent"
        )
        self.profile_identity_frame.pack(side="left", pady=0)

        self.profile_name_label = ctk.CTkLabel(
            self.profile_identity_frame, text=self.profile_nickname,
            font=ctk.CTkFont(size=26, weight="bold"),
            text_color=self.colors["text"]
        )
        self.profile_name_label.pack(side="left", pady=0)

        self.profile_twitch_btn = None
        self._refresh_profile_twitch_button()

        # ---- Timeframe selector ----
        header_row = ctk.CTkFrame(self.scrollable_frame, fg_color="transparent")
        header_row.grid(row=1, column=0, pady=10, sticky="ew")

        sel_frame = ctk.CTkFrame(
            header_row, fg_color=self.colors["card"], corner_radius=8
        )
        sel_frame.pack(side="left", padx=5)

        for tf in ["session", "daily", "weekly", "monthly", "lifetime"]:
            btn = ctk.CTkButton(
                sel_frame, text=tf.upper(), width=80, height=30,
                fg_color=(
                    self.colors["accent"]
                    if self.profile_timeframe == tf
                    else "transparent"
                ),
                hover_color=self.colors["accent_hover"],
                font=ctk.CTkFont(size=10, weight="bold"),
                command=lambda t=tf: self.change_profile_timeframe(t),
            )
            btn.pack(side="left", padx=2, pady=2)

        ctk.CTkButton(
            header_row, text="VIEW ALL RUNS", width=120, height=34,
            fg_color=self.colors["panel_alt"], hover_color=self.colors["accent_soft"],
            text_color=self.colors["text"],
            font=ctk.CTkFont(size=11, weight="bold"),
            command=lambda: self.navigate_to("all_runs", self.profile_nickname),
        ).pack(side="right", padx=15)

        # ---- Session Summary (for session timeframe only) ----
        self.session_summary_container = ctk.CTkFrame(
            self.scrollable_frame, fg_color="transparent"
        )
        self.session_summary_container.grid(row=2, column=0, sticky="ew", padx=5, pady=(10, 5))

        # ---- Statistics (avg/count) ----
        ctk.CTkLabel(
            self.scrollable_frame, text="STATISTICS",
            font=ctk.CTkFont(size=12, weight="bold"),
            text_color=self.colors["accent"]
        ).grid(row=3, column=0, pady=(15, 5), sticky="w", padx=15)

        self.stats_container = ctk.CTkFrame(
            self.scrollable_frame,
            fg_color=self.colors["card"], corner_radius=10
        )
        self.stats_container.grid(row=4, column=0, sticky="nsew", padx=5, pady=5)
        ctk.CTkLabel(
            self.stats_container, text="Loading statistics...",
            text_color=self.colors["text_dim"]
        ).pack(pady=20)

        # ---- Fastest Run (with its actual splits) ----
        ctk.CTkLabel(
            self.scrollable_frame, text="FASTEST RUN",
            font=ctk.CTkFont(size=12, weight="bold"),
            text_color=self.colors["gold"]
        ).grid(row=5, column=0, pady=(20, 5), sticky="w", padx=15)

        self.fastest_run_container = ctk.CTkFrame(
            self.scrollable_frame, fg_color="transparent"
        )
        self.fastest_run_container.grid(row=6, column=0, sticky="nsew", padx=5)

        # ---- Fastest Milestone Times (all-time bests) ----
        ctk.CTkLabel(
            self.scrollable_frame, text="FASTEST MILESTONE TIMES",
            font=ctk.CTkFont(size=12, weight="bold"),
            text_color=self.colors["accent"]
        ).grid(row=7, column=0, pady=(20, 5), sticky="w", padx=15)

        self.fastest_milestones_container = ctk.CTkFrame(
            self.scrollable_frame,
            fg_color=self.colors["card"], corner_radius=10
        )
        self.fastest_milestones_container.grid(row=8, column=0, sticky="nsew", padx=5, pady=5)
        ctk.CTkLabel(
            self.fastest_milestones_container, text="Loading...",
            text_color=self.colors["text_dim"]
        ).pack(pady=20)

        # ---- Recent runs section ----
        ctk.CTkLabel(
            self.scrollable_frame, text="LATEST 5 RUNS",
            font=ctk.CTkFont(size=12, weight="bold"),
            text_color=self.colors["accent"]
        ).grid(row=9, column=0, pady=(20, 5), sticky="w", padx=15)

        self.runs_container = ctk.CTkFrame(
            self.scrollable_frame, fg_color="transparent"
        )
        self.runs_container.grid(row=10, column=0, sticky="nsew")

    def on_avatar_enter(self, event=None):
        self.avatar_tracking_active = True
        self.avatar_tilt = (0.0, 0.0)
        self.avatar_tilt_velocity = (0.0, 0.0)
        self.avatar_target_tilt = (0.0, 0.0)
        self._refresh_profile_avatar()

    def _refresh_profile_twitch_button(self, runs=None):
        if not hasattr(self, "profile_identity_frame") or not self.profile_identity_frame.winfo_exists():
            return

        if getattr(self, "profile_twitch_btn", None) is not None:
            try:
                self.profile_twitch_btn.destroy()
            except Exception:
                pass
            self.profile_twitch_btn = None

        twitch_name = None
        if self.profile_nickname:
            twitch_name = self.data_manager.get_player_twitch(self.profile_nickname, runs=runs)
            if not twitch_name:
                self._resolve_profile_twitch_async(self.profile_nickname)

        if twitch_name and self.twitch_img:
            self.profile_twitch_btn = ctk.CTkButton(
                self.profile_identity_frame,
                image=self.twitch_img,
                text="",
                width=24,
                height=24,
                fg_color="transparent",
                hover_color=self.colors["twitch"],
                corner_radius=8,
                border_width=0,
                command=lambda t=twitch_name: webbrowser.open(f"https://twitch.tv/{t}"),
            )
            self.profile_twitch_btn.pack(side="left", padx=(6, 0), pady=0)

    def _resolve_profile_twitch_async(self, nickname):
        if not nickname:
            return

        key = nickname.lower()
        now = time.time()
        last = self._profile_twitch_last_attempt.get(key, 0)
        if (now - last) < 120:
            return
        if key in self._profile_twitch_resolving:
            return

        self._profile_twitch_last_attempt[key] = now
        self._profile_twitch_resolving.add(key)

        def task():
            resolved = self.data_manager.fetch_player_twitch_from_profile_page(nickname)

            def apply_result():
                self._profile_twitch_resolving.discard(key)
                if self.current_view == "profile" and self.profile_nickname and self.profile_nickname.lower() == key:
                    if resolved:
                        self._refresh_profile_twitch_button()

            self.after(0, apply_result)

        threading.Thread(target=task, daemon=True).start()

    def _start_avatar_tracking_loop(self):
        if self._avatar_tracking_job is not None:
            try:
                self.after_cancel(self._avatar_tracking_job)
            except Exception:
                pass
            self._avatar_tracking_job = None
        self._avatar_last_tick_time = time.perf_counter()
        self._avatar_tracking_job = self.after(self._avatar_tracking_interval_ms, self._avatar_tracking_tick)

    def _avatar_tracking_tick(self):
        self._avatar_tracking_job = None
        if self.current_view != "profile":
            self.avatar_tracking_active = False
            return
        if not hasattr(self, "profile_avatar_label") or not self.profile_avatar_label.winfo_exists():
            return

        self.avatar_tracking_active = True
        window_w = max(1, self.winfo_width())
        window_h = max(1, self.winfo_height())

        x = max(0, min(window_w - 1, self.winfo_pointerx() - self.winfo_rootx()))
        y = max(0, min(window_h - 1, self.winfo_pointery() - self.winfo_rooty()))

        avatar_center_x = (
            self.profile_avatar_label.winfo_rootx()
            - self.winfo_rootx()
            + (self.profile_avatar_label.winfo_width() * 0.5)
        )
        avatar_center_y = (
            self.profile_avatar_label.winfo_rooty()
            - self.winfo_rooty()
            + (self.profile_avatar_label.winfo_height() * 0.5)
        )

        # Map cursor offset in a local radius around the avatar for stable, intentional motion.
        dx = x - avatar_center_x
        dy = y - avatar_center_y
        radius = max(140.0, min(window_w, window_h) * 0.18)

        target_x = max(-1.0, min(1.0, dx / radius))
        target_y = max(-1.0, min(1.0, -dy / radius))

        deadzone = 0.035
        if abs(target_x) < deadzone:
            target_x = 0.0
        if abs(target_y) < deadzone:
            target_y = 0.0

        self.avatar_target_tilt = (target_x, target_y)

        # Critically damped spring smoothing for natural, non-random follow behavior.
        now = time.perf_counter()
        dt = max(0.0001, min(0.05, now - self._avatar_last_tick_time))
        self._avatar_last_tick_time = now

        current_x, current_y = self.avatar_tilt
        vel_x, vel_y = self.avatar_tilt_velocity
        goal_x, goal_y = self.avatar_target_tilt

        stiffness = 28.0
        damping = 11.0
        acc_x = stiffness * (goal_x - current_x) - damping * vel_x
        acc_y = stiffness * (goal_y - current_y) - damping * vel_y

        vel_x += acc_x * dt
        vel_y += acc_y * dt
        next_x = max(-1.0, min(1.0, current_x + vel_x * dt))
        next_y = max(-1.0, min(1.0, current_y + vel_y * dt))
        self.avatar_tilt_velocity = (vel_x, vel_y)

        if abs(next_x - current_x) > 0.0015 or abs(next_y - current_y) > 0.0015:
            self.avatar_tilt = (next_x, next_y)
            self._refresh_profile_avatar()

        self._avatar_tracking_job = self.after(self._avatar_tracking_interval_ms, self._avatar_tracking_tick)

    def on_avatar_motion(self, event=None):
        # Kept for backward compatibility, but tracking is now driven by a pointer loop.
        return

    def on_avatar_leave(self, event=None):
        self.avatar_tracking_active = False
        self.avatar_tilt = (0.0, 0.0)
        self.avatar_tilt_velocity = (0.0, 0.0)
        self.avatar_target_tilt = (0.0, 0.0)
        if self.current_view == "profile":
            self._refresh_profile_avatar()

    def _refresh_profile_avatar(self):
        if not hasattr(self, "profile_avatar_label") or not self.profile_avatar_label.winfo_exists():
            return
        if not hasattr(self, "_avatar_source"):
            self._avatar_source = None
        if self._avatar_source is None:
            self.profile_avatar_label.configure(text="?", image=None)
            return

        tilt_x, tilt_y = getattr(self, "avatar_tilt", (0.0, 0.0))
        if not getattr(self, "avatar_tracking_active", False):
            tilt_x, tilt_y = 0.0, 0.0
        quant_step = self._avatar_quant_step
        qx = round(tilt_x / quant_step) * quant_step
        qy = round(tilt_y / quant_step) * quant_step
        render_key = (id(self._avatar_source), qx, qy)

        if render_key == self._avatar_last_render_key and hasattr(self.profile_avatar_label, "image"):
            return

        avatar = self._avatar_render_cache.get(render_key)
        if avatar is None:
            avatar = self._build_avatar_image(self._avatar_source, tilt_override=(qx, qy))
            if avatar is not None:
                self._avatar_render_cache[render_key] = avatar
                if len(self._avatar_render_cache) > 160:
                    oldest = next(iter(self._avatar_render_cache))
                    self._avatar_render_cache.pop(oldest, None)

        if avatar is None:
            self.profile_avatar_label.configure(text="?", image=None)
            return
        self._avatar_last_render_key = render_key
        self.profile_avatar_label.configure(image=avatar, text="")
        self.profile_avatar_label.image = avatar

    def _blend_pixel(self, dst, x, y, src_rgba):
        sr, sg, sb, sa = src_rgba
        if sa <= 0:
            return
        dr, dg, db, da = dst[x, y]
        src_a = sa / 255.0
        dst_a = da / 255.0
        out_a = src_a + dst_a * (1.0 - src_a)
        if out_a <= 0.0:
            dst[x, y] = (0, 0, 0, 0)
            return

        out_r = int((sr * src_a + dr * dst_a * (1.0 - src_a)) / out_a)
        out_g = int((sg * src_a + dg * dst_a * (1.0 - src_a)) / out_a)
        out_b = int((sb * src_a + db * dst_a * (1.0 - src_a)) / out_a)
        out_alpha = int(out_a * 255.0)
        dst[x, y] = (out_r, out_g, out_b, out_alpha)

    def _draw_textured_triangle(self, dst, tex, p0, p1, p2, uv0, uv1, uv2, invz0, invz1, invz2, shade, force_opaque=True):
        width, height = dst.size
        dst_px = dst.load()
        tex_px = tex.load()
        tex_w, tex_h = tex.size

        min_x = max(0, int(math.floor(min(p0[0], p1[0], p2[0]))))
        max_x = min(width - 1, int(math.ceil(max(p0[0], p1[0], p2[0]))))
        min_y = max(0, int(math.floor(min(p0[1], p1[1], p2[1]))))
        max_y = min(height - 1, int(math.ceil(max(p0[1], p1[1], p2[1]))))
        if min_x > max_x or min_y > max_y:
            return

        denom = ((p1[1] - p2[1]) * (p0[0] - p2[0]) +
                 (p2[0] - p1[0]) * (p0[1] - p2[1]))
        if abs(denom) < 1e-8:
            return

        for y in range(min_y, max_y + 1):
            py = y + 0.5
            for x in range(min_x, max_x + 1):
                px = x + 0.5
                w0 = ((p1[1] - p2[1]) * (px - p2[0]) + (p2[0] - p1[0]) * (py - p2[1])) / denom
                w1 = ((p2[1] - p0[1]) * (px - p2[0]) + (p0[0] - p2[0]) * (py - p2[1])) / denom
                w2 = 1.0 - w0 - w1
                if w0 < 0.0 or w1 < 0.0 or w2 < 0.0:
                    continue

                iz = invz0 * w0 + invz1 * w1 + invz2 * w2
                if iz <= 1e-8:
                    continue

                u_over_z = uv0[0] * invz0 * w0 + uv1[0] * invz1 * w1 + uv2[0] * invz2 * w2
                v_over_z = uv0[1] * invz0 * w0 + uv1[1] * invz1 * w1 + uv2[1] * invz2 * w2
                u = u_over_z / iz
                v = v_over_z / iz
                tx = max(0, min(tex_w - 1, int(u * (tex_w - 1) + 0.5)))
                ty = max(0, min(tex_h - 1, int(v * (tex_h - 1) + 0.5)))

                r, g, b, a = tex_px[tx, ty]
                if a <= 0:
                    continue
                if force_opaque:
                    a = 255

                lit = max(0.25, min(1.35, shade))
                color = (
                    int(max(0, min(255, r * lit))),
                    int(max(0, min(255, g * lit))),
                    int(max(0, min(255, b * lit))),
                    a,
                )
                if force_opaque:
                    dst_px[x, y] = color
                else:
                    self._blend_pixel(dst_px, x, y, color)

    def _rotate_vertex(self, v, yaw_rad, pitch_rad):
        x, y, z = v
        cos_y = math.cos(yaw_rad)
        sin_y = math.sin(yaw_rad)
        x1 = x * cos_y + z * sin_y
        z1 = -x * sin_y + z * cos_y

        cos_x = math.cos(pitch_rad)
        sin_x = math.sin(pitch_rad)
        y2 = y * cos_x - z1 * sin_x
        z2 = y * sin_x + z1 * cos_x
        return x1, y2, z2

    def _project_vertex(self, v, canvas_center, scale, camera_dist):
        x, y, z = v
        denom = z + camera_dist
        if denom <= 0.05:
            denom = 0.05
        sx = canvas_center[0] + (x * scale) / denom
        sy = canvas_center[1] - (y * scale) / denom
        return sx, sy

    def _render_cube_part(self, canvas, faces, yaw_rad, pitch_rad, center_xyz, half_size_xyz, is_overlay=False):
        cx, cy, cz = center_xyz
        hx, hy, hz = half_size_xyz
        verts = {
            "FTL": (cx - hx, cy + hy, cz + hz),
            "FTR": (cx + hx, cy + hy, cz + hz),
            "FBR": (cx + hx, cy - hy, cz + hz),
            "FBL": (cx - hx, cy - hy, cz + hz),
            "BTL": (cx - hx, cy + hy, cz - hz),
            "BTR": (cx + hx, cy + hy, cz - hz),
            "BBR": (cx + hx, cy - hy, cz - hz),
            "BBL": (cx - hx, cy - hy, cz - hz),
        }

        face_defs = {
            "front": {
                "verts": ["FTL", "FTR", "FBR", "FBL"],
                "normal": (0.0, 0.0, 1.0),
            },
            "back": {
                "verts": ["BTR", "BTL", "BBL", "BBR"],
                "normal": (0.0, 0.0, -1.0),
            },
            "left": {
                "verts": ["BTL", "FTL", "FBL", "BBL"],
                "normal": (-1.0, 0.0, 0.0),
            },
            "right": {
                "verts": ["FTR", "BTR", "BBR", "FBR"],
                "normal": (1.0, 0.0, 0.0),
            },
            "top": {
                "verts": ["BTL", "BTR", "FTR", "FTL"],
                "normal": (0.0, 1.0, 0.0),
            },
            "bottom": {
                "verts": ["FBL", "FBR", "BBR", "BBL"],
                "normal": (0.0, -1.0, 0.0),
            },
        }

        def face_uv(face_name, vert_name):
            x, y, z = verts[vert_name]
            if hx == 0 or hy == 0 or hz == 0:
                return (0.5, 0.5)
            x = (x - cx) / hx
            y = (y - cy) / hy
            z = (z - cz) / hz

            if face_name == "front":
                return ((x + 1.0) * 0.5, (1.0 - y) * 0.5)
            if face_name == "back":
                return ((1.0 - x) * 0.5, (1.0 - y) * 0.5)
            if face_name == "left":
                return ((z + 1.0) * 0.5, (1.0 - y) * 0.5)
            if face_name == "right":
                return ((1.0 - z) * 0.5, (1.0 - y) * 0.5)
            if face_name == "top":
                return ((x + 1.0) * 0.5, (z + 1.0) * 0.5)
            return ((x + 1.0) * 0.5, (1.0 - z) * 0.5)

        rotated = {name: self._rotate_vertex(v, yaw_rad, pitch_rad) for name, v in verts.items()}
        canvas_w, canvas_h = canvas.size
        center = (canvas_w * 0.5, canvas_h * 0.48)
        scale = min(canvas_w, canvas_h) * 0.58
        camera_dist = 18.0
        projected = {
            name: self._project_vertex(v, center, scale, camera_dist) for name, v in rotated.items()
        }

        light = (-0.30, 0.90, 0.50)
        light_len = math.sqrt(light[0] ** 2 + light[1] ** 2 + light[2] ** 2)
        light = (light[0] / light_len, light[1] / light_len, light[2] / light_len)

        draw_list = []
        face_base_shade = {
            "front": 1.00,
            "back": 0.74,
            "left": 0.82,
            "right": 0.82,
            "top": 1.10,
            "bottom": 0.66,
        }
        for face_name, info in face_defs.items():
            texture = faces.get(face_name)
            if texture is None:
                continue

            n = self._rotate_vertex(info["normal"], yaw_rad, pitch_rad)
            if is_overlay:
                # Cull overlay faces that point away from the camera so hidden shell faces
                # cannot bleed through the base head.
                if n[2] >= 0.0:
                    continue
            else:
                # Base layer keeps broader face visibility for readability at shallow angles.
                if face_name not in ("left", "right", "front", "top", "bottom") and n[2] >= -0.01:
                    continue

            alpha_box = texture.split()[-1].getbbox()
            if alpha_box is None:
                continue

            z_avg = sum(rotated[v_name][2] for v_name in info["verts"]) / 4.0
            # Keep lighting mostly face-flat so the cube stays clean and readable.
            light_term = 0.94 + max(0.0, n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) * 0.06
            shade = face_base_shade.get(face_name, 1.0) * light_term
            if is_overlay:
                shade *= 1.01

            quad = [projected[v_name] for v_name in info["verts"]]
            quad_invz = []
            for v_name in info["verts"]:
                z = rotated[v_name][2] + camera_dist
                if z <= 0.05:
                    z = 0.05
                quad_invz.append(1.0 / z)

            quad_uv = [face_uv(face_name, v_name) for v_name in info["verts"]]

            draw_list.append((z_avg, face_name, texture, quad, quad_uv, quad_invz, shade))

        # Painter order: farther faces first (higher z), near faces later.
        draw_list.sort(key=lambda item: item[0], reverse=True)

        non_front_faces = [item for item in draw_list if item[1] != "front"]
        front_faces = [item for item in draw_list if item[1] == "front"]

        for _, _, texture, quad, quad_uv, quad_invz, shade in non_front_faces + front_faces:
            self._draw_textured_triangle(
                canvas, texture,
                quad[0], quad[1], quad[2],
                quad_uv[0], quad_uv[1], quad_uv[2],
                quad_invz[0], quad_invz[1], quad_invz[2],
                shade,
                force_opaque=(not is_overlay),
            )
            self._draw_textured_triangle(
                canvas, texture,
                quad[0], quad[2], quad[3],
                quad_uv[0], quad_uv[2], quad_uv[3],
                quad_invz[0], quad_invz[2], quad_invz[3],
                shade,
                force_opaque=(not is_overlay),
            )

    def _extract_part_faces(self, skin, coords):
        upsample = max(2, int(getattr(self, "_avatar_face_scale", 4)))

        def face(rect):
            x1, y1, x2, y2 = rect
            w = max(1, x2 - x1)
            h = max(1, y2 - y1)
            return skin.crop((x1, y1, x2, y2)).resize((w * upsample, h * upsample), Image.Resampling.NEAREST)

        return {
            "front": face(coords["front"]),
            "back": face(coords["back"]),
            "left": face(coords["left"]),
            "right": face(coords["right"]),
            "top": face(coords["top"]),
            "bottom": face(coords["bottom"]),
        }

    def _prepare_avatar_layers(self, img):
        if img is None:
            return None
        try:
            base = img.convert("RGBA")
            if base.size != (64, 64):
                base = base.resize((64, 64), Image.Resampling.LANCZOS)

            head_base = self._extract_part_faces(base, {
                "front": (8, 8, 16, 16), "back": (24, 8, 32, 16),
                "left": (16, 8, 24, 16), "right": (0, 8, 8, 16),
                "top": (8, 0, 16, 8), "bottom": (16, 0, 24, 8),
            })
            head_overlay = self._extract_part_faces(base, {
                "front": (40, 8, 48, 16), "back": (56, 8, 64, 16),
                "left": (48, 8, 56, 16), "right": (32, 8, 40, 16),
                "top": (40, 0, 48, 8), "bottom": (48, 0, 56, 8),
            })

            # Mirror once up front instead of every frame.
            for face_name, face_img in head_base.items():
                head_base[face_name] = face_img.convert("RGBA").transpose(Image.Transpose.FLIP_LEFT_RIGHT)

            for face_name, face_img in head_overlay.items():
                head_overlay[face_name] = face_img.convert("RGBA").transpose(Image.Transpose.FLIP_LEFT_RIGHT)

            has_overlay = any(
                face_img.getbbox() is not None and face_img.split()[-1].getbbox() is not None
                for face_img in head_overlay.values()
            )

            return {
                "base": head_base,
                "overlay": head_overlay,
                "has_overlay": has_overlay,
            }
        except Exception:
            return None

    def _build_avatar_image(self, img, tilt_override=None):
        if img is None:
            return None
        try:
            layers = self._avatar_prepared_layers
            if not layers:
                layers = self._prepare_avatar_layers(img)
                self._avatar_prepared_layers = layers
            if not layers:
                return None

            if tilt_override is not None:
                tilt_x, tilt_y = tilt_override
            else:
                tilt_x, tilt_y = getattr(self, "avatar_tilt", (0.0, 0.0))
                if not getattr(self, "avatar_tracking_active", False):
                    tilt_x, tilt_y = 0.0, 0.0

            # Default to a 180-degree orientation with subtle cursor tracking offsets.
            yaw_deg = 180.0 - tilt_x * 24.0
            pitch_deg = tilt_y * 16.0
            yaw_deg = max(156.0, min(204.0, yaw_deg))
            pitch_deg = max(-16.0, min(16.0, pitch_deg))
            yaw_rad = math.radians(yaw_deg)
            pitch_rad = math.radians(pitch_deg)

            internal_size = int(getattr(self, "_avatar_internal_size", 192))
            display_size = int(getattr(self, "_avatar_display_size", 184))
            canvas = Image.new("RGBA", (internal_size, internal_size), (0, 0, 0, 0))

            self._render_cube_part(canvas, layers["base"], yaw_rad, pitch_rad, (0.0, 0.0, 0.0), (4.9, 4.9, 4.9), False)
            if layers.get("has_overlay"):
                self._render_cube_part(canvas, layers["overlay"], yaw_rad, pitch_rad, (0.0, 0.0, 0.0), (5.25, 5.25, 5.25), True)

            final = canvas.resize((display_size, display_size), Image.Resampling.LANCZOS)
            return ctk.CTkImage(light_image=final, dark_image=final, size=(display_size, display_size))
        except Exception:
            return None

    def load_profile_avatar(self):
        nickname = self.profile_nickname
        if not nickname:
            return

        # Keep the current profile head stable instead of reloading it repeatedly.
        if getattr(self, "_avatar_source", None) is not None and self._avatar_source_nickname == nickname:
            self._refresh_profile_avatar()
            return

        def task():
            img = self.data_manager.fetch_player_avatar(nickname)
            self.after(0, lambda: self.display_profile_avatar(img, nickname))

        threading.Thread(target=task, daemon=True).start()

    def display_profile_avatar(self, img, nickname):
        if self.current_view != "profile" or self.profile_nickname != nickname:
            return
        if not hasattr(self, "profile_avatar_label"):
            return
        self._avatar_source = img
        self._avatar_source_nickname = nickname if img is not None else None
        self._avatar_prepared_layers = self._prepare_avatar_layers(img) if img is not None else None
        self._avatar_render_cache = {}
        self._avatar_last_render_key = None
        self._refresh_profile_avatar()

    def change_profile_timeframe(self, tf):
        self.profile_timeframe = tf
        self.render_profile_skeleton()
        self.load_profile_data()
        self.load_profile_avatar()

    def load_profile_data(self):
        nickname = self.profile_nickname
        if self._profile_refreshing:
            return
        self._profile_refreshing = True

        def task():
            def safe_fetch(fetcher, fallback):
                try:
                    return fetcher()
                except Exception:
                    return fallback

            with ThreadPoolExecutor(max_workers=4) as executor:
                fut_stats = executor.submit(
                    safe_fetch,
                    lambda: self.data_manager.get_user_stats(nickname, self.profile_timeframe),
                    None,
                )
                fut_runs = executor.submit(
                    safe_fetch,
                    lambda: self.data_manager.get_recent_runs(nickname),
                    [],
                )
                fut_fastest = executor.submit(
                    safe_fetch,
                    lambda: self.data_manager.get_fastest_stats(nickname),
                    None,
                )
                fut_session = executor.submit(
                    safe_fetch,
                    lambda: self.data_manager.get_session_summary(nickname, self.profile_timeframe),
                    None,
                )

                stats = fut_stats.result()
                runs = fut_runs.result()
                fastest = fut_fastest.result()
                session_summary = fut_session.result()

            # NPH is optional and intentionally skipped in the critical path for faster profile loads.
            nph_stats = None
            def apply_results():
                try:
                    self.safe_display_profile(
                        stats, runs, fastest, session_summary, nph_stats, nickname
                    )
                finally:
                    self._profile_refreshing = False

            # Guarded UI update with in-flight flag reset.
            self.after(0, apply_results)

        threading.Thread(target=task, daemon=True).start()

    def safe_display_profile(self, stats, runs, fastest, session_summary, nph_stats, nickname):
        # Only update if the user is still viewing the same profile
        if self.current_view == "profile" and self.profile_nickname == nickname:
            # Display session summary FIRST as it's the most requested
            try:
                self._refresh_profile_twitch_button(runs=runs)
                session_sig = self._profile_payload_signature((session_summary, nph_stats, self.profile_timeframe))
                if self._profile_section_signatures.get("session") != session_sig:
                    self.display_session_summary(session_summary, nph_stats)
                    self._profile_section_signatures["session"] = session_sig
            except Exception as e:
                print(f"Error displaying session summary: {e}")

            try:
                stats_sig = self._profile_payload_signature((stats, self.profile_timeframe))
                if self._profile_section_signatures.get("stats") != stats_sig:
                    self.display_stats(stats)
                    self._profile_section_signatures["stats"] = stats_sig
            except Exception as e:
                print(f"Error displaying stats: {e}")

            try:
                fastest_run_sig = self._profile_payload_signature(fastest)
                if self._profile_section_signatures.get("fastest_run") != fastest_run_sig:
                    self.display_fastest_run(fastest)
                    self._profile_section_signatures["fastest_run"] = fastest_run_sig
            except Exception as e:
                print(f"Error displaying fastest run: {e}")

            try:
                milestones_sig = self._profile_payload_signature(fastest)
                if self._profile_section_signatures.get("milestones") != milestones_sig:
                    self.display_fastest_milestones(fastest)
                    self._profile_section_signatures["milestones"] = milestones_sig
            except Exception as e:
                print(f"Error displaying milestones: {e}")

            try:
                runs_sig = self._profile_payload_signature(runs)
                if self._profile_section_signatures.get("runs") != runs_sig:
                    self.display_recent_runs(runs)
                    self._profile_section_signatures["runs"] = runs_sig
            except Exception as e:
                print(f"Error displaying recent runs: {e}")

    def _profile_payload_signature(self, data):
        try:
            return json.dumps(data, sort_keys=True, default=str)
        except Exception:
            return repr(data)

    def display_session_summary(self, session_summary, nph_stats=None):
        """Display the detailed session summary with advanced metrics."""
        try:
            for widget in self.session_summary_container.winfo_children():
                widget.destroy()
        except Exception:
            return

        # Ensure the container is shown/hidden based on timeframe
        if self.profile_timeframe != "session":
            self.session_summary_container.grid_remove()
            return

        if session_summary is None:
            # Still show a message if we're on the session tab but no data found
            self.session_summary_container.grid()
            ctk.CTkLabel(
                self.session_summary_container,
                text="No session data found for this player.",
                font=ctk.CTkFont(size=11),
                text_color=self.colors["text_dim"]
            ).pack(pady=10)
            return
        
        self.session_summary_container.grid()

        def format_duration(ms):
            """Format milliseconds as 'XhYm' or 'Xm'."""
            if ms <= 0:
                return "0m"
            total_seconds = ms // 1000
            hours = total_seconds // 3600
            minutes = (total_seconds % 3600) // 60
            if hours > 0:
                return f"{hours}h{minutes}m"
            return f"{minutes}m"

        def format_time(ms):
            """Format milliseconds as 'MM:SS'."""
            if ms <= 0:
                return "0:00"
            total_seconds = ms // 1000
            minutes = total_seconds // 60
            seconds = total_seconds % 60
            return f"{minutes}:{seconds:02d}"

        # Build the summary line
        duration_str = format_duration(session_summary.get("session_duration_ms", 0))
        time_ago_str = session_summary.get("time_ago_str", "unknown")

        summary_text = f"{self.profile_nickname} Session Stats ({duration_str}, {time_ago_str}):"

        # Create the header label
        header_label = ctk.CTkLabel(
            self.session_summary_container,
            text=summary_text,
            font=ctk.CTkFont(size=11, weight="bold"),
            text_color=self.colors["accent"]
        )
        header_label.pack(anchor="w", padx=10, pady=(5, 6))

        # ---- Performance Metrics (RTANPH, RNPH, LNPH) from NPH API ----
        try:
            perf_frame = ctk.CTkFrame(self.session_summary_container, fg_color="transparent")
            perf_frame.pack(anchor="w", padx=10, pady=(0, 8), fill="x")

            nph_data = {}
            if nph_stats is not None:
                nph_data = {
                    "rtanph": nph_stats.get("rtanph", 0),
                    "rnph": nph_stats.get("rnph", 0),
                    "lnph": nph_stats.get("lnph", 0),
                    "rpe": nph_stats.get("rpe", 0),
                }

            def create_perf_card(parent, label, value, subtitle):
                card = ctk.CTkFrame(parent, fg_color=self.colors["card"], corner_radius=8)
                card.pack(side="left", padx=(0, 8), fill="y")
                
                inner = ctk.CTkFrame(card, fg_color="transparent")
                inner.pack(padx=12, pady=8)
                
                ctk.CTkLabel(
                    inner, text=label,
                    font=ctk.CTkFont(size=9, weight="bold"),
                    text_color=self.colors["text_dim"]
                ).pack(anchor="w")
                
                color = self.colors["gold"] if label == "RTANPH" else self.colors["accent"]
                ctk.CTkLabel(
                    inner, text=value,
                    font=ctk.CTkFont(family="Consolas", size=16, weight="bold"),
                    text_color=color
                ).pack(anchor="w")
                
                ctk.CTkLabel(
                    inner, text=subtitle,
                    font=ctk.CTkFont(size=8),
                    text_color=self.colors["text_dim"]
                ).pack(anchor="w")
                return card

            create_perf_card(perf_frame, "RTANPH", self.data_manager._format_nph(nph_data.get("rtanph")), "real-time NPH")
            create_perf_card(perf_frame, "RNPH", self.data_manager._format_nph(nph_data.get("rnph")), "quality metric")
            create_perf_card(perf_frame, "LNPH", self.data_manager._format_nph(nph_data.get("lnph")), "recent form")

            # RPE from API (not calculated)
            reset_card = ctk.CTkFrame(perf_frame, fg_color=self.colors["card"], corner_radius=8)
            reset_card.pack(side="left", padx=(0, 10), fill="y")
            reset_inner = ctk.CTkFrame(reset_card, fg_color="transparent")
            reset_inner.pack(padx=12, pady=8)
            ctk.CTkLabel(
                reset_inner, text="RPE",
                font=ctk.CTkFont(size=9, weight="bold"),
                text_color=self.colors["text_dim"]
            ).pack(anchor="w")
            rpe_value = nph_stats.get("rpe", 0) if nph_stats else 0
            ctk.CTkLabel(
                reset_inner, text=self.data_manager._format_nph(rpe_value),
                font=ctk.CTkFont(family="Consolas", size=16, weight="bold"),
                text_color=self.colors["accent"]
            ).pack(anchor="w")
            ctk.CTkLabel(
                reset_inner, text="resets per enter",
                font=ctk.CTkFont(size=8),
                text_color=self.colors["text_dim"]
            ).pack(anchor="w")

        except Exception:
            pass

        # ---- Playtime & Seeds Info ----
        try:
            seeds_frame = ctk.CTkFrame(self.session_summary_container, fg_color="transparent")
            seeds_frame.pack(anchor="w", padx=10, pady=(0, 8), fill="x")

            if nph_stats and isinstance(nph_stats, dict):
                playtime_ms = nph_stats.get("playtime", 0)
                walltime_ms = nph_stats.get("walltime", 0)
                seeds_played = nph_stats.get("seedsPlayed", 0)

                playtime_str = self.data_manager._format_playtime_ms(playtime_ms)
                walltime_str = self.data_manager._format_playtime_ms(walltime_ms)

                ctk.CTkLabel(
                    seeds_frame, text=f"Playtime: {playtime_str}  |  Walltime: {walltime_str}",
                    font=ctk.CTkFont(size=10),
                    text_color=self.colors["text_dim"]
                ).pack(side="left")

                if seeds_played > 0:
                    ctk.CTkLabel(
                        seeds_frame, text=f"• Seeds: {seeds_played}",
                        font=ctk.CTkFont(size=10),
                        text_color=self.colors["text_dim"]
                    ).pack(side="left", padx=(20, 0))

        except Exception:
            pass

        # ---- Remaining metrics (structures) ----
        metrics_parts = []

        # First structures
        fs_data = session_summary.get("first_structures", {})
        if fs_data.get("count", 0) > 0:
            fs_count = fs_data.get("count", 0)
            fs_avg = format_time(fs_data.get("avg_ms", 0))
            metrics_parts.append(f"• first structures: {fs_count} ({fs_avg} avg)")

        # Second structures
        ss_data = session_summary.get("second_structures", {})
        if ss_data.get("count", 0) > 0:
            ss_count = ss_data.get("count", 0)
            ss_avg = format_time(ss_data.get("avg_ms", 0))
            metrics_parts.append(f"• second structures: {ss_count} ({ss_avg} avg)")

        # End enters
        end_data = session_summary.get("end_enters", {})
        if end_data.get("count", 0) > 0:
            end_count = end_data.get("count", 0)
            end_avg = format_time(end_data.get("avg_ms", 0))
            metrics_parts.append(f"• end enters: {end_count} ({end_avg} avg)")

        # Create the metrics label
        if metrics_parts:
            metrics_text = "\n".join(metrics_parts)
            metrics_label = ctk.CTkLabel(
                self.session_summary_container,
                text=metrics_text,
                font=ctk.CTkFont(size=10),
                text_color=self.colors["text_dim"],
                justify="left"
            )
            metrics_label.pack(anchor="w", padx=10, pady=(0, 10))

    def display_stats(self, stats):
        try:
            for widget in self.stats_container.winfo_children():
                widget.destroy()
        except Exception:
            return

        if stats is None:
            ctk.CTkLabel(
                self.stats_container,
                text="No data found for this player.",
                text_color="gray"
            ).pack(pady=20)
            return

        total_runs = sum(
            v.get("count", 0)
            for k, v in stats.items()
            if isinstance(v, dict)
        )
        if total_runs == 0:
            ctk.CTkLabel(
                self.stats_container,
                text=f"No runs found in the {self.profile_timeframe} timeframe.",
                text_color="gray"
            ).pack(pady=10)

        splits = [
            ("Nether", "nether"),
            ("Bastion", "bastion"),
            ("Fortress", "fortress"),
            ("Blind", "first_portal"),
            ("Stronghold", "stronghold"),
            ("End Enter", "end"),
            ("Finish", "finish"),
        ]

        for i, (label, key) in enumerate(splits):
            data = stats.get(key, {"count": 0, "avg": "0:00"})
            # Defensive: ensure data is a dict with expected keys
            if not isinstance(data, dict):
                data = {"count": 0, "avg": "0:00"}
            count = data.get("count", 0)
            avg = data.get("avg", "0:00")

            r = ctk.CTkFrame(self.stats_container, fg_color="transparent")
            r.pack(fill="x", padx=15, pady=2)

            ctk.CTkLabel(
                r, text=label, width=150, anchor="w",
                font=ctk.CTkFont(weight="bold")
            ).pack(side="left", pady=5)

            ctk.CTkLabel(
                r, text=f"Avg: {avg}", width=100,
                font=ctk.CTkFont(family="Consolas", size=13),
                text_color=self.colors["accent"]
            ).pack(side="right", padx=5)

            ctk.CTkLabel(
                r, text=f"Count: {count}", width=100,
                text_color=self.colors["text_dim"]
            ).pack(side="right", padx=5)

            if i < len(splits) - 1:
                ctk.CTkFrame(
                    self.stats_container, height=1, fg_color=self.colors["line"]
                ).pack(fill="x", padx=15)

    def display_fastest_run(self, fastest):
        """Display the fastest completed run with its actual splits."""
        try:
            for widget in self.fastest_run_container.winfo_children():
                widget.destroy()
        except Exception:
            return

        if fastest is None or fastest.get("fastest_run") is None:
            ctk.CTkLabel(
                self.fastest_run_container,
                text="No completed runs found.",
                text_color="gray"
            ).pack(pady=20)
            return

        run = fastest.get("fastest_run")
        if not isinstance(run, dict):
            ctk.CTkLabel(
                self.fastest_run_container,
                text="No completed runs found.",
                text_color="gray"
            ).pack(pady=20)
            return

        run_id = run.get("id", "?")
        finish_time = run.get("finish")

        def format_t(ms):
            if ms is None:
                return "--:--"
            try:
                return f"{int(ms / 60000):02d}:{int((ms / 1000) % 60):02d}"
            except Exception:
                return "--:--"

        r = ctk.CTkFrame(
            self.fastest_run_container,
            fg_color=self.colors["card"], corner_radius=8
        )
        r.pack(fill="x", padx=5, pady=4)

        # Header with run ID and finish time
        header = ctk.CTkFrame(r, fg_color="transparent")
        header.pack(fill="x", padx=10, pady=5)

        ctk.CTkLabel(
            header, text=f"RUN #{run_id} - {format_t(finish_time)}",
            font=ctk.CTkFont(weight="bold", size=13),
            text_color=self.colors["gold"]
        ).pack(side="left")

        def make_open_url(rid):
            return lambda: webbrowser.open(
                f"https://paceman.gg/stats/run/{rid}"
            )

        ctk.CTkButton(
            header, text="VIEW ON PACEMAN", width=110, height=24,
            fg_color=self.colors["panel_alt"], hover_color=self.colors["accent_soft"],
            text_color=self.colors["text"],
            font=ctk.CTkFont(size=9, weight="bold"),
            command=make_open_url(run_id)
        ).pack(side="right")

        # Splits from this specific run
        milestones = ctk.CTkFrame(r, fg_color="transparent")
        milestones.pack(fill="x", padx=15, pady=(0, 10))

        splits = [
            ("Nether", "nether"), ("Bastion", "bastion"),
            ("Fortress", "fortress"), ("Blind", "first_portal"),
            ("Stronghold", "stronghold"), ("End", "end"),
            ("Finish", "finish"),
        ]
        for label, key in splits:
            ms = run.get(key)
            color = (
                self.colors["gold"]
                if key == "finish" and ms
                else self.colors["text"]
            )
            ctk.CTkLabel(
                milestones,
                text=f"{label}: {format_t(ms)}",
                font=ctk.CTkFont(size=11), text_color=color
            ).pack(side="left", padx=10)

    def display_fastest_milestones(self, fastest):
        """Display the all-time fastest times for each milestone."""
        try:
            for widget in self.fastest_milestones_container.winfo_children():
                widget.destroy()
        except Exception:
            return

        if fastest is None or fastest.get("fastest_milestones") is None:
            ctk.CTkLabel(
                self.fastest_milestones_container,
                text="No milestone data available.",
                text_color="gray"
            ).pack(pady=20)
            return

        milestones = fastest.get("fastest_milestones")
        if not isinstance(milestones, dict):
            ctk.CTkLabel(
                self.fastest_milestones_container,
                text="No milestone data available.",
                text_color="gray"
            ).pack(pady=20)
            return

        def format_t(ms):
            if ms is None:
                return "--:--"
            try:
                return f"{int(ms / 60000):02d}:{int((ms / 1000) % 60):02d}"
            except Exception:
                return "--:--"

        splits = [
            ("Nether", "nether"),
            ("Bastion", "bastion"),
            ("Fortress", "fortress"),
            ("Blind", "first_portal"),
            ("Stronghold", "stronghold"),
            ("End Enter", "end"),
            ("Finish", "finish"),
        ]

        for i, (label, key) in enumerate(splits):
            ms = milestones.get(key)
            time_str = format_t(ms)

            r = ctk.CTkFrame(self.fastest_milestones_container, fg_color="transparent")
            r.pack(fill="x", padx=15, pady=2)

            ctk.CTkLabel(
                r, text=label, width=150, anchor="w",
                font=ctk.CTkFont(weight="bold")
            ).pack(side="left", pady=5)

            ctk.CTkLabel(
                r, text=time_str,
                font=ctk.CTkFont(family="Consolas", size=13, weight="bold"),
                text_color=self.colors["gold"]
            ).pack(side="right", padx=5)

            if i < len(splits) - 1:
                ctk.CTkFrame(
                    self.fastest_milestones_container, height=1, fg_color=self.colors["line"]
                ).pack(fill="x", padx=15)

    def display_recent_runs(self, runs):
        try:
            for widget in self.runs_container.winfo_children():
                widget.destroy()
        except Exception:
            return

        if not runs:
            ctk.CTkLabel(
                self.runs_container,
                text="No recent runs found.", text_color="gray"
            ).pack(pady=20)
            return

        def format_t(ms):
            if ms is None:
                return "--:--"
            try:
                return f"{int(ms / 60000):02d}:{int((ms / 1000) % 60):02d}"
            except Exception:
                return "--:--"

        for i, run in enumerate(runs):
            if not isinstance(run, dict):
                continue
            r = ctk.CTkFrame(
                self.runs_container,
                fg_color=self.colors["card"], corner_radius=8
            )
            r.pack(fill="x", padx=5, pady=4)

            run_id = run.get("id", "?")
            header = ctk.CTkFrame(r, fg_color="transparent")
            header.pack(fill="x", padx=10, pady=5)

            ctk.CTkLabel(
                header, text=f"RUN #{run_id}",
                font=ctk.CTkFont(weight="bold"),
                text_color=self.colors["text_dim"]
            ).pack(side="left")

            def make_open_url(rid):
                return lambda: webbrowser.open(
                    f"https://paceman.gg/stats/run/{rid}"
                )

            ctk.CTkButton(
                header, text="VIEW ON PACEMAN", width=110, height=24,
                fg_color=self.colors["panel_alt"], hover_color=self.colors["accent_soft"],
                text_color=self.colors["text"],
                font=ctk.CTkFont(size=9, weight="bold"),
                command=make_open_url(run_id)
            ).pack(side="right")

            milestones = ctk.CTkFrame(r, fg_color="transparent")
            milestones.pack(fill="x", padx=15, pady=(0, 10))

            splits = [
                ("Nether", "nether"), ("Bastion", "bastion"),
                ("Fortress", "fortress"), ("Blind", "first_portal"),
                ("Stronghold", "stronghold"), ("End", "end"),
                ("Finish", "finish"),
            ]
            for label, key in splits:
                ms = run.get(key)
                color = (
                    self.colors["gold"]
                    if key == "finish" and ms
                    else self.colors["text"]
                )
                ctk.CTkLabel(
                    milestones,
                    text=f"{label}: {format_t(ms)}",
                    font=ctk.CTkFont(size=11), text_color=color
                ).pack(side="left", padx=10)

    # ------------------------------------------------------------------
    # All Runs view
    # ------------------------------------------------------------------

    def show_all_runs(self, nickname):
        if not nickname:
            return
        self.profile_nickname = nickname
        self.current_view = "all_runs"
        self.current_page = 0
        self.filter_frame.grid_remove()
        self.runs_filter_frame.grid()
        self.scrollable_frame.configure(label_text="")
        self.content_title_label.configure(text="ALL RUNS")
        for widget in self.scrollable_frame.winfo_children():
            widget.destroy()
        self.status_label.configure(text=f"Loading all runs for {nickname}...")
        self.load_all_runs_data()

    def load_all_runs_data(self):
        nickname = self.profile_nickname

        def task():
            try:
                self.data_manager.get_all_runs(nickname)
            except Exception:
                pass
            self.after(0, self.update_all_runs_ui)

        threading.Thread(target=task, daemon=True).start()

    def update_all_runs_ui(self):
        if self.current_view != "all_runs":
            return
        try:
            for widget in self.scrollable_frame.winfo_children():
                widget.destroy()
        except Exception:
            return

        f_vals = {
            k: f_input.get_ms()
            for k, f_input in self.runs_time_filters.items()
            if f_input.get_ms()
        }
        completed_only = self.completed_only_var.get()
        cache_entry = self.data_manager.runs_cache.get(
            self.profile_nickname, (0, [])
        )
        all_runs = cache_entry[1] if isinstance(cache_entry, tuple) else []

        filtered = []
        for run in all_runs:
            if not isinstance(run, dict):
                continue
            if completed_only and run.get("finish") is None:
                continue
            passed = True
            for f_key, f_val in f_vals.items():
                val = run.get(f_key)
                if val is not None and val > f_val:
                    passed = False
                    break
            if passed:
                filtered.append(run)

        # Pagination
        total_runs = len(filtered)
        max_pages = (
            (total_runs - 1) // self.runs_per_page + 1
            if total_runs > 0 else 1
        )
        self.current_page = max(0, min(self.current_page, max_pages - 1))

        start_idx = self.current_page * self.runs_per_page
        end_idx = start_idx + self.runs_per_page
        page_runs = filtered[start_idx:end_idx]

        # Pagination Controls
        pag_frame = ctk.CTkFrame(self.scrollable_frame, fg_color="transparent")
        pag_frame.grid(row=0, column=0, pady=10, sticky="ew")

        ctk.CTkButton(
            pag_frame, text="◀ PREV", width=70, height=30,
            fg_color=self.colors["panel_alt"],
            hover_color=self.colors["accent_soft"],
            text_color=self.colors["text"],
            state="normal" if self.current_page > 0 else "disabled",
            command=self.prev_page
        ).pack(side="left", padx=10)

        ctk.CTkLabel(
            pag_frame,
            text=f"PAGE {self.current_page + 1} OF {max_pages} ({total_runs} TOTAL)",
            font=ctk.CTkFont(weight="bold")
        ).pack(side="left", expand=True)

        ctk.CTkButton(
            pag_frame, text="NEXT ▶", width=70, height=30,
            fg_color=self.colors["panel_alt"],
            hover_color=self.colors["accent_soft"],
            text_color=self.colors["text"],
            state="normal" if self.current_page < max_pages - 1 else "disabled",
            command=self.next_page
        ).pack(side="right", padx=10)

        def format_t(ms):
            if ms is None:
                return "--:--"
            try:
                return f"{int(ms / 60000):02d}:{int((ms / 1000) % 60):02d}"
            except Exception:
                return "--:--"

        for i, run in enumerate(page_runs):
            if not isinstance(run, dict):
                continue
            r = ctk.CTkFrame(
                self.scrollable_frame,
                fg_color=self.colors["card"] if i % 2 == 0 else "transparent",
                corner_radius=6,
            )
            r.grid(row=i + 1, column=0, sticky="ew", padx=5, pady=2)

            run_id = run.get("id", "?")
            ctk.CTkLabel(
                r, text=f"#{run_id}", width=60,
                text_color=self.colors["text_dim"],
                font=ctk.CTkFont(weight="bold")
            ).pack(side="left", padx=10)

            splits = [
                ("N", "nether"), ("B", "bastion"), ("F", "fortress"),
                ("Bl", "first_portal"), ("SH", "stronghold"), ("End", "end"),
                ("Fin", "finish"),
            ]
            for label, key in splits:
                ms = run.get(key)
                color = (
                    self.colors["gold"]
                    if key == "finish" and ms
                    else self.colors["text"]
                )
                ctk.CTkLabel(
                    r,
                    text=f"{label}: {format_t(ms)}",
                    font=ctk.CTkFont(family="Consolas", size=11),
                    text_color=color
                ).pack(side="left", padx=12, pady=10)

            def make_open_url(rid):
                return lambda: webbrowser.open(
                    f"https://paceman.gg/stats/run/{rid}"
                )

            ctk.CTkButton(
                r, text="VIEW", width=60, height=26,
                fg_color=self.colors["panel_alt"], hover_color=self.colors["accent_soft"],
                text_color=self.colors["text"],
                font=ctk.CTkFont(size=10, weight="bold"),
                command=make_open_url(run_id)
            ).pack(side="right", padx=15)

        self.status_label.configure(
            text=(
                f"SHOWING {len(page_runs)} OF {total_runs} RUNS "
                f"FOR {self.profile_nickname} ({len(all_runs)} LOADED)"
            )
        )

    def prev_page(self):
        if self.current_page > 0:
            self.current_page -= 1
            self.update_all_runs_ui()

    def next_page(self):
        self.current_page += 1
        self.update_all_runs_ui()

    def show_recent_searches(self):
        recent = self.data_manager.recents[:5]
        x = self.search_entry.winfo_rootx() - self.winfo_rootx()
        y = self.search_entry.winfo_rooty() - self.winfo_rooty() + self.search_entry.winfo_height() + 6
        self.search_results_frame.place(x=x, y=y)
        self.search_results_frame.lift()

        for widget in self.search_results_frame.winfo_children():
            widget.destroy()

        if not recent:
            ctk.CTkLabel(
                self.search_results_frame,
                text="No recent searches yet.",
                text_color=self.colors["text_dim"],
                anchor="w",
                font=ctk.CTkFont(size=12),
            ).pack(fill="x", padx=16, pady=18)
            return

        for i, name in enumerate(recent):
            row = ctk.CTkFrame(
                self.search_results_frame,
                fg_color="transparent",
                corner_radius=12,
            )
            row.pack(fill="x", padx=10, pady=4)
            ctk.CTkButton(
                row, text=name,
                fg_color="transparent", hover_color=self.colors["accent_soft"],
                text_color=self.colors["text"],
                anchor="w", font=ctk.CTkFont(size=13, weight="bold"),
                height=36,
                command=lambda n=name: self.select_search_result(n),
            ).pack(fill="x", padx=6, pady=3)

        if len(recent) < 5:
            filler = ctk.CTkFrame(self.search_results_frame, fg_color="transparent", height=18)
            filler.pack(fill="x")

    # ------------------------------------------------------------------
    # Search view
    # ------------------------------------------------------------------

    def update_search_ui(self, recos):
        x = self.search_entry.winfo_rootx() - self.winfo_rootx()
        y = self.search_entry.winfo_rooty() - self.winfo_rooty() + self.search_entry.winfo_height() + 6
        self.search_results_frame.place(x=x, y=y)
        self.search_results_frame.lift()

        for widget in self.search_results_frame.winfo_children():
            widget.destroy()

        if not recos:
            ctk.CTkLabel(
                self.search_results_frame,
                text="No players found.",
                text_color=self.colors["text_dim"],
                anchor="w",
                font=ctk.CTkFont(size=12),
            ).pack(fill="x", padx=16, pady=18)
            return

        for i, name in enumerate(recos[:8]):
            row = ctk.CTkFrame(
                self.search_results_frame,
                fg_color="transparent",
                corner_radius=12,
            )
            row.pack(fill="x", padx=10, pady=4)
            ctk.CTkButton(
                row, text=name,
                fg_color="transparent", hover_color=self.colors["accent_soft"],
                text_color=self.colors["accent"],
                anchor="w", font=ctk.CTkFont(size=13, weight="bold"),
                height=38,
                command=lambda n=name: self.select_search_result(n),
            ).pack(fill="x", padx=6, pady=3)

        if len(recos) > 8:
            ctk.CTkLabel(
                self.search_results_frame,
                text=f"+ {len(recos) - 8} more matches",
                text_color=self.colors["text_dim"],
                font=ctk.CTkFont(size=10),
                anchor="w",
            ).pack(fill="x", padx=16, pady=(4, 12))


if __name__ == "__main__":
    app = PaceManApp()
    app.mainloop()
