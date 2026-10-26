// A Mii living in the world: wanders around on its own, sits on benches,
// sunbathes on the beach, admires the fountain and the flowers, chats with
// other Miis, can be picked up and dropped, and has a partner Pokémon.
import * as THREE from 'three';
import { buildMiiModel, disposeMiiModel, FFLExpression } from './miiModel.js';
import { Follower, turnToward } from './pokemon.js';
import { WALK_RADIUS, isWalkable, spots, isOnBeach, beachSpotAt } from './world.js';

const WALK_SPEED = 14; // World units per second; a stroll.
const WANDER_RANGE = 90; // Max distance of each stroll.
const LIFT_HEIGHT = 6; // How high a picked-up Mii dangles (low, so it stays near its shadow).
const GRAVITY = 260;
const SPOT_CHANCE = 0.4; // How often a Mii done idling goes to use a spot instead of strolling.
const JOY_CHANCE = 0.12; // ...or hops for joy on the spot.
const SPOT_SEARCH_RADIUS = 170;
const LIE_LIFT = 3.2; // Lying on its back: raise the body so the big head stays above the sand.
const GIVE_UP_AFTER = 15; // Seconds; if it can't reach where it's going (blocked), it stops trying.
const EMOTE_SECONDS = 2.4;

/** States where the Mii is taking part in a chat. */
const CHAT_STATES = new Set(['toChat', 'chatWait', 'chatting']);
/** What a Mii says while chatting: [expression, emote icon]. Icons are Material Symbols. */
const CHAT_BEATS = [
	[FFLExpression.SMILE, 'chat_bubble'],
	[FFLExpression.HAPPY, 'music_note'],
	[FFLExpression.SMILE, 'favorite'],
	[FFLExpression.SURPRISE, 'priority_high'],
	[FFLExpression.HAPPY, 'sentiment_very_satisfied']
];
/** The reaction bubble each kind of spot gets. */
const SPOT_EMOTES = { sit: 'music_note', lie: 'wb_sunny', fountain: 'sentiment_very_satisfied', flowers: 'favorite' };

let nextId = 1;

/** FFL head overlays (face mask, nose line, glasses) are see-through quads; they shouldn't cast shadows. */
const OVERLAY_MODULATE_TYPES = new Set([6, 7, 8]); // FFLModulateType SHAPE_MASK, SHAPE_NOSELINE, SHAPE_GLASS

const SIDE_AXIS = new THREE.Vector3(1, 0, 0); // The Mii's left-right axis (it faces +Z).
const FORWARD_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * Bends a bone around one of the Mii's own axes (model space). Works whatever
 * the bone's local axes are: the axis is converted into the bone's parent space.
 */
