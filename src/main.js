// Mii world: Miis wander around a plane with their partner Pokémon. Click a Mii
// for a menu (change its look or partner); click and hold to pick it up and
// drop it somewhere else. The Mii Maker and partner picker edit one Mii at a time.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
	FIELDS, getField, setField, getName, setName, paletteFor, toHex, fromHex
} from './miiData.js';
import { SHEETS, PARTS, ADJUSTMENTS, TABS, PAGE_SIZE } from './makerLayout.js';
import { el, symbol } from './dom.js';
import { loadPokemonIndex, loadPokemonModel, iconUrl } from './pokemon.js';
import { createPartnerMenu } from './partnerMenu.js';
import { initMiiModels, randomCharInfo } from './miiModel.js';
import { Resident } from './resident.js';
import { buildWorld, keepOnIsland, isWalkable } from './world.js';

const RESIDENTS_KEY = 'dorm-sim.residents';
// Saves from before there could be several Miis.
const OLD_MII_KEY = 'dorm-sim.mii';
const OLD_PARTNER_KEY = 'dorm-sim.partner';

const statusEl = document.getElementById('status');
const appEl = document.getElementById('app');

// ---------------------------------------------------------------------
//  Renderer, scene, world
// ---------------------------------------------------------------------

// FFL's shaders work in sRGB, so opt out of Three.js color management.
THREE.ColorManagement.enabled = false;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('viewport').append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa8dcff); // Until the sky panorama loads (world.js).
scene.fog = new THREE.Fog(0xcfe7f6, 900, 3200); // Haze over the far ocean.

scene.add(new THREE.HemisphereLight(0xffffff, 0x6a8f5a, 2));
// The sun is nearly overhead (about 9 degrees off), so each shadow sits at the
// Mii's feet and shows where a carried Mii will land. The small tilt points
// shadows to the side rather than toward the camera, so their shapes read.
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(-45, 300, -20);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.left = sun.shadow.camera.bottom = -340; // Covers the whole wander area.
sun.shadow.camera.right = sun.shadow.camera.top = 340;
sun.shadow.camera.near = 50;
sun.shadow.camera.far = 600;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.3;
scene.add(sun);


