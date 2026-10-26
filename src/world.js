// The island the Miis live on: a Frutiger Aero / Wii Sports Resort-style
// resort island. Every set piece is a found, freely licensed asset (see README):
// Kenney kits (CC0), a Poly Haven sky (CC0), and the three.js water normals (MIT).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Water } from 'three/addons/objects/Water.js';

export const GRASS_RADIUS = 330;
const BEACH_RADIUS = 395;
/** Miis stay on the island (grass and beach), inside this radius. */
export const WALK_RADIUS = 378;
const WATER_LEVEL = -1.5;

/**
 * Circles Miis and Pokémon walk around: {x, z, r}. Filled in as props load.
 * @type {Array<{x: number, z: number, r: number}>}
 */
export const obstacles = [];

/**
 * Places a Mii can use. A spot is where the Mii's feet (sitting: its hips)
 * go, the way it faces (yaw), and where it stands to step in or out.
 * `occupant` is the resident using it, or null.
 * @typedef {{type: 'sit'|'lie', x: number, z: number, y: number, yaw: number,
 *   approach: {x: number, z: number}, occupant: object|null}} Spot
 * @type {Spot[]}
 */
export const spots = [];

/** Whether a point is on the sand (where Miis can lie down anywhere). */
export const isOnBeach = (x, z) => Math.hypot(x, z) > GRASS_RADIUS + 4;

/** A beach spot for lying down right at (x, z), feet toward the sea. */
export function beachSpotAt(x, z) {
	const out = Math.hypot(x, z) || 1;
	return {
		type: 'lie', x, z, y: 0, yaw: Math.atan2(x, z), occupant: null,
		approach: { x: x - (x / out) * 2, z: z - (z / out) * 2 }
	};
}

/** Keeps a point on the island and outside every obstacle (moves it in place). */
export function keepOnIsland(position, radius = 0) {
	for (const o of obstacles) {
		const dx = position.x - o.x;
		const dz = position.z - o.z;
		const min = o.r + radius;
		const distSq = dx * dx + dz * dz;
		if (distSq < min * min) {
			const dist = Math.sqrt(distSq) || 0.001;
			position.x = o.x + (dx / dist) * min;
			position.z = o.z + (dz / dist) * min;
		}
	}
	const fromCenter = Math.hypot(position.x, position.z);
	if (fromCenter > WALK_RADIUS) {
		position.x *= WALK_RADIUS / fromCenter;
		position.z *= WALK_RADIUS / fromCenter;
	}
	return position;
}

/** Whether a spot is free to walk to (on the island and not inside a prop). */
export function isWalkable(x, z, margin = 4) {
	if (Math.hypot(x, z) > WALK_RADIUS) {
		return false;
	}
	return obstacles.every(o => Math.hypot(x - o.x, z - o.z) > o.r + margin);
}

// ---------------------------------------------------------------------
//  Layout
// ---------------------------------------------------------------------

