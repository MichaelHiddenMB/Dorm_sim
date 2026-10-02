#!/usr/bin/env bash
# Downloads the third-party code and Mii assets this project needs.
# Nothing downloaded here is committed (see .gitignore).
set -euo pipefail
cd "$(dirname "$0")/.."

FFLJS_VERSION="v2.2.2"
RESOURCE_ZIP_URL="https://web.archive.org/web/20180502054513id_/http://download-cdn.miitomo.com/native/20180125111639/android/v2/asset_model_character_mii_AFLResHigh_2_3_dat.zip"
BODY_BASE_URL="https://raw.githubusercontent.com/ariankordi/ffl-raylib-samples/master/models"

mkdir -p vendor assets
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# FFL.js: Wii U Mii renderer (FFL decomp) for Three.js. AGPL-3.0.
if [ ! -f vendor/ffljs/ffl.js ]; then
	echo "Downloading FFL.js ${FFLJS_VERSION}..."
	curl -fsSL "https://github.com/ariankordi/FFL.js/archive/refs/tags/${FFLJS_VERSION}.tar.gz" | tar xz -C "$tmp"
	rm -rf vendor/ffljs
	mv "$tmp"/FFL.js-* vendor/ffljs
fi

# Mii parts resource (heads, hair, eyes, brows, noses, mouths, beards, glasses, moles...).
# This is Nintendo's AFLResHigh_2_3.dat from Miitomo, via archive.org.
if [ ! -f assets/AFLResHigh_2_3.dat ]; then
	echo "Downloading Mii parts resource (AFLResHigh_2_3.dat)..."
	curl -fSL --retry 3 -o "$tmp/res.zip" "$RESOURCE_ZIP_URL"
	unzip -o -q "$tmp/res.zip" -d "$tmp/res"
	find "$tmp/res" -name 'AFLResHigh_2_3.dat' -exec mv {} assets/AFLResHigh_2_3.dat \;
fi

# Mii body models (Wii U Mii Maker body), from ariankordi/ffl-raylib-samples.
for gender in male female; do
	out="assets/body-${gender}.glb"
	if [ ! -f "$out" ]; then
		echo "Downloading ${gender} body model..."
		curl -fsSL -o "$out" "${BODY_BASE_URL}/miibodymiddle%20${gender}%20test.glb"
	fi
done

# Wii U Mii Maker UI icons, ripped by xAct, RFGuy and DogToon64 on The Spriters Resource.
# Each entry is "<path on spriters-resource>:<local name>".
mkdir -p assets/ui
for spec in \
	256/259641:part-icons 169/171914:gender \
	146/149207:heads 146/149206:hair 146/149202:eyebrows 146/149203:eyes \
	146/149209:noses 146/149208:mouths 146/149204:facial-hair 146/149205:glasses \
	146/149210:wrinkles 146/149201:blushes; do
	out="assets/ui/${spec#*:}.png"
	if [ ! -f "$out" ]; then
		echo "Downloading Mii Maker icons: ${spec#*:}..."
		curl -fsSL -A "Mozilla/5.0" -o "$out" "https://www.spriters-resource.com/media/assets/${spec%%:*}.png"
	fi
done

echo "Done. Start a server with: python3 -m http.server 8000"
