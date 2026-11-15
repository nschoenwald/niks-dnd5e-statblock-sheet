# Nik's DnD5e Statblock Sheet

![Foundry v14](https://img.shields.io/badge/Foundry-v14-orange)

**Nik's DnD5e Statblock Sheet** shows D&D 5e NPCs as compact stat blocks, just like the ones in the books. Everything
you need at the table is clickable. When you want to change something, switch to edit mode and you get the full dnd5e
NPC sheet.

Based on [5e Statblock Sheet](https://github.com/Aioros/5e-statblock-sheet) by Aioros.

---

## Compatibility

- **Foundry VTT**: V14
- **System**: D&D 5e 6.0 and 6.1
- **Languages**: English and German.

---

## Features

### Two stat block sheets

The module adds two sheets for NPCs: **Stat Block 2014 (Nik)** and **Stat Block 2024 (Nik)**, matching the stat block
layouts of the two rule sets. Pick one in the NPC's sheet configuration, or set it as the default sheet for NPCs.

### Clickable stat block

- Attacks, actions, features and gear use the item when clicked; hovering shows the item's tooltip.
  Shift-click posts the item to chat without using it, right-click opens the item's sheet.
- Ability scores, saving throws, skills and (2024) initiative roll when clicked.
- Click the hit points to type a new value, `+5` / `-5` to change them, or `=5` to set them. Temporary hit points
  appear next to them when the NPC has any, and can be edited the same way.

### View controls

The icons in the title row of the stat block:

- **Biography** (feather): shows the NPC's biography below the stat block.
- **Portrait**: shows the NPC's portrait next to its name.
- **Two Columns**: splits the stat block into two columns for wide windows.
- **Zoom** (magnifier): hover to zoom in or out (40% to 250%); click the percentage to go back to the default zoom.

### Edit mode

Switch the sheet to edit mode with dnd5e's toggle and the full NPC sheet appears in the same window. Switch back to
return to the stat block. The window can be resized freely in both modes: a size you set while editing stays until
you leave edit mode, then the sheet returns to its stat block size.

### Remembered per NPC

Window size, zoom, layout, portrait and biography visibility are remembered per NPC and per user (shared by all tokens of the
same actor), and follow you to other browsers: the most recent change wins. Preferences for NPCs you haven't opened in 180 days are cleaned up
automatically. The first time you open an NPC, the window height fits the stat block.

### Limited permission

Players with Limited permission on an NPC see D&D 5e's limited view (name, portrait and biography), not the stat block.

### Settings

World settings in **Configure Settings**. Changes show right away on open sheets of NPCs you haven't adjusted:

- **Show Portrait by Default**: shows the portrait for NPCs you haven't toggled yet.
- **Default Layout**: one or two columns for NPCs you haven't adjusted yet (default: two columns).
- **Default Zoom (%)**: the starting zoom, 40% to 250% (default: 130%).
- **Show Biography by Default**: opens the biography for NPCs you haven't adjusted yet.

---

## Coming from 5e Statblock Sheet

This module is a separate package and can be installed next to the original. Its sheets, settings and saved window
preferences are its own: NPCs that use the original module's sheets keep them until you pick one of this module's
sheets.

---

## License

This work is licensed under the Foundry Virtual Tabletop
[EULA - Limited License Agreement for module development](https://foundryvtt.com/article/license/).
This module is licensed under the [GNU Affero General Public License v3](LICENSE). It is a modified version of
[5e Statblock Sheet](https://github.com/Aioros/5e-statblock-sheet) by Aioros, also licensed under the AGPL v3.