/** Small seeded random generator, so the island looks the same every visit. */
function seededRandom(seed) {
	return () => {
		seed |= 0;
		seed = (seed + 0x6D2B79F5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const model = (kit, name) => `assets/world/${kit}/${name}.glb`;
const PALMS = [
	model('pirate-kit', 'palm-detailed-straight'), model('pirate-kit', 'palm-detailed-bend'),
	model('pirate-kit', 'palm-straight'), model('pirate-kit', 'palm-bend'),
	model('nature-kit', 'tree_palmTall'), model('nature-kit', 'tree_palmDetailedTall')
];
const TREES = [
	model('nature-kit', 'tree_default'), model('nature-kit', 'tree_oak'), model('nature-kit', 'tree_detailed'),
	model('nature-kit', 'tree_fat'), model('fantasy-town-kit', 'tree-high-round'), model('fantasy-town-kit', 'tree')
];
const BUSHES = [model('nature-kit', 'plant_bushLarge'), model('nature-kit', 'plant_bushDetailed'), model('nature-kit', 'plant_bush')];
const FLOWERS = ['redA', 'redB', 'redC', 'yellowA', 'yellowB', 'yellowC', 'purpleA', 'purpleB', 'purpleC']
	.map(f => model('nature-kit', `flower_${f}`));
const GRASS = [model('nature-kit', 'grass_large'), model('nature-kit', 'grass_leafsLarge'), model('nature-kit', 'grass')];
const ROCKS = [model('nature-kit', 'rock_largeA'), model('nature-kit', 'rock_largeC'), model('nature-kit', 'rock_tallB'), model('fantasy-town-kit', 'rock-large')];
const BEACH_ROCKS = [model('pirate-kit', 'rocks-sand-a'), model('pirate-kit', 'rocks-sand-b'), model('pirate-kit', 'rocks-sand-c')];

/**
 * Every prop: model URL, position, facing, target height (or width) in world
 * units (Miis are about 22 tall), and `block`: the fraction of its footprint
 * radius that Miis walk around (0 for decorations they can walk through).
 * @returns {Array<{url: string, x: number, z: number, rotation: number, height: number, block: number, y?: number}>}
 */
function islandLayout() {
	const random = seededRandom(20090308); // Wii Sports Resort's release month, why not.
	const pick = list => list[Math.floor(random() * list.length)];
	const placed = [];
	const spaced = (x, z, gap) => placed.every(p => Math.hypot(p.x - x, p.z - z) > gap);
	const add = (prop) => {
		placed.push(prop);
		return prop;
	};

	// Mii Plaza: a fountain in the middle, benches facing it, lanterns around.
	add({ url: model('fantasy-town-kit', 'fountain-round'), x: 0, z: 0, rotation: 0, height: 16, width: 50, block: 1 });
	for (let i = 0; i < 4; i++) {
		const angle = Math.PI / 4 + i * Math.PI / 2;
		// Turned to face the fountain once loaded (see placeBench), with two seats each.
		add({ url: model('holiday-kit', 'bench'), x: Math.cos(angle) * 46, z: Math.sin(angle) * 46,
			rotation: 0, height: 10, block: 0.9, kind: 'bench' });
	}
	for (let i = 0; i < 8; i++) {
		const angle = Math.PI / 8 + i * Math.PI / 4; // Off the paths (and the Mii Maker stage).
		add({ url: model('fantasy-town-kit', 'lantern'), x: Math.cos(angle) * 66, z: Math.sin(angle) * 66,
			rotation: -angle, height: 26, block: 0.5 });
	}
	// Flower beds and bushes ringing the plaza, with gaps for paths.
	for (let i = 0; i < 28; i++) {
		const angle = (i / 28) * Math.PI * 2;
		if (Math.abs(Math.sin(angle * 2)) < 0.25) {
			continue; // Path gaps at the four compass points.
		}
		const r = 82 + random() * 8;
		add({ url: i % 3 === 0 ? pick(BUSHES) : pick(FLOWERS), x: Math.cos(angle) * r, z: Math.sin(angle) * r,
			rotation: random() * Math.PI * 2, height: i % 3 === 0 ? 12 : 6, block: i % 3 === 0 ? 0.8 : 0 });
	}

	// Market stalls off the plaza.
	[[0.35, 'stall-green'], [2.4, 'stall-red'], [4.3, 'stall-green']].forEach(([angle, name]) => {
		add({ url: model('fantasy-town-kit', name), x: Math.cos(angle) * 128, z: Math.sin(angle) * 128,
			rotation: -angle - Math.PI / 2, height: 30, block: 0.9 });
	});

	// Beach: a ring of palms near the shore, sandy rocks, and a dock with a rowboat.
	for (let i = 0; i < 34; i++) {
		const angle = (i / 34) * Math.PI * 2 + random() * 0.08;
		const r = 300 + random() * 40;
		add({ url: pick(PALMS), x: Math.cos(angle) * r, z: Math.sin(angle) * r,
			rotation: random() * Math.PI * 2, height: 48 + random() * 20, block: 0.25, sway: 0.03 });
	}
	for (let i = 0; i < 10; i++) {
		const angle = random() * Math.PI * 2;
		const r = 345 + random() * 35;
		add({ url: pick(BEACH_ROCKS), x: Math.cos(angle) * r, z: Math.sin(angle) * r,
			rotation: random() * Math.PI * 2, height: 8 + random() * 8, block: 0.8 });
	}
	const dockAngle = Math.PI * 0.55; // Toward the camera's starting view.
	add({ url: model('pirate-kit', 'structure-platform-dock'), x: Math.cos(dockAngle) * 395, z: Math.sin(dockAngle) * 395,
		rotation: -dockAngle + Math.PI / 2, height: 14, block: 0, y: WATER_LEVEL });
	add({ url: model('pirate-kit', 'boat-row-small'), x: Math.cos(dockAngle + 0.08) * 445, z: Math.sin(dockAngle + 0.08) * 445,
		rotation: -dockAngle, height: 10, block: 0, y: WATER_LEVEL - 1, bob: true });

	// Trees and rocks across the meadow, spaced out.
	for (let tries = 0, count = 0; count < 18 && tries < 500; tries++) {
		const angle = random() * Math.PI * 2;
		const r = 115 + random() * 160;
		const x = Math.cos(angle) * r;
		const z = Math.sin(angle) * r;
		if (spaced(x, z, 45)) {
			add({ url: pick(TREES), x, z, rotation: random() * Math.PI * 2, height: 40 + random() * 18, block: 0.3, sway: 0.015 });
			count++;
		}
	}
	for (let tries = 0, count = 0; count < 8 && tries < 300; tries++) {
		const angle = random() * Math.PI * 2;
		const r = 110 + random() * 170;
		const x = Math.cos(angle) * r;
		const z = Math.sin(angle) * r;
		if (spaced(x, z, 35)) {
			add({ url: pick(ROCKS), x, z, rotation: random() * Math.PI * 2, height: 8 + random() * 10, block: 0.9 });
			count++;
		}
	}
	// Flowers and grass tufts everywhere (decoration only).
	for (let i = 0; i < 160; i++) {
		const angle = random() * Math.PI * 2;
		const r = 95 + Math.sqrt(random()) * 225;
		const flower = random() < 0.45;
		add({ url: flower ? pick(FLOWERS) : pick(GRASS), x: Math.cos(angle) * r, z: Math.sin(angle) * r,
			rotation: random() * Math.PI * 2, height: flower ? 5 + random() * 3 : 4 + random() * 3, block: 0 });
	}
	return placed;
}

// ---------------------------------------------------------------------
//  Building the scene
// ---------------------------------------------------------------------

const loader = new GLTFLoader();
/** @type {Map<string, Promise<THREE.Object3D>>} */
const prototypes = new Map();

/** Loads a model once, prepares its materials, and returns the shared prototype. */
function loadProp(url) {
	if (!prototypes.has(url)) {
		prototypes.set(url, loader.loadAsync(url).then(({ scene }) => {
			scene.traverse((node) => {
				if (!node.isMesh) {
					return;
				}
				node.castShadow = true;
				node.receiveShadow = true;
				for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
					// The page renders in sRGB without conversion (for FFL's shaders), so
					// show glTF's linear colors and sRGB textures as authored.
					material.color?.convertLinearToSRGB();
					if (material.map) {
						material.map.colorSpace = THREE.NoColorSpace;
						material.map.needsUpdate = true;
					}
				}
			});
			return scene;
		}));
	}
	return prototypes.get(url);
}

const UP = new THREE.Vector3(0, 1, 0);
/** @type {WeakMap<THREE.Object3D, {front: THREE.Vector3, seatTop: number, halfWidth: number}>} */
const benchShapes = new WeakMap();

/**
 * Works out which way a bench model faces and how high its seat is, from its
 * vertices: the backrest is the tall part (so the top vertices sit toward the
 * back), and the seat is the highest point of the front half.
 */
function benchShape(prototype) {
	if (benchShapes.has(prototype)) {
		return benchShapes.get(prototype);
	}
	prototype.updateMatrixWorld(true);
	const points = [];
	prototype.traverse((node) => {
		if (node.isMesh) {
			const position = node.geometry.attributes.position;
			for (let i = 0; i < position.count; i++) {
				points.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld));
			}
		}
	});
	const box = new THREE.Box3().setFromPoints(points);
	const center = box.getCenter(new THREE.Vector3());
	const height = box.max.y - box.min.y;
	const top = points.filter(p => p.y > box.min.y + height * 0.7);
	const back = top.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(top.length || 1);
	const front = new THREE.Vector3(center.x - back.x, 0, center.z - back.z);
	if (front.lengthSq() < 1e-6) {
		front.set(0, 0, 1); // No backrest: pick a side.
	}
	front.normalize();
	const side = new THREE.Vector3(front.z, 0, -front.x);
	const along = (p, dir) => (p.x - center.x) * dir.x + (p.z - center.z) * dir.z;
	const depth = points.reduce((max, p) => Math.max(max, Math.abs(along(p, front))), 0);
	const frontHalf = points.filter(p => along(p, front) > depth * 0.15);
	const shape = {
		front,
		// Seat height above the model's base.
		seatTop: (frontHalf.length ? frontHalf.reduce((max, p) => Math.max(max, p.y), -Infinity) : box.min.y + height * 0.45) - box.min.y,
		halfWidth: points.reduce((max, p) => Math.max(max, Math.abs(along(p, side))), 0)
	};
	benchShapes.set(prototype, shape);
	return shape;
}

