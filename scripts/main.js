Hooks.once("init", () => {
  console.log("Tile Combiner v1.0.0 | Initializing Live-Mesh Baking & Persistent Toolbar");

  game.settings.register("tile-combiner", "resolutionScale", {
    name: "Export Resolution Scale",
    hint: "Multiplier for texture resolution (0.5x for performance, 1.0x normal, 2.0x high definition).",
    scope: "world",
    config: true,
    type: Number,
    default: 1.0,
    choices: {
      0.5: "0.5x (Performance)",
      1.0: "1.0x (Standard)",
      2.0: "2.0x (High Definition)"
    }
  });

  game.settings.register("tile-combiner", "autoTrim", {
    name: "Automatic Padding Trim",
    hint: "Crop transparent outer margins around combined tiles.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
});

// Primary Hook: Foundry Control Buttons Data Injection
Hooks.on("getSceneControlButtons", (controls) => {
  let tileControl = null;
  if (Array.isArray(controls)) {
    tileControl = controls.find(c => c.name === "tiles" || c.title?.toLowerCase().includes("tile")) || controls[3];
  } else if (controls instanceof Map) {
    tileControl = controls.get("tiles");
  } else if (controls && controls.tiles) {
    tileControl = controls.tiles;
  }

  if (!tileControl) return;

  const toolConfig = {
    name: "combine-tiles",
    title: "Combine Selected Tiles",
    icon: "icons/svg/box.svg",
    visible: game.user.isGM,
    onClick: () => combineSelectedTiles(),
    button: true
  };

  if (tileControl.tools instanceof Map || (tileControl.tools && typeof tileControl.tools.set === "function")) {
    tileControl.tools.set("combine-tiles", toolConfig);
  } else if (Array.isArray(tileControl.tools)) {
    if (!tileControl.tools.some(t => t.name === "combine-tiles")) {
      tileControl.tools.push(toolConfig);
    }
  } else if (tileControl.tools && typeof tileControl.tools === "object") {
    tileControl.tools["combine-tiles"] = toolConfig;
  }
});

// DOM Injector: Guarantees button visibility in the active sub-tool palette
function injectCombinerButton() {
  if (!game.user.isGM) return;

  const subTools = document.querySelector("#sub-controls") || document.querySelector(".sub-tools") || document.querySelector("ol.sub-tools");
  if (!subTools) return;

  if (subTools.querySelector(".tile-combiner-tool")) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "control-tool tile-combiner-tool";
  btn.title = "Combine Selected Tiles";
  btn.innerHTML = `<img src="icons/svg/box.svg" style="width: 24px; height: 24px; border: none; pointer-events: none;" />`;
  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    combineSelectedTiles();
  });

  subTools.appendChild(btn);
}

Hooks.on("renderSceneControls", () => {
  setTimeout(injectCombinerButton, 50);
});

Hooks.once("ready", () => {
  const observer = new MutationObserver(() => {
    injectCombinerButton();
  });
  observer.observe(document.body, { childList: true, subtree: true });
});

/**
 * Render a tile's LIVE mesh (with its currently-applied Token Magic filters and the
 * exact random values already rolled) straight into the target RenderTexture.
 *
 * Why this fixes the Random Overlay drift:
 * the old code called generateTexture() on each mesh and then re-placed/rescaled the
 * resulting sprite. generateTexture() renders the mesh with a different filter area
 * (it re-frames the object and includes filter padding), so the tiled/offset overlay
 * sprite was sampled against a different frame and then stretched to doc.width/height.
 * That is why the overlay was "always a bit different". Rendering the real mesh in place
 * with only a translation keeps the filter area, scale and offsets identical to the canvas.
 */
function renderTileInto(tile, renderTexture, matrix, clear) {
  const renderer = canvas.app.renderer;
  const mesh = tile.mesh;
  if (!mesh) return false;

  const saved = { alpha: mesh.alpha, visible: mesh.visible, renderable: mesh.renderable };
  try {
    mesh.visible = true;
    mesh.renderable = true;
    // Use the document alpha so GM-view dimming (hidden/occlusion) doesn't leak into the bake
    mesh.alpha = tile.document.alpha ?? 1;
    renderer.render(mesh, { renderTexture, clear, transform: matrix });
    return true;
  } catch (e) {
    console.warn(`Tile Combiner: live mesh render failed for tile ${tile.document.id}`, e);
    return false;
  } finally {
    mesh.alpha = saved.alpha;
    mesh.visible = saved.visible;
    mesh.renderable = saved.renderable;
  }
}

async function renderTileFallback(tile, renderTexture, matrix, clear) {
  const doc = tile.document;
  const texturePath = doc.texture?.src;
  if (!texturePath) return;
  const texture = await loadTexture(texturePath);
  if (!texture) return;

  const sprite = new PIXI.Sprite(texture);
  sprite.anchor.set(0.5, 0.5);
  sprite.width = doc.width;
  sprite.height = doc.height;
  sprite.position.set(doc.x + doc.width / 2, doc.y + doc.height / 2);
  sprite.rotation = Math.toRadians(doc.rotation || 0);
  sprite.alpha = doc.alpha ?? 1;
  if (tile.mesh?.filters?.length) sprite.filters = [...tile.mesh.filters];

  const holder = new PIXI.Container();
  holder.addChild(sprite);
  canvas.app.renderer.render(holder, { renderTexture, clear, transform: matrix });
  holder.destroy({ children: true });
}

