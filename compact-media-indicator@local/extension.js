/* extension.js
 *
 * Compact Media Indicator — a single panel button driven by MPRIS.
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {MprisManager} from './mpris.js';

// Clutter button numbers.
const BUTTON_LEFT = 1;
const BUTTON_MIDDLE = 2;
const BUTTON_RIGHT = 3;
const BUTTON_BACK = 8;
const BUTTON_FORWARD = 9;

// Status icon names per playback state.
const STATUS_ICONS = {
    'Playing': 'media-playback-start-symbolic',
    'Paused': 'media-playback-pause-symbolic',
    'Stopped': 'media-playback-stop-symbolic',
};
const DEFAULT_ICON = 'audio-x-generic-symbolic';

/* Resolve an MPRIS artUrl to a Gio.Icon, downloading & caching remote URLs.
 * Calls cb(gicon | null). A token guards against stale async results. */
function loadArt(url, cacheDir, cb) {
    if (!url) {
        cb(null);
        return;
    }

    if (url.startsWith('file://')) {
        try {
            cb(new Gio.FileIcon({file: Gio.File.new_for_uri(url)}));
        } catch (e) {
            cb(null);
        }
        return;
    }

    if (!url.startsWith('http')) {
        cb(null);
        return;
    }

    try {
        GLib.mkdir_with_parents(cacheDir, 0o755);
        const name = GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, url, -1);
        const dest = Gio.File.new_for_path(GLib.build_filenamev([cacheDir, name]));

        if (dest.query_exists(null)) {
            cb(new Gio.FileIcon({file: dest}));
            return;
        }

        const src = Gio.File.new_for_uri(url);
        src.load_contents_async(null, (file, res) => {
            try {
                const [, contents] = file.load_contents_finish(res);
                dest.replace_contents(contents, null, false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                cb(new Gio.FileIcon({file: dest}));
            } catch (e) {
                cb(null);
            }
        });
    } catch (e) {
        cb(null);
    }
}

