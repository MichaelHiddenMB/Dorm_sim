// Builds a Mii's 3D model: FFL head (FFL.js) attached to the Wii U Mii Maker body glTF.
import * as THREE from 'three';
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

const RESOURCE_PATH = 'assets/AFLResHigh_2_3.dat';
const BODY_PATHS = ['assets/body-male.glb', 'assets/body-female.glb']; // Indexed by gender.
const CREATE_ID_OFFSET = 264; // FFLiCharInfo.createID
const CREATE_ID_SIZE = 10;

export { FFLExpression };

/** Expressions each Mii can switch between without rebuilding. */
const expressionFlag = makeExpressionFlag([
	FFLExpression.NORMAL, FFLExpression.BLINK, FFLExpression.SURPRISE,
	FFLExpression.SMILE, FFLExpression.HAPPY
]);

addSkeletonScalingExtensions(THREE.Skeleton); // Needed for Mii height/build bone scaling.
installModelSpaceSkeletonUpdate();

/**
 * Replaces the Skeleton.update installed by FFL.js's SkeletonScalingExtensions.
 * FFL.js adjusts the skl_root children's translation for height/build in *world*
 * space, which is only right when the body sits at the world origin (as when
 * rendering an icon). Anywhere else it scales the Mii's world position, so the
 * visible body (and attached head) drift away from where the Mii really is.
 * This does the same math in the body model's own space (`skeleton.modelRoot`,
 * set in buildMiiModel), and is otherwise the same as FFL.js's version.
 */
function installModelSpaceSkeletonUpdate() {
	const identity = new THREE.Matrix4();
	const scaled = new THREE.Matrix4();
	const product = new THREE.Matrix4();
	const temp = new THREE.Matrix4();
	const model = new THREE.Matrix4();
	const modelInverse = new THREE.Matrix4();
	const position = new THREE.Vector3();
	const quaternion = new THREE.Quaternion();
	const translation = new THREE.Vector3();

	/** FFL.js adjustTranslationForRoot: scale the translation, keep the legs planted. */
	function adjustTranslationForRoot(bone, matrix) {
		translation.setFromMatrixPosition(matrix);
		const scale = bone.scaleForRootAdjust;
		translation.x *= scale.y;
		translation.y *= scale.y;
		translation.z *= scale.x;
		translation.y += scale.x - scale.y;
		matrix.setPosition(translation);
	}

	/** FFL.js updateAttachments: places attached objects (the head) on their bone. */
	function updateAttachments(attachments, boneMatrices, boneInverses) {
		for (const at of attachments) {
			product.fromArray(boneMatrices, at.boneIdx * 16);
			product.multiply(temp.copy(boneInverses[at.boneIdx]).invert());
			if (at.localScale) {
				product.decompose(translation, quaternion, position);
				product.compose(translation, quaternion, at.localScale);
			}
			temp.copy(at.obj.parent ? at.obj.parent.matrixWorld : identity).invert();
			at.obj.matrix.multiplyMatrices(temp, product);
			at.obj.updateMatrixWorld(true);
		}
	}

	THREE.Skeleton.prototype.update = function update() {
		const boneMatrices = this.boneMatrices;
		const modelRoot = this.modelRoot;
		if (modelRoot) {
			model.copy(modelRoot.matrixWorld);
			modelInverse.copy(model).invert();
		}
		for (let i = 0; i < this.bones.length; i++) {
			const bone = this.bones[i];
			let matrixWorld = bone ? bone.matrixWorld : identity;
			if (bone && bone.scalling) {
				matrixWorld = scaled.copy(matrixWorld).scale(bone.scalling);
				if (bone.scaleForRootAdjust) {
					// The fix: adjust in model space, then go back to world space.
					if (modelRoot) {
						scaled.premultiply(modelInverse);
					}
					adjustTranslationForRoot(bone, scaled);
					if (modelRoot) {
						scaled.premultiply(model);
					}
				}
				// Children follow the scaled parent.
				for (const child of bone.children) {
					position.setFromMatrixPosition(temp.copy(scaled).multiply(child.matrix));
					child.matrixWorld.setPosition(position);
				}
			}
			product.multiplyMatrices(matrixWorld, this.boneInverses[i]).toArray(boneMatrices, i * 16);
		}
		if (this._attachments) {
			updateAttachments(this._attachments, boneMatrices, this.boneInverses);
		}
		if (this.boneTexture) {
			this.boneTexture.needsUpdate = true;
		}
	};
}

/** @type {FFL} */ let ffl;
/** @type {Array<import('three/addons/loaders/GLTFLoader.js').GLTF>} */ let bodyTemplates;
/** @type {THREE.WebGLRenderer} */ let renderer;

/** Loads the Mii parts resource and body models. Call once before building Miis. */
export async function initMiiModels(webglRenderer) {
	renderer = webglRenderer;
	const resourceResponse = await fetch(RESOURCE_PATH);
	if (!resourceResponse.ok) {
		throw new Error(`Missing ${RESOURCE_PATH}. Run ./scripts/setup.sh first.`);
	}
	const loader = new GLTFLoader();
	[ffl, ...bodyTemplates] = await Promise.all([
		FFL.initWithResource(resourceResponse, globalThis.ModuleFFL),
		...BODY_PATHS.map(path => loader.loadAsync(path))
	]);
	ffl.setRenderer(renderer);
}

/**
 * A random Mii from FFL. FFLiDatabaseRandom::Get never writes the creator ID,
 * so it holds leftover heap memory that can fail verification (reason 55).
 */
export function randomCharInfo() {
	const info = getRandomCharInfo(ffl);
	info.fill(0, CREATE_ID_OFFSET, CREATE_ID_OFFSET + CREATE_ID_SIZE);
	return info;
}

/**
 * Builds the head and body for a Mii. Throws if FFL rejects the data.
 * @param {Uint8Array} charInfo
 * @returns {{charModel: CharModel, body: {model: THREE.Object3D}}}
 */
export function buildMiiModel(charInfo) {
	const charModel = new CharModel(ffl, charInfo, expressionFlag, FFLShaderMaterial, renderer);
	charModel.meshes.traverse((m) => {
		m.frustumCulled = false;
	});

	const gltf = bodyTemplates[charModel.charInfo.gender];
	const model = SkeletonUtils.clone(gltf.scene);
	model.traverse((m) => {
		m.frustumCulled = false;
		if (m.isSkinnedMesh) {
			m.skeleton.modelRoot = model; // Space for the height/build adjustment (see above).
		}
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

/** @param {ReturnType<typeof buildMiiModel>} mii */
export function disposeMiiModel(mii) {
	mii.body.model.removeFromParent();
	mii.charModel.dispose();
	disposeModel(mii.body.model);
}
