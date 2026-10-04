# Handoff: NES remake #2, Marble Madness

This was written by the agent that built **RC Pro Forge**, an RC Pro-Am remake (`C:\Users\antho\OneDrive\Documents\RC Pro Forge`). That game shipped in one session. Anthony played all 8 rounds and loved it: "THAT WAS REALLY FUN!". Reuse what worked and skip the detours listed below.

---

## 1. Who you're building for

- **Clarifying questions:** Anthony wants them in the multiple-choice question UI (the AskUserQuestion tool), not as a text list. He asked for that explicitly ("do the questions in api"). Ask 4 per call at most, and put the recommended option first.
- **His choices last time:**
  - Retro pixel-art look.
  - Browser HTML5 Canvas.
  - The full feature set of the original.
  - 1P vs AI, 2P on the same screen, and gamepad support.
  - Synthesized chiptune audio.
  - Local git, then GitHub Pages.

  Expect similar answers, but still ask.
- **He plays it fully:** he played through all 8 rounds. He took 1st in every round except one 2nd. **The difficulty was too easy.** Tune Marble Madness harder: tighter timers and real danger.
- **His GitHub:** he deploys to GitHub Pages. `gh` is installed at `C:\Program Files\GitHub CLI\gh.exe`, but it isn't on the Bash PATH, so call it by full path. He has to run `gh auth login` himself; you can't do it for him.

## 2. The SDXL setup on this machine

