# Compact Media Indicator

A minimal GNOME Shell extension: a **single panel icon** that talks to the
**MPRIS** D-Bus protocol. The icon reflects the current playback state and,
when the player provides it, shows the current **album art** right next to it.
Every mouse button is configurable, and the layout adapts to horizontal or
vertical panels.

Built for **GNOME Shell 45–50** (the modern ESM extension API). Tested target:
GNOME Shell 50 on Wayland.

---

## Table of contents

- [What it does](#what-it-does)
- [How it works (MPRIS)](#how-it-works-mpris)
- [Installing](#installing)
- [Configuration](#configuration)
- [Project layout](#project-layout)
- [Architecture](#architecture)
- [Troubleshooting](#troubleshooting)
- [Makefile reference](#makefile-reference)

---

## What it does

- **Status icon that follows playback.** The icon changes with the active
  player's state:
  - Playing → `media-playback-start-symbolic`
  - Paused → `media-playback-pause-symbolic`
  - Stopped → `media-playback-stop-symbolic`
  - No player / unknown → `audio-x-generic-symbolic`
- **Album art beside the icon, whenever available.**
  - `file://` cover art is used directly.
  - `http(s)://` cover art (e.g. Spotify) is downloaded once and cached under
    `~/.cache/compact-media-indicator`, then reused.
  - Art is sized to the panel automatically, or to a fixed pixel size you set.
- **Follows the most-recently-active player automatically.** When several MPRIS
  players are running (Spotify, a browser tab, a video player…), the indicator
  tracks whichever one most recently changed playback state or track. Bind any
  button to **Switch to next player** to cycle the source manually.
- **Every mouse button is configurable.** Left, middle, right, **back (button 8)**
  and **forward (button 9)** can each be bound to one of:
  Play/Pause, Next, Previous, Stop, Seek forward, Seek backward,
  Raise/focus the player, Switch to next player, **Show media popup**, or
  Do nothing. The media popup shows the album art, song title, artist and
  album, a **source switcher** (◀ / ▶) to move between players when more than
  one is active, and **transport controls** (previous / play-pause / next /
  stop) for the selected source. Controls auto-disable when the player reports
  it can't perform them, and the popup updates live as the track or source
  changes.
- **Horizontal & vertical panels.** In a horizontal panel the album art sits to
  the **right** of the status icon; in a vertical panel it sits **below** it.
  This is auto-detected, and can be forced in preferences.
- **Blocklist.** Exclude specific players (e.g. a browser) so they never show up
  as a source — block detected players with one click or add names manually.

### Default button mapping

| Button            | Default action |
|-------------------|----------------|
| Left click        | Play / Pause   |
| Middle click      | Previous track |
| Right click       | Next track     |
| Back (button 8)   | Seek backward  |
| Forward (button 9)| Seek forward   |

All of these are changeable in **Mouse Actions** preferences.

---

## How it works (MPRIS)

[MPRIS](https://specifications.freedesktop.org/mpris-spec/latest/) (Media Player
Remote Interfacing Specification) is a D-Bus standard that media players
implement so other apps can observe and control them. Each player claims a bus
name like `org.mpris.MediaPlayer2.spotify` on the **session bus** and exposes two
interfaces at the object path `/org/mpris/MediaPlayer2`:

- `org.mpris.MediaPlayer2` — app-level: `Raise`, `Quit`, `Identity`, …
- `org.mpris.MediaPlayer2.Player` — playback: `PlayPause`, `Next`, `Previous`,
  `Stop`, `Seek`, plus the `PlaybackStatus` and `Metadata` properties.

`Metadata` is a dictionary; the keys this extension reads are:

- `mpris:artUrl` — cover art URL (`file://` or `http(s)://`)
- `xesam:title`, `xesam:artist`, `xesam:album` — track info

The extension discovers players by listing bus names and watching
`NameOwnerChanged`, then subscribes to each player's `PropertiesChanged` signal
to react to state and track changes in real time.

---

## Installing

You need the GNOME Shell developer basics (`glib-compile-schemas`, `make`,
`gnome-extensions`), which are present on a standard GNOME desktop.

```bash
cd compact-media-indicator
make install          # compiles the schema and copies into your extensions dir
make enable           # enables the extension
```

> **Wayland note:** GNOME on Wayland cannot hot-reload extension code. After
> `make install` you must **log out and log back in** for the shell to load the
> new code. (The old `Alt+F2` → `r` reload only works on X11.) Re-running
> `make install` after edits also requires a fresh login to take effect.

Open the settings window at any time:

```bash
make prefs            # == gnome-extensions prefs compact-media-indicator@local
```

To remove it:

```bash
make disable
make uninstall
```

### Distributable zip

```bash
make pack             # produces compact-media-indicator@local.zip
gnome-extensions install --force compact-media-indicator@local.zip
```

---

## Configuration

Open with `make prefs` or via the Extensions / Extension Manager app. Settings
are stored in GSettings and applied live (no reload needed for preference
changes — only code changes need a re-login).

### Appearance

| Setting | Description | Default |
|---|---|---|
| **Orientation** | `Auto-detect`, `Horizontal` (art to the right), or `Vertical` (art below). | Auto-detect |
| **Status icon size** | Size of the playback-state icon in pixels; `0` = panel default. | 22 |
| **Show album art** | Toggle the cover preview on/off. | On |
| **Album art size** | Size in pixels; `0` means match the panel thickness. | 0 (auto) |
| **Hide when no player** | Remove the indicator from the panel when nothing is playing. | On |

### Mouse Actions

| Setting | Description | Default |
|---|---|---|
| **Left / Middle / Right / Back / Forward** | The action bound to each button (incl. *Show media popup*). | see table above |
| **Seek amount** | Seconds skipped by the Seek forward/backward actions. | 5 |

### Blocklist

Exclude players you never want to control from the indicator — they won't
appear as a source or in the popup's source switcher.

- **Detected players** lists everything currently exposing MPRIS; click **Block**
  to add it (use the ↻ button to rescan).
- **Add manually** lets you type a name for players that aren't running yet.
- Entries are matched **fuzzily** (case-insensitive substring, either
  direction) against a player's bus id (e.g. `firefox`), desktop entry, or
  identity (e.g. `Spotify`) — so `chr`, `Chrome`, or `Google` all block Chrome.
- Remove an entry with the trash button to un-block it.

---

## Project layout

```
compact-media-indicator/
├── Makefile                          # build / install / pack targets
├── README.md
└── compact-media-indicator@local/    # the extension itself (UUID-named)
    ├── metadata.json                 # UUID, name, supported shell versions, schema id
    ├── extension.js                  # panel button: layout, click dispatch, art loading
    ├── mpris.js                      # MprisManager: D-Bus discovery & controls
    ├── prefs.js                      # Adwaita preferences window
    ├── stylesheet.css                # spacing + rounded art corners
    └── schemas/
        └── org.gnome.shell.extensions.compact-media-indicator.gschema.xml
```

The directory name **must** equal the UUID (`compact-media-indicator@local`)
for GNOME to load it — that's why it's nested.

---

## Architecture

**`mpris.js` — `MprisManager`** (a `GObject` emitting a single `changed` signal):
- Wraps the freedesktop D-Bus interface to **list** existing MPRIS names and
  watch `NameOwnerChanged` for players appearing/disappearing.
- For each player it creates two `Gio.DBusProxy` wrappers (app + player
  interfaces) and connects to `g-properties-changed`.
- Maintains a monotonically increasing **activity counter**; a player's order is
  bumped whenever its `PlaybackStatus` or `Metadata` changes, so `getActive()`
  returns the **most recently active** player.
- Exposes control methods that act on the active player: `playPause`, `next`,
  `previous`, `stop`, `seek(seconds)`, `raise`, and `cyclePlayer()` to manually
  rotate the active source.

**`extension.js` — `MediaIndicator`** (a `PanelMenu.Button`):
- Holds a `St.BoxLayout` containing the status `St.Icon` and the album-art
  `St.Icon`. The box's `vertical` flag flips the art to the right or below.
- Overrides `vfunc_event` to intercept **all** button presses (the panel menu is
  never used), mapping each button to its configured action.
- Listens to the manager's `changed` signal to update the icon and art, and to
  the settings' `changed` signal to re-apply layout/size.
- `loadArt()` resolves the `mpris:artUrl` to a `Gio.Icon`, downloading and
  caching remote URLs; a token guards against stale async results when tracks
  change quickly.

**`prefs.js` — `CompactMediaIndicatorPrefs`**: an `Adw.PreferencesWindow` with an
Appearance page and a Mouse Actions page, binding rows to GSettings.

**Orientation auto-detect:** in `auto` mode the indicator walks up its actor
parents looking for a vertically-oriented container (as used by vertical panels
such as Dash to Panel) and lays the art out accordingly. If detection is ever
wrong for your setup, force `Horizontal`/`Vertical` in preferences.

---

## Troubleshooting

- **Nothing appears in the panel.** Make sure a media player with MPRIS support
  is running, or turn off *Hide when no player*. Confirm the extension is
  enabled: `gnome-extensions info compact-media-indicator@local`.
- **Changes to the code don't show up.** On Wayland you must log out/in after
  `make install`. Preference changes apply live; code changes do not.
- **Back/forward buttons do nothing.** Buttons 8/9 depend on your mouse and
  libinput mapping. Verify they're delivered as button 8/9 (e.g. with
  `xev`/`wev` or `libinput debug-events`).
- **Remote album art doesn't load.** `http(s)://` art is fetched through GVfs.
  If a player's art never appears, check the shell log for the failed download.
- **Watch the logs:**
  ```bash
  journalctl -f -o cat /usr/bin/gnome-shell    # extension.js runtime
  journalctl -f -o cat /usr/bin/gjs             # prefs.js runtime
  ```

---

## Makefile reference

| Target | What it does |
|---|---|
| `make` / `make schemas` | Compile the GSettings schema in the source tree. |
| `make install` | Compile the schema and install into `~/.local/share/gnome-shell/extensions/`. |
| `make uninstall` | Remove the installed copy. |
| `make enable` / `make disable` | Enable/disable the extension. |
| `make prefs` | Open the preferences window. |
| `make pack` | Build `compact-media-indicator@local.zip` for distribution. |
| `make check` | Quick JS syntax check (needs `node`; optional). |
| `make clean` | Remove the compiled schema and the zip. |
