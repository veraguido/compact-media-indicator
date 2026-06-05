/* prefs.js — Adwaita preferences for Compact Media Indicator. */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';

/* List MPRIS players currently on the session bus, resolving each one's
 * Identity. Calls cb([{busName, busId, identity}, ...]). */
function listMprisPlayers(cb) {
    const bus = Gio.DBus.session;
    bus.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
        'ListNames', null, new GLib.VariantType('(as)'),
        Gio.DBusCallFlags.NONE, -1, null, (o, res) => {
            let names = [];
            try {
                [names] = bus.call_finish(res).deepUnpack();
            } catch (e) {
                cb([]);
                return;
            }
            const players = names.filter(n => n.startsWith(MPRIS_PREFIX));
            if (players.length === 0) {
                cb([]);
                return;
            }
            const results = [];
            let pending = players.length;
            for (const name of players) {
                const busId = name.slice(MPRIS_PREFIX.length).split('.')[0];
                bus.call(name, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties',
                    'Get', new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2', 'Identity']),
                    new GLib.VariantType('(v)'), Gio.DBusCallFlags.NONE, -1, null, (o2, res2) => {
                        let identity = '';
                        try {
                            const [v] = bus.call_finish(res2).deepUnpack();
                            identity = v.deepUnpack();
                        } catch (e) { /* fall back to busId */ }
                        results.push({busName: name, busId, identity: identity || busId});
                        if (--pending === 0) {
                            results.sort((a, b) => a.identity.localeCompare(b.identity));
                            cb(results);
                        }
                    });
            }
        });
}

// Order here must match the enum nicks used in the gschema and extension.js.
const ACTIONS = [
    {id: 'none',          label: 'Do nothing'},
    {id: 'play-pause',    label: 'Play / Pause'},
    {id: 'next',          label: 'Next track'},
    {id: 'previous',      label: 'Previous track'},
    {id: 'stop',          label: 'Stop'},
    {id: 'seek-forward',  label: 'Seek forward'},
    {id: 'seek-backward', label: 'Seek backward'},
    {id: 'raise',         label: 'Raise / focus player'},
    {id: 'next-player',   label: 'Switch to next player'},
    {id: 'show-info',     label: 'Show media popup (info + controls)'},
];

const ORIENTATIONS = [
    {id: 'auto',       label: 'Auto-detect'},
    {id: 'horizontal', label: 'Horizontal (art to the right)'},
    {id: 'vertical',   label: 'Vertical (art below)'},
];

function makeStringList(items) {
    const list = new Gtk.StringList();
    for (const item of items)
        list.append(item.label);
    return list;
}

/* Bind an Adw.ComboRow to an enum-backed string setting. */
function bindCombo(settings, key, row, items) {
    const indexOfId = id => Math.max(0, items.findIndex(i => i.id === id));
    row.set_selected(indexOfId(settings.get_string(key)));
    row.connect('notify::selected', () => {
        const sel = items[row.get_selected()];
        if (sel)
            settings.set_string(key, sel.id);
    });
}

function comboRow(title, subtitle, items) {
    return new Adw.ComboRow({
        title,
        subtitle: subtitle ?? '',
        model: makeStringList(items),
    });
}

