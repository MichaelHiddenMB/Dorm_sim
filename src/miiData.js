// Read/write helpers for FFLiCharInfo, the 288-byte Mii struct FFL renders from.
// Field offsets match _unpackFFLiCharInfo in vendor/ffljs/ffl.js.
// Ranges are the FFL_*_MAX constants from the FFL decomp (FFLiCharInfo.cpp).

export const CHAR_INFO_SIZE = 288;
const NAME_OFFSET = 180;
const NAME_MAX_CHARS = 10;

/** @typedef {{offset: number, min: number, max: number}} Field */

/** @type {Record<string, Field>} */
export const FIELDS = {
	faceType: { offset: 4, min: 0, max: 11 },
	faceColor: { offset: 8, min: 0, max: 5 },
	faceTex: { offset: 12, min: 0, max: 11 },
	faceMake: { offset: 16, min: 0, max: 11 },
	hairType: { offset: 20, min: 0, max: 131 },
	hairColor: { offset: 24, min: 0, max: 7 },
	hairFlip: { offset: 28, min: 0, max: 1 },
	eyeType: { offset: 32, min: 0, max: 59 },
	eyeColor: { offset: 36, min: 0, max: 5 },
	eyeScale: { offset: 40, min: 0, max: 7 },
	eyeAspect: { offset: 44, min: 0, max: 6 },
	eyeRotate: { offset: 48, min: 0, max: 7 },
	eyeX: { offset: 52, min: 0, max: 12 },
	eyeY: { offset: 56, min: 0, max: 18 },
	eyebrowType: { offset: 60, min: 0, max: 23 },
	eyebrowColor: { offset: 64, min: 0, max: 7 },
	eyebrowScale: { offset: 68, min: 0, max: 8 },
	eyebrowAspect: { offset: 72, min: 0, max: 6 },
	eyebrowRotate: { offset: 76, min: 0, max: 11 },
	eyebrowX: { offset: 80, min: 0, max: 12 },
	eyebrowY: { offset: 84, min: 3, max: 18 },
	noseType: { offset: 88, min: 0, max: 17 },
	noseScale: { offset: 92, min: 0, max: 8 },
	noseY: { offset: 96, min: 0, max: 18 },
	mouthType: { offset: 100, min: 0, max: 35 },
	mouthColor: { offset: 104, min: 0, max: 4 },
	mouthScale: { offset: 108, min: 0, max: 8 },
	mouthAspect: { offset: 112, min: 0, max: 6 },
	mouthY: { offset: 116, min: 0, max: 18 },
	mustacheType: { offset: 120, min: 0, max: 5 },
	beardType: { offset: 124, min: 0, max: 5 },
	beardColor: { offset: 128, min: 0, max: 7 },
	mustacheScale: { offset: 132, min: 0, max: 8 },
	mustacheY: { offset: 136, min: 0, max: 16 },
	glassType: { offset: 140, min: 0, max: 8 },
	glassColor: { offset: 144, min: 0, max: 5 },
	glassScale: { offset: 148, min: 0, max: 7 },
	glassY: { offset: 152, min: 0, max: 20 },
	moleType: { offset: 156, min: 0, max: 1 },
	moleScale: { offset: 160, min: 0, max: 8 },
	moleX: { offset: 164, min: 0, max: 16 },
	moleY: { offset: 168, min: 0, max: 30 },
	height: { offset: 172, min: 0, max: 127 },
	build: { offset: 176, min: 0, max: 127 },
	gender: { offset: 224, min: 0, max: 1 },
	favoriteColor: { offset: 236, min: 0, max: 11 }
};

// Palettes from the FFL decomp's color tables (src/FFLiColor.cpp), as 0-1 RGB.
// Eyebrows and facial hair use the hair colors; eye color is the iris (eyeColorB).
const HAIR_COLORS = [
	[0.118, 0.102, 0.094], [0.251, 0.125, 0.063], [0.361, 0.094, 0.039], [0.486, 0.227, 0.078],
	[0.471, 0.471, 0.502], [0.306, 0.243, 0.063], [0.533, 0.345, 0.094], [0.816, 0.627, 0.290]
];
const PALETTES = {
	faceColor: [
		[1.000, 0.827, 0.678], [1.000, 0.714, 0.420], [0.870, 0.475, 0.259],
		[1.000, 0.667, 0.549], [0.678, 0.318, 0.161], [0.388, 0.173, 0.094]
	],
	hairColor: HAIR_COLORS,
	eyebrowColor: HAIR_COLORS,
	beardColor: HAIR_COLORS,
	eyeColor: [
		[0.000, 0.000, 0.000], [0.424, 0.439, 0.439], [0.400, 0.235, 0.173],
		[0.376, 0.369, 0.188], [0.275, 0.329, 0.659], [0.220, 0.439, 0.345]
	],
	glassColor: [
		[0.094, 0.094, 0.094], [0.376, 0.219, 0.062], [0.658, 0.062, 0.031],
		[0.125, 0.188, 0.407], [0.658, 0.376, 0.000], [0.470, 0.439, 0.407]
	],
	mouthColor: [
		[0.847, 0.322, 0.031], [0.941, 0.047, 0.031], [0.961, 0.282, 0.282],
		[0.941, 0.604, 0.455], [0.549, 0.314, 0.251]
	],
	favoriteColor: [
		[0.824, 0.118, 0.078], [1.000, 0.431, 0.098], [1.000, 0.847, 0.125], [0.471, 0.824, 0.125],
		[0.000, 0.471, 0.188], [0.039, 0.282, 0.706], [0.235, 0.667, 0.871], [0.961, 0.353, 0.490],
		[0.451, 0.157, 0.678], [0.282, 0.220, 0.094], [0.878, 0.878, 0.878], [0.094, 0.094, 0.078]
	]
};

/** @param {string} key - A color field key. @returns {string[]} CSS colors by index. */
export const paletteFor = key => PALETTES[key].map(([r, g, b]) =>
	`rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`);

/** @param {Uint8Array} info @param {string} key */
export const getField = (info, key) =>
	new DataView(info.buffer, info.byteOffset).getInt32(FIELDS[key].offset, true);

/** @param {Uint8Array} info @param {string} key @param {number} value */
export function setField(info, key, value) {
	const { offset, min, max } = FIELDS[key];
	const clamped = Math.min(max, Math.max(min, Math.round(value)));
	new DataView(info.buffer, info.byteOffset).setInt32(offset, clamped, true);
}

/** @param {Uint8Array} info */
export function getName(info) {
	const chars = new Uint16Array(info.buffer.slice(info.byteOffset + NAME_OFFSET,
		info.byteOffset + NAME_OFFSET + NAME_MAX_CHARS * 2));
	const end = chars.indexOf(0);
	return String.fromCharCode(...(end === -1 ? chars : chars.subarray(0, end)));
}

/** @param {Uint8Array} info @param {string} name */
export function setName(info, name) {
	const view = new DataView(info.buffer, info.byteOffset);
	const text = name.replace(/[%\\]/g, '').slice(0, NAME_MAX_CHARS);
	for (let i = 0; i <= NAME_MAX_CHARS; i++) {
		view.setUint16(NAME_OFFSET + i * 2, i < text.length ? text.charCodeAt(i) : 0, true);
	}
}

export const toHex = (/** @type {Uint8Array} */ bytes) =>
	Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

export function fromHex(/** @type {string} */ hex) {
	if (!/^[0-9a-f]+$/i.test(hex) || hex.length !== CHAR_INFO_SIZE * 2) {
		return null;
	}
	return Uint8Array.from({ length: CHAR_INFO_SIZE }, (_, i) =>
		Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}
