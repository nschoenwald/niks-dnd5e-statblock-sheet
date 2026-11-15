export const MODULE_ID = "niks-dnd5e-statblock-sheet";

/** Prefix of the localStorage keys holding sheet preferences: `<prefix><userId>.<actorId>`. */
export const STORAGE_PREFIX = `${MODULE_ID}.sheetPrefs.`;

/** Zoom limits and step of the zoom buttons. */
const ZOOM = { min: 0.4, max: 2.5, step: 0.15 };

const TextEditor = foundry.applications.ux.TextEditor.implementation;

/**
 * Wrap each "<label> <bonus>" entry of a stat block list (e.g. "Animal Handling +5, Perception +3") whose label is
 * known. Labels are matched in full and case-insensitively, longest first, so multi-word and non-ASCII labels work.
 * @param {string} html                          The list's HTML.
 * @param {Map<string, string>} keys             Keys by lowercase label.
 * @param {(text: string, key: string) => string} wrap  Returns the replacement for a matched entry.
 * @returns {string}
 */
function linkLabeledBonuses(html, keys, wrap) {
    const labels = Array.from(keys.keys()).sort((a, b) => b.length - a.length).map(l => RegExp.escape(l));
    if (!labels.length) return html;
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${labels.join("|")})\\s*[+\\-\\u2212]\\s*\\d+`, "giu");
    return html.replace(pattern, (text, label) => {
        const key = keys.get(label.toLowerCase());
        return key ? wrap(text, key) : text;
    });
}

export class StatblockSheet extends dnd5e.applications.actor.NPCActorSheet {

    rulesVersion;
    baseActor;

    /**
     * The sheet mode of the previous render, used to detect switching back to view mode.
     * @type {number|undefined}
     */
    #lastRenderedMode;
    
    constructor(options={}) {
        super(options);
        // Unlinked token actors share their preferences with the world actor they were created from.
        this.baseActor = this.actor.token?.baseActor ?? this.actor;
    }

    /** @inheritdoc */
    static DEFAULT_OPTIONS = {
        classes: ["actor", "standard-form", "dnd5e2", "niks-statblock-sheet"],
        actions: {
            use: StatblockSheet._onUseItem,
            toggleDoubleColumn: StatblockSheet._toggleDoubleColumn,
            toggleBiography: StatblockSheet._toggleBiography,
            togglePortrait: StatblockSheet._togglePortrait,
            zoomIn: StatblockSheet._zoomIn,
            zoomOut: StatblockSheet._zoomOut,
            zoomReset: StatblockSheet._zoomReset
        }
    };

    /** @inheritdoc */
    static PARTS = {
        ...super.PARTS,
        statblock: {
            container: { classes: ["main-content"], id: "main" },
            template: "systems/dnd5e/templates/actors/embeds/npc-embed.hbs"
        },
        biographyView: {
            container: { classes: ["main-content"], id: "main" },
            template: `modules/${MODULE_ID}/templates/biography.hbs`
        },
        portrait: {
            template: `modules/${MODULE_ID}/templates/portrait.hbs`
        }
    };

    /**
     * Key of this actor's preferences in localStorage. Includes the user, so users sharing a browser keep their own.
     * @type {string}
     */
    get #storageKey() {
        return `${STORAGE_PREFIX}${game.user.id}.${this.baseActor.id}`;
    }

    /**
     * Retrieve saved sheet preferences for this actor.
     * Two copies exist: localStorage (available right after a write) and the user flag (synced from the user's other
     * browsers). The newer one wins, by `lastViewed`, which every save updates.
     * @returns {Object}
     */
    _getPreferences() {
        let local = null;
        try {
            local = JSON.parse(localStorage.getItem(this.#storageKey) ?? "null");
        } catch (e) {}
        const synced = game.user.getFlag(MODULE_ID, `sheetPrefs.${this.baseActor.id}`) ?? null;
        if ( local && ((local.lastViewed ?? 0) >= (synced?.lastViewed ?? 0)) ) return local;
        return synced ?? local ?? {};
    }

    /**
     * Update sheet preferences for this actor in localStorage and the user flag.
     * @param {Object} updates  Changed values. `null` removes the saved value, so the default applies again.
     */
    async _updatePreferences(updates) {
        const prefs = { ...this._getPreferences(), ...updates, lastViewed: Date.now() };
        const flagUpdate = { ...updates, lastViewed: prefs.lastViewed };
        for ( const [key, value] of Object.entries(updates) ) {
            if ( value !== null ) continue;
            delete prefs[key];
            flagUpdate[key] = _del;
        }
        try {
            localStorage.setItem(this.#storageKey, JSON.stringify(prefs));
        } catch (e) {}
        return game.user.update({ flags: { [MODULE_ID]: { sheetPrefs: { [this.baseActor.id]: flagUpdate } } } });
    }

    /** @inheritDoc */
    async _onFirstRender(context, options) {
        await super._onFirstRender(context, options);
        // Mark the preferences as recently used, so the cleanup in `ready` keeps them.
        if ( !foundry.utils.isEmpty(this._getPreferences()) ) this._updatePreferences({});
    }

    /** @inheritdoc */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        // Limited actors use dnd5e's limited view.
        if ( this.actor.limited ) return context;
        Object.assign(context, {
            ...await this.actor.system._prepareEmbedContext(this.rulesVersion),
            name: this.actor.name
        });
        context.biography = await this._prepareBiographyContext(context, { rollData: context.rollData });
        const defaultSettings = {
            doubleColumn: game.settings.get(MODULE_ID, "defaultLayout") === "doubleColumn",
            visibleBiography: game.settings.get(MODULE_ID, "defaultVisibleBiography"),
            zoom: game.settings.get(MODULE_ID, "defaultZoom") / 100,
            showPortrait: game.settings.get(MODULE_ID, "showPortrait")
        };
        const savedPrefs = this._getPreferences();
        context.sheetPrefs = { ...defaultSettings, ...savedPrefs };
        return context;
    }

    /** @inheritDoc */
    _configureRenderOptions(options) {
        super._configureRenderOptions(options);
        // Saved sizes belong to view mode. Apply them only when the sheet opens or switches back to view mode,
        // so re-renders in edit mode (e.g. after changing a field) keep the size the user set while editing.
        const { MODES } = this.constructor;
        const enteredPlayMode = (this._mode === MODES.PLAY) && (this.#lastRenderedMode !== MODES.PLAY);
        this.#lastRenderedMode = this._mode;
        if ( !options.isFirstRender && !enteredPlayMode ) return;
        const { width, height } = this._getPreferences();
        options.position = options.position ?? {};
        if ( width ) options.position.width = width;
        if ( height ) options.position.height = height;
    }

    /** @inheritdoc */
    _configureRenderParts(options) {
        let parts = super._configureRenderParts(options);
        // Limited actors only get dnd5e's limited parts (header and biography); show them as they are.
        if (this.actor.limited) return parts;
        if (this._mode === this.constructor.MODES.EDIT) {
            if (parts.statblock) {
                parts.statblock.classes ??= [];
                parts.statblock.classes.push("hidden");
            }
            if (parts.biographyView) {
                parts.biographyView.classes ??= [];
                parts.biographyView.classes.push("hidden");
            }
            if (parts.portrait) {
                parts.portrait.classes ??= [];
                parts.portrait.classes.push("hidden");
            }
        } else {
            Object.keys(parts).filter(p => !["statblock", "biographyView", "portrait"].includes(p)).forEach(p => {
                parts[p].classes ??= [];
                parts[p].classes.push("hidden");
            });
        }
        return parts;
    }

    /** @inheritDoc */
    async _onRender(context, options) {
        await super._onRender(context, options);
        if (this.actor.limited) return;
        // Slot pips next to dnd5e's slot config button in edit mode (our override skips this in view mode)
        this._renderSpellbook({...context, editable: false }, options);
        if (this._mode !== this.constructor.MODES.PLAY) return;

        this.#renderLayout(context);
        this.#renderControls(context);
        await this.#renderActions();
        if (this.rulesVersion === "2024") {
            this.#linkInitiative(context);
            this.#linkGear();
        }
        this.#linkAbilities();
        this.#renderHitPoints();
        this.#linkSkills();
        this.#activateItemLinks();
        await this.#addItemTooltips();
    }

    /* -------------------------------------------- */
    /*  View mode rendering                         */
    /* -------------------------------------------- */

    /**
     * Find the value (dd) of a stat block header entry by its label.
     * @param {string|string[]} labels  Localization keys of the label; the first one found is used.
     * @returns {HTMLElement|undefined}
     */
    #getHeaderDd(labels) {
        const labelList = (Array.isArray(labels) ? labels : [labels]).map(l => game.i18n.localize(l));
        const dt = Array.from(this.element.querySelectorAll(".statblock-header div dt"))
            .find(dt => labelList.includes(dt.innerText));
        return dt?.parentNode.querySelector("dd");
    }

    /**
     * Ability keys by their (localized) abbreviation, as the stat block shows them.
     * @type {Map<string, string>}
     */
    get #abilityKeys() {
        return new Map(Object.entries(CONFIG.DND5E.abilities)
            .map(([key, { abbreviation }]) => [abbreviation.toLowerCase(), key]));
    }

    /**
     * Place the portrait and biography, and apply the saved layout, visibility and zoom.
     * @param {object} context
     */
    #renderLayout(context) {
        const { sheetPrefs } = context;
        const title = this.element.querySelector(".statblock-title");
        const portrait = this.element.querySelector(".statblock-portrait");
        if (title && portrait && (portrait.parentNode !== title)) title.insertBefore(portrait, title.firstChild);

        // Biography below the stat block
        const statblockPart = this.element.querySelector(`[data-application-part="statblock"]`);
        const bioPart = this.element.querySelector(`[data-application-part="biographyView"]`);
        if (statblockPart && bioPart) statblockPart.after(bioPart);

        this.element.classList.toggle("visible-bio", !!sheetPrefs.visibleBiography);
        this.element.classList.toggle("visible-portrait", !!sheetPrefs.showPortrait);
        this.element.querySelector(".window-content")?.classList.toggle("double-column", !!sheetPrefs.doubleColumn);
        this.#applyZoom(sheetPrefs.zoom || 1);
    }

    /**
     * Add the toggle and zoom controls to the stat block title.
     * @param {object} context
     */
    #renderControls(context) {
        const title = this.element.querySelector(".statblock-title");
        if (!title) return;
        const addToggle = (cls, icon, action, tooltip) => {
            if (title.querySelector(`.${cls}`)) return;
            const toggle = document.createElement("i");
            toggle.classList.add("statblock-control", cls, "fa-solid", icon);
            Object.assign(toggle.dataset, { action, tooltip });
            title.appendChild(toggle);
        };
        addToggle("toggle-biography", "fa-feather", "toggleBiography", "NDSS.Buttons.ToggleBiography");
        addToggle("toggle-portrait", "fa-image-portrait", "togglePortrait", "NDSS.Buttons.TogglePortrait");
        addToggle("toggle-doublecolumn", "fa-table-columns", "toggleDoubleColumn", "NDSS.Buttons.ToggleDoubleColumn");

        if (!title.querySelector(".zoom-container")) {
            const zoomContainer = document.createElement("span");
            zoomContainer.classList.add("zoom-container", "statblock-control");
            const zoomIn = document.createElement("i");
            zoomIn.classList.add("zoom-in", "fa-solid", "fa-magnifying-glass-plus");
            Object.assign(zoomIn.dataset, { action: "zoomIn", tooltip: "NDSS.Buttons.ZoomIn" });
            const zoomLabel = document.createElement("span");
            zoomLabel.classList.add("zoom-label");
            Object.assign(zoomLabel.dataset, { action: "zoomReset", tooltip: "NDSS.Buttons.ZoomReset" });
            const zoomOut = document.createElement("i");
            zoomOut.classList.add("zoom-out", "fa-solid", "fa-magnifying-glass-minus");
            Object.assign(zoomOut.dataset, { action: "zoomOut", tooltip: "NDSS.Buttons.ZoomOut" });
            zoomContainer.append(zoomIn, zoomLabel, zoomOut);
            title.appendChild(zoomContainer);
        }
        this.#applyZoom(context.sheetPrefs.zoom || 1);
    }

    /**
     * Replace each action's text with its item's enriched description, led by a link that uses the item.
     */
    async #renderActions() {
        const actions = Array.from(this.element.querySelectorAll(".statblock-action"));
        const results = await Promise.all(actions.map(async action => {
            const nameEl = action.querySelector(".name");
            const nameText = nameEl?.innerText;
            let item = action.dataset.id ? this.actor.items.get(action.dataset.id) : null;
            if (!item && nameText) item = this.actor.items.getName(nameText);
            if (!item) return null;

            const enrichedName = document.createElement("span");
            enrichedName.classList.add("name", "statblock-roll-link-group");
            enrichedName.dataset.rollItemUuid = item.uuid;
            const uses = item.system.uses.label || (item.system.activities?.size === 1 ? item.system.activities?.contents[0]?.uses.label : undefined);
            const finalName = uses ? `${item.name} (${uses})` : item.name;
            enrichedName.innerHTML = `<span class="roll-link" data-action="use" data-item-id="${item.id}">${finalName}</span>`;

            // Links to items on this actor become item use links
            const description = (item.system.description.value || "").replace(/@UUID\[(?<uuid>[^\]]+)\](?:\{(?<name>[^\}]+)\})?/g, (match, uuid, name) => {
                const linkedDocument = foundry.utils.parseUuid(uuid, { relative: this.actor });
                const itemOnActor = (linkedDocument?.id ? this.actor.items.get(linkedDocument.id) : null) ?? (name ? this.actor.items.getName(name) : null);
                return itemOnActor ? `[[/item .${itemOnActor.id}]]` : match;
            });
            const enrichedHTML = await TextEditor.enrichHTML(description, {
                secrets: false, rollData: item.getRollData(), relativeTo: item
            });
            return { action, nameEl, enrichedName, enrichedHTML };
        }));

        for (const result of results) {
            if (!result) continue;
            const { action, nameEl, enrichedName, enrichedHTML } = result;
            nameEl?.remove();
            action.innerHTML = enrichedHTML;
            // Unwrap single wrapping divs so the name lands in the first paragraph
            while ((action.children.length === 1) && (action.children[0].tagName === "DIV")) {
                action.children[0].outerHTML = action.children[0].innerHTML;
            }
            action.firstElementChild?.prepend(enrichedName);
        }
    }

    /**
     * Make the initiative (2024) rollable.
     * @param {object} context
     */
    #linkInitiative(context) {
        const initDd = this.#getHeaderDd("DND5E.Initiative");
        if (initDd) {
            initDd.innerHTML = `<span class="rollable" aria-label="Initiative" data-action="roll" data-type="initiative">${context.summary.initiative}</span>`;
        }
    }

    /**
     * Rebuild the gear list (2024) like dnd5e's (presentation name, sorted), with links that use the items.
     * A gear text set in the stat block override is left as it is.
     */
    #linkGear() {
        const gearDd = this.#getHeaderDd("DND5E.Gear.Label");
        if (!gearDd || this.actor.flags.dnd5e?.statBlockOverride?.gear) return;
        const formatter = game.i18n.getListFormatter({ type: "unit" });
        gearDd.innerHTML = formatter.format(
            this.actor.items.filter(item => item.system.quantity && item.system.properties?.has("gear"))
                .map(item => ({ item, ...item.system.gearPresentationData() }))
                .sort((lhs, rhs) => lhs.name.localeCompare(rhs.name, game.i18n.lang))
                .map(({ item, nameHTML }) => {
                    let enrichedGear = `<span class="roll-link" data-action="use" data-item-id="${item.id}">${nameHTML}</span>`;
                    if (item.system.quantity > 1) enrichedGear += ` (${dnd5e.utils.formatNumber(item.system.quantity)})`;
                    return enrichedGear;
                })
        );
    }

    /**
     * Make ability scores, modifiers and saving throws rollable: the ability table (2024), or the ability row and
     * the saving throws entry (2014).
     */
    #linkAbilities() {
        const abilityKeys = this.#abilityKeys;
        const wrap = (el, key, save = false) => {
            el.innerHTML = `<span class="rollable${save ? " saving-throw" : ""}" data-action="roll" data-type="ability" data-ability="${key}">${el.innerHTML}</span>`;
        };

        // 2024 ability table
        this.element.querySelectorAll(".statblock-header .abilities tbody tr").forEach(tr => {
            const label = tr.querySelector("th");
            const key = abilityKeys.get(label.textContent.trim().toLowerCase());
            if (!key) return;
            wrap(label, key, true);
            wrap(tr.querySelector(".score"), key);
            wrap(tr.querySelector("td:nth-of-type(2)"), key);
            wrap(tr.querySelector("td:nth-of-type(3)"), key, true);
        });

        // 2014 ability row
        this.element.querySelectorAll(".statblock-header .ability .name").forEach(name => {
            const key = abilityKeys.get(name.textContent.trim().toLowerCase());
            if (!key) return;
            wrap(name, key, true);
            wrap(name.parentNode.querySelector(".score"), key);
        });

        // 2014 saving throws entry
        const savesDd = this.#getHeaderDd("DND5E.ClassSaves");
        if (savesDd) {
            savesDd.innerHTML = linkLabeledBonuses(savesDd.innerHTML, abilityKeys, (text, key) =>
                `<span class="rollable saving-throw" data-action="roll" data-type="ability" data-ability="${key}">${text}</span>`);
        }
    }

    /**
     * Show current and temporary hit points in the HP entry, each editable with a click.
     * When the stat block override shows a Temp HP entry instead of HP (2024), its value is the editable temp HP.
     */
    #renderHitPoints() {
        const { value, temp, effectiveMax, max } = this.actor.system.attributes.hp;
        const tempLabel = game.i18n.localize("DND5E.HEAL.Type.TemporaryShort");

        const hpDd = this.#getHeaderDd(["DND5E.HP", "DND5E.HitPoints"]);
        if (hpDd) {
            const current = this.#createEditableNumber("system.attributes.hp.value", value, effectiveMax ?? max);
            hpDd.prepend(...current, " / ");
            if (temp > 0) {
                const tempEl = document.createElement("span");
                tempEl.classList.add("statblock-temp-hp");
                tempEl.append(" + ", ...this.#createEditableNumber("system.attributes.hp.temp", temp), ` ${tempLabel}`);
                hpDd.append(tempEl);
            }
        }

        const tempDd = this.#getHeaderDd("DND5E.HEAL.Type.TemporaryShort");
        if (tempDd) tempDd.prepend(...this.#createEditableNumber("system.attributes.hp.temp", temp ?? 0), " ");
    }

    /**
     * Create a number shown as text that turns into an input when clicked. The input takes a value, or a change
     * such as `+5`, `-5` or `=5`.
     * @param {string} property  Actor property to update.
     * @param {number} value     Current value.
     * @param {number} [max]     Upper limit.
     * @returns {HTMLElement[]}  The input and the text, or only the text if the sheet isn't editable.
     */
    #createEditableNumber(property, value, max) {
        const input = document.createElement("input");
        Object.assign(input, { type: "text", inputMode: "numeric", value: value ?? 0 });
        input.classList.add("statblock-hp-input", "hidden");
        // No form name, so the sheet's form doesn't submit it; parseInputDelta reads data-name and data-max
        input.dataset.name = property;
        if (Number.isFinite(max)) input.dataset.max = max;
        const text = document.createElement("span");
        text.innerText = value ?? 0;
        // Users who can only view the actor get plain text
        if (!this.isEditable) return [text];
        text.classList.add("statblock-hp-text");

        input.addEventListener("change", this._onChangeHpInput.bind(this));
        input.addEventListener("focus", () => input.select());
        input.addEventListener("blur", () => {
            text.classList.remove("hidden");
            input.classList.add("hidden");
        });
        text.addEventListener("click", () => {
            text.classList.add("hidden");
            input.classList.remove("hidden");
            input.focus();
        });
        return [input, text];
    }

    /**
     * Make the skills entry rollable.
     */
    #linkSkills() {
        const skillDd = this.#getHeaderDd("DND5E.Skills");
        if (!skillDd) return;
        const skillKeys = new Map(Object.entries(CONFIG.DND5E.skills).map(([key, { label }]) => [label.toLowerCase(), key]));
        skillDd.innerHTML = linkLabeledBonuses(skillDd.innerHTML, skillKeys, (text, key) =>
            `<span class="rollable" data-action="roll" data-type="skill" data-key="${key}">${text}</span>`);
    }

    /**
     * Right-click on an item link (actions, gear) opens the item's sheet.
     */
    #activateItemLinks() {
        for (const link of this.element.querySelectorAll('.statblock [data-action="use"][data-item-id]')) {
            link.addEventListener("contextmenu", event => {
                const item = this.actor.items.get(link.dataset.itemId);
                if (!item) return;
                event.preventDefault();
                event.stopPropagation();
                item.sheet.render({ force: true });
            });
        }
    }

    /**
     * Show item tooltips on action names and on item links in descriptions.
     */
    async #addItemTooltips() {
        const tooltipLinks = Array.from(this.element.querySelectorAll(".roll-link-group[data-type=item], .statblock-roll-link-group"));
        await Promise.all(tooltipLinks.map(async link => {
            let uuid = link.dataset.rollItemUuid;
            if (!uuid && link.dataset.rollItemActor) {
                const actor = await fromUuid(link.dataset.rollItemActor);
                uuid = actor?.items.getName(link.dataset.rollItemName)?.uuid;
            }
            if (uuid) {
                link.dataset.tooltip = `<section class="loading" data-uuid="${uuid}"><i class="fas fa-spinner fa-spin-pulse"></i></section>`;
            }
        }));
    }

    /** @inheritdoc */
    _renderCreateInventory() { 
        if (this._mode === this.constructor.MODES.EDIT) {
            return super._renderCreateInventory();
        }
    }
    /** @inheritdoc */
    _renderAttunement(context, options) {
        if (this._mode === this.constructor.MODES.EDIT) {
            return super._renderAttunement(context, options);
        }
    }
    /** @inheritdoc */
    _renderSpellbook(context, options) {
        if (this._mode === this.constructor.MODES.EDIT) {
            return super._renderSpellbook(context, options);
        }
    }

    /** @inheritdoc */
    _onPosition(position) {
        const statblock = this.element.querySelector(".statblock.npc");
        if ((this._mode === this.constructor.MODES.PLAY) && !this.actor.limited && statblock) {
            const prefs = this._getPreferences();
            // Fit the height to the stat block the first time, unless the biography is shown below it
            if (!prefs.height && !this.element.classList.contains("visible-bio")) {
                const headerHeight = this.element.querySelector("header").offsetHeight;
                const newHeight = headerHeight + statblock.offsetHeight + 30;
                this.element.style.height = newHeight + "px";
                position.height = newHeight;
            }
            this._saveStatblockSheetPosition ??= foundry.utils.debounce((pos) => this.#saveStatblockSheetSize(pos), 500);
            this._saveStatblockSheetPosition(position);
        } else {
            return super._onPosition(position);
        }
    }

    /**
     * Save the sheet's current size to preferences.
     * @param {ApplicationPosition} position
     */
    #saveStatblockSheetSize(position) {
        const { width, height } = position;
        const prefs = this._getPreferences();
        const updates = {};
        // Moving the window also calls this; only save when the size changed.
        if ( (width !== "auto") && (width !== prefs.width) ) updates.width = width;
        if ( (height !== "auto") && (height !== prefs.height) ) updates.height = height;
        if ( foundry.utils.isEmpty(updates) ) return;
        this._updatePreferences(updates);
    }

    static _onUseItem(event, target) {
        const { itemId } = target.closest("[data-item-id]")?.dataset ?? {};
        const item = this.actor.items.get(itemId);
        if ( !item || (target.ariaDisabled === "true") ) return;
        // Shift-click posts the item to chat without using it
        if ( event.shiftKey ) return item.displayCard();
        return item.use({ event });
    }

    static async _toggleDoubleColumn(event, target) {
        const isDoubleColumn = this.element.querySelector(".window-content").classList.contains("double-column");
        this.element.querySelector(".window-content").classList.toggle("double-column", !isDoubleColumn);
        this._updatePreferences({ doubleColumn: !isDoubleColumn });
    }

    static _toggleBiography(event, target) {
        const isVisibleBio = this.element.classList.contains("visible-bio");
        this.element.classList.toggle("visible-bio", !isVisibleBio);
        this._updatePreferences({ visibleBiography: !isVisibleBio });
    }

    /**
     * Show a zoom level on the stat block and its label.
     * @param {number} zoom
     */
    #applyZoom(zoom) {
        const statblockContentEl = this.element.querySelector(".statblock-content");
        if (statblockContentEl) statblockContentEl.style.zoom = zoom;
        const zoomLabel = this.element.querySelector(".zoom-label");
        if (zoomLabel) zoomLabel.innerText = Math.round(zoom * 100) + "%";
    }

    /**
     * Change the zoom by a step, within the limits, and save it.
     * @param {number} direction  1 to zoom in, -1 to zoom out.
     */
    #stepZoom(direction) {
        const statblockContentEl = this.element.querySelector(".statblock-content");
        const current = parseFloat(statblockContentEl?.style.zoom || 1);
        const newZoom = Math.clamp(Math.round((current + (direction * ZOOM.step)) * 100) / 100, ZOOM.min, ZOOM.max);
        if (newZoom === current) return;
        this.#applyZoom(newZoom);
        this._updatePreferences({ zoom: newZoom });
    }

    static _togglePortrait(event, target) {
        const isVisiblePortrait = this.element.classList.contains("visible-portrait");
        this.element.classList.toggle("visible-portrait", !isVisiblePortrait);
        this._updatePreferences({ showPortrait: !isVisiblePortrait });
    }

    static _zoomIn(event, target) {
        this.#stepZoom(1);
    }

    static _zoomOut(event, target) {
        this.#stepZoom(-1);
    }

    static _zoomReset(event, target) {
        this.#applyZoom(game.settings.get(MODULE_ID, "defaultZoom") / 100);
        this._updatePreferences({ zoom: null });
    }

    /**
     * Apply a value typed into an editable stat block number (hit points, temp HP): a number, or a change such as
     * `+5`, `-5` or `=5`, limited to data-max.
     * @param {Event} event
     */
    _onChangeHpInput(event) {
        // The sheet's form must not handle this field as well
        event.stopPropagation();
        const input = event.currentTarget;
        const value = dnd5e.utils.parseInputDelta(input, this.actor);
        if ((value === undefined) || (value === "")) return;
        this.actor.update({ [input.dataset.name]: Math.max(0, value) });
    }
}

export class StatblockSheet2014 extends StatblockSheet {
    rulesVersion = "2014";
}

export class StatblockSheet2024 extends StatblockSheet {
    rulesVersion = "2024";
}
