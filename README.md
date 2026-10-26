# Dorm_sim

A browser Mii Maker plus a little 3D resort island, in a Frutiger Aero / Wii Sports Resort style, where your Miis wander around on their own, each with a partner Pokémon following along.

## Run it

```sh
./scripts/setup.sh          # downloads FFL.js, Mii and Pokémon assets into vendor/ and assets/
python3 scripts/serve.py      # local server with caching off, so refreshes always get the latest code
```

Open http://localhost:8000. Make your first Mii and press **OK**, then pick a partner Pokémon and press **OK** again. In the world:

- **Click a Mii** (or its Pokémon) for a menu above its head: **Appearance** opens the Mii Maker, the partner button opens the Pokémon picker.
- **Click and hold a Mii** to pick it up, drag it anywhere, and let go to drop it.
- **The round + button** (bottom left) makes another Mii.
- **Drag empty ground** to orbit the camera, right-drag to pan, scroll/pinch or **+ / −** to zoom.

Everything (each Mii, its partner, and where it is) is saved in the browser's localStorage.

The first `setup.sh` run downloads all 719 Pokémon (about 20 MB, a few minutes). It's resumable: re-run it if it gets interrupted.

## Where the assets come from

No art in this repo is original. `setup.sh` downloads everything, and none of it is committed:

| What | Source | License |
| --- | --- | --- |
| Mii head renderer | [FFL.js](https://github.com/ariankordi/FFL.js) v2.2.2 (FFL decomp in WASM + Three.js) | AGPL-3.0 |
| Mii parts: face shapes, skin colors, wrinkles, makeup, 132 hairstyles, eyebrows, eyes, noses, mouths, mustaches, beards, glasses, moles | `AFLResHigh_2_3.dat`, Nintendo's Mii resource from Miitomo, [archived on archive.org](https://web.archive.org/web/20180502054513/http://download-cdn.miitomo.com/native/20180125111639/android/v2/asset_model_character_mii_AFLResHigh_2_3_dat.zip) | © Nintendo |
| Male/female body models | [ffl-raylib-samples/models](https://github.com/ariankordi/ffl-raylib-samples/tree/master/models) (Wii U Mii Maker body) | Repo is Unlicense; the model is Nintendo's |
| Mii Maker UI icons (part tabs, every part's grid icon, gender) | Wii U Mii Maker rips on [The Spriters Resource](https://www.spriters-resource.com/wii_u/systembios/) by xAct, RFGuy, DogToon64 | © Nintendo |
| Partner Pokémon: 719 models (Gen I–VI) and their menu icons | Pokémon Rumble World rips on [The Models Resource](https://models.spriters-resource.com/3ds/pokemonrumbleworld/), uploaded by Ploaj | © Nintendo / Creatures / GAME FREAK / The Pokémon Company |
| Island set pieces: palm trees, fountain, benches, lanterns, market stalls, trees, bushes, flowers, grass, rocks, dock and rowboat | [Kenney](https://kenney.nl) Nature Kit, Pirate Kit, Holiday Kit and Fantasy Town Kit | CC0 |
| Sky panorama (background and reflections) | [Kloofendal 48d Partly Cloudy (Pure Sky)](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky) by Greg Zaal and Jarod Guest, Poly Haven | CC0 |
| Ocean ripples | `waternormals.jpg` and the `Water` effect from the [three.js examples](https://github.com/mrdoob/three.js/tree/r180/examples) | MIT |
| Adjustment arrows and Miis' reaction bubbles (♪, ♥, chat, sun, !) | [Material Symbols](https://fonts.google.com/icons) via Google Fonts | Apache-2.0 |
| 3D engine | [three.js](https://threejs.org) r180 via jsDelivr | MIT |

Data taken from other projects (in `src/`):

- **Part display order** (which part sits on which Mii Maker page, also the order of the icon sheets): `lookupTables.pages` in [MiiJS](https://github.com/Stewared/MiiJS/blob/main/data.js).
- **Color palettes** (hair, eyes, mouth, glasses, skin, favorite color): `src/FFLiColor.cpp` in the [FFL decomp](https://github.com/aboood40091/ffl).

The Mii resource, body models, Mii Maker icons and Pokémon models are Nintendo / The Pokémon Company IP. They're fine for a personal or learning project, but don't ship them publicly or commercially. Because FFL.js is AGPL-3.0, publicly hosting this site means releasing its source under the AGPL as well.

## Code

- `src/miiData.js`: builds the 288-byte `FFLiCharInfo` struct, with field offsets and ranges taken from FFL, plus the color palettes.
- `src/makerLayout.js`: Mii Maker tabs, part pages, sprite-sheet geometry and adjustment buttons.
- `src/main.js`: scene, the Mii Maker UI, world interaction (click menu, carry and drop), saving, and switching between the world and the menus.
- `src/miiModel.js`: builds a Mii's model (FFL head on the glTF body).
- `src/resident.js`: one Mii in the world: wandering, sitting, sunbathing, admiring the fountain and flowers, chatting, waving, cheering, being carried and dropped, and its partner.
- `src/world.js`: the island: sky, grass and beach, ocean, where every set piece goes, the props Miis walk around, the spots they use (bench seats, beach, fountain, flowers), and the swaying trees and bobbing boat.
- `scripts/fetch_world.py`: downloads the Kenney kits, the sky and the water texture into `assets/world/`.
- `src/pokemon.js`: loads the Rumble models (OBJ/MTL) and the follower's hopping, trailing and blinking.
- `src/partnerMenu.js`: the partner picker (generation tabs, search, paged icon grid).
- `scripts/fetch_pokemon.py`: downloads the Rumble zips, picks each Pokémon's base form, and writes `assets/pokemon/index.json`.
