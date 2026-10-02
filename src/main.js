// Mii maker + simple 3D world. Heads/parts are rendered by FFL.js from the
// Mii resource file; bodies are the Wii U Mii Maker body glTFs (see scripts/setup.sh).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import {
	FFL, CharModel, FFLExpression, makeExpressionFlag,
	getRandomCharInfo, pantsColors, PantsColor
} from '../vendor/ffljs/ffl.js';
import FFLShaderMaterial from '../vendor/ffljs/materials/FFLShaderMaterial.js';
import { addSkeletonScalingExtensions } from '../vendor/ffljs/helpers/SkeletonScalingExtensions.js';
import { detectModelDesc } from '../vendor/ffljs/helpers/ModelScaleDesc.js';
import {
	prepareBodyForCharModel, attachHeadToBody, disposeModel
} from '../vendor/ffljs/helpers/BodyUtilities.js';
import {
	CATEGORIES, getField, setField, getName, setName, toHex, fromHex
} from './miiData.js';

const RESOURCE_PATH = 'assets/AFLResHigh_2_3.dat';
const BODY_PATHS = ['assets/body-male.glb', 'assets/body-female.glb']; // Indexed by gender.
const STORAGE_KEY = 'dorm-sim.mii';
const WORLD_HALF_SIZE = 400;
const WALK_SPEED = 40; // World units per second.

const statusEl = document.getElementById('status');
const appEl = document.getElementById('app');

// ---------------------------------------------------------------------
//  Renderer, scene, world
// ---------------------------------------------------------------------

addSkeletonScalingExtensions(THREE.Skeleton); // Needed for Mii height/build bone scaling.

// FFL's shaders work in sRGB, so opt out of Three.js color management.
THREE.ColorManagement.enabled = false;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(window.devicePixelRatio);
document.getElementById('viewport').append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa8dcff);
scene.fog = new THREE.Fog(0xa8dcff, 300, 900);

