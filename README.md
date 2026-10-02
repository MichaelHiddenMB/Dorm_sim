# Dorm_sim

A browser Mii Maker that drops your Mii onto a simple 3D plane you can walk around.

## Run it

```sh
./scripts/setup.sh          # downloads FFL.js + Mii assets into vendor/ and assets/
python3 -m http.server 8000 # any static server works
```

Open http://localhost:8000. Edit your Mii, then press **Enter world** and move with WASD / arrow keys. Your Mii is saved in the browser's localStorage.

## Where the assets come from

No art in this repo is original. `setup.sh` downloads everything, and none of it is committed:

| What | Source | License |
| --- | --- | --- |
| Mii head renderer | [FFL.js](https://github.com/ariankordi/FFL.js) v2.2.2 (FFL decomp in WASM + Three.js) | AGPL-3.0 |
| Mii parts: face shapes, skin colors, wrinkles, makeup, 132 hairstyles, eyebrows, eyes, noses, mouths, mustaches, beards, glasses, moles | `AFLResHigh_2_3.dat`, Nintendo's Mii resource from Miitomo, [archived on archive.org](https://web.archive.org/web/20180502054513/http://download-cdn.miitomo.com/native/20180125111639/android/v2/asset_model_character_mii_AFLResHigh_2_3_dat.zip) | © Nintendo |
| Male/female body models | [ffl-raylib-samples/models](https://github.com/ariankordi/ffl-raylib-samples/tree/master/models) (Wii U Mii Maker body) | Repo is Unlicense; the model is Nintendo's |
| 3D engine | [three.js](https://threejs.org) r180 via jsDelivr | MIT |

The Mii resource and body models are Nintendo IP. They're fine for a personal or learning project, but don't ship them publicly or commercially. Because FFL.js is AGPL-3.0, publicly hosting this site means releasing its source under the AGPL as well.

## Code

- `src/miiData.js`: builds the 288-byte `FFLiCharInfo` struct, with field offsets and ranges taken from FFL.
- `src/main.js`: scene, editor UI, head-on-body assembly, and walking.