function bendAbout(bone, modelRoot, modelAxis, angle) {
	modelRoot.updateMatrixWorld(true);
	const axis = modelAxis.clone().applyQuaternion(modelRoot.getWorldQuaternion(new THREE.Quaternion()));
	axis.applyQuaternion(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
	bone.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
}

export class Resident {
	/**
	 * @param {THREE.Scene} scene
	 * @param {{charInfo: Uint8Array, partnerId?: number|null, x?: number, z?: number}} data
	 */
	constructor(scene, { charInfo, partnerId = null, x = 0, z = 0 }) {
		this.id = nextId++;
		this.charInfo = charInfo;
		/** Asset id of the partner Pokémon, or null. */
		this.partnerId = partnerId;

		this.root = new THREE.Group();
		this.root.position.set(x, 0, z);
		this.root.rotation.y = Math.random() * Math.PI * 2;
		scene.add(this.root);

		/** Invisible cylinder used to click/grab the Mii (more forgiving than its meshes). */
		this.hitMesh = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 1, 8), new THREE.MeshBasicMaterial());
		this.hitMesh.visible = false;
		this.hitMesh.userData.resident = this;
		this.root.add(this.hitMesh);

		this.follower = new Follower(scene);
		this.follower.root.traverse((node) => {
			node.userData.resident = this;
		});

		/** @type {ReturnType<typeof buildMiiModel>|null} */
		this.mii = null;
		/**
		 * 'idle' | 'walk' | 'toSpot' (heading to a spot) | 'using' (sitting, lying,
		 * or looking at something) | 'toChat' | 'chatWait' | 'chatting' |
		 * 'paused' (menu open) | 'held' | 'falling'
		 */
		this.state = 'idle';
		/** @type {import('./world.js').Spot|null} The spot it's heading to or using. */
		this.spot = null;
		/** @type {Resident|null} Who it's chatting with. */
		this.chatWith = null;
		this.timer = 1 + Math.random() * 3;
		this.destination = new THREE.Vector3();
		this.walkTime = Math.random() * 10;
		this.fallSpeed = 0;
		this.nextBlink = performance.now() + Math.random() * 3000;
		this.blinking = false;
		/** Expression it returns to after blinking. */
		this.mood = FFLExpression.NORMAL;
		this.moodTimer = 0;
		/** Reaction bubble shown above its head (drawn by main.js): {icon, until} or null. */
		this.emote = null;
		/** Seconds until it's up for another chat. */
		this.socialCooldown = 5 + Math.random() * 15;
		this.waveTime = 0;
		this.hopTime = 0;
		this.cheerDelay = 0; // Counts down to the reaction after settling into a spot.
		this.chatBeat = 0;
	}

	/** Rebuilds the model from charInfo. Throws (and keeps the old model) if FFL rejects it. */
	rebuild() {
		const next = buildMiiModel(this.charInfo);
		if (this.mii) {
			disposeMiiModel(this.mii);
		}
		this.mii = next;
		this.root.add(next.body.model);
		// Real shadows from the sun (see main.js), in the Mii's actual shape.
		next.body.model.traverse((node) => {
			if (node.isMesh) {
				node.castShadow = !OVERLAY_MODULATE_TYPES.has(node.geometry.userData.modulateType);
			}
		});

		// Bones for poses, from the Wii U Mii body: foot_*1 is the hip joint and
		// foot_*2 the knee; arm_*1 the shoulder and arm_*2 the elbow.
		const model = next.body.model;
		const bone = name => model.getObjectByName(name);
		this.legBones = ['l', 'r'].map(side => ({ hip: bone(`foot_${side}1`), knee: bone(`foot_${side}2`) }))
			.filter(leg => leg.hip && leg.knee);
		this.waveArm = bone('arm_r1') && bone('arm_r2') ? { shoulder: bone('arm_r1'), elbow: bone('arm_r2') } : null;
		const posed = [...this.legBones.flatMap(leg => [leg.hip, leg.knee]),
			...(this.waveArm ? [this.waveArm.shoulder, this.waveArm.elbow] : [])];
		this.restPose = new Map(posed.map(b => [b, b.quaternion.clone()]));
		this.root.updateMatrixWorld(true);
		this.hipHeight = this.legBones.length
			? this.legBones[0].hip.getWorldPosition(new THREE.Vector3()).y - this.root.position.y
			: 6;
		this.resetPose();
	}

	// --- Poses -------------------------------------------------------------

	/** Size the click cylinder to the Mii standing up (taller Miis get a taller target). */
	resetHitMesh() {
		const height = this.headHeight() + 6;
		this.hitMesh.rotation.set(0, 0, 0);
		this.hitMesh.scale.y = height;
		this.hitMesh.position.set(0, height / 2, 0);
	}

	/** Standing pose: legs straight, arms down, body upright. */
	resetPose() {
		for (const [bone, quaternion] of this.restPose ?? []) {
			bone.quaternion.copy(quaternion);
		}
		const body = this.mii?.body.model;
		if (body) {
			body.position.set(0, 0, 0);
			body.rotation.set(0, 0, 0);
		}
		this.waveTime = 0;
		this.hopTime = 0;
		this.resetHitMesh();
	}

	/** Sitting: thighs forward, knees bent, hips resting on a seat at `seatY`. */
	sitPose(seatY) {
		this.resetPose();
		const body = this.mii.body.model;
		for (const leg of this.legBones) {
			bendAbout(leg.hip, body, SIDE_AXIS, -Math.PI / 2);
			bendAbout(leg.knee, body, SIDE_AXIS, Math.PI / 2);
		}
		body.position.y = seatY - this.hipHeight + 0.7;
	}

	/** Lying on its back, face up, feet at the Mii's position, head behind it. */
	liePose() {
		this.resetPose();
		const length = this.headHeight() + 4; // Measured standing, before lying down.
		const body = this.mii.body.model;
		body.rotation.x = -Math.PI / 2;
		body.position.y = LIE_LIFT;
		// The click target lies down too.
		this.hitMesh.rotation.x = Math.PI / 2;
		this.hitMesh.scale.y = length;
		this.hitMesh.position.set(0, LIE_LIFT, -length / 2);
	}

	/** Right arm up and waving at the elbow, for `seconds`. */
	wave(seconds = 1.6) {
		if (this.waveArm && this.state !== 'using') {
			this.waveTime = seconds;
		}
	}

	updateWave(dt) {
		if (!this.waveArm || this.waveTime <= 0) {
			return;
		}
		const { shoulder, elbow } = this.waveArm;
		const body = this.mii.body.model;
		shoulder.quaternion.copy(this.restPose.get(shoulder));
		elbow.quaternion.copy(this.restPose.get(elbow));
		this.waveTime -= dt;
		if (this.waveTime > 0) {
			// The right arm is on the Mii's -X side; this swings it out and up.
			bendAbout(shoulder, body, FORWARD_AXIS, -2.2);
			bendAbout(elbow, body, FORWARD_AXIS, Math.sin(this.waveTime * 14) * 0.5);
		}
	}

	/** Height of the head bone above the Mii's feet. */
	headHeight() {
		const head = this.mii?.body.model.getObjectByName('head');
		if (!head) {
			return 20;
		}
		this.root.updateMatrixWorld(true);
		return head.getWorldPosition(new THREE.Vector3()).y - this.root.position.y;
	}

	/** World position of the head (for camera framing, the hover menu and emotes). */
	headWorldPosition() {
		const head = this.mii?.body.model.getObjectByName('head');
		if (!head) {
			return this.root.position.clone().setY(this.root.position.y + 20);
		}
		this.root.updateMatrixWorld(true);
		return head.getWorldPosition(new THREE.Vector3());
	}

	setVisible(visible) {
		this.root.visible = visible;
		this.follower.root.visible = visible && Boolean(this.follower.model);
	}

	setExpression(expression) {
		try {
			this.mii?.charModel.setExpression(expression);
		} catch { /* Expression not in the model's flag; ignore. */ }
	}

	/** Sets the face it makes (and returns to after blinks), for `seconds` or until changed. */
	setMood(expression, seconds = 0) {
		this.mood = expression;
		this.moodTimer = seconds;
		if (!this.blinking) {
			this.setExpression(expression);
		}
	}

	// --- Reactions ---------------------------------------------------------

	/** Shows a reaction bubble (a Material Symbols icon name) above its head. */
	showEmote(icon, seconds = EMOTE_SECONDS) {
		this.emote = { icon, until: performance.now() + seconds * 1000 };
	}

	/** A happy moment: grin, a bubble, a little hop (if standing), and its partner cheers too. */
	cheer(icon) {
		this.showEmote(icon);
		this.setMood(FFLExpression.HAPPY, 1.6);
		if (this.state !== 'using' || this.spot?.type === 'look') {
			this.hopTime = 0.7;
		}
		this.follower.cheer();
	}

	// --- Interaction -------------------------------------------------------

	/** Stops and looks at the camera (while its menu is open). */
	pause() {
		this.endChat();
		if (this.state === 'toSpot') {
			this.standUp();
		}
		if (this.state === 'idle' || this.state === 'walk') {
			this.state = 'paused';
		}
	}

	resume() {
		if (this.state === 'paused') {
			this.state = 'idle';
			this.timer = 0.5 + Math.random();
		}
	}

	pickUp() {
		this.endChat();
		this.standUp();
		this.state = 'held';
		this.setMood(FFLExpression.SURPRISE);
		this.showEmote('priority_high', 600); // Until it's dropped.
	}

	/** While held: follow the pointer over the ground. */
	moveHeldTo(x, z) {
		const before = this.root.position.x;
		// Can be carried anywhere over the island.
		const fromCenter = Math.hypot(x, z);
		const keep = fromCenter > WALK_RADIUS ? WALK_RADIUS / fromCenter : 1;
		this.root.position.x = x * keep;
		this.root.position.z = z * keep;
		// Swing a little in the direction it's being dragged.
		this.swing = THREE.MathUtils.clamp((this.root.position.x - before) * -0.04, -0.4, 0.4);
	}

	drop() {
		this.state = 'falling';
		this.fallSpeed = 0;
		this.emote = null;
	}

	// --- Spots: benches, the beach, the fountain, the flowers ----------------

	/** Claims a spot and walks to the place in front of it. */
	goToSpot(spot) {
		this.spot = spot;
		spot.occupant = this;
		this.destination.set(spot.approach.x, 0, spot.approach.z);
		this.state = 'toSpot';
		this.timer = GIVE_UP_AFTER;
	}

	/** Sits down, lies down, or stands looking, staying a while. */
	useSpot() {
		const spot = this.spot;
		this.root.position.set(spot.x, 0, spot.z);
		this.root.rotation.y = spot.yaw;
		if (spot.type === 'sit') {
			this.sitPose(spot.y);
		} else if (spot.type === 'lie') {
			this.liePose();
			this.setMood(FFLExpression.BLINK); // Eyes closed, sunbathing.
		} else {
			this.resetPose(); // 'look': stand facing the fountain or flowers.
		}
		this.state = 'using';
		this.timer = spot.type === 'look' ? 5 + Math.random() * 5 : 8 + Math.random() * 12;
		this.cheerDelay = 1 + Math.random() * 2;
	}

	/**
	 * Gets up and frees its spot. `stepOut` moves it to the spot's approach
	 * point (getting up normally); otherwise it stays put (being picked up, etc.).
	 */
	standUp(stepOut = false) {
		const spot = this.spot;
		if (!spot) {
			return;
		}
		if (spot.occupant === this) {
			spot.occupant = null;
		}
		this.spot = null;
		if (this.state === 'using') {
			this.resetPose();
			this.setMood(FFLExpression.NORMAL);
			if (stepOut) {
				this.root.position.set(spot.approach.x, 0, spot.approach.z);
			}
		}
		if (this.state === 'using' || this.state === 'toSpot') {
			this.state = 'idle';
			this.timer = 1 + Math.random() * 3;
		}
	}

	/** A free spot nearby, or null. */
	findSpot() {
		const pos = this.root.position;
		const nearby = spots
			.filter(spot => !spot.occupant)
			.map(spot => ({ spot, distance: Math.hypot(spot.x - pos.x, spot.z - pos.z) }))
			.filter(({ distance }) => distance < SPOT_SEARCH_RADIUS)
			.sort((a, b) => a.distance - b.distance)
			.slice(0, 4);
		return nearby.length ? nearby[Math.floor(Math.random() * nearby.length)].spot : null;
	}

	/** After being dropped: onto a free bench seat it sits down, onto the sand it lies down. */
	landed() {
		const pos = this.root.position;
		const seat = spots.find(spot => spot.type === 'sit' && !spot.occupant &&
			Math.hypot(spot.x - pos.x, spot.z - pos.z) < 9);
		if (seat) {
			this.spot = seat;
		} else if (isOnBeach(pos.x, pos.z)) {
			this.spot = beachSpotAt(pos.x, pos.z);
		} else {
			return;
		}
		this.spot.occupant = this;
		this.useSpot();
	}

	// --- Chatting with another Mii -----------------------------------------

	/** Whether it's free to start a chat (main.js pairs Miis up). */
	canChat() {
		return this.socialCooldown <= 0 && !this.chatWith && (this.state === 'idle' || this.state === 'walk');
	}

	/** Walks to `point` to meet `other` for a chat. */
	startChat(other, point) {
		this.chatWith = other;
		this.destination.copy(point);
		this.state = 'toChat';
		this.timer = GIVE_UP_AFTER;
	}

	beginChatting() {
		this.state = 'chatting';
		this.timer = 6 + Math.random() * 5;
		this.chatBeat = 0.4 + Math.random() * 0.8;
		this.wave();
		this.showEmote('chat_bubble');
	}

	/** Ends the chat for both Miis. */
	endChat() {
		const other = this.chatWith;
		if (!other) {
			return;
		}
		this.chatWith = null;
		other.endChat();
		if (CHAT_STATES.has(this.state)) {
			this.state = 'idle';
			this.timer = 1 + Math.random() * 2;
		}
		this.setMood(FFLExpression.NORMAL);
		this.socialCooldown = 25 + Math.random() * 35;
	}

	// --- Per-frame -----------------------------------------------------------

	/**
	 * @param {number} dt
	 * @param {THREE.Vector3} cameraPosition - Paused/held Miis turn to face it.
	 */
	update(dt, cameraPosition) {
		const body = this.mii?.body.model;
		const pos = this.root.position;
		const faceCamera = () => turnToward(this.root, Math.atan2(cameraPosition.x - pos.x, cameraPosition.z - pos.z), dt * 6);
		const faceChatPartner = () => {
			const other = this.chatWith.root.position;
			turnToward(this.root, Math.atan2(other.x - pos.x, other.z - pos.z), dt * 6);
		};
		this.socialCooldown -= dt;
		if (this.chatWith && !CHAT_STATES.has(this.chatWith.state)) {
			this.endChat(); // The other Mii got picked up, or wandered off.
		}

		switch (this.state) {
			case 'idle':
				this.settle(body);
				this.timer -= dt;
				if (this.timer <= 0) {
					const roll = Math.random();
					const spot = roll < SPOT_CHANCE ? this.findSpot() : null;
					if (spot) {
						this.goToSpot(spot);
					} else if (roll > 1 - JOY_CHANCE) {
						this.cheer('music_note');
						this.timer = 1.5;
					} else {
						this.pickDestination();
					}
				}
				break;
			case 'using':
				this.timer -= dt;
				if (this.cheerDelay > 0) {
					this.cheerDelay -= dt;
					if (this.cheerDelay <= 0) {
						const icon = SPOT_EMOTES[this.spot.look ?? this.spot.type];
						if (this.spot.type === 'lie') {
							this.showEmote(icon); // Keeps its eyes closed.
						} else {
							this.cheer(icon);
						}
					}
				}
				if (this.timer <= 0) {
					this.standUp(true);
				}
				break;
			case 'walk':
			case 'toSpot':
			case 'toChat': {
				this.timer -= dt;
				const toDest = this.destination.clone().sub(pos).setY(0);
				const distance = toDest.length();
				if (distance < 1.5 || this.timer <= 0) {
					this.arrive(distance < 1.5);
					break;
				}
				pos.addScaledVector(toDest.normalize(), Math.min(distance, WALK_SPEED * dt));
				turnToward(this.root, Math.atan2(toDest.x, toDest.z), dt * 8);
				// Waddle: bob up and down and sway side to side.
				this.walkTime += dt;
				if (body) {
					body.position.y = Math.abs(Math.sin(this.walkTime * 9)) * 1.0;
					body.rotation.z = Math.sin(this.walkTime * 9) * 0.07;
				}
				break;
			}
			case 'chatWait':
				this.settle(body);
				faceChatPartner();
				this.timer -= dt;
				if (this.chatWith.state === 'chatWait') {
					this.beginChatting();
					this.chatWith.beginChatting();
				} else if (this.timer <= 0) {
					this.endChat();
				}
				break;
			case 'chatting':
				faceChatPartner();
				// Nod along while talking.
				if (body) {
					body.position.y = Math.abs(Math.sin(this.timer * 7)) * 0.4;
				}
				this.chatBeat -= dt;
				if (this.chatBeat <= 0) {
					const [expression, icon] = CHAT_BEATS[Math.floor(Math.random() * CHAT_BEATS.length)];
					this.setMood(expression, 1.2);
					this.showEmote(icon, 1.4);
					if (icon === 'sentiment_very_satisfied' || icon === 'favorite') {
						this.follower.cheer();
					}
					this.chatBeat = 1.6 + Math.random() * 1.6;
				}
				this.timer -= dt;
				if (this.timer <= 0) {
					this.wave(1.2); // Bye!
					this.endChat();
				}
				break;
			case 'paused':
				this.settle(body);
				faceCamera();
				break;
			case 'held':
				pos.y += (LIFT_HEIGHT - pos.y) * Math.min(1, dt * 10);
				faceCamera();
				if (body) {
					// Dangle: swing toward the drag direction, then ease back.
					body.rotation.z += ((this.swing ?? 0) - body.rotation.z) * Math.min(1, dt * 8);
					this.swing = (this.swing ?? 0) * 0.85;
				}
				break;
			case 'falling':
				this.fallSpeed += GRAVITY * dt;
				pos.y -= this.fallSpeed * dt;
				if (pos.y <= 0) {
					pos.y = 0;
					this.state = 'idle';
					this.timer = 1 + Math.random() * 2;
					this.setMood(FFLExpression.NORMAL);
					if (body) {
						body.rotation.z = 0;
					}
					this.landed();
				}
				break;
		}

		this.updateHop(dt, body);
		this.updateWave(dt);
		if (this.moodTimer > 0) {
			this.moodTimer -= dt;
			if (this.moodTimer <= 0 && !(this.state === 'using' && this.spot?.type === 'lie')) {
				this.setMood(FFLExpression.NORMAL);
			}
		}
		this.follower.update(dt, this.root);
		this.updateBlink(performance.now());
		this.follower.updateBlink(performance.now());
	}

	/** Reached its destination (or gave up getting there). */
	arrive(reached) {
		if (this.state === 'toSpot') {
			if (reached) {
				this.useSpot();
			} else {
				this.standUp();
			}
		} else if (this.state === 'toChat') {
			this.state = 'chatWait';
			this.timer = 6; // Wait this long for the other Mii to show up.
			if (!reached) {
				this.endChat();
			}
		} else {
			this.state = 'idle';
			this.timer = 2 + Math.random() * 5;
		}
	}

	/** A quick double hop for joy (standing only). */
	updateHop(dt, body) {
		if (this.hopTime <= 0 || !body) {
			return;
		}
		this.hopTime -= dt;
		const phase = (0.7 - Math.max(0, this.hopTime)) / 0.7; // 0 → 1
		body.position.y = Math.abs(Math.sin(phase * Math.PI * 2)) * 3.5;
		if (this.hopTime <= 0) {
			body.position.y = 0;
		}
	}

	settle(body) {
		if (body && this.hopTime <= 0) {
			body.position.y *= 0.8;
			body.rotation.z *= 0.8;
		}
	}

	/** Picks a random open spot nearby (on the island, not inside a prop) and walks there. */
	pickDestination() {
		for (let attempt = 0; attempt < 12; attempt++) {
			const angle = Math.random() * Math.PI * 2;
			const distance = 20 + Math.random() * WANDER_RANGE;
			const x = this.root.position.x + Math.cos(angle) * distance;
			const z = this.root.position.z + Math.sin(angle) * distance;
			if (isWalkable(x, z, 6)) {
				this.destination.set(x, 0, z);
				this.state = 'walk';
				this.timer = GIVE_UP_AFTER;
				return;
			}
		}
		this.timer = 1; // Boxed in for now; try again in a moment.
	}

	updateBlink(now) {
		const sunbathing = this.state === 'using' && this.spot?.type === 'lie';
		if (!this.mii || now < this.nextBlink || this.state === 'held' || this.state === 'falling' || sunbathing) {
			return;
		}
		this.blinking = !this.blinking;
		this.setExpression(this.blinking ? FFLExpression.BLINK : this.mood);
		this.nextBlink = now + (this.blinking ? 120 : 1500 + Math.random() * 2500);
	}

	dispose() {
		this.endChat();
		this.standUp();
		if (this.mii) {
			disposeMiiModel(this.mii);
		}
		this.root.removeFromParent();
		this.follower.root.removeFromParent();
	}
}
