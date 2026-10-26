#!/usr/bin/env python3
"""Download the world's set pieces into assets/world/ (all freely licensed):

- Kenney Nature, Pirate, Holiday and Fantasy Town kits (CC0, kenney.nl):
  every GLB model plus each kit's shared colormap texture.
- Sky: "Kloofendal 48d Partly Cloudy (Pure Sky)" by Greg Zaal and Jarod Guest
  (CC0, polyhaven.com), the tonemapped JPG, shrunk to 4096 px wide with macOS
  `sips` when available.
- Water normal map from the three.js examples (MIT, github.com/mrdoob/three.js).

Already-downloaded files are skipped, so it can be re-run. Standard library only.
"""
import re
import shutil
import subprocess
import urllib.request
import zipfile
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "assets" / "world"
KENNEY_KITS = ["nature-kit", "pirate-kit", "holiday-kit", "fantasy-town-kit"]
SKY_URL = ("https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG/"
	"kloofendal_48d_partly_cloudy_puresky.jpg")
WATER_NORMALS_URL = "https://raw.githubusercontent.com/mrdoob/three.js/r180/examples/textures/waternormals.jpg"


def fetch(url):
	req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (dorm-sim setup)"})
	with urllib.request.urlopen(req, timeout=120) as resp:
		return resp.read()


def download(path, url):
	if not path.exists():
		print(f"Downloading {path.name}...", flush=True)
		path.parent.mkdir(parents=True, exist_ok=True)
		path.write_bytes(fetch(url))
	return path


def kenney_zip_url(kit):
	"""The zip link on a kit's page (its file name includes a version hash)."""
	page = fetch(f"https://kenney.nl/assets/{kit}").decode("utf-8", "replace")
	match = re.search(r"https://kenney\.nl/media/pages/assets/[^\"']+\.zip", page)
	if not match:
		raise RuntimeError(f"No download link found on kenney.nl/assets/{kit}")
	return match.group(0)


def extract_kit(kit):
	"""Unpacks the kit's GLB models and colormap to assets/world/<kit>/."""
	folder = OUT / kit
	if (folder / ".done").exists():
		return
	zip_path = OUT / "_zips" / f"{kit}.zip"
	if not zip_path.exists():
		download(zip_path, kenney_zip_url(kit))
	folder.mkdir(parents=True, exist_ok=True)
	with zipfile.ZipFile(zip_path) as zf:
		for name in zf.namelist():
			leaf = name.rsplit("/", 1)[-1]
			# Models/GLB format/*.glb (the Nature Kit calls its folder "GLTF format").
			if leaf.lower().endswith(".glb") and "/Models/" in "/" + name:
				(folder / leaf).write_bytes(zf.read(name))
			elif leaf == "colormap.png" and "GLB format/Textures" in name:
				(folder / "Textures").mkdir(exist_ok=True)
				(folder / "Textures" / leaf).write_bytes(zf.read(name))
			elif leaf == "License.txt":
				(folder / leaf).write_bytes(zf.read(name))
	(folder / ".done").write_text("ok")
	print(f"Unpacked {kit}: {len(list(folder.glob('*.glb')))} models")


def fetch_sky():
	sky = OUT / "sky.jpg"
	if sky.exists():
		return
	original = download(OUT / "_zips" / "sky-original.jpg", SKY_URL)
	if shutil.which("sips"):
		subprocess.run(["sips", "--resampleWidth", "4096", str(original), "--out", str(sky)],
			check=True, stdout=subprocess.DEVNULL)
	else:
		shutil.copy(original, sky)  # Full size works too, it's just larger.


def main():
	OUT.mkdir(parents=True, exist_ok=True)
	for kit in KENNEY_KITS:
		extract_kit(kit)
	fetch_sky()
	download(OUT / "waternormals.jpg", WATER_NORMALS_URL)
	print("World assets ready.")


if __name__ == "__main__":
	main()
