// Partner Pokémon: loads the Pokémon Rumble World models (downloaded by
// scripts/fetch_pokemon.py) and makes one follow the Mii around.
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';

/** @typedef {{id: number, dex: number, name: string, dir: string, model: string, mtl: string|null}} PokemonEntry */

/** Rumble models are in meters; this makes a Charmander about 40% of a Mii's height. */
const MODEL_SCALE = 16;
/** Keep the odd giant or tiny Pokémon within a sensible size range (world units). */
const MIN_HEIGHT = 5;
const MAX_HEIGHT = 20;

const FOLLOW_DISTANCE = 14; // How far behind the Mii it trails.
const FOLLOW_SIDE = 7; // And how far off to the side.
const MAX_SPEED = 55;

/** @returns {Promise<PokemonEntry[]>} */
export async function loadPokemonIndex() {
	const response = await fetch('assets/pokemon/index.json');
	if (!response.ok) {
		throw new Error('Missing assets/pokemon/index.json. Run ./scripts/setup.sh first.');
	}
	return response.json();
}

export const iconUrl = (/** @type {PokemonEntry} */ entry) => `${entry.dir}icon.png`;

/** @type {Map<number, Promise<THREE.Group>>} */
const modelCache = new Map();

/**
 * Loads a Pokémon model, scaled to world units with its feet at y = 0
 * and facing +Z. Cached, so switching back and forth is instant. This is a
 * shared prototype: Follower.setModel() places a clone of it.
 * @param {PokemonEntry} entry
 * @returns {Promise<THREE.Group>}
 */
export function loadPokemonModel(entry) {
	if (!modelCache.has(entry.id)) {
		modelCache.set(entry.id, loadModel(entry).catch((error) => {
			modelCache.delete(entry.id);
			throw error;
		}));
	}
	return modelCache.get(entry.id);
}

/** Most zips have OBJ/MTL; a couple (Fennekin, Diancie) only have Collada. */
async function loadRawModel(entry) {
	if (entry.model.endsWith('.dae')) {
		return (await new ColladaLoader().loadAsync(entry.dir + entry.model)).scene;
	}
	const objLoader = new OBJLoader().setPath(entry.dir);
	if (entry.mtl) {
		const materials = await new MTLLoader().setPath(entry.dir).loadAsync(entry.mtl);
		materials.preload();
		objLoader.setMaterials(materials);
	}
	return objLoader.loadAsync(entry.model);
}

async function loadModel(entry) {
	const obj = await loadRawModel(entry);
	obj.updateMatrixWorld(true);

	obj.traverse((node) => {
		if (!(node instanceof THREE.Mesh)) {
			return;
		}
		const materials = Array.isArray(node.material) ? node.material : [node.material];
		for (const material of materials) {
			const map = material.map;
			if (map) {
				// The models' samplers clamp (their .dae files say CLAMP), and the
				// textures are used as-is in sRGB like the FFL shaders.
				map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
				map.colorSpace = THREE.NoColorSpace;
				map.needsUpdate = true;
			}
			material.alphaTest = 0.5; // Cut-out edges (eyes, flames, fins).
			material.side = THREE.DoubleSide;
			if (material.specular) {
				material.specular.setScalar(0.15); // MTLs say 0.5, which looks wet.
			}
		}
	});

	// Normalize: feet on the ground, centered, scaled to world units.
	const box = new THREE.Box3().setFromObject(obj);
	const size = box.getSize(new THREE.Vector3());
	const height = THREE.MathUtils.clamp(size.y * MODEL_SCALE, MIN_HEIGHT, MAX_HEIGHT);
	const scale = height / size.y;
	const center = box.getCenter(new THREE.Vector3());
	obj.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
	obj.scale.setScalar(scale);

	const group = new THREE.Group();
	group.add(obj);
	return group;
}

/**
 * Rumble eye textures stack four frames vertically (open, half, closed, sad).
 * Returns those maps so the follower can blink by shifting them.
 */
function findEyeMaps(obj) {
	const maps = [];
	obj.traverse((node) => {
		if (!(node instanceof THREE.Mesh)) {
			return;
		}
		for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
			const map = material.map;
			if (/eye/i.test(material.name) && map) {
				// Only strips (four times taller than wide). Checked when blinking,
				// since the texture image loads after the model.
				maps.push({ map, isStrip: () => map.image?.height === map.image?.width * 4 });
			}
		}
	});
	return maps;
}

/** Blink frames as texture offsets: half closed, closed, half closed. */
const BLINK_FRAMES = [-0.25, -0.5, -0.25];