/** Turns a bench to face the fountain and adds its two seats to `spots`. */
function placeBench(holder, prototype, box, scale) {
	const { front, seatTop, halfWidth } = benchShape(prototype);
	const toFountain = new THREE.Vector3(-holder.position.x, 0, -holder.position.z).normalize();
	const facing = Math.atan2(toFountain.x, toFountain.z);
	holder.rotation.y = facing - Math.atan2(front.x, front.z);
	const forward = toFountain;
	const side = new THREE.Vector3(forward.z, 0, -forward.x);
	for (const offset of [-0.42, 0.42]) {
		const x = holder.position.x + side.x * halfWidth * scale * offset + forward.x;
		const z = holder.position.z + side.z * halfWidth * scale * offset + forward.z;
		spots.push({
			type: 'sit', x, z, y: seatTop * scale, yaw: facing, occupant: null,
			approach: { x: x + forward.x * 12, z: z + forward.z * 12 }
		});
	}
}

/**
 * Everything else Miis can go do: sunbathe on the beach, watch the fountain,
 * and smell the flower beds. Only where there's room (after props load).
 */
function addActivitySpots() {
	const clear = (x, z, margin = 8) => obstacles.every(o => Math.hypot(x - o.x, z - o.z) > o.r + margin);
	for (let i = 0; i < 18; i++) {
		const angle = (i / 18) * Math.PI * 2 + 0.1;
		// Feet near the water; the body stretches about 22 units inland.
		const x = Math.cos(angle) * 372;
		const z = Math.sin(angle) * 372;
		if (clear(x, z) && clear(Math.cos(angle) * 352, Math.sin(angle) * 352)) {
			spots.push(beachSpotAt(x, z));
		}
	}
	// Standing at a spot, facing something. `look` names what (for its reaction).
	const lookSpot = (look, angle, radius, approachRadius, facingOut) => {
		const x = Math.cos(angle) * radius;
		const z = Math.sin(angle) * radius;
		spots.push({
			type: 'look', look, x, z, y: 0, occupant: null,
			yaw: Math.atan2(facingOut ? x : -x, facingOut ? z : -z),
			approach: { x: Math.cos(angle) * approachRadius, z: Math.sin(angle) * approachRadius }
		});
	};
	// Around the fountain's rim, facing it (the fountain blocks out to radius 25).
	for (let i = 0; i < 6; i++) {
		const angle = (i / 6) * Math.PI * 2;
		lookSpot('fountain', angle, 31, 40, false);
	}
	// In front of the flower beds (on the diagonals, where the beds are), facing out at them.
	for (let i = 0; i < 4; i++) {
		for (const nudge of [-0.2, 0.2]) {
			const angle = Math.PI / 4 + i * Math.PI / 2 + nudge;
			if (clear(Math.cos(angle) * 74, Math.sin(angle) * 74, 4) && clear(Math.cos(angle) * 64, Math.sin(angle) * 64, 4)) {
				lookSpot('flowers', angle, 74, 64, true);
			}
		}
	}
}