| Item | Value |
|---|---|
| Model (diffusers format) | `C:\Users\antho\.cache\hy3dgen\sdxl\base` (fp16), plus `...\sdxl\vae-fp16-fix` and `...\sdxl\ip-adapter` |
| Python with torch 2.11 cu128 + diffusers 0.32 | `C:\Users\antho\Hunyuan3D-2\.venv\Scripts\python.exe` (also has PIL, numpy, scipy, cv2, rembg) |
| GPU | RTX 5080 16 GB: **~5 s per 1024² image** at 28 steps, ~20 s to load the model |
| Env | set `HF_HUB_OFFLINE=1` (everything is local) |
| Not available | ComfyUI / A1111; rembg's u2net model isn't downloaded (I didn't need it) |

**Copy the whole pipeline from RC Pro Forge's `tools/`:** `gen_assets.py`, `prompts.py`, `process_assets.py`, `sheet.py`, `preview.py` and `picks.json`. It works.

## 3. Art pipeline: lessons learned the hard way

**Workflow that worked**
1. Write every prompt in `prompts.py` as a dict: name → kind (`texture` / `sprite` / `art`), prompt, negative prompt, number of seeds, background color.
2. **Pilot first.** Run 1–2 seeds of *every* prompt (cheap, ~5 min) and look at the contact sheet. Only then generate 4–8 seeds of each. I skipped this once and threw away a whole 90-image batch.
3. Run generation **in the background** (`run_in_background`) and write game code at the same time.
4. Contact sheets: `python sheet.py <prefix> ...` → `raw/_sheet.png`. Pick by eye.
5. `picks.json` maps name → seed, or `[seed, "flip", "detail=12", "nogrey"]`.
6. `process_assets.py` writes `assets/*.png` + `assets/manifest.js` (`const ASSET_NAMES = [...]`).
7. `preview.py` shows the processed sprites at 4×. **Always look at this.** The raw sheet lies about how a sprite reads at 16 px.

**Prompting**
- **Don't** put "pixel art" in *texture* prompts. You get busy, patterned noise in the wrong colors. Use "stylized hand painted game texture, simple, soft, low detail, natural colors" and let post-processing make it pixel art.
- Sprites: `"one single X, <view>, centered with empty space around it, isolated on a plain solid white background"` plus the style "pixel art game sprite, clean dark outline, bold simple shapes". Negative prompt: `multiple objects, many, sprite sheet, pattern, repeated, tiles, collage, scenery, ground, floor, platform, base, cropped, shadow`. Even so, **about half the seeds come back as sprite sheets or patterns.** Generate 4–8 seeds.
- **Magenta backgrounds tint the object.** Use white, and use black for white objects (snow, clouds).
- SDXL **ignores "pointing up"**. Cars came back pointing down, so I added a `flip` option.
- SDXL **can't make**: clean puddles or oil slicks (it paints whole ponds), lamp posts (it paints whole streets), snowmen (it paints scenes), or consistent multi-angle views of one object. Draw those procedurally, or design them out.
- Great at: trees, rocks, barrels, trophies, icons, tileable ground textures, and the **title-screen illustration** (1344×768, which looked fantastic).

**Seamless textures:** set every `Conv2d.padding_mode = "circular"` in the unet + vae for texture jobs, and switch it back to `"zeros"` for sprites. Then box-downscale by an exact divisor (1024 → 64) and the tiling survives.

**Processing (`process_assets.py`)**
- **Keying:**
  1. Take the median border color.
  2. Flood-fill pixels within distance 48 of it, starting from the border (scipy `ndimage.label`).
  3. Apply `binary_opening(iterations=1)`. Two iterations ate thin poles and stems.
  4. Erode by 2 to remove the halo.
  5. Keep blobs that are at least 8% the size of the largest one.
- Downscale with **premultiplied alpha** (BOX filter), then threshold alpha at 0.45.
- **Palette:** use an **adaptive median-cut palette per asset**: 6 colors for textures, 10–12 for sprites, 32 for title art. Mapping to the real NES palette made asphalt brown and sand grey. It was unusable.
- Add a 1 px black outline to sprites. It's essential for readability on busy ground.
- Texture contrast: rescale each texture to a target standard deviation (`detail=N`, ~10–16). SDXL textures are often almost flat.
- Team colors: hue-shift saturated pixels **and paint grey chassis panels** in the team hue. Otherwise dark sprites don't read.
- `nogrey`: strip soft grey drop shadows (I needed it for the trophy).

## 4. Engine architecture that worked (RC Pro Forge `src/`)

- **Plain `<script>` tags with globals, no ES modules and no build step,** so `index.html` works from a double-click (`file://`). Never call `getImageData` on a canvas that an `<img>` has been drawn into (it taints from file://). Calling it on pure vector-path canvases is fine.
- **Resolution:** internal 640×360 canvas, CSS-scaled by an integer with `image-rendering: pixelated`. Fixed 60 Hz timestep with an accumulator.
- **Text:** `font.js` is a hand-made 5×7 bitmap font with per-color glyph atlases. Don't use canvas text; it blurs.
- **Isometric projection:** `sx = x − y`, `sy = (x + y)/2`, i.e. `ctx.setTransform(1, .5, −1, .5, ox, oy)`. Simulate in top-down world space and render in iso.
- **Ground:** pre-render the whole level once into a large offscreen canvas (~3600×1900 is fine). Build each region as a **thresholded mask**: stroke the path, `getImageData`, set alpha to 0 or 255. Then fill it with a texture pattern using `source-in` **in screen space**. That keeps textures crisp and unrotated, where rotated pixel art would shimmer.
- **Depth:** sort every entity each frame by screen-space y. Bake walls facing away from the camera into the ground. Draw walls facing the camera as sortable polygon chunks so they correctly hide things behind them.
- **Fake 3D sprites:** draw a projected top-down sprite 3–4 times, offset upward, with darkened copies underneath ("sprite stacking"), plus a shadow. Cheap and convincing.
- **Fallbacks:** give every asset a procedural stand-in, so the game runs before the art exists. This let me test gameplay while SDXL ran.
- **Audio (`audio.js`):** works with no files.
  - **Voices:** Web Audio pulse waves (PeriodicWave), triangle bass, noise drums.
  - **Music:** procedural songs built from seed, scale and chord progression in an A A′ B A form, one per level.
  - **Context:** unlock the AudioContext on the first key or click.
  - **Testing:** you can't hear the output, so ask the user how it sounds.
- **Input (`input.js`):** keyboard sets for 1P and 2P plus the Gamepad API. A missing pad falls back to the keyboard. Menus read edge-triggered presses.

## 5. Marble Madness: what's different, and how I'd approach it

This is **much harder in the vertical dimension.** RC Pro Forge was flat ground with ramps. Marble Madness *is* height.

- **Level representation:** a **grid heightfield**: per-cell corner heights, with slopes and cliffs. Author levels as compact grid data (ASCII or arrays of heights) in a `levels.js`, as I did with `tracks.js` grid corner lists. Write a validator that checks a path from start to goal exists.
- **Rendering:**
  - **Projection:** iso with height, `sy = (x + y)/2 − z`.
  - **Ground cache:** pre-render the static terrain to a big canvas, as before.
  - **Faces:** draw top faces with a SDXL texture via masks and `source-in`. Draw side and cliff faces procedurally in darker shades.
  - **Lighting and style:** light from top-left, as in the original. The original's look is checkerboard grid lines over flat-shaded slopes. The grid is easy to draw procedurally, and reads better than SDXL textures here.
- **Marble:** draw it **procedurally**: a shaded circle with a specular highlight and a rotating stripe or dots showing spin. SDXL can't produce consistent rotation frames.
- **Physics:**
  - Gravity along the heightfield gradient; per-surface friction.
  - Vertical drop tracking: falling more than about 2 tiles breaks the marble.
  - Sliding off edges into the void; respawn costs time.
- **Controls:** the arcade original used a trackball. Support **mouse movement** (pointer lock), analog stick and keyboard with acceleration. Ask Anthony which feels right.
- **Hazards from the original:**
  - Steelies (black marbles that home in on you).
  - Marble munchers (slinky-like creatures).
  - Acid pools.
  - Hammers.
  - Vacuums.
  - Wave floors.
  - Moving and elevator platforms.
  - Collapsing bridges.

  SDXL can make sprites for the munchers and hammers, plus title art; make everything else procedural.
- **Structure:** 6 timed races: Practice, Beginner, Intermediate, Aerial, Silly, Ultimate. Leftover time carries forward, there are bonus seconds, and 2P is a simultaneous race. Make it **properly hard**.

## 6. Testing in the Claude desktop browser pane

- Start with `preview_start` using `.claude/launch.json`: python `-m http.server` via the Hunyuan venv's python.
- **`requestAnimationFrame` doesn't fire when the pane is hidden.** The game looks frozen even though it isn't. Expose `window.game` and drive it from `javascript_tool`:
  ```js
  window.step = (n) => { for (let i = 0; i < n; i++) { game.update(1/60); if (n - i < 30) game.render(1/60); } return game.state; };
  ```
  Render the last ~30 frames so the smoothed camera catches up.
- **Autopilot:** override `Input.player` to return the AI controller's output, then simulate whole levels headlessly and log progress every 600 frames. This caught a deadlock where AI cars spun out facing backwards and never recovered.
- **Inspect assets in the page:** override `game.render = () => {}`, draw sprites enlarged onto the canvas, and screenshot.
- **Screenshots:** they often time out once ("did not finish rendering"). Just retry.
- **After `location.reload()`:** run the next script in a *separate* call. One script that reloads and then continues gets cut off.

## 7. Process tips

- Start git on day 0 (`.gitignore`: `tools/raw/`). Commit at milestones and end messages with the Co-Authored-By line.
- **winget:** add `--source winget`. The msstore source fails with a certificate error on this machine.
- **Bash `cd`:** it changes the session's working directory. Prefer absolute paths.
- **Status updates:** keep them brief. Anthony is happy to let you run long, but post short progress notes.
- **Test before announcing:** I said "start?" before building and he said yes, then I built everything in one go. Show a screenshot of the first playable build.
