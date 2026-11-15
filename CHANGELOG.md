# Changelog

All notable changes to this project will be documented in this file.

## 14.1.1

### Fixed
- **Carolingian UI**: The portrait and title of the stat block were tinted by the header color overlay that Carolingian UI draws on NPC sheets. The overlay is now only shown in edit mode, where the sheet has a header.

## 14.1.0

### Added
- **Portrait toggle**: A new button in the stat block's title row shows or hides the NPC's portrait, remembered per NPC. The **Show Portrait** setting is now **Show Portrait by Default** and applies to NPCs you haven't toggled yet.

### Fixed
- **Limited NPCs**: Players with Limited permission saw an empty sheet. They now see the usual limited view with the NPC's name, portrait and biography.
- **Hit points**: Typing `+5` or `-5` into the stat block's hit points could set them to 5 or 0 instead of changing them. Changes now work as on the regular sheet, including `=` to set a value, and stay within the maximum.
- **Skills, abilities and saves**: Skills with more than one word (Animal Handling, Sleight of Hand) can be rolled from the stat block now. Ability, save and skill rolls also work when D&D 5e runs in another language, such as German.
- **Zoom**: Zooming out stops at 40% instead of breaking the layout, and zooming in stops at 250%. Reset now goes to the default zoom from the settings, and stays reset on your other browsers.
- **Gear**: The gear list keeps D&D 5e's sorting and item names, and a gear text you entered in the stat block override is shown as you wrote it.
- **Preferences**: Changes made on another browser now show up on this one. Users who share a browser keep separate preferences. The window height fit on first opening now leaves room when the biography is shown by default.

### Improved
- The sheet saves your preferences far less often: when you change something and when you open an NPC, no longer on every update of the NPC or every move of the window.

## 14.0.1

### Improved
- Removed leftover code from older D&D 5e versions. No visible changes.

## 14.0.0

First release as Nik's DnD5e Statblock Sheet, based on 5e Statblock Sheet by Aioros.

### Added
- **Free resizing and zoom**: Resize the window to any size and zoom the stat block in or out. Size, zoom, layout and biography visibility are remembered per NPC.
- **Preferences follow you**: Your sheet preferences are shared between your browsers. Old preferences of NPCs you haven't opened in 180 days are cleaned up.
- **Defaults**: World settings for the default layout, zoom and biography visibility.
- **Show Portrait**: A world setting to show the NPC's portrait next to its name.
- **German translation.**

### Fixed
- Resizing the sheet in edit mode no longer snaps back to the stat block size after every change.