/** Things that move on their own: swaying trees, the bobbing boat, drifting sky. */
const ambient = { swayers: [], bobbers: [], time: 0 };

/**
 * Adds the sky, island, ocean and props to the scene.
 * @param {THREE.Scene} scene
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.DirectionalLight} sun
 * @returns {Promise<{update: (dt: number) => void}>}
 */
export async function buildWorld(scene, renderer, sun) {
	// Sky panorama: background, and soft reflections for the props' Frutiger Aero sheen.
	const sky = await new THREE.TextureLoader().loadAsync('assets/world/sky.jpg');
	sky.mapping = THREE.EquirectangularReflectionMapping;
	sky.colorSpace = THREE.NoColorSpace;
	scene.background = sky;
	const pmrem = new THREE.PMREMGenerator(renderer);
	scene.environment = pmrem.fromEquirectangular(sky).texture;
	scene.environmentIntensity = 0.6;
	pmrem.dispose();

	// The island: grass in the middle, a sandy beach ring, ocean all around.
	const grass = new THREE.Mesh(new THREE.CircleGeometry(GRASS_RADIUS, 96),
		new THREE.MeshLambertMaterial({ color: 0x8fd45c }));
	grass.rotation.x = -Math.PI / 2;
	grass.receiveShadow = true;
	// A ring (not a disc under the grass), so the two never fight over depth far away.
	const beach = new THREE.Mesh(new THREE.RingGeometry(GRASS_RADIUS, BEACH_RADIUS, 96),
		new THREE.MeshLambertMaterial({ color: 0xf1e3b0 }));
	beach.rotation.x = -Math.PI / 2;
	beach.receiveShadow = true;
	scene.add(grass, beach);

	const waterNormals = await new THREE.TextureLoader().loadAsync('assets/world/waternormals.jpg');
	waterNormals.wrapS = waterNormals.wrapT = THREE.RepeatWrapping;
	const water = new Water(new THREE.PlaneGeometry(8000, 8000), {
		textureWidth: 512,
		textureHeight: 512,
		waterNormals,
		sunDirection: sun.position.clone().normalize(),
		sunColor: 0xffffff,
		waterColor: 0x1d8fc4,
		distortionScale: 2.2,
		fog: scene.fog !== undefined
	});
	water.rotation.x = -Math.PI / 2;
	water.position.y = WATER_LEVEL;
	scene.add(water);

	// Props, loaded in parallel; obstacles fill in as each one arrives.
	const layout = islandLayout();
	await Promise.all(layout.map(async (spec) => {
		let prototype;
		try {
			prototype = await loadProp(spec.url);
		} catch (error) {
			console.warn(`Couldn't load ${spec.url}`, error);
			return;
		}
		const prop = prototype.clone();
		const box = new THREE.Box3().setFromObject(prop);
		const size = box.getSize(new THREE.Vector3());
		const scale = spec.width ? spec.width / Math.max(size.x, size.z) : spec.height / size.y;
		prop.scale.setScalar(scale);
		// Center it on its spot with its base on the ground.
		const center = box.getCenter(new THREE.Vector3());
		const holder = new THREE.Group();
		prop.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
		holder.add(prop);
		holder.position.set(spec.x, spec.y ?? 0, spec.z);
		holder.rotation.y = spec.rotation;
		if (spec.kind === 'bench') {
			placeBench(holder, prototype, box, scale);
		}
		scene.add(holder);
		if (spec.block) {
			obstacles.push({ x: spec.x, z: spec.z, r: (Math.max(size.x, size.z) * scale / 2) * spec.block });
		}
		if (spec.sway) {
			// Phase from position, so neighbors don't sway in lockstep.
			ambient.swayers.push({ holder, phase: spec.x * 0.05 + spec.z * 0.03, amount: spec.sway });
		}
		if (spec.bob) {
			ambient.bobbers.push({ holder, baseY: holder.position.y, phase: spec.x * 0.1 });
		}
	}));
	addActivitySpots();

	return {
		update(dt) {
			water.material.uniforms.time.value += dt * 0.6;
			ambient.time += dt;
			const t = ambient.time;
			// Trees lean gently in the breeze (pivoting at their base).
			for (const { holder, phase, amount } of ambient.swayers) {
				holder.rotation.x = Math.sin(t * 0.9 + phase) * amount;
				holder.rotation.z = Math.cos(t * 0.7 + phase * 1.3) * amount * 0.7;
			}
			// The boat rides the swell.
			for (const { holder, baseY, phase } of ambient.bobbers) {
				holder.position.y = baseY + Math.sin(t * 1.3 + phase) * 0.6;
				holder.rotation.z = Math.sin(t * 1.1 + phase) * 0.06;
				holder.rotation.x = Math.sin(t * 0.8 + phase) * 0.03;
			}
			// Clouds drift by, very slowly.
			scene.backgroundRotation.y += dt * 0.004;
			scene.environmentRotation.y = scene.backgroundRotation.y;
		}
	};
}
