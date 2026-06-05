/* mpris.js
 *
 * Tracks all MPRIS players on the session bus, keeps a "most recently active"
 * ordering, and exposes simple control methods that operate on the active
 * player. Emits 'changed' whenever the active player or its state changes.
 */

import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const MPRIS_PATH = '/org/mpris/MediaPlayer2';

const DBusIface = `<node>
  <interface name="org.freedesktop.DBus">
    <method name="ListNames">
      <arg type="as" direction="out"/>
    </method>
    <signal name="NameOwnerChanged">
      <arg type="s"/>
      <arg type="s"/>
      <arg type="s"/>
    </signal>
  </interface>
</node>`;

const MprisIface = `<node>
  <interface name="org.mpris.MediaPlayer2">
    <method name="Raise"/>
    <method name="Quit"/>
    <property name="CanRaise" type="b" access="read"/>
    <property name="CanQuit" type="b" access="read"/>
    <property name="Identity" type="s" access="read"/>
    <property name="DesktopEntry" type="s" access="read"/>
  </interface>
</node>`;

const MprisPlayerIface = `<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <method name="PlayPause"/>
    <method name="Play"/>
    <method name="Pause"/>
    <method name="Stop"/>
    <method name="Next"/>
    <method name="Previous"/>
    <method name="Seek">
      <arg type="x" direction="in"/>
    </method>
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="CanPlay" type="b" access="read"/>
    <property name="CanPause" type="b" access="read"/>
    <property name="CanGoNext" type="b" access="read"/>
    <property name="CanGoPrevious" type="b" access="read"/>
    <property name="CanSeek" type="b" access="read"/>
    <property name="CanControl" type="b" access="read"/>
  </interface>
</node>`;

const DBusProxy = Gio.DBusProxy.makeProxyWrapper(DBusIface);
const MprisProxy = Gio.DBusProxy.makeProxyWrapper(MprisIface);
const MprisPlayerProxy = Gio.DBusProxy.makeProxyWrapper(MprisPlayerIface);

