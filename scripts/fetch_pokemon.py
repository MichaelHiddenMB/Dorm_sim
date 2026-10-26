#!/usr/bin/env python3
"""Download the Pokémon Rumble World models from The Models Resource.

Each Pokémon's zip is kept in assets/pokemon/_zips/. From it, one OBJ model (with
its MTL and textures) and the menu icon go to assets/pokemon/<asset id>/, and
assets/pokemon/index.json lists them for the follower menu. Downloads are skipped
when the file already exists, so it can be re-run to resume. Standard library only.
"""
import html
import io
import json
import re
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

SITE = "https://models.spriters-resource.com"
LISTING = f"{SITE}/3ds/pokemonrumbleworld/"
OUT = Path(__file__).resolve().parent.parent / "assets" / "pokemon"
DELAY = 0.25  # Seconds between downloads, to go easy on the site.


def fetch(url):
	req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (dorm-sim setup)"})
	with urllib.request.urlopen(req, timeout=60) as resp:
		return resp.read()


def parse_listing(page):
	"""Yields {id, dex, name, icon} for every Pokémon on the listing page."""
	for a in re.finditer(r'<a[^>]+href="/3ds/pokemonrumbleworld/asset/(\d+)/"[^>]*>([\s\S]*?)</a>', page):
		text = " ".join(html.unescape(re.sub(r"<[^>]+>", " ", a.group(2))).split())
		m = re.match(r"#(\d{4}) (.+?)(?: view_in_ar)?$", text)
		icon = re.search(r'src="(/media/asset_icons/[^"?]+)', a.group(2))
		if m and icon:  # Skips the "Props" section (bombs, candy...), which has no dex number.
			yield {"id": int(a.group(1)), "dex": int(m.group(1)), "name": m.group(2), "icon": icon.group(1)}


# Folder names of the default form for species whose zips hold several forms,
# in the order to try them: Normal/Normalm (male), Plant Cloak (Kusa), Overcast
# (Nega), West Sea, Altered (Another), Land, Red-Striped, Standard (Action),
# Spring, Aria (Voice), Red Flower, Shield (Tate).
DEFAULT_FORMS = ["normal", "normalm", "m", "male", "kusa", "nega", "west", "another",
	"land", "red", "action", "spring", "voice", "tate"]


def pick_model(names):
	"""Chooses one model from the zip and returns (path, "obj"|"dae"), or None.
	OBJ is preferred; a few zips (Fennekin, Diancie) only have Collada files.
	Among variants: the root first, then a default-form folder, then anything
	that isn't a Mega Evolution, then the first one alphabetically."""
	def rank(name):
		if "/" not in name:
			return 0
		folder = name.rsplit("/", 1)[0].split("/")[-1].lower()
		if folder in DEFAULT_FORMS:
			return 1 + DEFAULT_FORMS.index(folder)
		return 1000 if "mega" in name.lower() else 100

	for ext in ("obj", "dae"):
		# model.dae is the ripper's combined file with shiny textures too; skip it.
		models = [n for n in names if n.lower().endswith("." + ext)
			and n.rsplit("/", 1)[-1].lower() != "model.dae"]
		if models:
			return min(models, key=lambda n: (rank(n), n)), ext
	return None


def cached(path, url):
	"""Returns the file's bytes, downloading it first if needed."""
	if not path.exists():
		path.parent.mkdir(parents=True, exist_ok=True)
		path.write_bytes(fetch(url))
		time.sleep(DELAY)
	return path.read_bytes()


def save_pokemon(entry):
	folder = OUT / str(entry["id"])
	data = cached(OUT / "_zips" / f"{entry['id']}.zip",
		f"{SITE}/media/assets/{entry['icon'].split('/')[-2]}/{entry['id']}.zip")
	with zipfile.ZipFile(io.BytesIO(data)) as zf:
		picked = pick_model(zf.namelist())
		if not picked:
			print(f"  no model in zip for {entry['name']}, skipping")
			return False
		model_name, fmt = picked
		base = model_name.rsplit("/", 1)[0] + "/" if "/" in model_name else ""
		if folder.exists():  # Rebuild from the zip, in case the chosen variant changed.
			for old in folder.iterdir():
				old.unlink()
		folder.mkdir(parents=True, exist_ok=True)
		for name in zf.namelist():
			# Keep that variant's PNGs and MTL; the model is saved as model.obj/.dae.
			if not name.startswith(base) or "/" in name[len(base):]:
				continue
			leaf = name[len(base):]
			if leaf.lower().endswith(".png") or leaf.lower().endswith(".mtl"):
				(folder / leaf).write_bytes(zf.read(name))
		model = zf.read(model_name).decode("utf-8", "replace")
		mtl = re.search(r"^mtllib (.+)$", model, re.M) if fmt == "obj" else None
		(folder / f"model.{fmt}").write_text(model)
		(folder / "meta.json").write_text(json.dumps({
			"model": f"model.{fmt}", "mtl": mtl.group(1).strip() if mtl else None,
			"variant": base.rstrip("/")
		}))
	(folder / "icon.png").write_bytes(cached(OUT / "_icons" / f"{entry['id']}.png", SITE + entry["icon"]))
	return True


def main():
	OUT.mkdir(parents=True, exist_ok=True)
	entries = list(parse_listing(fetch(LISTING).decode("utf-8", "replace")))
	print(f"Found {len(entries)} Pokémon.")
	index = []
	for i, entry in enumerate(entries, 1):
		folder = OUT / str(entry["id"])
		try:
			if not (OUT / "_zips" / f"{entry['id']}.zip").exists():
				print(f"[{i}/{len(entries)}] #{entry['dex']:04d} {entry['name']}", flush=True)
			if not save_pokemon(entry):
				continue
		except Exception as error:  # Keep going; a re-run retries failures.
			print(f"  failed: {error}", file=sys.stderr)
			continue
		meta = json.loads((folder / "meta.json").read_text())
		index.append({
			"id": entry["id"], "dex": entry["dex"], "name": entry["name"],
			"dir": f"assets/pokemon/{entry['id']}/", "model": meta["model"], "mtl": meta["mtl"]
		})
	(OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1))
	print(f"Wrote {len(index)} Pokémon to {OUT / 'index.json'}")


if __name__ == "__main__":
	main()
