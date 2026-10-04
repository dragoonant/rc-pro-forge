# RC Pro Forge

An isometric RC racing game in the spirit of the NES classic. All art was generated locally with SDXL and converted to pixel art. Music and sound are synthesized in the browser.

## Play

Open `index.html` in a browser by double-clicking it. Or, if you'd rather serve it:

```bash
python -m http.server 8417
```

Then browse to http://localhost:8417.

| Action  | 1 player             | 2P: player 1 | 2P: player 2   |
|---------|----------------------|--------------|----------------|
| Gas     | W / Up / Z           | W            | Up             |
| Brake   | S / Down / X         | S            | Down           |
| Steer   | A D / Left Right     | A D          | Left Right     |
| Missile | Space / F / C        | F            | / or Enter     |
| Bomb    | Shift / G / V        | G            | . or R-Shift   |

Gamepads: A or RT = gas, B or LT = brake, X or RB = missile, Y or LB = bomb, Start = pause. Press M to mute.

There are 8 rounds across 4 tracks. Finish last and you lose a continue. Prize money buys engine, tire, battery and ammo upgrades in the pit shop. Collect F-O-R-G-E letters to unlock the Forge Formula car.

## Regenerating the art

These scripts use the SDXL install at `C:\Users\antho\.cache\hy3dgen\sdxl` through the Hunyuan3D-2 virtual environment.

```bash
cd tools
python gen_assets.py [name ...] [--seeds N] [--force]   # raw renders -> tools/raw/
python sheet.py tree_ car_                               # contact sheet -> raw/_sheet.png
python process_assets.py [name ...]                      # pixelate -> assets/ + manifest.js
python preview.py                                        # processed preview -> raw/_preview.png
```

- `tools/prompts.py` holds every prompt.
- `tools/picks.json` chooses which seed to use for each asset, with options:
  - `flip` rotates the image 180°.
  - `detail=N` sets texture contrast.
  - `nogrey` strips grey drop shadows.
- Textures are generated with circular convolution padding, so they tile seamlessly.

## Code

`src/` holds plain scripts with no build step:

- `track.js`: track geometry and the pre-rendered isometric ground.
- `car.js`: physics and the AI driver.
- `race.js`: weapons, hazards, pickups and world rendering.
- `game.js`: menus, HUD and shop.
- `audio.js`: Web Audio synth with a procedural chiptune generator.

Tracks are defined as grid corner lists in `src/tracks.js`.