export default class CompactMediaIndicatorPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // --- Appearance page --------------------------------------------
        const appearance = new Adw.PreferencesPage({
            title: 'Appearance',
            icon_name: 'preferences-desktop-display-symbolic',
        });
        window.add(appearance);

        const layoutGroup = new Adw.PreferencesGroup({title: 'Layout'});
        appearance.add(layoutGroup);

        const orientationRow = comboRow('Orientation',
            'How the album art is placed relative to the status icon', ORIENTATIONS);
        bindCombo(settings, 'layout-orientation', orientationRow, ORIENTATIONS);
        layoutGroup.add(orientationRow);

        const iconGroup = new Adw.PreferencesGroup({title: 'Status icon'});
        appearance.add(iconGroup);

        const iconSizeRow = new Adw.SpinRow({
            title: 'Status icon size',
            subtitle: 'Pixels (0 = panel default)',
            adjustment: new Gtk.Adjustment({lower: 0, upper: 64, step_increment: 1, page_increment: 4}),
        });
        settings.bind('status-icon-size', iconSizeRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        iconGroup.add(iconSizeRow);

        const artGroup = new Adw.PreferencesGroup({title: 'Album art'});
        appearance.add(artGroup);

        const showArtRow = new Adw.SwitchRow({
            title: 'Show album art',
            subtitle: 'Display the cover next to the status icon when available',
        });
        settings.bind('show-album-art', showArtRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        artGroup.add(showArtRow);

        const artSizeRow = new Adw.SpinRow({
            title: 'Album art size',
            subtitle: 'Pixels (0 = match the panel size)',
            adjustment: new Gtk.Adjustment({lower: 0, upper: 256, step_increment: 1, page_increment: 8}),
        });
        settings.bind('album-art-size', artSizeRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        artGroup.add(artSizeRow);

        const behaviorGroup = new Adw.PreferencesGroup({title: 'Behavior'});
        appearance.add(behaviorGroup);

        const hideRow = new Adw.SwitchRow({
            title: 'Hide when no player',
            subtitle: 'Remove the indicator from the panel when nothing is playing',
        });
        settings.bind('hide-when-no-player', hideRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        behaviorGroup.add(hideRow);

        // --- Mouse actions page -----------------------------------------
        const actionsPage = new Adw.PreferencesPage({
            title: 'Mouse Actions',
            icon_name: 'input-mouse-symbolic',
        });
        window.add(actionsPage);

        const buttonsGroup = new Adw.PreferencesGroup({
            title: 'Button bindings',
            description: 'Choose what each mouse button does on the indicator',
        });
        actionsPage.add(buttonsGroup);

        const buttons = [
            {key: 'action-left',    title: 'Left click'},
            {key: 'action-middle',  title: 'Middle click'},
            {key: 'action-right',   title: 'Right click'},
            {key: 'action-back',    title: 'Back button'},
            {key: 'action-forward', title: 'Forward button'},
        ];
        for (const b of buttons) {
            const row = comboRow(b.title, null, ACTIONS);
            bindCombo(settings, b.key, row, ACTIONS);
            buttonsGroup.add(row);
        }

        const seekGroup = new Adw.PreferencesGroup({title: 'Seeking'});
        actionsPage.add(seekGroup);

        const seekRow = new Adw.SpinRow({
            title: 'Seek amount',
            subtitle: 'Seconds to skip for seek actions',
            adjustment: new Gtk.Adjustment({lower: 1, upper: 120, step_increment: 1, page_increment: 5}),
        });
        settings.bind('seek-seconds', seekRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        seekGroup.add(seekRow);

        // --- Blocklist page ---------------------------------------------
        this._buildBlocklistPage(window, settings);
    }

    _buildBlocklistPage(window, settings) {
        const page = new Adw.PreferencesPage({
            title: 'Blocklist',
            icon_name: 'action-unavailable-symbolic',
        });
        window.add(page);

        const blockedGroup = new Adw.PreferencesGroup({
            title: 'Blocked players',
            description: 'These players never appear as a source in the indicator.',
        });
        page.add(blockedGroup);

        const addGroup = new Adw.PreferencesGroup({title: 'Add manually'});
        page.add(addGroup);
        const entryRow = new Adw.EntryRow({
            title: 'Player name (e.g. Spotify, firefox)',
            show_apply_button: true,
        });
        addGroup.add(entryRow);

        const detectedGroup = new Adw.PreferencesGroup({
            title: 'Detected players',
            description: 'Players currently running — click to block.',
        });
        page.add(detectedGroup);

        const norm = s => String(s).toLowerCase().trim();
        const getList = () => settings.get_strv('blocklist');
        const inList = name => getList().some(e => norm(e) === norm(name));
        // Fuzzy check mirroring the manager: does any blocklist term overlap
        // (as a substring, either direction) this player's identity or bus id?
        const fuzzyBlocked = p => {
            const ids = [norm(p.identity), norm(p.busId)].filter(Boolean);
            return getList().some(e => {
                const t = norm(e);
                return t && ids.some(id => id.includes(t) || t.includes(id));
            });
        };
        const addToList = name => {
            name = String(name).trim();
            if (!name || inList(name))
                return;
            settings.set_strv('blocklist', [...getList(), name]);
        };
        const removeFromList = name =>
            settings.set_strv('blocklist', getList().filter(e => norm(e) !== norm(name)));

        let blockedRows = [];
        let detectedRows = [];

        const refreshBlocked = () => {
            blockedRows.forEach(r => blockedGroup.remove(r));
            blockedRows = [];
            const list = getList();
            if (list.length === 0) {
                const row = new Adw.ActionRow({title: 'Nothing blocked', sensitive: false});
                blockedGroup.add(row);
                blockedRows.push(row);
                return;
            }
            for (const name of list) {
                const row = new Adw.ActionRow({title: name});
                const btn = new Gtk.Button({
                    icon_name: 'user-trash-symbolic',
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat'],
                    tooltip_text: 'Remove',
                });
                btn.connect('clicked', () => {
                    removeFromList(name);
                    refreshAll();
                });
                row.add_suffix(btn);
                blockedGroup.add(row);
                blockedRows.push(row);
            }
        };

        const refreshDetected = () => {
            detectedRows.forEach(r => detectedGroup.remove(r));
            detectedRows = [];
            listMprisPlayers(players => {
                try {
                    detectedRows.forEach(r => detectedGroup.remove(r));
                    detectedRows = [];
                    if (players.length === 0) {
                        const row = new Adw.ActionRow({title: 'No players running', sensitive: false});
                        detectedGroup.add(row);
                        detectedRows.push(row);
                        return;
                    }
                    for (const p of players) {
                        const row = new Adw.ActionRow({title: p.identity, subtitle: p.busId});
                        const blocked = fuzzyBlocked(p);
                        const btn = new Gtk.Button({
                            label: blocked ? 'Blocked' : 'Block',
                            valign: Gtk.Align.CENTER,
                            sensitive: !blocked,
                            css_classes: ['flat'],
                        });
                        btn.connect('clicked', () => {
                            addToList(p.identity || p.busId);
                            refreshAll();
                        });
                        row.add_suffix(btn);
                        detectedGroup.add(row);
                        detectedRows.push(row);
                    }
                } catch (e) {
                    // Window may have been closed mid-query; ignore.
                }
            });
        };

        const refreshAll = () => {
            refreshBlocked();
            refreshDetected();
        };

        const rescanBtn = new Gtk.Button({
            icon_name: 'view-refresh-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
            tooltip_text: 'Rescan',
        });
        rescanBtn.connect('clicked', () => refreshDetected());
        detectedGroup.set_header_suffix(rescanBtn);

        entryRow.connect('apply', () => {
            addToList(entryRow.get_text());
            entryRow.set_text('');
            refreshAll();
        });

        refreshAll();
    }
}
