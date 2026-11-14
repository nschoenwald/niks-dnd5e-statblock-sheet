export const MODULE_ID = "niks-dnd5e-statblock-sheet";

const TextEditor = foundry.applications.ux.TextEditor.implementation;

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
     * Retrieve saved sheet preferences for this actor.
     * Resolution order:
     * 1. Local client storage (localStorage)
     * 2. User flags (game.user) synced from other clients
     * @returns {Object}
     */
    _getPreferences() {
        const actorId = this.baseActor.id;
        const storageKey = `${MODULE_ID}.sheetPrefs.${actorId}`;
        try {
            const clientRaw = localStorage.getItem(storageKey);
            if ( clientRaw ) return JSON.parse(clientRaw);
        } catch (e) {}

        return game.user.getFlag(MODULE_ID, `sheetPrefs.${actorId}`) ?? {};
    }

    /**
     * Save complete sheet preferences for this actor across both client storage and user flags.
     * @param {Object} prefs
     */
    async _savePreferences(prefs) {
        const actorId = this.baseActor.id;
        const finalPrefs = {
            ...prefs,
            lastViewed: Date.now()
        };
        const storageKey = `${MODULE_ID}.sheetPrefs.${actorId}`;
        try {
            localStorage.setItem(storageKey, JSON.stringify(finalPrefs));
        } catch (e) {}

        return game.user.setFlag(MODULE_ID, `sheetPrefs.${actorId}`, finalPrefs);
    }

    /**
     * Update sheet preferences for this actor across both client storage and user flags.
     * @param {Object} updates
     */
    async _updatePreferences(updates) {
        const currentPrefs = this._getPreferences();
        return this._savePreferences({
            ...currentPrefs,
            ...updates
        });
    }

    /** @inheritdoc */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        Object.assign(context, {
            ...await this.actor.system._prepareEmbedContext(this.rulesVersion),
            name: this.actor.name
        });
        context.biography = await this._prepareBiographyContext(context, { rollData: context.rollData });
        const defaultSettings = {
            doubleColumn: game.settings.get(MODULE_ID, "defaultLayout") === "doubleColumn",
            visibleBiography: game.settings.get(MODULE_ID, "defaultVisibleBiography"),
            zoom: game.settings.get(MODULE_ID, "defaultZoom") / 100
        };
        const savedPrefs = this._getPreferences();
        context.sheetPrefs = foundry.utils.mergeObject(foundry.utils.duplicate(defaultSettings), savedPrefs);
        context.sheetPrefs.showPortrait = game.settings.get(MODULE_ID, "showPortrait");
        
        if (!foundry.utils.isEmpty(savedPrefs)) {
            this._updatePreferences({});
        }
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
        this._renderSpellbook({...context, editable: false }, options);

        if (this._mode === this.constructor.MODES.PLAY) {

            const title = this.element.querySelector(".statblock-title");
            const portrait = this.element.querySelector(".statblock-portrait");
            if (title && portrait) {
                if (!context.sheetPrefs.showPortrait) portrait.classList.add("hidden");
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
                
                // Wire Gear
                const formatter = game.i18n.getListFormatter({ type: "unit" });
                const gear = formatter.format(
                    this.actor.items.filter(item => item.system.quantity && item.system.properties?.has("gear")).map(item => {
                        let enrichedGear = `<span class="roll-link" data-action="use" data-item-id="${item.id}">${item.name}</span>`;
                        if (item.system.quantity > 1) enrichedGear += ` (${dnd5e.utils.formatNumber(item.system.quantity)})`;
                        return enrichedGear;
                    })
                );
                const gearDd = getHeaderDd(game.i18n.localize("DND5E.Gear.Label"));
                if (gearDd) {
                    gearDd.innerHTML = gear;
                }
                
                // Wire ability tables
                this.element.querySelectorAll(".statblock-header .abilities tbody tr").forEach(tr => {
                    const abbreviationBox = tr.querySelector("th");
                    const abbreviation = abbreviationBox.innerText.toLowerCase();
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
                    const ability = abilityNameSpan.innerHTML;
                    abilityNameSpan.innerHTML = `<span class="rollable saving-throw" data-action="roll" data-type="ability" data-ability="${ability}">${abilityNameSpan.innerHTML}</span>`;
                    const scoreSpan = abilityNameSpan.parentNode.querySelector(".score");
                    scoreSpan.innerHTML = `<span class="rollable" data-action="roll" data-type="ability" data-ability="${ability}">${scoreSpan.innerHTML}</span>`;
                });
                
                // Wire saves
                const savesDd = getHeaderDd(game.i18n.localize("DND5E.ClassSaves"));
                if (savesDd) {
                    savesDd.innerHTML = savesDd.innerHTML.replace(/([\w]+)\s.*?(?=(?:,\s|$))/ig, (abilityText, abilityAbbr) => {
                        return `<span class="rollable saving-throw" data-action="roll" data-type="ability" data-ability="${abilityAbbr.toLowerCase()}">${abilityText}</span>`;
                    });
                }
            }

            // HP editing
            const hpDd = getHeaderDd([game.i18n.localize("DND5E.HP"), game.i18n.localize("DND5E.HitPoints")]);
            if (hpDd) {
                const hpInput = this.element.querySelector(`input[name="system.attributes.hp.value"]`);
                if (hpInput) {
                    const statblockHpInput = hpInput.cloneNode(false);
                    hpInput.setAttribute("name", "");
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
                skillDd.innerHTML = skillDd.innerHTML.replace(/([\w]+)\s.*?(?=(?:,\s|$))/ig, (skillText, skillLabel) => {
                    const abbreviation = Object.keys(CONFIG.DND5E.skills).find(key => CONFIG.DND5E.skills[key].label === skillLabel);
                    return `<span class="rollable" data-action="roll" data-type="skill" data-key="${abbreviation}">${skillText}</span>`;
                });
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
        if (this._mode === this.constructor.MODES.PLAY) {
            const prefs = this._getPreferences();
            // Optimize height the first time
            if (!prefs.height && !prefs.visibleBiography) {
                const headerHeight = this.element.querySelector("header").offsetHeight;
                const statblockHeight = this.element.querySelector(".statblock.npc").offsetHeight;
                const newHeight = headerHeight + statblockHeight + 30;
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
        const updates = {};
        if ( width !== "auto" ) updates.width = width;
        if ( height !== "auto" ) updates.height = height;
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

    static _zoomIn(event, target) {
        const statblockContentEl = this.element.querySelector(".statblock-content");
        const newZoom = Math.round((parseFloat(statblockContentEl.style.zoom || 1) + 0.15) * 100) / 100;
        statblockContentEl.style.zoom = newZoom;
        this.element.querySelector(".zoom-label").innerText = Math.round(newZoom * 100) + "%";
        this._updatePreferences({ zoom: newZoom });
    }
    
    static _zoomOut(event, target) {
        const statblockContentEl = this.element.querySelector(".statblock-content");
        const newZoom = Math.round((parseFloat(statblockContentEl.style.zoom || 1) - 0.15) * 100) / 100;
        statblockContentEl.style.zoom = newZoom;
        this.element.querySelector(".zoom-label").innerText = Math.round(newZoom * 100) + "%";
        this._updatePreferences({ zoom: newZoom });
    }

    static _zoomReset(event, target) {
        const newZoom100 = game.settings.get(MODULE_ID, "defaultZoom");
        this.element.querySelector(".statblock-content").style.removeProperty("zoom");
        this.element.querySelector(".zoom-label").innerText = newZoom100 + "%";
        const currentPrefs = { ...this._getPreferences() };
        delete currentPrefs.zoom;
        this._savePreferences(currentPrefs);
    }

    _onChangeHpInput(event) {
        event.preventDefault();
        const input = event.currentTarget;
        const rawValue = input.value.trim();
        const currentHp = Number(this.actor.system.attributes.hp.value) || 0;
        let newHp = currentHp;
        if (rawValue.startsWith("+") || rawValue.startsWith("-")) {
            const delta = parseInt(rawValue, 10);
            if (!isNaN(delta)) newHp = Math.max(0, currentHp + delta);
        } else {
            const parsed = parseInt(rawValue, 10);
            if (!isNaN(parsed)) newHp = Math.max(0, parsed);
        }
        this.actor.update({ "system.attributes.hp.value": newHp });
    }
}

export class StatblockSheet2014 extends StatblockSheet {
    rulesVersion = "2014";
}

export class StatblockSheet2024 extends StatblockSheet {
    rulesVersion = "2024";
}
