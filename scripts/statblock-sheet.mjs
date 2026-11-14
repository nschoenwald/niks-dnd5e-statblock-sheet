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
        this._renderSpellbook({...context, editable: false }, options);

        if (this._mode === this.constructor.MODES.PLAY) {

            const title = this.element.querySelector(".statblock-title");
            const portrait = this.element.querySelector(".statblock-portrait");
            if (title && portrait) {
                if (portrait.parentNode !== title) title.insertBefore(portrait, title.firstChild);
            }

            // Move bio after statblock
            const statblockPart = this.element.querySelector(`[data-application-part="statblock"]`);
            const bioPart = this.element.querySelector(`[data-application-part="biographyView"]`);
            if (statblockPart && bioPart) statblockPart.after(bioPart);

            if (title) {
                // Inject bio toggle if not present
                if (!title.querySelector(".toggle-biography")) {
                    const bioToggle = document.createElement("i");
                    bioToggle.classList.add("statblock-control", "toggle-biography", "fa-solid", "fa-feather");
                    bioToggle.dataset.action = "toggleBiography";
                    bioToggle.dataset.tooltip = "NDSS.Buttons.ToggleBiography";
                    title.appendChild(bioToggle);
                }
                // Set bio visibility
                this.element.classList.toggle("visible-bio", !!context.sheetPrefs.visibleBiography);

                // Inject portrait toggle if not present
                if (!title.querySelector(".toggle-portrait")) {
                    const portraitToggle = document.createElement("i");
                    portraitToggle.classList.add("statblock-control", "toggle-portrait", "fa-solid", "fa-image-portrait");
                    portraitToggle.dataset.action = "togglePortrait";
                    portraitToggle.dataset.tooltip = "NDSS.Buttons.TogglePortrait";
                    title.appendChild(portraitToggle);
                }
                // Set portrait visibility
                this.element.classList.toggle("visible-portrait", !!context.sheetPrefs.showPortrait);

                // Add double-column toggle if not present
                if (!title.querySelector(".toggle-doublecolumn")) {
                    const doubleColumnToggle = document.createElement("i");
                    doubleColumnToggle.classList.add("statblock-control", "toggle-doublecolumn", "fa-solid", "fa-table-columns");
                    doubleColumnToggle.dataset.action = "toggleDoubleColumn";
                    doubleColumnToggle.dataset.tooltip = "NDSS.Buttons.ToggleDoubleColumn";
                    title.appendChild(doubleColumnToggle);
                }
                // Set double column
                const windowContent = this.element.querySelector(".window-content");
                if (windowContent) windowContent.classList.toggle("double-column", !!context.sheetPrefs.doubleColumn);

                // Zoom buttons container if not present
                let zoomContainer = title.querySelector(".zoom-container");
                if (!zoomContainer) {
                    zoomContainer = document.createElement("span");
                    zoomContainer.classList.add("zoom-container", "statblock-control");
                    title.appendChild(zoomContainer);

                    const zoomInButton = document.createElement("i");
                    zoomInButton.classList.add("zoom-in", "fa-solid", "fa-magnifying-glass-plus");
                    zoomInButton.dataset.action = "zoomIn";
                    zoomInButton.dataset.tooltip = "NDSS.Buttons.ZoomIn";
                    zoomContainer.appendChild(zoomInButton);
                    
                    const zoomLabel = document.createElement("span");
                    zoomLabel.classList.add("zoom-label");
                    zoomLabel.dataset.action = "zoomReset";
                    zoomLabel.dataset.tooltip = "NDSS.Buttons.ZoomReset";
                    zoomContainer.appendChild(zoomLabel);

                    const zoomOutButton = document.createElement("i");
                    zoomOutButton.classList.add("zoom-out", "fa-solid", "fa-magnifying-glass-minus");
                    zoomOutButton.dataset.action = "zoomOut";
                    zoomOutButton.dataset.tooltip = "NDSS.Buttons.ZoomOut";
                    zoomContainer.appendChild(zoomOutButton);
                }
                const zoomLabel = zoomContainer.querySelector(".zoom-label");
                if (zoomLabel) zoomLabel.innerText = Math.round((context.sheetPrefs.zoom || 1) * 100) + "%";
            }

            // Set zoom
            const statblockContentEl = this.element.querySelector(".statblock-content");
            if (statblockContentEl) statblockContentEl.style.zoom = context.sheetPrefs.zoom || 1;

            // Ability keys by their (localized) abbreviation, as the stat block shows them
            const abilityKeys = new Map(Object.entries(CONFIG.DND5E.abilities)
                .map(([key, { abbreviation }]) => [abbreviation.toLowerCase(), key]));

            // Cache header dt elements for faster lookup
            const headerDts = Array.from(this.element.querySelectorAll(".statblock-header div dt"));
            const getHeaderDd = (labels) => {
                const labelList = Array.isArray(labels) ? labels : [labels];
                return headerDts.find(dt => labelList.includes(dt.innerText))?.parentNode.querySelector("dd");
            };

            const actions = Array.from(this.element.querySelectorAll(".statblock-action"));
            const actionEnrichments = actions.map(async action => {
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

                const originalDescription = item.system.description.value || "";
                let description = originalDescription.replace(/@UUID\[(?<uuid>[^\]]+)\](?:\{(?<name>[^\}]+)\})?/g, (match, uuid, name) => {
                    const linkedDocument = foundry.utils.parseUuid(uuid, { relative: this.actor });
                    const itemOnActor = (linkedDocument?.id ? this.actor.items.get(linkedDocument.id) : null) ?? (name ? this.actor.items.getName(name) : null);
                    if (itemOnActor) return `[[/item .${itemOnActor.id}]]`;
                    return match;
                });
                const enrichedHTML = await TextEditor.enrichHTML(description, {
                    secrets: false, rollData: item.getRollData(), relativeTo: item
                });
                return { action, nameEl, enrichedName, enrichedHTML };
            });

            const enrichedActions = await Promise.all(actionEnrichments);
            for (const result of enrichedActions) {
                if (!result) continue;
                const { action, nameEl, enrichedName, enrichedHTML } = result;
                nameEl?.remove();
                action.innerHTML = enrichedHTML;
                let isWrapped;
                do {
                    isWrapped = action.children.length === 1 && action.children[0].tagName === "DIV";
                    if (isWrapped) {
                        action.children[0].outerHTML = action.children[0].innerHTML;
                    }
                } while (isWrapped);
                const firstParagraph = action.firstElementChild;
                if (firstParagraph) {
                    firstParagraph.prepend(enrichedName);
                }
            }

            // 2024 additions
            if (this.rulesVersion === "2024") {
                // Wire initiative (2024 only)
                const initDd = getHeaderDd(game.i18n.localize("DND5E.Initiative"));
                if (initDd) {
                    initDd.innerHTML = `<span class="rollable" aria-label="Initiative" data-action="roll" data-type="initiative">${context.summary.initiative}</span>`;
                }
                
                // Wire Gear, built like dnd5e's list (presentation name, sorted). A gear text set in the stat block
                // override is left as it is.
                const gearDd = getHeaderDd(game.i18n.localize("DND5E.Gear.Label"));
                if (gearDd && !this.actor.flags.dnd5e?.statBlockOverride?.gear) {
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

                // Wire ability tables
                this.element.querySelectorAll(".statblock-header .abilities tbody tr").forEach(tr => {
                    const abbreviationBox = tr.querySelector("th");
                    const abbreviation = abilityKeys.get(abbreviationBox.textContent.trim().toLowerCase());
                    if (!abbreviation) return;
                    abbreviationBox.innerHTML = `<span class="rollable saving-throw" data-action="roll" data-type="ability" data-ability="${abbreviation}">${abbreviationBox.innerHTML}</span>`;
                    const abilityScoreBox = tr.querySelector(".score");
                    abilityScoreBox.innerHTML = `<span class="rollable" data-action="roll" data-type="ability" data-ability="${abbreviation}">${abilityScoreBox.innerHTML}</span>`;
                    const abilityModBox = tr.querySelector("td:nth-of-type(2)");
                    abilityModBox.innerHTML = `<span class="rollable" data-action="roll" data-type="ability" data-ability="${abbreviation}">${abilityModBox.innerHTML}</span>`;
                    const abilitySaveBox = tr.querySelector("td:nth-of-type(3)");
                    abilitySaveBox.innerHTML = `<span class="rollable saving-throw" data-action="roll" data-type="ability" data-ability="${abbreviation}">${abilitySaveBox.innerHTML}</span>`;
                });
            }

            // 2014 additions
            else {
                // Wire abilities
                this.element.querySelectorAll(".statblock-header .ability .name").forEach(abilityNameSpan => {
                    const ability = abilityKeys.get(abilityNameSpan.textContent.trim().toLowerCase());
                    if (!ability) return;
                    abilityNameSpan.innerHTML = `<span class="rollable saving-throw" data-action="roll" data-type="ability" data-ability="${ability}">${abilityNameSpan.innerHTML}</span>`;
                    const scoreSpan = abilityNameSpan.parentNode.querySelector(".score");
                    scoreSpan.innerHTML = `<span class="rollable" data-action="roll" data-type="ability" data-ability="${ability}">${scoreSpan.innerHTML}</span>`;
                });
                
                // Wire saves
                const savesDd = getHeaderDd(game.i18n.localize("DND5E.ClassSaves"));
                if (savesDd) {
                    savesDd.innerHTML = linkLabeledBonuses(savesDd.innerHTML, abilityKeys, (text, key) =>
                        `<span class="rollable saving-throw" data-action="roll" data-type="ability" data-ability="${key}">${text}</span>`);
                }
            }

            // HP editing
            const hpDd = getHeaderDd([game.i18n.localize("DND5E.HP"), game.i18n.localize("DND5E.HitPoints")]);
            if (hpDd) {
                const hpInput = this.element.querySelector(`input[name="system.attributes.hp.value"]`);
                if (hpInput) {
                    // A copy of dnd5e's HP field without a form name, so only our handler saves it.
                    // parseInputDelta reads the property from data-name and the maximum from data-max.
                    const statblockHpInput = hpInput.cloneNode(false);
                    statblockHpInput.removeAttribute("name");
                    statblockHpInput.dataset.name = "system.attributes.hp.value";
                    statblockHpInput.removeAttribute("hidden");
                    statblockHpInput.addEventListener("change", this._onChangeHpInput.bind(this));
                    statblockHpInput.addEventListener("focus", () => statblockHpInput.select());
                    statblockHpInput.addEventListener("blur", () => {
                        statblockHpText.classList.remove("hidden");
                        statblockHpInput.classList.add("hidden");
                    });
                    statblockHpInput.classList.add("statblock-hp-input", "hidden");
                    const statblockHpText = document.createElement("span");
                    statblockHpText.classList.add("statblock-hp-text");
                    statblockHpText.innerText = this.actor.system.attributes.hp.value;
                    statblockHpText.addEventListener("click", () => {
                        statblockHpText.classList.add("hidden");
                        statblockHpInput.classList.remove("hidden");
                        statblockHpInput.focus();
                    });
                    hpDd.innerHTML = " / " + hpDd.innerHTML;
                    hpDd.prepend(statblockHpText);
                    hpDd.prepend(statblockHpInput);
                }
            }

            // Wire skills
            const skillDd = getHeaderDd(game.i18n.localize("DND5E.Skills"));
            if (skillDd) {
                const skillKeys = new Map(Object.entries(CONFIG.DND5E.skills).map(([key, { label }]) => [label.toLowerCase(), key]));
                skillDd.innerHTML = linkLabeledBonuses(skillDd.innerHTML, skillKeys, (text, key) =>
                    `<span class="rollable" data-action="roll" data-type="skill" data-key="${key}">${text}</span>`);
            }

            // Add tooltips concurrently
            const tooltipLinks = Array.from(this.element.querySelectorAll(".roll-link-group[data-type=item], .statblock-roll-link-group"));
            await Promise.all(tooltipLinks.map(async link => {
                let uuid = link.dataset.rollItemUuid;
                if (!uuid && link.dataset.rollItemActor) {
                    const actor = await fromUuid(link.dataset.rollItemActor);
                    const item = actor?.items.getName(link.dataset.rollItemName);
                    uuid = item?.uuid;
                }
                if (uuid) {
                    link.dataset.tooltip = `<section class="loading" data-uuid="${uuid}"><i class="fas fa-spinner fa-spin-pulse"></i></section>`;
                }
            }));
        }
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
     * Apply a value typed into the stat block's HP field: a number, or a change such as `+5`, `-5` or `=5`.
     * @param {Event} event
     */
    _onChangeHpInput(event) {
        // The sheet's form must not submit this field as well (it would save "+5" as 5).
        event.stopPropagation();
        const value = dnd5e.utils.parseInputDelta(event.currentTarget, this.actor);
        if ((value === undefined) || (value === "")) return;
        this.actor.update({ "system.attributes.hp.value": Math.max(0, value) });
    }
}

export class StatblockSheet2014 extends StatblockSheet {
    rulesVersion = "2014";
}

export class StatblockSheet2024 extends StatblockSheet {
    rulesVersion = "2024";
}