export const MprisManager = GObject.registerClass({
    Signals: {'changed': {}},
}, class MprisManager extends GObject.Object {
    _init() {
        super._init();
        // busName -> { busName, app, player, order, changedId, ids }
        this._players = new Map();
        this._counter = 0;
        this._destroyed = false;
        this._blocklist = new Set();

        this._dbus = new DBusProxy(
            Gio.DBus.session,
            'org.freedesktop.DBus',
            '/org/freedesktop/DBus',
            (proxy, error) => {
                if (error) {
                    logError(error, 'CompactMediaIndicator: failed to create DBus proxy');
                    return;
                }
                this._ownerChangedId = this._dbus.connectSignal(
                    'NameOwnerChanged',
                    (p, sender, [name, oldOwner, newOwner]) => {
                        if (!name.startsWith(MPRIS_PREFIX))
                            return;
                        if (newOwner && !oldOwner)
                            this._addPlayer(name);
                        else if (!newOwner)
                            this._removePlayer(name);
                    });
                this._scanExisting();
            });
    }

    _scanExisting() {
        this._dbus.ListNamesRemote((result, error) => {
            if (error || this._destroyed)
                return;
            const [names] = result;
            for (const name of names) {
                if (name.startsWith(MPRIS_PREFIX))
                    this._addPlayer(name);
            }
        });
    }

    _addPlayer(busName) {
        if (this._destroyed || this._players.has(busName))
            return;

        // Reserve the slot immediately so concurrent NameOwnerChanged /
        // ListNames callbacks don't create duplicates.
        const entry = {busName, app: null, player: null, order: 0, changedId: 0};
        this._players.set(busName, entry);

        const onReady = () => {
            if (this._destroyed || !this._players.has(busName))
                return;
            if (!entry.app || !entry.player)
                return; // wait for both proxies

            entry.ids = this._computeIds(busName, entry.app);
            entry.order = ++this._counter;
            entry.changedId = entry.player.connect('g-properties-changed', (p, changed) => {
                const props = changed.deepUnpack();
                if ('PlaybackStatus' in props || 'Metadata' in props)
                    entry.order = ++this._counter;
                this.emit('changed');
            });
            this.emit('changed');
        };

        new MprisProxy(Gio.DBus.session, busName, MPRIS_PATH, (proxy, error) => {
            if (error) {
                this._players.delete(busName);
                return;
            }
            entry.app = proxy;
            onReady();
        });

        new MprisPlayerProxy(Gio.DBus.session, busName, MPRIS_PATH, (proxy, error) => {
            if (error) {
                this._players.delete(busName);
                return;
            }
            entry.player = proxy;
            onReady();
        });
    }

    _removePlayer(busName) {
        const entry = this._players.get(busName);
        if (!entry)
            return;
        if (entry.changedId && entry.player)
            entry.player.disconnect(entry.changedId);
        this._players.delete(busName);
        this.emit('changed');
    }

    /** Lower-cased identifiers a blocklist entry can match against. */
    _computeIds(busName, app) {
        const remainder = busName.slice(MPRIS_PREFIX.length);
        const busId = remainder.split('.')[0]; // strip instance suffixes
        let desktop = '';
        let identity = '';
        try {
            desktop = app.DesktopEntry || '';
        } catch (e) { /* optional */ }
        try {
            identity = app.Identity || '';
        } catch (e) { /* optional */ }
        return [busId, desktop, identity]
            .filter(Boolean)
            .map(s => String(s).toLowerCase());
    }

    /** Replace the blocklist (array of names) and re-evaluate sources. */
    setBlocklist(list) {
        this._blocklist = new Set((list || []).map(s => String(s).toLowerCase()));
        this.emit('changed');
    }

    _isBlocked(entry) {
        if (!entry.ids || this._blocklist.size === 0)
            return false;
        // Fuzzy: a player is blocked when any blocklist term is a substring of
        // one of its identifiers, or vice versa (all lower-cased already).
        for (const id of entry.ids) {
            if (!id)
                continue;
            for (const term of this._blocklist) {
                if (term && (id.includes(term) || term.includes(id)))
                    return true;
            }
        }
        return false;
    }

    /** True if the entry is ready and not blocked. */
    _isEligible(entry) {
        return !!(entry.app && entry.player) && !this._isBlocked(entry);
    }

    /** The currently active player entry (most recently active), or null. */
    getActive() {
        let best = null;
        for (const entry of this._players.values()) {
            if (!this._isEligible(entry))
                continue;
            if (!best || entry.order > best.order)
                best = entry;
        }
        return best;
    }

    get playerCount() {
        let n = 0;
        for (const entry of this._players.values()) {
            if (this._isEligible(entry))
                n++;
        }
        return n;
    }

    /** Playback status string of the active player: Playing/Paused/Stopped. */
    getStatus() {
        const a = this.getActive();
        if (!a)
            return null;
        try {
            return a.player.PlaybackStatus;
        } catch (e) {
            return null;
        }
    }

    /** Metadata of the active player as a plain JS object (fully unpacked). */
    getMetadata() {
        const a = this.getActive();
        if (!a)
            return {};
        try {
            const v = a.player.get_cached_property('Metadata');
            return v ? v.recursiveUnpack() : {};
        } catch (e) {
            return {};
        }
    }

    getIdentity() {
        const a = this.getActive();
        if (!a)
            return null;
        try {
            return a.app.Identity;
        } catch (e) {
            return null;
        }
    }

    /** Capabilities of the active player (all default to false). */
    getCaps() {
        const caps = {
            canGoNext: false,
            canGoPrevious: false,
            canPlay: false,
            canPause: false,
            canControl: false,
            canSeek: false,
        };
        const a = this.getActive();
        if (!a)
            return caps;
        try {
            caps.canGoNext = !!a.player.CanGoNext;
            caps.canGoPrevious = !!a.player.CanGoPrevious;
            caps.canPlay = !!a.player.CanPlay;
            caps.canPause = !!a.player.CanPause;
            caps.canControl = !!a.player.CanControl;
            caps.canSeek = !!a.player.CanSeek;
        } catch (e) {
            // leave defaults
        }
        return caps;
    }

    /** Stable ordered list of eligible (ready, non-blocked) bus names. */
    _readyNames() {
        return [...this._players.keys()]
            .filter(n => this._isEligible(this._players.get(n)))
            .sort();
    }

    /** {count, index} of the active player within the stable ordering. */
    getPlayerInfo() {
        const names = this._readyNames();
        const active = this.getActive();
        const index = active ? names.indexOf(active.busName) : -1;
        return {count: names.length, index};
    }

    // --- Controls (operate on the active player) -------------------------

    _withPlayer(fn) {
        const a = this.getActive();
        if (a && a.player)
            fn(a);
    }

    playPause() {
        this._withPlayer(a => {
            try {
                a.player.PlayPauseRemote();
            } catch (e) {
                logError(e);
            }
        });
    }

    next() {
        this._withPlayer(a => {
            try {
                a.player.NextRemote();
            } catch (e) {
                logError(e);
            }
        });
    }

    previous() {
        this._withPlayer(a => {
            try {
                a.player.PreviousRemote();
            } catch (e) {
                logError(e);
            }
        });
    }

    stop() {
        this._withPlayer(a => {
            try {
                a.player.StopRemote();
            } catch (e) {
                logError(e);
            }
        });
    }

    /** Seek by a relative number of seconds (may be negative). */
    seek(seconds) {
        this._withPlayer(a => {
            try {
                a.player.SeekRemote(Math.round(seconds * 1000000));
            } catch (e) {
                logError(e);
            }
        });
    }

    raise() {
        this._withPlayer(a => {
            try {
                a.app.RaiseRemote();
            } catch (e) {
                logError(e);
            }
        });
    }

    /** Promote the next (dir=1) or previous (dir=-1) player to active. */
    cyclePlayer(dir = 1) {
        const names = this._readyNames();
        if (names.length <= 1)
            return;
        const active = this.getActive();
        const idx = active ? names.indexOf(active.busName) : 0;
        const step = dir < 0 ? -1 : 1;
        const next = names[(idx + step + names.length) % names.length];
        this._players.get(next).order = ++this._counter;
        this.emit('changed');
    }

    destroy() {
        this._destroyed = true;
        for (const entry of this._players.values()) {
            if (entry.changedId && entry.player)
                entry.player.disconnect(entry.changedId);
        }
        this._players.clear();
        if (this._ownerChangedId && this._dbus) {
            this._dbus.disconnectSignal(this._ownerChangedId);
            this._ownerChangedId = 0;
        }
        this._dbus = null;
    }
});
