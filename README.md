# Tile Combiner

A Foundry VTT module that merges several selected tiles into **one** image tile. The result is baked from what the tiles actually look like on the canvas, so visual effects from [Token Magic FX](https://foundryvtt.com/packages/tokenmagic) filters (for example the Bailey Wiki "Replace Color" and "Random Overlay Terrain" macros) are kept in the new image. The new tile carries no filters itself.

**Version 1.0.0** · Built and tested for Foundry VTT **V14** (verified 14.370)

## Features

- Combine two or more selected tiles into a single tile with one button.
- Bakes each tile's live mesh, including applied Token Magic FX filters and the random values already rolled, so the overlay matches what you see on the canvas.
- Tiles are layered by elevation, then sort order.
- Export resolution scale: 0.5x, 1.0x or 2.0x.
- Optional automatic trim of transparent padding around the result.
- Copies `flags.baileywiki` from the lowest tile onto the merged tile.
- GM only.

## Installation

In Foundry, go to **Add-on Modules → Install Module** and paste this into **Manifest URL**:

```
https://github.com/YOUR-GITHUB-USERNAME/tile-combiner/releases/latest/download/module.json
```

Then enable **Tile Combiner** in your world under **Manage Modules**.

## Usage

1. Open the **Tiles** layer in the scene controls.
2. Select two or more tiles (click, or drag a box).
3. Click the **Combine Selected Tiles** button (box icon) in the tile tool palette.
4. The tiles are replaced with one merged tile. The image is saved to `worlds/<your world>/combined-tiles/`.

**Back up your scene first.** The originals are deleted after combining.

## Settings

| Setting | Description | Default |
| --- | --- | --- |
| Export Resolution Scale | Texture resolution multiplier (0.5x, 1.0x, 2.0x). | 1.0x |
| Automatic Padding Trim | Crops transparent outer margins around the combined tile. | Off |

## Notes and limitations

- The merged image is a flat PNG. Filters cannot be edited afterwards, so keep a copy of the original tiles if you may want to change them.
- Filter padding can make the merged tile a little larger than the original footprint. Turn on Automatic Padding Trim to crop it.
- Large scenes at 2.0x can use a lot of memory. If it fails, try 1.0x.

## Support

Open an issue at <https://github.com/YOUR-GITHUB-USERNAME/tile-combiner/issues>. Please include your Foundry version, the list of active modules, and any errors from the browser console (F12).

## License

MIT. See [LICENSE](LICENSE).