const MediaIndicator = GObject.registerClass(
class MediaIndicator extends PanelMenu.Button {
    _init(extension) {
        // Create the menu (dontCreateMenu = false) so the "Show track info"
        // action has a popup to populate.
        super._init(0.0, 'Compact Media Indicator', false);

        // GNOME 45+ PanelMenu.Button toggles its menu via a Clutter.ClickGesture
        // that is enabled whenever a menu exists. That gesture would swallow our
        // button presses, so we disable it and drive everything from the
        // button-press-event signal (we open the menu ourselves for "show-info").
        this._clickGesture?.set_enabled(false);

        this._extension = extension;
        this._settings = extension.getSettings();
        this._mpris = new MprisManager();
        this._artToken = 0;
        this._lastArtUrl = null;
        this._popupArtToken = 0;
        this._popupArtIcon = null;
        this._cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'compact-media-indicator']);

        this._box = new St.BoxLayout({
            style_class: 'cmi-box',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._statusIcon = new St.Icon({
            style_class: 'system-status-icon cmi-status-icon',
            icon_name: DEFAULT_ICON,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._art = new St.Icon({
            style_class: 'cmi-album-art',
            visible: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._box.add_child(this._statusIcon);
        this._box.add_child(this._art);
        this.add_child(this._box);

        // Dispatch every mouse button ourselves. We use the button-press-event
        // signal (NOT a vfunc_event override): the parent St.Widget has no
        // 'event' vfunc to chain to, and throwing from that virtual handler
        // crashes gnome-shell. The default click gesture is disabled above so
        // button 1 doesn't also toggle the menu.
        this._pressId = this.connect('button-press-event',
            (actor, event) => this._onButtonPress(event));

        this._mprisChangedId = this._mpris.connect('changed', () => this._sync());
        this._settingsChangedId = this._settings.connect('changed', (s, key) => {
            if (key === 'blocklist')
                this._mpris.setBlocklist(this._settings.get_strv('blocklist'));
            else
                this._applyLayout();
        });

        this._mpris.setBlocklist(this._settings.get_strv('blocklist'));
        this._applyLayout();
        this._sync();
    }

    _detectVertical() {
        const setting = this._settings.get_string('layout-orientation');
        if (setting === 'horizontal')
            return false;
        if (setting === 'vertical')
            return true;

        // auto: walk up the actor tree looking for a vertically-oriented
        // container (as used by vertical panels such as Dash to Panel).
        let a = this.container ?? this;
        for (let i = 0; i < 6 && a; i++) {
            const lm = a.layout_manager;
            if (lm instanceof Clutter.BoxLayout &&
                lm.orientation === Clutter.Orientation.VERTICAL)
                return true;
            a = a.get_parent();
        }
        return false;
    }

    _artSize() {
        const configured = this._settings.get_int('album-art-size');
        if (configured > 0)
            return configured;
        // Auto: match the panel thickness (its smaller dimension) so it works
        // for both horizontal and vertical panels without ballooning.
        const w = Main.panel?.width || 0;
        const h = Main.panel?.height || 0;
        const thickness = Math.min(w || h || 24, h || w || 24);
        return Math.max(16, Math.min(64, thickness ? thickness - 4 : 24));
    }

    _applyLayout() {
        const vertical = this._detectVertical();
        // Use the layout manager's orientation; St.BoxLayout.vertical is
        // deprecated and logs a noisy backtrace on every set.
        this._box.layout_manager.orientation = vertical
            ? Clutter.Orientation.VERTICAL
            : Clutter.Orientation.HORIZONTAL;

        // Status icon size (explicit icon-size in the inline style overrides the
        // 16px from the system-status-icon CSS class).
        const iconSize = this._settings.get_int('status-icon-size');
        if (iconSize > 0) {
            this._statusIcon.icon_size = iconSize;
            this._statusIcon.set_style(`icon-size: ${iconSize}px;`);
        } else {
            this._statusIcon.set_style(null);
        }

        const size = this._artSize();
        this._art.icon_size = size;
        this._art.set_style(`min-width: ${size}px; min-height: ${size}px;`);

        // Re-evaluate visibility / art for the new settings.
        this._lastArtUrl = null;
        this._sync();
    }

    _onButtonPress(event) {
        let button;
        try {
            button = event.get_button();
        } catch (e) {
            return Clutter.EVENT_PROPAGATE;
        }
        let key = null;
        switch (button) {
        case BUTTON_LEFT:    key = 'action-left'; break;
        case BUTTON_MIDDLE:  key = 'action-middle'; break;
        case BUTTON_RIGHT:   key = 'action-right'; break;
        case BUTTON_BACK:    key = 'action-back'; break;
        case BUTTON_FORWARD: key = 'action-forward'; break;
        default:
            return Clutter.EVENT_PROPAGATE;
        }

        // Never let an exception escape into Clutter's event machinery.
        try {
            this._runAction(this._settings.get_string(key));
        } catch (e) {
            logError(e, 'CompactMediaIndicator: action failed');
        }
        return Clutter.EVENT_STOP;
    }

    _runAction(action) {
        const seconds = this._settings.get_int('seek-seconds');
        switch (action) {
        case 'play-pause':    this._mpris.playPause(); break;
        case 'next':          this._mpris.next(); break;
        case 'previous':      this._mpris.previous(); break;
        case 'stop':          this._mpris.stop(); break;
        case 'seek-forward':  this._mpris.seek(seconds); break;
        case 'seek-backward': this._mpris.seek(-seconds); break;
        case 'raise':         this._mpris.raise(); break;
        case 'next-player':   this._mpris.cyclePlayer(); break;
        case 'show-info':     this._openPopup(); break;
        case 'none':
        default:
            break;
        }
    }

    _openPopup() {
        this._buildPopupContent();
        this.menu.open(true);
    }

    // Placeholder shown when a source exposes no album art (or it fails to
    // load). A symbolic themed icon keeps it crisp and theme-aware.
    _defaultArtIcon() {
        return new Gio.ThemedIcon({name: 'audio-x-generic-symbolic'});
    }

    // Load the given artUrl into the current popup art icon, guarded by a
    // token so a slow/late load can't overwrite a newer source's art.
    _loadPopupArt(url) {
        const icon = this._popupArtIcon;
        if (!icon)
            return;
        if (!url) {
            icon.gicon = this._defaultArtIcon();
            return;
        }
        const token = ++this._popupArtToken;
        loadArt(url, this._cacheDir, gicon => {
            if (token !== this._popupArtToken || this._popupArtIcon !== icon)
                return; // superseded by a newer build / source
            icon.gicon = gicon ?? this._defaultArtIcon();
        });
    }

    // A small reactive icon button used for controls and the source switcher.
    _iconButton(iconName, onClick, disabled = false) {
        const btn = new St.Button({
            style_class: 'cmi-control-button button',
            child: new St.Icon({icon_name: iconName, icon_size: 18}),
            reactive: !disabled,
            can_focus: !disabled,
            track_hover: !disabled,
        });
        if (disabled)
            btn.add_style_class_name('cmi-control-disabled');
        else
            btn.connect('clicked', () => {
                try {
                    onClick();
                } catch (e) {
                    logError(e, 'CompactMediaIndicator: control failed');
                }
            });
        return btn;
    }

    _switchSource(dir) {
        // Cycling promotes another player to "active"; the manager emits
        // 'changed', which queues a popup refresh (we never rebuild inline,
        // to avoid destroying the button mid-click).
        this._mpris.cyclePlayer(dir);
    }

    _buildPopupContent() {
        this.menu.removeAll();

        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'cmi-popup',
        });
        const root = new St.BoxLayout({vertical: true, style_class: 'cmi-popup-root'});
        item.add_child(root);
        this.menu.addMenuItem(item);

        if (this._mpris.playerCount === 0) {
            root.add_child(new St.Label({text: 'Nothing playing', style_class: 'cmi-info-title'}));
            return;
        }

        const metadata = this._mpris.getMetadata();
        const caps = this._mpris.getCaps();
        const status = this._mpris.getStatus();
        const {count, index} = this._mpris.getPlayerInfo();
        const identity = this._mpris.getIdentity() ?? 'Unknown player';

        // --- Source switcher header ---
        const header = new St.BoxLayout({style_class: 'cmi-popup-header'});
        if (count > 1)
            header.add_child(this._iconButton('go-previous-symbolic', () => this._switchSource(-1)));
        const label = count > 1 ? `${identity}  ·  ${index + 1}/${count}` : identity;
        header.add_child(new St.Label({
            text: label,
            style_class: 'cmi-popup-player',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        if (count > 1)
            header.add_child(this._iconButton('go-next-symbolic', () => this._switchSource(1)));
        root.add_child(header);

        // --- Now playing: art + text ---
        const np = new St.BoxLayout({style_class: 'cmi-info-content'});
        root.add_child(np);

        if (this._settings.get_boolean('show-album-art')) {
            // Start from the default image and load this source's art into it.
            // Loading per-build (rather than reusing the panel icon's gicon)
            // ensures the art always matches the source shown, including after
            // switching sources.
            const artIcon = new St.Icon({
                gicon: this._defaultArtIcon(),
                icon_size: 96,
                style_class: 'cmi-info-art',
            });
            this._popupArtIcon = artIcon;
            np.add_child(artIcon);
            this._loadPopupArt(metadata['mpris:artUrl']);
        }

        const text = new St.BoxLayout({vertical: true, style_class: 'cmi-info-text', x_expand: true});
        np.add_child(text);

        const title = metadata['xesam:title'];
        text.add_child(new St.Label({
            text: title ? String(title) : 'Unknown title',
            style_class: 'cmi-info-title',
        }));
        const artist = metadata['xesam:artist'];
        const artistStr = Array.isArray(artist) ? artist.join(', ') : artist;
        if (artistStr)
            text.add_child(new St.Label({text: String(artistStr), style_class: 'cmi-info-value'}));
        const album = metadata['xesam:album'];
        if (album)
            text.add_child(new St.Label({text: String(album), style_class: 'cmi-info-value'}));

        // --- Transport controls for this source ---
        const controls = new St.BoxLayout({
            style_class: 'cmi-controls',
            x_align: Clutter.ActorAlign.CENTER,
        });
        controls.add_child(this._iconButton('media-skip-backward-symbolic',
            () => this._mpris.previous(), !caps.canGoPrevious));
        controls.add_child(this._iconButton(
            status === 'Playing' ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic',
            () => this._mpris.playPause(), !(caps.canPlay || caps.canPause)));
        controls.add_child(this._iconButton('media-skip-forward-symbolic',
            () => this._mpris.next(), !caps.canGoNext));
        controls.add_child(this._iconButton('media-playback-stop-symbolic',
            () => this._mpris.stop(), !caps.canControl));
        root.add_child(controls);
    }

    // Rebuild the popup on the next idle (deferred so we never destroy a
    // button while we're inside its 'clicked' handler).
    _queuePopupRefresh() {
        if (this._refreshId)
            return;
        this._refreshId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._refreshId = 0;
            if (this.menu.isOpen)
                this._buildPopupContent();
            return GLib.SOURCE_REMOVE;
        });
    }

    _sync() {
        const hasPlayer = this._mpris.playerCount > 0;
        const hideWhenEmpty = this._settings.get_boolean('hide-when-no-player');

        this.visible = hasPlayer || !hideWhenEmpty;

        // Keep an open popup in sync with track/state/source changes.
        if (this.menu?.isOpen)
            this._queuePopupRefresh();

        if (!hasPlayer) {
            this._statusIcon.icon_name = DEFAULT_ICON;
            this._setArtVisible(false);
            return;
        }

        const status = this._mpris.getStatus();
        this._statusIcon.icon_name = STATUS_ICONS[status] ?? DEFAULT_ICON;

        const metadata = this._mpris.getMetadata();
        this._updateArt(metadata['mpris:artUrl']);
    }

    _updateArt(url) {
        const enabled = this._settings.get_boolean('show-album-art');
        if (!enabled || !url) {
            this._setArtVisible(false);
            this._lastArtUrl = null;
            return;
        }

        if (url === this._lastArtUrl && this._art.gicon) {
            this._setArtVisible(true);
            return;
        }
        this._lastArtUrl = url;

        const token = ++this._artToken;
        loadArt(url, this._cacheDir, gicon => {
            if (token !== this._artToken)
                return; // a newer request superseded this one
            if (gicon) {
                this._art.gicon = gicon;
                this._setArtVisible(true);
            } else {
                this._setArtVisible(false);
            }
        });
    }

    _setArtVisible(visible) {
        this._art.visible = visible;
    }

    destroy() {
        if (this._mprisChangedId) {
            this._mpris.disconnect(this._mprisChangedId);
            this._mprisChangedId = 0;
        }
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }
        if (this._refreshId) {
            GLib.source_remove(this._refreshId);
            this._refreshId = 0;
        }
        this._artToken++; // invalidate pending art callbacks
        this._popupArtToken++;
        this._popupArtIcon = null;
        if (this._mpris) {
            this._mpris.destroy();
            this._mpris = null;
        }
        super.destroy();
    }
});

export default class CompactMediaIndicatorExtension extends Extension {
    enable() {
        this._indicator = new MediaIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