async function combineSelectedTiles() {
  const selectedTiles = canvas.tiles.placeables.filter(t => t.controlled);

  if (selectedTiles.length < 2) {
    ui.notifications.warn("Tile Combiner: Please select at least 2 tiles on the canvas to combine.");
    return;
  }

  ui.notifications.info(`Tile Combiner: Compiling ${selectedTiles.length} tiles with full shader footprints...`);

  try {
    const scale = Number(game.settings.get("tile-combiner", "resolutionScale")) || 1;
    const doAutoTrim = game.settings.get("tile-combiner", "autoTrim");

    // 1. Bounding box of all selected tiles
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const tile of selectedTiles) {
      const doc = tile.document;
      minX = Math.min(minX, doc.x);
      minY = Math.min(minY, doc.y);
      maxX = Math.max(maxX, doc.x + doc.width);
      maxY = Math.max(maxY, doc.y + doc.height);
    }

    // Expand by the largest filter padding so filter effects aren't clipped at the edges
    let pad = 0;
    for (const tile of selectedTiles) {
      for (const f of tile.mesh?.filters ?? []) pad = Math.max(pad, f.padding || 0);
    }
    pad = Math.ceil(pad);

    minX = Math.floor(minX - pad);
    minY = Math.floor(minY - pad);
    maxX = Math.ceil(maxX + pad);
    maxY = Math.ceil(maxY + pad);

    const baseWidth = Math.round(maxX - minX);
    const baseHeight = Math.round(maxY - minY);

    if (baseWidth <= 0 || baseHeight <= 0) {
      throw new Error("Invalid bounding dimensions calculated.");
    }

    // 2. Sort so background layers render first
    const sortedTiles = [...selectedTiles].sort((a, b) => {
      if (a.document.elevation !== b.document.elevation) {
        return a.document.elevation - b.document.elevation;
      }
      return a.document.sort - b.document.sort;
    });

    // 3. Render each live mesh into one texture, translated only (no rescaling)
    const renderTexture = PIXI.RenderTexture.create({
      width: baseWidth,
      height: baseHeight,
      resolution: scale
    });
    const matrix = new PIXI.Matrix().translate(-minX, -minY);

    let first = true;
    for (const tile of sortedTiles) {
      let ok = renderTileInto(tile, renderTexture, matrix, first);
      if (!ok) {
        await renderTileFallback(tile, renderTexture, matrix, first);
      }
      first = false;
    }

    let exportCanvas = canvas.app.renderer.extract.canvas(renderTexture);
    renderTexture.destroy(true);

    let finalX = minX;
    let finalY = minY;
    let finalWidth = baseWidth;
    let finalHeight = baseHeight;

    if (doAutoTrim) {
      const trimmed = trimTransparentPadding(exportCanvas, scale);
      exportCanvas = trimmed.canvas;
      finalX = minX + Math.round(trimmed.offsetX / scale);
      finalY = minY + Math.round(trimmed.offsetY / scale);
      finalWidth = Math.round(exportCanvas.width / scale);
      finalHeight = Math.round(exportCanvas.height / scale);
    }

    // 4. Upload image and create the new tile
    const folderPath = `worlds/${game.world.id}/combined-tiles`;
    try {
      await FilePicker.createDirectory("data", folderPath, { notify: false });
    } catch (e) {}

    const blob = await new Promise(resolve => exportCanvas.toBlob(resolve, "image/png"));
    const fileObj = new File([blob], `composite-${Date.now()}.png`, { type: "image/png" });

    const uploadResult = await FilePicker.upload("data", folderPath, fileObj, { notify: false });
    const imageUrl = uploadResult.path;

    const primaryDoc = sortedTiles[0].document;

    // Preserve Baileywiki configuration flags (NOT Token Magic flags, so no filters carry over)
    const cleanFlags = {};
    if (primaryDoc.flags && primaryDoc.flags.baileywiki) {
      cleanFlags.baileywiki = foundry.utils.deepClone(primaryDoc.flags.baileywiki);
    }

    await canvas.scene.createEmbeddedDocuments("Tile", [{
      texture: { src: imageUrl },
      x: finalX,
      y: finalY,
      width: finalWidth,
      height: finalHeight,
      elevation: primaryDoc.elevation,
      sort: primaryDoc.sort,
      hidden: false,
      flags: cleanFlags
    }]);

    await canvas.scene.deleteEmbeddedDocuments("Tile", sortedTiles.map(t => t.id));

    ui.notifications.info("Tile Combiner: Tiles successfully combined with full filter footprints!");

  } catch (err) {
    console.error("Tile Combiner Error:", err);
    ui.notifications.error("Tile Combiner: Failed during combination. Check console (F12).");
  }
}

function trimTransparentPadding(sourceCanvas, scale) {
  const ctx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  let top = null, bottom = null, left = null, right = null;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > 5) {
        if (top === null) top = y;
        if (bottom === null || y > bottom) bottom = y;
        if (left === null || x < left) left = x;
        if (right === null || x > right) right = x;
      }
    }
  }

  if (top === null) return { canvas: sourceCanvas, offsetX: 0, offsetY: 0 };

  const cropWidth = right - left + 1;
  const cropHeight = bottom - top + 1;

  const croppedCanvasElem = document.createElement("canvas");
  croppedCanvasElem.width = cropWidth;
  croppedCanvasElem.height = cropHeight;
  const croppedCtx = croppedCanvasElem.getContext("2d");

  croppedCtx.drawImage(sourceCanvas, left, top, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

  return { canvas: croppedCanvasElem, offsetX: left, offsetY: top };
}