scene.add(new THREE.HemisphereLight(0xffffff, 0x6a8f5a, 2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(100, 200, 100);
scene.add(sun);

const ground = new THREE.Mesh(
	new THREE.PlaneGeometry(WORLD_HALF_SIZE * 2, WORLD_HALF_SIZE * 2),
	new THREE.MeshLambertMaterial({ color: 0x9fd486 })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const grid = new THREE.GridHelper(WORLD_HALF_SIZE * 2, 40, 0x7fb86a, 0x7fb86a);
grid.position.y = 0.01;
scene.add(grid);

const camera = new THREE.PerspectiveCamera(30, 1, 1, 3000);
camera.position.set(0, 30, 120);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.05; // Stay above the ground.
controls.minDistance = 20;
controls.maxDistance = 400;

/** Holds the Mii; moved around the world in play mode. */
const avatar = new THREE.Group();
scene.add(avatar);

function resize() {
	const { clientWidth: w, clientHeight: h } = renderer.domElement.parentElement;
	renderer.setSize(w, h);
	camera.aspect = w / h;
	camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ---------------------------------------------------------------------
//  Mii model (FFL head + glTF body)
// ---------------------------------------------------------------------

/** @type {FFL} */ let ffl;
/** @type {Array<import('three/addons/loaders/GLTFLoader.js').GLTF>} */ let bodyTemplates;
/** Current FFLiCharInfo bytes being edited. */
let charInfo;
/** Last charInfo that rendered successfully, to roll back to on errors. */
let lastGoodCharInfo;
/** @type {{charModel: CharModel, body: {model: THREE.Object3D}}|null} */
let mii = null;
let rebuildQueued = false;

const expressionFlag = makeExpressionFlag([FFLExpression.NORMAL, FFLExpression.BLINK]);

function buildMii() {
	const charModel = new CharModel(ffl, charInfo, expressionFlag, FFLShaderMaterial, renderer);
	charModel.meshes.traverse((m) => {
		m.frustumCulled = false;
	});

	const gltf = bodyTemplates[charModel.charInfo.gender];
	const model = SkeletonUtils.clone(gltf.scene);
	model.traverse((m) => {
		m.frustumCulled = false;
	});
	const mixer = new THREE.AnimationMixer(model);
	if (gltf.animations.length) {
		mixer.clipAction(gltf.animations[0]).play();
	}
	mixer.update(0); // Pose the body once; walking is done procedurally.
	const body = { model, animations: gltf.animations, mixer, scaleDesc: detectModelDesc(model) };

	prepareBodyForCharModel(body, FFLShaderMaterial, charModel.favoriteColor,
		charModel.getBodyScale(), pantsColors[PantsColor.GrayNormal]);
	attachHeadToBody(body, charModel.meshes);
	return { charModel, body };
}

function disposeMii(old) {
	avatar.remove(old.body.model);
	old.charModel.dispose();
	disposeModel(old.body.model);
}

function rebuildMii() {
	rebuildQueued = false;
	let next;
	try {
		next = buildMii();
	} catch (error) {
		console.error(error);
		showStatus(`Couldn't build that Mii: ${error.message}`, true);
		charInfo = lastGoodCharInfo.slice();
		renderEditor();
		return;
	}
	if (mii) {
		disposeMii(mii);
	}
	mii = next;
	avatar.add(mii.body.model);
	lastGoodCharInfo = charInfo.slice();
	try {
		localStorage.setItem(STORAGE_KEY, toHex(charInfo));
	} catch { /* Storage unavailable; the Mii just won't persist. */ }
	document.getElementById('hud-name').textContent = getName(charInfo) || 'Your Mii';
}

/** Coalesces rapid slider changes into one rebuild per frame. */
function queueRebuild() {
	rebuildQueued = true;
}

/** World position of the Mii's head bone (for camera framing). */
function headWorldPosition() {
	const head = mii?.body.model.getObjectByName('head');
	const pos = new THREE.Vector3();
	if (head) {
		head.getWorldPosition(pos);
	} else {
		avatar.getWorldPosition(pos).y += 20;
	}
	return pos;
}

// ---------------------------------------------------------------------
//  Colors from FFL (for skin and favorite color swatches)
// ---------------------------------------------------------------------

function fflColorCss(fnName, index) {
	const mod = ffl.module;
	const ptr = mod._malloc(16); // sizeof(FFLColor)
	mod[fnName](ptr, index);
	const [r, g, b] = mod.HEAPF32.subarray(ptr / 4, ptr / 4 + 3);
	mod._free(ptr);
	const to255 = v => Math.round(Math.min(1, Math.max(0, v)) * 255);
	return `rgb(${to255(r)}, ${to255(g)}, ${to255(b)})`;
}

const SWATCH_FUNCS = { faceline: '_FFLGetFacelineColor', favorite: '_FFLGetFavoriteColor' };

// ---------------------------------------------------------------------
//  Editor UI
// ---------------------------------------------------------------------

let activeCategory = CATEGORIES[0].id;
const tabsEl = document.getElementById('tabs');
const fieldsEl = document.getElementById('fields');
const nameInput = /** @type {HTMLInputElement} */ (document.getElementById('mii-name'));

function el(tag, props = {}, children = []) {
	const node = Object.assign(document.createElement(tag), props);
	node.append(...children);
	return node;
}

function renderTabs() {
	tabsEl.replaceChildren(...CATEGORIES.map(cat => el('button', {
		type: 'button',
		className: 'tab' + (cat.id === activeCategory ? ' active' : ''),
		textContent: cat.label,
		onclick: () => {
			activeCategory = cat.id;
			renderTabs();
			renderEditor();
		}
	})));
}

function updateField(field, value) {
	setField(charInfo, field, value);
	queueRebuild();
	renderEditor();
}

function renderPartPicker(field, value) {
	if (field.choices) {
		return el('div', { className: 'choices' }, field.choices.map((label, i) => el('button', {
			type: 'button',
			className: 'chip' + (i + field.min === value ? ' active' : ''),
			textContent: label,
			onclick: () => updateField(field, i + field.min)
		})));
	}
	const count = field.max - field.min + 1;
	const step = delta => updateField(field,
		field.min + ((value - field.min + delta + count) % count));
	return el('div', { className: 'stepper' }, [
		el('button', { type: 'button', textContent: '◀', ariaLabel: `Previous ${field.label}`, onclick: () => step(-1) }),
		el('span', { textContent: `${value - field.min + 1} / ${count}` }),
		el('button', { type: 'button', textContent: '▶', ariaLabel: `Next ${field.label}`, onclick: () => step(1) })
	]);
}

function renderColorPicker(field, value) {
	const chips = [];
	for (let i = field.min; i <= field.max; i++) {
		const chip = el('button', {
			type: 'button',
			className: 'chip color' + (i === value ? ' active' : ''),
			ariaLabel: `${field.label} ${i + 1}`,
			onclick: () => updateField(field, i)
		});
		if (field.kind === 'swatch') {
			chip.style.background = fflColorCss(SWATCH_FUNCS[field.swatch], i);
		} else {
			chip.textContent = String(i + 1);
		}
		chips.push(chip);
	}
	return el('div', { className: 'choices' }, chips);
}

function renderSlider(field, value) {
	const shown = field.invert ? field.max + field.min - value : value;
	const input = el('input', {
		type: 'range', min: field.min, max: field.max, value: shown,
		ariaLabel: field.label,
		oninput: () => {
			const v = Number(input.value);
			setField(charInfo, field, field.invert ? field.max + field.min - v : v);
			queueRebuild();
		}
	});
	return input;
}

function renderEditor() {
	nameInput.value = getName(charInfo);
	const category = CATEGORIES.find(c => c.id === activeCategory);
	fieldsEl.replaceChildren(...category.fields.map((field) => {
		const value = getField(charInfo, field);
		const control = field.kind === 'part'
			? renderPartPicker(field, value)
			: field.kind === 'slider'
				? renderSlider(field, value)
				: renderColorPicker(field, value);
		return el('div', { className: 'field' }, [el('label', { textContent: field.label }), control]);
	}));
}

nameInput.addEventListener('input', () => {
	setName(charInfo, nameInput.value);
	queueRebuild();
});

document.getElementById('randomize').addEventListener('click', () => {
	const name = getName(charInfo);
	charInfo = getRandomCharInfo(ffl);
	setName(charInfo, name);
	queueRebuild();
	renderEditor();
});

// ---------------------------------------------------------------------
//  Modes: edit (Mii Maker) and play (walk around the plane)
// ---------------------------------------------------------------------

let mode = 'edit';

function setMode(next) {
	mode = next;
	appEl.dataset.mode = next;
	resize();
	if (next === 'edit') {
		// Bring the Mii back to the center, facing the camera.
		avatar.position.set(0, 0, 0);
		avatar.rotation.set(0, 0, 0);
	}
	frameCamera(true);
}

/** Points the camera at the Mii: close on the face in edit mode, wide in play mode. */
function frameCamera(jump) {
	const head = headWorldPosition();
	let target;
	let offset;
	if (mode === 'play') {
		target = avatar.position.clone().setY(head.y * 0.6);
		offset = new THREE.Vector3(0, 40, 140);
	} else if (activeCategory === 'body') {
		target = avatar.position.clone().setY(head.y * 0.55);
		offset = new THREE.Vector3(0, 6, 95);
	} else {
		target = head.clone().setY(head.y + 2.5);
		offset = new THREE.Vector3(0, 1, 34);
	}
	if (jump) {
		cameraGoal = null;
		controls.target.copy(target);
		camera.position.copy(target).add(offset);
	} else {
		cameraGoal = { target, position: target.clone().add(offset) };
	}
}
/** @type {{target: THREE.Vector3, position: THREE.Vector3}|null} */
let cameraGoal = null;

document.getElementById('enter-world').addEventListener('click', () => setMode('play'));
document.getElementById('edit-mii').addEventListener('click', () => setMode('edit'));
tabsEl.addEventListener('click', () => frameCamera(false));

const keys = new Set();
window.addEventListener('keydown', (e) => {
	if (mode === 'play' && !(e.target instanceof HTMLInputElement)) {
		keys.add(e.key.toLowerCase());
	}
});
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

const axis = (pos, neg) => (keys.has(pos[0]) || keys.has(pos[1]) ? 1 : 0) -
	(keys.has(neg[0]) || keys.has(neg[1]) ? 1 : 0);

let walkTime = 0;
function updateWalking(dt) {
	const forwardInput = axis(['w', 'arrowup'], ['s', 'arrowdown']);
	const rightInput = axis(['d', 'arrowright'], ['a', 'arrowleft']);
	const model = mii?.body.model;
	if (!model) {
		return;
	}
	if (!forwardInput && !rightInput) {
		// Settle back to standing.
		model.position.y *= 0.8;
		model.rotation.z *= 0.8;
		return;
	}

	// Move relative to where the camera is looking, flattened onto the ground.
	const forward = new THREE.Vector3();
	camera.getWorldDirection(forward);
	forward.y = 0;
	forward.normalize();
	const right = new THREE.Vector3().crossVectors(forward, THREE.Object3D.DEFAULT_UP);
	const move = forward.multiplyScalar(forwardInput).add(right.multiplyScalar(rightInput))
		.normalize().multiplyScalar(WALK_SPEED * dt);

	const before = avatar.position.clone();
	avatar.position.add(move);
	avatar.position.x = THREE.MathUtils.clamp(avatar.position.x, -WORLD_HALF_SIZE + 10, WORLD_HALF_SIZE - 10);
	avatar.position.z = THREE.MathUtils.clamp(avatar.position.z, -WORLD_HALF_SIZE + 10, WORLD_HALF_SIZE - 10);
	const moved = avatar.position.clone().sub(before);
	camera.position.add(moved);
	controls.target.add(moved);

	// Turn to face the walking direction (shortest way around).
	const targetYaw = Math.atan2(move.x, move.z);
	const diff = Math.atan2(Math.sin(targetYaw - avatar.rotation.y), Math.cos(targetYaw - avatar.rotation.y));
	avatar.rotation.y += diff * Math.min(1, dt * 12);

	// Simple waddle: bob up and down and sway side to side.
	walkTime += dt;
	model.position.y = Math.abs(Math.sin(walkTime * 10)) * 1.2;
	model.rotation.z = Math.sin(walkTime * 10) * 0.08;
}

// Blinking, like the Mii Maker idle.
let nextBlink = performance.now() + 2000;
let blinking = false;
function updateBlink(now) {
	if (!mii || now < nextBlink) {
		return;
	}
	blinking = !blinking;
	mii.charModel.setExpression(blinking ? FFLExpression.BLINK : FFLExpression.NORMAL);
	nextBlink = now + (blinking ? 120 : 1500 + Math.random() * 2500);
}

const clock = new THREE.Clock();
function animate() {
	requestAnimationFrame(animate);
	const dt = Math.min(clock.getDelta(), 0.1);
	if (rebuildQueued) {
		rebuildMii();
	}
	if (mode === 'play') {
		updateWalking(dt);
	}
	if (cameraGoal) {
		const t = Math.min(1, dt * 6);
		controls.target.lerp(cameraGoal.target, t);
		camera.position.lerp(cameraGoal.position, t);
		if (camera.position.distanceTo(cameraGoal.position) < 0.1) {
			cameraGoal = null;
		}
	}
	updateBlink(performance.now());
	controls.update();
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

async function loadInitialCharInfo() {
	try {
		const saved = fromHex(localStorage.getItem(STORAGE_KEY) ?? '');
		if (saved) {
			return saved;
		}
	} catch { /* Storage unavailable. */ }
	const info = getRandomCharInfo(ffl);
	setName(info, 'Player');
	return info;
}

async function main() {
	showStatus('Loading Mii parts…');
	const loader = new GLTFLoader();
	const resourceResponse = await fetch(RESOURCE_PATH);
	if (!resourceResponse.ok) {
		throw new Error(`Missing ${RESOURCE_PATH}. Run ./scripts/setup.sh first.`);
	}
	[ffl, ...bodyTemplates] = await Promise.all([
		FFL.initWithResource(resourceResponse, globalThis.ModuleFFL),
		...BODY_PATHS.map(path => loader.loadAsync(path))
	]);
	ffl.setRenderer(renderer);

	charInfo = await loadInitialCharInfo();
	lastGoodCharInfo = charInfo.slice();
	resize();
	rebuildMii();
	if (!mii) { // Saved Mii was invalid; start from a random one.
		charInfo = getRandomCharInfo(ffl);
		lastGoodCharInfo = charInfo.slice();
		rebuildMii();
	}
	renderTabs();
	renderEditor();
	setMode('edit');
	showStatus('');
	animate();
}

main().catch((error) => {
	console.error(error);
	showStatus(error.message, true);
	clearTimeout(showStatus.timer); // Keep fatal errors on screen.
});