/** A Pokémon that trails behind a leader (the Mii) and hops when moving. */
export class Follower {
	constructor(scene) {
		/** Placed in the world; holds the current model. */
		this.root = new THREE.Group();
		this.root.visible = false;
		scene.add(this.root);
		/** @type {THREE.Group|null} */
		this.model = null;
		this.hopTime = 0;
		this.cheerTime = 0;
		this.nextBlink = 0;
		this.blinkFrame = -1;
	}

	/** @param {THREE.Group|null} prototype - From loadPokemonModel(), or null for none. */
	setModel(prototype) {
		if (this.model) {
			this.root.remove(this.model);
		}
		// Clone so several Miis can have the same Pokémon. Geometry, materials and
		// textures stay shared (so identical partners blink in sync).
		this.model = prototype ? prototype.clone() : null;
		this.eyeMaps = this.model ? findEyeMaps(this.model) : [];
		// Cast real shadows. Cut-out parts (alphaTest) cast their cut-out shape.
		this.model?.traverse((node) => {
			node.castShadow = node.isMesh;
		});
		this.root.visible = Boolean(this.model);
		if (this.model) {
			this.root.add(this.model);
			this.setEyeOffset(0);
		}
	}

	/** Stands next to the leader, facing the camera (editor/menu preview). */
	standBeside(leader) {
		const side = new THREE.Vector3(1, 0, 0).applyQuaternion(leader.quaternion);
		this.root.position.copy(leader.position).addScaledVector(side, 13);
		this.root.rotation.set(0, leader.rotation.y - 0.35, 0);
		if (this.model) {
			this.model.position.y = 0;
		}
	}

	/** Puts it behind the leader right away (entering the world). */
	snapBehind(leader) {
		this.root.position.copy(this.followPoint(leader));
		this.root.rotation.set(0, leader.rotation.y, 0);
	}

	followPoint(leader) {
		const back = new THREE.Vector3(0, 0, -FOLLOW_DISTANCE).applyQuaternion(leader.quaternion);
		const side = new THREE.Vector3(FOLLOW_SIDE, 0, 0).applyQuaternion(leader.quaternion);
		return leader.position.clone().add(back).add(side).setY(0);
	}

	/** @param {number} dt @param {THREE.Object3D} leader */
	update(dt, leader) {
		if (!this.model) {
			return;
		}
		const target = this.followPoint(leader);
		const toTarget = target.sub(this.root.position).setY(0);
		const distance = toTarget.length();
		const moving = distance > 1.5;
		if (moving) {
			// Ease in: the farther behind, the faster it scampers (up to MAX_SPEED).
			const step = Math.min(distance, Math.min(MAX_SPEED, distance * 4) * dt);
			this.root.position.addScaledVector(toTarget.normalize(), step);
			turnToward(this.root, Math.atan2(toTarget.x, toTarget.z), dt * 10);
			// Rumble-style hop.
			this.hopTime += dt;
			this.model.position.y = Math.abs(Math.sin(this.hopTime * 14)) * 1.6;
		} else if (this.cheerTime > 0) {
			// Excited: quick high hops with a little wiggle.
			this.cheerTime -= dt;
			this.model.position.y = Math.abs(Math.sin(this.cheerTime * 16)) * 2.6;
			this.model.rotation.y = Math.sin(this.cheerTime * 20) * 0.25;
			if (this.cheerTime <= 0) {
				this.model.rotation.y = 0;
			}
		} else {
			this.model.position.y *= 0.7;
			// When it catches up, face the same way as the leader.
			turnToward(this.root, leader.rotation.y, dt * 4);
		}
	}

	/** Hops for joy for a moment (when its Mii is happy). */
	cheer() {
		this.cheerTime = 1.2;
	}

	/** Blinks every few seconds by stepping through the eye frames. */
	updateBlink(now) {
		if (!this.model || now < this.nextBlink) {
			return;
		}
		this.blinkFrame++;
		if (this.blinkFrame >= BLINK_FRAMES.length) {
			this.blinkFrame = -1;
			this.setEyeOffset(0);
			this.nextBlink = now + 2000 + Math.random() * 3000;
		} else {
			this.setEyeOffset(BLINK_FRAMES[this.blinkFrame]);
			this.nextBlink = now + 60;
		}
	}

	setEyeOffset(offset) {
		for (const { map, isStrip } of this.eyeMaps ?? []) {
			if (isStrip()) {
				map.offset.y = offset;
			}
		}
	}
}

/** Rotates an object's Y angle toward `yaw` the short way around. */
export function turnToward(object, yaw, amount) {
	const diff = Math.atan2(Math.sin(yaw - object.rotation.y), Math.cos(yaw - object.rotation.y));
	object.rotation.y += diff * Math.min(1, amount);
}
