import { MODULE_ID, STORAGE_PREFIX, StatblockSheet, StatblockSheet2014, StatblockSheet2024 } from "./statblock-sheet.mjs";

/**
 * Re-render open stat block sheets, so changed defaults show on NPCs without their own preferences.
 */
function refreshSheets() {
    for (const app of foundry.applications.instances.values()) {
        if (app instanceof StatblockSheet) app.render();
    }
}

Hooks.once("init", () => {
    const documentSheetConfig = foundry.applications.apps.DocumentSheetConfig;

    documentSheetConfig.registerSheet(
        Actor,
        game.system.id,
        StatblockSheet2014,
        {
            types: ["npc"],
            label: "NDSS.SheetNames.2014",
        }
    );

    documentSheetConfig.registerSheet(
        Actor,
        game.system.id,
        StatblockSheet2024,
        {
            types: ["npc"],
            label: "NDSS.SheetNames.2024",
        }
    );

    game.settings.register(MODULE_ID, "showPortrait", {
        name: "NDSS.Settings.ShowPortrait.Name",
        scope: "world",
        config: true,
        default: false,
        type: Boolean,
        onChange: refreshSheets
    });

    game.settings.register(MODULE_ID, "defaultLayout", {
        name: "NDSS.Settings.DefaultLayout.Name",
        scope: "world",
        config: true,
        default: "doubleColumn",
        type: String,
        choices: {
            auto: "NDSS.Settings.DefaultLayout.Auto",
            doubleColumn: "NDSS.Settings.DefaultLayout.DoubleColumn"
        },
        onChange: refreshSheets
    });

    game.settings.register(MODULE_ID, "defaultZoom", {
        name: "NDSS.Settings.DefaultZoom.Name",
        scope: "world",
        config: true,
        default: 130,
        type: Number,
        range: {
            min: 40,
            step: 15,
            max: 250
        },
        onChange: refreshSheets
    });

    game.settings.register(MODULE_ID, "defaultVisibleBiography", {
        name: "NDSS.Settings.DefaultVisibleBiography.Name",
        scope: "world",
        config: true,
        default: false,
        type: Boolean,
        onChange: refreshSheets
    });
});

Hooks.once("ready", async () => {
    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const EXPIRATION_MS = 180 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const lastCleanup = game.user.getFlag(MODULE_ID, "lastCleanupTimestamp") ?? 0;
    if (now - lastCleanup < ONE_WEEK_MS) return;

    // 1. Clean up User Flags, in one update together with the cleanup timestamp
    const allSheetPrefs = game.user.getFlag(MODULE_ID, "sheetPrefs") ?? {};
    const expired = {};
    for (const [actorId, prefs] of Object.entries(allSheetPrefs)) {
        const lastViewed = (prefs && (typeof prefs === "object")) ? (prefs.lastViewed ?? 0) : 0;
        if (!lastViewed || (now - lastViewed) >= EXPIRATION_MS) expired[actorId] = _del;
    }

    // 2. Clean up Client localStorage
    try {
        const prefix = STORAGE_PREFIX;
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith(prefix)) {
                const itemRaw = localStorage.getItem(key);
                if (itemRaw) {
                    try {
                        const parsed = JSON.parse(itemRaw);
                        const lastViewed = parsed?.lastViewed ?? 0;
                        if (!lastViewed || (now - lastViewed) >= EXPIRATION_MS) {
                            keysToRemove.push(key);
                        }
                    } catch (e) {
                        keysToRemove.push(key);
                    }
                }
            }
        }
        for (const k of keysToRemove) {
            localStorage.removeItem(k);
        }
    } catch (e) {
        // Ignore localStorage access errors
    }

    const flagUpdate = { lastCleanupTimestamp: now };
    if (!foundry.utils.isEmpty(expired)) flagUpdate.sheetPrefs = expired;
    await game.user.update({ flags: { [MODULE_ID]: flagUpdate } });
});