const camera = new THREE.PerspectiveCamera(30, 1, 1, 3000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.zoomSpeed = 2.5; // The default barely moves with trackpad pinches.
controls.maxPolarAngle = Math.PI / 2 - 0.05; // Stay above the ground.

// Edit-mode camera: starts on the whole Mii, and zooming in slides the view up to the face.
const EDIT_DISTANCE = 80;
const EDIT_MIN_DISTANCE = 26;
/** Where the Mii being edited stands: on the plaza path, the fountain behind it. */
const STAGE = new THREE.Vector3(0, 0, 76);
// World camera: an overview of the play area.
const WORLD_CAMERA_OFFSET = new THREE.Vector3(0, 120, 220);

function resize() {
	const { clientWidth: w, clientHeight: h } = renderer.domElement.parentElement;
	renderer.setSize(w, h);
	camera.aspect = w / h;
	camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ---------------------------------------------------------------------
//  Residents (the Miis in the world)
// ---------------------------------------------------------------------

/** @type {Resident[]} */
const residents = [];

/** The Mii open in the Mii Maker / partner picker, or null in the world. */
/** @type {Resident|null} */
let editing = null;
/** Whether `editing` is brand new (goes Mii Maker -> partner -> world). */
let editingIsNew = false;
/** The edited Mii's charInfo (the Mii Maker UI below reads and writes this). */
let charInfo;
/** Last charInfo that rendered successfully, to roll back to on errors. */
let lastGoodCharInfo;
let rebuildQueued = false;

/** @type {import('./pokemon.js').PokemonEntry[]} */
let pokemonList = [];

function saveResidents() {
	try {
		localStorage.setItem(RESIDENTS_KEY, JSON.stringify(residents.map(r => ({
			charInfo: toHex(r.charInfo),
			partner: r.partnerId,
			// While a Mii is on the editing stage, save where it stood in the world.
			x: Math.round(r === editing ? stageReturn.position.x : r.root.position.x),
			z: Math.round(r === editing ? stageReturn.position.z : r.root.position.z)
		}))));
	} catch { /* Storage unavailable; the world just won't persist. */ }
}
window.addEventListener('pagehide', saveResidents);

/** Saved residents, including a one-Mii save from before there could be several. */
function loadSavedResidents() {
	try {
		const saved = JSON.parse(localStorage.getItem(RESIDENTS_KEY) ?? 'null');
		if (Array.isArray(saved)) {
			return saved;
		}
		const oldMii = localStorage.getItem(OLD_MII_KEY);
		if (oldMii) {
			const oldPartner = localStorage.getItem(OLD_PARTNER_KEY);
			return [{ charInfo: oldMii, partner: oldPartner && oldPartner !== 'none' ? Number(oldPartner) : null, x: 0, z: 0 }];
		}
	} catch { /* Storage unavailable or corrupt. */ }
	return [];
}

/** A random open spot near the middle of the world. */
function randomSpot() {
	const angle = Math.random() * Math.PI * 2;
	const distance = Math.random() * 120;
	return { x: Math.cos(angle) * distance, z: Math.sin(angle) * distance };
}

/** Creates a resident and builds its model. Returns null if its data is invalid. */
function addResident(data) {
	const resident = new Resident(scene, data);
	try {
		resident.rebuild();
	} catch (error) {
		console.warn('Skipping a Mii that FFL rejected:', error);
		resident.dispose();
		return null;
	}
	residents.push(resident);
	if (resident.partnerId !== null && pokemonList.length) {
		setResidentPartner(resident, pokemonList.find(p => p.id === resident.partnerId) ?? null);
	}
	return resident;
}

/** Loads (or clears) a resident's partner Pokémon model. */
async function setResidentPartner(resident, entry) {
	resident.partnerId = entry?.id ?? null;
	if (!entry) {
		resident.follower.setModel(null);
		return;
	}
	try {
		const prototype = await loadPokemonModel(entry);
		if (resident.partnerId !== entry.id) {
			return; // Another Pokémon was picked while this one loaded.
		}
		resident.follower.setModel(prototype);
		placeFollower(resident);
	} catch (error) {
		console.error(error);
		showStatus(`Couldn't load ${entry.name}.`, true);
	}
}

/** Puts a resident's partner where the current mode wants it. */
function placeFollower(resident) {
	const follower = resident.follower;
	if (resident === editing) {
		follower.root.visible = mode === 'partner' && Boolean(follower.model);
		follower.standBeside(resident.root);
	} else {
		follower.root.visible = resident.root.visible && Boolean(follower.model);
		follower.snapBehind(resident.root);
	}
}

/** Rebuilds the edited Mii after Mii Maker changes. */
function rebuildMii() {
	rebuildQueued = false;
	editing.charInfo = charInfo;
	try {
		editing.rebuild();
	} catch (error) {
		console.error(error);
		showStatus(`Couldn't build that Mii: ${error.message}`, true);
		charInfo = lastGoodCharInfo.slice();
		editing.charInfo = charInfo;
		renderMaker();
		return;
	}
	lastGoodCharInfo = charInfo.slice();
	saveResidents();
}

/** Coalesces rapid edits into one rebuild per frame. */
function queueRebuild() {
	rebuildQueued = true;
}

// ---------------------------------------------------------------------
//  Mii Maker UI
// ---------------------------------------------------------------------

const tabsEl = document.getElementById('tabs');
const subtabsEl = document.getElementById('subtabs');
const workspaceEl = document.getElementById('workspace');

let activeTab = TABS[0];
let activeSub = 0;
let page = 0;

/**
 * An icon cut from one of the Mii Maker sprite sheets. It scales to the
 * width of its container (percent-based background size and position).
 * @param {import('./makerLayout.js').SpriteRef} ref
 */
function sprite([sheetKey, index]) {
	const s = SHEETS[sheetKey];
	const { x, y } = cellOrigin(s, index);
	const node = el('span', { className: 'sprite' + (s.whiteArt ? ' inverted' : '') });
	Object.assign(node.style, {
		backgroundImage: `url(${s.url})`,
		backgroundSize: `${(s.w / s.cw) * 100}% ${(s.h / s.ch) * 100}%`,
		backgroundPosition: `${(x / (s.w - s.cw)) * 100}% ${(y / (s.h - s.ch)) * 100}%`,
		aspectRatio: `${s.cw} / ${s.ch}`
	});
	return node;
}

const cellOrigin = (s, index) => ({
	x: s.x0 + (index % s.cols) * s.pitchX,
	y: s.y0 + Math.floor(index / s.cols) * s.pitchY
});

/** @type {Record<string, Promise<HTMLImageElement>>} */
const sheetImages = {};
const loadSheet = key => (sheetImages[key] ??= new Promise((resolve, reject) => {
	const img = new Image();
	img.onload = () => resolve(img);
	img.onerror = reject;
	img.src = SHEETS[key].url;
}));

/**
 * Like sprite(), but drawn on a canvas with high-quality downsampling.
 * Thin line art (the part tab icons) breaks up when CSS scales it down a lot.
 * @param {import('./makerLayout.js').SpriteRef} ref
 * @param {number} cssWidth
 */
function smallSprite([sheetKey, index], cssWidth) {
	const s = SHEETS[sheetKey];
	const ratio = window.devicePixelRatio || 1;
	const canvas = el('canvas', {
		className: 'sprite small',
		width: Math.round(cssWidth * ratio),
		height: Math.round((cssWidth * s.ch / s.cw) * ratio)
	});
	canvas.style.width = `${cssWidth}px`;
	loadSheet(sheetKey).then((img) => {
		const ctx = canvas.getContext('2d');
		ctx.imageSmoothingQuality = 'high';
		const { x, y } = cellOrigin(s, index);
		const inset = 6; // Keep the sheet's blue grid lines out of the filtered edges.
		ctx.drawImage(img, x + inset, y + inset, s.cw - inset * 2, s.ch - inset * 2,
			0, 0, canvas.width, canvas.height);
	});
	return canvas;
}

function edit(key, value) {
	setField(charInfo, key, value);
	queueRebuild();
	renderMaker();
}

function selectTab(tab, subIndex = 0) {
	activeTab = tab;
	activeSub = subIndex;
	const sub = tab.subtabs?.[subIndex];
	if (sub) {
		// Open the page that holds the Mii's current part.
		const position = PARTS[sub.part].order.indexOf(getField(charInfo, sub.part));
		page = Math.max(0, Math.floor(position / PAGE_SIZE));
	}
	renderMaker();
}

function renderMaker() {
	tabsEl.replaceChildren(...TABS.map(tab => el('button', {
		type: 'button',
		className: 'tab' + (tab === activeTab ? ' active' : ''),
		title: tab.label,
		ariaLabel: tab.label,
		ariaPressed: String(tab === activeTab),
		onclick: () => selectTab(tab)
	}, [smallSprite(['partIcons', tab.icon], 54)])));

	const subs = activeTab.subtabs ?? [];
	subtabsEl.hidden = subs.length < 2;
	subtabsEl.replaceChildren(...(subs.length < 2 ? [] : subs.map((sub, i) => el('button', {
		type: 'button',
		className: 'subtab' + (i === activeSub ? ' active' : ''),
		title: sub.label,
		ariaLabel: sub.label,
		ariaPressed: String(i === activeSub),
		onclick: () => selectTab(activeTab, i)
	}, [sub.icon ? sprite(sub.icon) : el('span', { className: 'subtab-text', textContent: sub.label })]))));

	workspaceEl.dataset.view = activeTab.body ? 'body' : 'parts';
	workspaceEl.replaceChildren(...(activeTab.body ? renderBody() : renderPartEditor(subs[activeSub])));
}

/** @param {import('./makerLayout.js').SubTab} sub */
function renderPartEditor(sub) {
	const part = PARTS[sub.part];
	const current = getField(charInfo, sub.part);
	const partLabel = sub.label ?? activeTab.label;

	// Adjustment buttons (position, spacing, rotation, size, stretch).
	const adjust = el('div', { className: 'adjust' });
	if (sub.flip) {
		const flipped = getField(charInfo, sub.flip) === 1;
		adjust.append(el('div', { className: 'adjust-group', title: 'Flip hair part' }, [
			el('button', {
				type: 'button',
				className: 'adjust-btn' + (flipped ? ' active' : ''),
				ariaLabel: 'Flip hair part',
				ariaPressed: String(flipped),
				onclick: () => edit(sub.flip, flipped ? 0 : 1)
			}, [symbol('flip')])
		]));
	}
	for (const [kind, key] of Object.entries(sub.adjust ?? {})) {
		const { label, buttons } = ADJUSTMENTS[kind];
		const value = getField(charInfo, key);
		const { min, max } = FIELDS[key];
		adjust.append(el('div', { className: 'adjust-group', title: label, role: 'group', ariaLabel: label },
			buttons.map(([icon, delta, iconClass]) => el('button', {
				type: 'button',
				className: 'adjust-btn',
				ariaLabel: `${label}: ${icon.replace(/_/g, ' ')}`,
				disabled: value + delta < min || value + delta > max,
				onclick: () => edit(key, value + delta)
			}, [symbol(icon, iconClass)]))));
	}

	// Part grid, 12 per page like Mii Maker.
	const pages = Math.ceil(part.order.length / PAGE_SIZE);
	page = Math.min(page, pages - 1);
	const turnPage = (delta) => {
		page = (page + delta + pages) % pages;
		renderMaker();
	};
	const tiles = part.order.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((id) => {
		const ref = part.icon(id);
		return el('button', {
			type: 'button',
			className: 'tile' + (id === current ? ' active' : ''),
			ariaLabel: `${partLabel} ${part.order.indexOf(id) + 1}`,
			ariaPressed: String(id === current),
			onclick: () => edit(sub.part, id)
		}, [ref ? sprite(ref) : el('span', { className: 'tile-text', textContent: part.label(id) })]);
	});
	const gridArea = el('div', { className: 'grid-area' }, [
		el('div', { className: 'pager', hidden: pages < 2 }, [
			el('button', { type: 'button', ariaLabel: 'Previous page', onclick: () => turnPage(-1) }, [symbol('chevron_left')]),
			el('span', { textContent: `${page + 1} / ${pages}` }),
			el('button', { type: 'button', ariaLabel: 'Next page', onclick: () => turnPage(1) }, [symbol('chevron_right')])
		]),
		el('div', { className: 'grid' }, tiles)
	]);

	return [adjust, gridArea, sub.color ? renderPalette(sub.color, 'palette') : el('div', { className: 'palette empty' })];
}

function renderPalette(key, className) {
	const current = getField(charInfo, key);
	return el('div', { className, role: 'group', ariaLabel: 'Color' }, paletteFor(key).map((css, i) => {
		const swatch = el('button', {
			type: 'button',
			className: 'swatch' + (i === current ? ' active' : ''),
			ariaLabel: `Color ${i + 1}`,
			ariaPressed: String(i === current),
			onclick: () => edit(key, i)
		});
		swatch.style.background = css;
		return swatch;
	}));
}

function renderBody() {
	const nameInput = el('input', {
		type: 'text', maxLength: 10, value: getName(charInfo), autocomplete: 'off', spellcheck: false,
		oninput: () => {
			setName(charInfo, nameInput.value);
			queueRebuild();
		}
	});
	const slider = (key, label) => {
		const input = el('input', {
			type: 'range', min: FIELDS[key].min, max: FIELDS[key].max, value: getField(charInfo, key),
			oninput: () => {
				setField(charInfo, key, Number(input.value));
				queueRebuild();
			}
		});
		return el('label', { className: 'body-field' }, [el('span', { textContent: label }), input]);
	};
	const gender = getField(charInfo, 'gender');
	return [el('div', { className: 'body-form' }, [
		el('label', { className: 'body-field' }, [el('span', { textContent: 'Name' }), nameInput]),
		el('div', { className: 'body-field' }, [
			el('span', { textContent: 'Gender' }),
			el('div', { className: 'gender-row' }, ['Male', 'Female'].map((label, i) => el('button', {
				type: 'button',
				className: 'tile gender' + (gender === i ? ' active' : ''),
				ariaLabel: label,
				ariaPressed: String(gender === i),
				onclick: () => edit('gender', i)
			}, [sprite(['gender', i])])))
		]),
		slider('height', 'Height'),
		slider('build', 'Build'),
		el('div', { className: 'body-field' }, [
			el('span', { textContent: 'Favorite color' }),
			renderPalette('favoriteColor', 'palette favorite')
		])
	])];
}

document.getElementById('randomize').addEventListener('click', () => {
	const name = getName(charInfo);
	charInfo = randomCharInfo();
	setName(charInfo, name);
	queueRebuild();
	renderMaker();
});

// ---------------------------------------------------------------------
//  Modes: world, edit (Mii Maker), partner (choose a Pokémon)
// ---------------------------------------------------------------------

let mode = 'world';
/** Where the edited Mii stood and where the camera was, to restore after editing. */
const stageReturn = { position: new THREE.Vector3(), rotation: 0, cameraPosition: new THREE.Vector3(), cameraTarget: new THREE.Vector3() };

function setMode(next) {
	mode = next;
	appEl.dataset.mode = next;
	controls.minDistance = next === 'edit' ? EDIT_MIN_DISTANCE : 20;
	controls.maxDistance = next === 'world' ? 700 : 300;
	controls.enablePan = next === 'world'; // The menus keep the Mii centered themselves.
	resize();
	if (editing) {
		placeFollower(editing);
	}
	if (next === 'partner') {
		document.getElementById('partner-back').hidden = !editingIsNew;
		partnerMenu?.show();
	}
	if (next !== 'world') {
		frameStage();
	}
}

/**
 * Opens the Mii Maker for a resident. The Mii moves to a stage at the origin,
 * facing the camera, and everyone else is hidden until it's done.
 */
function openEditor(resident, nextMode, isNew = false) {
	closeMiiMenu();
	editing = resident;
	editingIsNew = isNew;
	charInfo = resident.charInfo;
	lastGoodCharInfo = charInfo.slice();

	// Up off its bench or the sand first (frees the spot; it'll come back standing).
	const usedSpot = resident.spot;
	resident.endChat();
	resident.standUp(true);
	stageReturn.position.copy(resident.root.position).setY(0);
	stageReturn.rotation = usedSpot ? usedSpot.yaw : resident.root.rotation.y;
	stageReturn.cameraPosition.copy(camera.position);
	stageReturn.cameraTarget.copy(controls.target);

	resident.state = 'paused';
	resident.root.position.copy(STAGE);
	resident.root.rotation.set(0, 0, 0); // Facing the camera, back to the fountain.
	resident.resetPose();
	for (const r of residents) {
		r.setVisible(r === resident);
	}
	selectTab(TABS[0]);
	setMode(nextMode);
}

/** Puts the edited Mii back in the world and returns to the overview. */
function returnToWorld() {
	if (editing) {
		const resident = editing;
		if (editingIsNew) {
			// New Miis show up somewhere near where the camera is looking.
			const spot = randomSpot();
			resident.root.position.set(stageReturn.cameraTarget.x + spot.x * 0.5, 0, stageReturn.cameraTarget.z + spot.z * 0.5);
			keepOnIsland(resident.root.position, 6);
		} else {
			resident.root.position.copy(stageReturn.position);
			resident.root.rotation.y = stageReturn.rotation;
		}
		resident.state = 'idle';
		resident.timer = 1;
		editing = null;
		for (const r of residents) {
			r.setVisible(true);
			placeFollower(r);
		}
		camera.position.copy(stageReturn.cameraPosition);
		controls.target.copy(stageReturn.cameraTarget);
		saveResidents();
	}
	setMode('world');
}

/** Points the camera at the edited Mii (and its partner, in the partner picker). */
function frameStage() {
	const head = editing.headWorldPosition();
	const target = new THREE.Vector3(STAGE.x, head.y * 0.6, STAGE.z);
	const offset = new THREE.Vector3(0, 0, EDIT_DISTANCE);
	if (mode === 'partner') {
		// Center between the Mii and its partner standing beside it.
		target.x += 6;
		offset.set(0, 6, EDIT_DISTANCE);
	}
	controls.target.copy(target);
	camera.position.copy(target).add(offset);
}

/**
 * In edit mode, aim between the body and the face depending on zoom:
 * fully zoomed out shows the whole Mii, fully zoomed in centers the face.
 */
function aimForZoom() {
	const head = editing.headWorldPosition();
	const distance = camera.position.distanceTo(controls.target);
	const closeness = THREE.MathUtils.clamp(
		(EDIT_DISTANCE - distance) / (EDIT_DISTANCE - EDIT_MIN_DISTANCE), 0, 1);
	const aimY = THREE.MathUtils.lerp(head.y * 0.6, head.y + 2.5, closeness);
	const dy = aimY - controls.target.y;
	controls.target.y += dy;
	camera.position.y += dy;
}

/** Zoom buttons: scale the camera's distance from what it orbits. */
function zoomBy(factor) {
	const offset = camera.position.clone().sub(controls.target);
	const distance = THREE.MathUtils.clamp(offset.length() * factor,
		controls.minDistance, controls.maxDistance);
	camera.position.copy(controls.target).add(offset.setLength(distance));
}
document.getElementById('zoom-in').addEventListener('click', () => zoomBy(0.75));
document.getElementById('zoom-out').addEventListener('click', () => zoomBy(1 / 0.75));

// New Miis go Mii Maker -> partner picker -> world. Edits from the hover menu
// go straight back to the world.
document.getElementById('maker-ok').addEventListener('click', () =>
	(editingIsNew ? setMode('partner') : returnToWorld()));
document.getElementById('partner-back').addEventListener('click', () => setMode('edit'));
document.getElementById('partner-ok').addEventListener('click', returnToWorld);
document.getElementById('add-mii').addEventListener('click', () => createNewMii());

function createNewMii() {
	const info = randomCharInfo();
	setName(info, `Mii ${residents.length + 1}`); // FFL names random Miis "no name".
	const resident = addResident({ charInfo: info, partnerId: null });
	if (resident) {
		openEditor(resident, 'edit', true);
	}
}

// ---------------------------------------------------------------------
//  Partner Pokémon picker
// ---------------------------------------------------------------------

/** @type {ReturnType<typeof createPartnerMenu>|null} */
let partnerMenu = null;

async function setUpPartners() {
	try {
		pokemonList = await loadPokemonIndex();
	} catch (error) {
		console.warn(error);
		document.getElementById('partner-grid').textContent =
			'No Pokémon found. Run ./scripts/setup.sh to download them.';
		return;
	}
	partnerMenu = createPartnerMenu({
		pokemon: pokemonList,
		getSelected: () => editing?.partnerId ?? null,
		onSelect: (entry) => {
			setResidentPartner(editing, entry);
			saveResidents();
		}
	});
	for (const resident of residents) {
		if (resident.partnerId !== null) {
			setResidentPartner(resident, pokemonList.find(p => p.id === resident.partnerId) ?? null);
		}
	}
	if (mode === 'partner') {
		partnerMenu.show();
	}
}

// ---------------------------------------------------------------------
//  World interaction: click a Mii for its menu, click and hold to carry it
// ---------------------------------------------------------------------

const HOLD_MS = 220; // Holding this long picks the Mii up.
const DRAG_START_PX = 6; // Or moving this far while pressed.

const raycaster = new THREE.Raycaster();
const canvas = renderer.domElement;

/** Pointer position as normalized device coordinates. */
function pointerNdc(event) {
	const rect = canvas.getBoundingClientRect();
	return new THREE.Vector2(
		((event.clientX - rect.left) / rect.width) * 2 - 1,
		-((event.clientY - rect.top) / rect.height) * 2 + 1);
}

/**
 * What's under the pointer: a resident (hit on its body or its partner
 * Pokémon), the 3D point that was hit, and whether it was the Mii itself.
 * @returns {{resident: Resident, point: THREE.Vector3, onMii: boolean}|null}
 */
function pick(event) {
	raycaster.setFromCamera(pointerNdc(event), camera);
	const targets = residents.flatMap(r => [r.hitMesh, r.follower.root]);
	for (const hit of raycaster.intersectObjects(targets, true)) {
		for (let node = hit.object; node; node = node.parent) {
			if (node.userData.resident) {
				const resident = node.userData.resident;
				return { resident, point: hit.point, onMii: hit.object === resident.hitMesh };
			}
		}
	}
	return null;
}

/**
 * The current press on a Mii. While carrying, the grabbed spot on the Mii
 * (grabHeight above its feet, grabOffset from its center) stays under the pointer.
 * @type {{resident: Resident, pointerId: number, x: number, y: number, ndc: THREE.Vector2,
 *   timer: number, dragging: boolean, grabHeight: number, grabOffset: THREE.Vector3}|null}
 */
let press = null;

function startCarrying() {
	if (!press || press.dragging) {
		return;
	}
	clearTimeout(press.timer);
	press.dragging = true;
	closeMiiMenu();
	press.resident.pickUp();
	appEl.classList.add('carrying');
}

const carryPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
/**
 * Moves the carried Mii so the spot you grabbed stays under the pointer, even
 * while it's still rising.
 */
function updateCarry() {
	if (!press?.dragging) {
		return;
	}
	const resident = press.resident;
	carryPlane.constant = -(resident.root.position.y + press.grabHeight);
	raycaster.setFromCamera(press.ndc, camera);
	const hit = raycaster.ray.intersectPlane(carryPlane, new THREE.Vector3());
	if (hit) {
		hit.add(press.grabOffset);
		resident.moveHeldTo(hit.x, hit.z);
	}
}

// Capture phase on the canvas, so a press on a Mii never reaches OrbitControls
// (no camera spin while carrying someone).
canvas.addEventListener('pointerdown', (event) => {
	if (mode !== 'world' || event.button !== 0) {
		return;
	}
	const picked = pick(event);
	if (!picked) {
		closeMiiMenu();
		return;
	}
	event.stopImmediatePropagation();
	event.preventDefault();
	canvas.setPointerCapture(event.pointerId);
	const { resident, point, onMii } = picked;
	const root = resident.root.position;
	press = {
		resident,
		pointerId: event.pointerId,
		x: event.clientX,
		y: event.clientY,
		ndc: pointerNdc(event),
		dragging: false,
		// Grabbed by its Pokémon: hold the Mii by its middle instead.
		grabHeight: onMii ? point.y - root.y : resident.headHeight() * 0.6,
		grabOffset: onMii ? new THREE.Vector3(root.x - point.x, 0, root.z - point.z) : new THREE.Vector3(),
		timer: setTimeout(startCarrying, HOLD_MS)
	};
}, { capture: true });

canvas.addEventListener('pointermove', (event) => {
	if (!press || event.pointerId !== press.pointerId) {
		return;
	}
	press.ndc = pointerNdc(event);
	if (!press.dragging && Math.hypot(event.clientX - press.x, event.clientY - press.y) > DRAG_START_PX) {
		startCarrying();
	}
});

function endPress(event) {
	if (!press || event.pointerId !== press.pointerId) {
		return;
	}
	clearTimeout(press.timer);
	const { resident, dragging } = press;
	press = null;
	appEl.classList.remove('carrying');
	if (dragging) {
		resident.drop();
		saveResidents();
	} else if (event.type === 'pointerup') {
		openMiiMenu(resident);
	}
}
canvas.addEventListener('pointerup', endPress);
canvas.addEventListener('pointercancel', endPress);

// Hover cursor over Miis.
canvas.addEventListener('pointermove', (event) => {
	if (mode === 'world' && !press) {
		canvas.style.cursor = pick(event) ? 'grab' : '';
	}
});

// ---------------------------------------------------------------------
//  Hover menu above a clicked Mii
// ---------------------------------------------------------------------

const menuEl = document.getElementById('mii-menu');
const menuNameEl = document.getElementById('mii-menu-name');
const menuLookEl = document.getElementById('mii-menu-look');
const menuPartnerEl = document.getElementById('mii-menu-partner');
/** @type {Resident|null} */
let menuResident = null;

function openMiiMenu(resident) {
	if (menuResident && menuResident !== resident) {
		menuResident.resume();
	}
	menuResident = resident;
	resident.pause();
	menuNameEl.textContent = getName(resident.charInfo) || 'Mii';
	const partner = pokemonList.find(p => p.id === resident.partnerId);
	menuLookEl.replaceChildren(
		el('span', { className: 'mii-menu-icon' }, [smallSprite(['partIcons', 0], 30)]),
		el('span', { textContent: 'Appearance' }));
	menuPartnerEl.replaceChildren(
		el('span', { className: 'mii-menu-icon' }, [partner
			? el('img', { src: iconUrl(partner), alt: '' })
			: symbol('pets')]),
		el('span', { textContent: partner ? partner.name : 'Partner' }));
	menuEl.hidden = false;
	positionMiiMenu();
}

function closeMiiMenu() {
	menuResident?.resume();
	menuResident = null;
	menuEl.hidden = true;
}

/** Keeps the menu floating just above the Mii's head. */
function positionMiiMenu() {
	if (!menuResident) {
		return;
	}
	const anchor = menuResident.headWorldPosition();
	anchor.y += 7;
	anchor.project(camera);
	const behind = anchor.z > 1;
	menuEl.style.visibility = behind ? 'hidden' : '';
	const rect = canvas.getBoundingClientRect();
	// Keep the whole bubble on screen (it sits centered above its anchor point).
	const margin = 8;
	const halfWidth = menuEl.offsetWidth / 2;
	const x = THREE.MathUtils.clamp(((anchor.x + 1) / 2) * rect.width, halfWidth + margin, rect.width - halfWidth - margin);
	const y = THREE.MathUtils.clamp(((1 - anchor.y) / 2) * rect.height, menuEl.offsetHeight + 12 + margin, rect.height);
	menuEl.style.left = `${x}px`;
	menuEl.style.top = `${y}px`;
}

menuLookEl.addEventListener('click', () => {
	if (menuResident) {
		openEditor(menuResident, 'edit');
	}
});
menuPartnerEl.addEventListener('click', () => {
	if (menuResident) {
		openEditor(menuResident, 'partner');
	}
});
window.addEventListener('keydown', (event) => {
	if (event.key === 'Escape') {
		closeMiiMenu();
	}
});

// ---------------------------------------------------------------------
//  Frame loop
// ---------------------------------------------------------------------

/** States where a Mii is on its feet and can be nudged aside. */
const GROUNDED_STATES = new Set(['idle', 'walk', 'toSpot', 'toChat', 'chatWait', 'chatting', 'paused']);

// ---------------------------------------------------------------------
//  Chats: now and then, two Miis near each other meet up and talk
// ---------------------------------------------------------------------

const CHAT_RANGE = 120;
const CHAT_CHANCE = 0.35; // Per check, for each free pair in range.
let chatCheck = 2;

/** Every second, maybe pairs up two free Miis to walk over and chat. */
function pairUpChats(dt) {
	chatCheck -= dt;
	if (chatCheck > 0) {
		return;
	}
	chatCheck = 1;
	const free = residents.filter(r => r !== editing && r !== menuResident && r.root.visible && r.canChat());
	for (let i = 0; i < free.length; i++) {
		for (let j = i + 1; j < free.length; j++) {
			const a = free[i];
			const b = free[j];
			if (!a.canChat() || !b.canChat() || Math.random() > CHAT_CHANCE) {
				continue;
			}
			const pa = a.root.position;
			const pb = b.root.position;
			const apart = new THREE.Vector3(pb.x - pa.x, 0, pb.z - pa.z);
			if (apart.length() > CHAT_RANGE || apart.length() < 1) {
				continue;
			}
			// Meet in the middle, a comfortable chatting distance apart.
			const middle = pa.clone().add(pb).multiplyScalar(0.5).setY(0);
			apart.normalize().multiplyScalar(6.5);
			const spotA = middle.clone().sub(apart);
			const spotB = middle.clone().add(apart);
			if (isWalkable(spotA.x, spotA.z, 5) && isWalkable(spotB.x, spotB.z, 5)) {
				a.startChat(b, spotA);
				b.startChat(a, spotB);
			}
		}
	}
}

// ---------------------------------------------------------------------
//  Reaction bubbles above Miis' heads (icons are Material Symbols)
// ---------------------------------------------------------------------

const emoteLayer = document.getElementById('emotes');
/** @type {Map<Resident, HTMLElement>} */
const emoteBubbles = new Map();

function updateEmotes() {
	const now = performance.now();
	const rect = canvas.getBoundingClientRect();
	for (const resident of residents) {
		let bubble = emoteBubbles.get(resident);
		const emote = resident.emote;
		const show = mode === 'world' && resident.root.visible && resident !== menuResident &&
			emote && emote.until > now;
		if (!show) {
			if (bubble) {
				bubble.hidden = true;
			}
			continue;
		}
		if (!bubble) {
			bubble = el('div', { className: 'emote', ariaHidden: 'true' }, [symbol('')]);
			emoteLayer.append(bubble);
			emoteBubbles.set(resident, bubble);
		}
		if (bubble.dataset.icon !== emote.icon || bubble.hidden) {
			// New reaction: swap the icon and replay the pop-in.
			bubble.dataset.icon = emote.icon;
			bubble.firstChild.textContent = emote.icon;
			bubble.classList.remove('pop');
			void bubble.offsetWidth;
			bubble.classList.add('pop');
		}
		const anchor = resident.headWorldPosition();
		anchor.y += 7;
		anchor.project(camera);
		bubble.hidden = anchor.z > 1;
		bubble.style.left = `${((anchor.x + 1) / 2) * rect.width}px`;
		bubble.style.top = `${((1 - anchor.y) / 2) * rect.height}px`;
	}
	for (const [resident, bubble] of emoteBubbles) {
		if (!residents.includes(resident)) {
			bubble.remove();
			emoteBubbles.delete(resident);
		}
	}
}

/** Gently pushes apart Miis standing on the ground that get too close. */
function keepPersonalSpace(dt) {
	const MIN_GAP = 12;
	const grounded = residents.filter(r => r !== editing && r.root.visible && GROUNDED_STATES.has(r.state));
	for (let i = 0; i < grounded.length; i++) {
		for (let j = i + 1; j < grounded.length; j++) {
			const a = grounded[i].root.position;
			const b = grounded[j].root.position;
			const apart = new THREE.Vector3(b.x - a.x, 0, b.z - a.z);
			const distance = apart.length();
			if (distance < MIN_GAP) {
				if (distance < 0.01) {
					apart.set(Math.random() - 0.5, 0, Math.random() - 0.5);
				}
				const push = apart.setLength((MIN_GAP - distance) * Math.min(1, dt * 4) / 2);
				// A Mii with its menu open stays put; the other one steps aside.
				if (grounded[i].state !== 'paused') {
					a.sub(push);
				}
				if (grounded[j].state !== 'paused') {
					b.add(push);
				}
			}
		}
	}
}

const clock = new THREE.Clock();
function animate() {
	requestAnimationFrame(animate);
	const dt = Math.min(clock.getDelta(), 0.1);
	if (rebuildQueued && editing) {
		rebuildMii();
	}
	updateCarry();
	for (const resident of residents) {
		if (resident === editing) {
			resident.updateBlink(performance.now());
			resident.follower.updateBlink(performance.now());
		} else if (resident.root.visible) {
			resident.update(dt, camera.position);
		}
	}
	keepPersonalSpace(dt);
	// Walk around props and stay on the island (the edited Mii is on its stage).
	for (const resident of residents) {
		if (resident !== editing && resident.root.visible) {
			// (Not while sitting: a seat is inside its bench's footprint.)
			if (resident.state !== 'held' && resident.state !== 'falling' && resident.state !== 'using') {
				keepOnIsland(resident.root.position, 5);
			}
			if (resident.follower.model) {
				keepOnIsland(resident.follower.root.position, 3);
			}
		}
	}
	if (mode === 'world') {
		pairUpChats(dt);
	}
	world?.update(dt);
	controls.update();
	if (mode === 'edit' && editing) {
		aimForZoom();
	}
	positionMiiMenu();
	updateEmotes();
	renderer.render(scene, camera);
}

// ---------------------------------------------------------------------
//  Startup
// ---------------------------------------------------------------------

function showStatus(message, isError = false) {
	statusEl.textContent = message;
	statusEl.hidden = !message;
	statusEl.classList.toggle('error', isError);
	if (isError) {
		clearTimeout(showStatus.timer);
		showStatus.timer = setTimeout(() => showStatus(''), 4000);
	}
}

/** @type {{update: (dt: number) => void}|null} */
let world = null;

async function main() {
	showStatus('Loading Mii parts and the island…');
	[, world] = await Promise.all([initMiiModels(renderer), buildWorld(scene, renderer, sun)]);
	resize();
	controls.target.set(0, 10, 0);
	camera.position.copy(controls.target).add(WORLD_CAMERA_OFFSET);

	for (const saved of loadSavedResidents()) {
		const info = fromHex(saved.charInfo ?? '');
		if (info) {
			addResident({ charInfo: info, partnerId: saved.partner ?? null, x: saved.x ?? 0, z: saved.z ?? 0 });
		}
	}
	showStatus('');
	animate();
	const partnersReady = setUpPartners();

	if (residents.length) {
		setMode('world');
		saveResidents(); // Moves an old single-Mii save over to the new format.
	} else {
		// First visit: make your first Mii.
		const resident = addResident({ charInfo: randomCharInfo(), partnerId: null });
		setName(resident.charInfo, 'Player');
		resident.rebuild();
		openEditor(resident, 'edit', true);
		// Suggest the first Pokémon as a partner once the list has loaded.
		partnersReady.then(() => {
			if (resident.partnerId === null && pokemonList.length) {
				setResidentPartner(resident, pokemonList[0]);
			}
		});
	}
}

// For automated tests: ?debug exposes where each Mii is on screen.
if (new URLSearchParams(location.search).has('debug')) {
	globalThis.dormSim = {
		residents,
		camera,
		/** Looks at a resident from an offset (dx, dy, dz) relative to it. */
		focusFrom(resident, dx, dy, dz) {
			controls.target.copy(resident.root.position).setY(8);
			camera.position.copy(controls.target).add(new THREE.Vector3(dx, dy, dz));
		},
		/** Centers the camera on a resident at the given distance. */
		focus(resident, distance = 90) {
			controls.target.copy(resident.root.position).setY(10);
			camera.position.copy(controls.target).add(WORLD_CAMERA_OFFSET.clone().setLength(distance));
		},
		screenPosition(resident, height = 0.5) {
			const p = resident.root.position.clone();
			p.y += resident.headHeight() * height;
			p.project(camera);
			const rect = canvas.getBoundingClientRect();
			return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
		}
	};
}

main().catch((error) => {
	console.error(error);
	showStatus(error.message, true);
	clearTimeout(showStatus.timer); // Keep fatal errors on screen.
});
