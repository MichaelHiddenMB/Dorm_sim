// Layout of the Mii Maker editor: tabs, sub-tabs, part grids, and which
// Wii U Mii Maker icon (from the sprite sheets in assets/ui/) shows each part.

const range = n => Array.from({ length: n }, (_, i) => i);

// Sprite sheet geometry, measured from the sheets that scripts/setup.sh downloads.
// Cells are laid out left to right, top to bottom.
const xActSheet = (file, w, h, y0) =>
	({ url: `assets/ui/${file}.png`, w, h, x0: 1, y0, pitchX: 131, pitchY: 111, cw: 130, ch: 110, cols: 3 });

export const SHEETS = {
	partIcons: { url: 'assets/ui/part-icons.png', w: 372, h: 433, x0: 3, y0: 3, pitchX: 123, pitchY: 115, cw: 120, ch: 112, cols: 3 },
	gender: { url: 'assets/ui/gender.png', w: 183, h: 245, x0: 3, y0: 3, pitchX: 90, pitchY: 0, cw: 87, ch: 173, cols: 2 },
	heads: xActSheet('heads', 394, 566, 122),
	hair: xActSheet('hair', 394, 5006, 122),
	eyebrows: xActSheet('eyebrows', 394, 1010, 122),
	eyes: xActSheet('eyes', 394, 2339, 119),
	noses: xActSheet('noses', 394, 788, 122),
	mouths: xActSheet('mouths', 394, 1454, 122),
	facialHair: xActSheet('facial-hair', 394, 566, 122),
	glasses: xActSheet('glasses', 394, 454, 121),
	wrinkles: xActSheet('wrinkles', 394, 677, 122),
	blushes: xActSheet('blushes', 394, 566, 122)
};

// The order Mii Maker (3DS / Wii U) shows parts in, page by page (12 per page).
// The icon sheets are in this same order. Source: MiiJS lookupTables.pages
// (https://github.com/Stewared/MiiJS/blob/main/data.js).
const HAIR_ORDER = [
	33, 47, 40, 37, 32, 107, 48, 51, 55, 70, 44, 66,
	52, 50, 38, 49, 43, 31, 56, 68, 62, 115, 76, 119,
	64, 81, 116, 121, 22, 58, 60, 87, 125, 117, 73, 75,
	42, 89, 57, 54, 80, 34, 23, 86, 88, 118, 39, 36,
	45, 67, 59, 65, 41, 30, 12, 16, 10, 82, 128, 129,
	14, 95, 105, 100, 6, 20, 93, 102, 27, 4, 17, 110,
	123, 8, 106, 72, 3, 21, 0, 98, 63, 90, 11, 120,
	5, 74, 108, 94, 124, 25, 99, 69, 35, 13, 122, 113,
	53, 24, 85, 83, 71, 131, 96, 101, 29, 7, 15, 112,
	79, 1, 109, 127, 91, 26, 61, 103, 2, 77, 18, 92,
	84, 9, 19, 130, 97, 104, 46, 78, 28, 114, 126, 111
];
const FACE_ORDER = [0, 1, 8, 2, 3, 9, 4, 5, 10, 6, 7, 11];
const EYEBROW_ORDER = [
	6, 0, 12, 1, 9, 19, 7, 21, 8, 17, 5, 4,
	11, 10, 2, 3, 14, 20, 15, 13, 22, 18, 16, 23
];
const EYE_ORDER = [
	2, 4, 0, 8, 39, 17, 1, 26, 16, 15, 27, 20,
	33, 11, 19, 32, 9, 12, 23, 34, 21, 25, 40, 35,
	5, 41, 13, 36, 37, 6, 24, 30, 31, 18, 28, 46,
	7, 44, 38, 42, 45, 29, 3, 43, 22, 10, 14, 47,
	48, 49, 50, 53, 59, 56, 54, 58, 57, 55, 51, 52
];
const NOSE_ORDER = [1, 10, 2, 3, 6, 0, 5, 4, 8, 9, 7, 11, 13, 14, 12, 17, 16, 15];
const MOUTH_ORDER = [
	23, 1, 18, 21, 22, 5, 0, 8, 10, 16, 6, 13,
	7, 9, 2, 11, 3, 4, 15, 17, 20, 19, 14, 12,
	27, 30, 24, 25, 29, 28, 26, 35, 31, 34, 33, 32
];

/** A sprite reference: [sheet key, cell index], or null for no icon. */
/** @typedef {[keyof typeof SHEETS, number] | null} SpriteRef */

/**
 * Pickable parts: the order to show them in and the icon for each part ID.
 * @type {Record<string, {order: number[], icon: (id: number) => SpriteRef, label?: (id: number) => string}>}
 */
export const PARTS = {
	faceType: { order: FACE_ORDER, icon: id => ['heads', FACE_ORDER.indexOf(id)] },
	// Wrinkles sheet: cells 0-1 are makeup 10-11 (beard shadows), 2-13 are wrinkles 0-11.
	faceTex: { order: range(12), icon: id => ['wrinkles', id + 2] },
	faceMake: { order: range(12), icon: id => (id < 10 ? ['blushes', id] : ['wrinkles', id - 10]) },
	hairType: { order: HAIR_ORDER, icon: id => ['hair', HAIR_ORDER.indexOf(id)] },
	eyebrowType: { order: EYEBROW_ORDER, icon: id => ['eyebrows', EYEBROW_ORDER.indexOf(id)] },
	eyeType: { order: EYE_ORDER, icon: id => ['eyes', EYE_ORDER.indexOf(id)] },
	noseType: { order: NOSE_ORDER, icon: id => ['noses', NOSE_ORDER.indexOf(id)] },
	mouthType: { order: MOUTH_ORDER, icon: id => ['mouths', MOUTH_ORDER.indexOf(id)] },
	glassType: { order: range(9), icon: id => ['glasses', id] },
	// Facial hair sheet: cells 0-5 are mustaches, 6-11 are beards.
	mustacheType: { order: range(6), icon: id => ['facialHair', id] },
	beardType: { order: range(6), icon: id => ['facialHair', id + 6] },
	moleType: { order: [0, 1], icon: id => (id ? null : ['facialHair', 0]), label: () => 'Mole' }
};

/**
 * Adjustment buttons (the arrow column in Mii Maker). Each has a field and
 * two buttons that step it. Icons are Material Symbols names.
 * FFL stores vertical positions top-down, so "up" is -1.
 */
export const ADJUSTMENTS = {
	y: { label: 'Move up/down', buttons: [['arrow_upward', -1], ['arrow_downward', 1]] },
	x: { label: 'Spacing', buttons: [['unfold_less', -1, 'sideways'], ['unfold_more', 1, 'sideways']] },
	moveX: { label: 'Move left/right', buttons: [['arrow_back', -1], ['arrow_forward', 1]] },
	rotate: { label: 'Rotate', buttons: [['rotate_left', 1], ['rotate_right', -1]] },
	scale: { label: 'Size', buttons: [['zoom_out', -1], ['zoom_in', 1]] },
	aspect: { label: 'Stretch', buttons: [['unfold_less', -1], ['unfold_more', 1]] }
};

/**
 * @typedef {{label?: string, icon?: SpriteRef, part: string, color?: string,
 *   flip?: string, adjust?: Record<string, string>}} SubTab
 * @typedef {{id: string, label: string, icon: number, subtabs?: SubTab[], body?: boolean}} Tab
 */

/** Top-level tabs. `icon` is the cell in the Mii Part Icons sheet. @type {Tab[]} */
export const TABS = [
	{ id: 'face', label: 'Face', icon: 0, subtabs: [
		{ label: 'Face shape', icon: ['heads', 0], part: 'faceType', color: 'faceColor' },
		{ label: 'Wrinkles', icon: ['wrinkles', 4], part: 'faceTex' },
		{ label: 'Makeup', icon: ['blushes', 1], part: 'faceMake' }
	] },
	{ id: 'hair', label: 'Hair', icon: 1, subtabs: [
		{ part: 'hairType', color: 'hairColor', flip: 'hairFlip' }
	] },
	{ id: 'eyebrows', label: 'Eyebrows', icon: 2, subtabs: [
		{ part: 'eyebrowType', color: 'eyebrowColor', adjust: {
			y: 'eyebrowY', x: 'eyebrowX', rotate: 'eyebrowRotate', scale: 'eyebrowScale', aspect: 'eyebrowAspect'
		} }
	] },
	{ id: 'eyes', label: 'Eyes', icon: 3, subtabs: [
		{ part: 'eyeType', color: 'eyeColor', adjust: {
			y: 'eyeY', x: 'eyeX', rotate: 'eyeRotate', scale: 'eyeScale', aspect: 'eyeAspect'
		} }
	] },
	{ id: 'nose', label: 'Nose', icon: 4, subtabs: [
		{ part: 'noseType', adjust: { y: 'noseY', scale: 'noseScale' } }
	] },
	{ id: 'mouth', label: 'Mouth', icon: 5, subtabs: [
		{ part: 'mouthType', color: 'mouthColor', adjust: { y: 'mouthY', scale: 'mouthScale', aspect: 'mouthAspect' } }
	] },
	{ id: 'extras', label: 'Glasses, facial hair & mole', icon: 6, subtabs: [
		{ label: 'Glasses', icon: ['glasses', 1], part: 'glassType', color: 'glassColor',
			adjust: { y: 'glassY', scale: 'glassScale' } },
		{ label: 'Mustache', icon: ['facialHair', 1], part: 'mustacheType', color: 'beardColor',
			adjust: { y: 'mustacheY', scale: 'mustacheScale' } },
		{ label: 'Beard', icon: ['facialHair', 11], part: 'beardType', color: 'beardColor' },
		{ label: 'Mole', icon: null, part: 'moleType', adjust: { y: 'moleY', moveX: 'moleX', scale: 'moleScale' } }
	] },
	{ id: 'body', label: 'Body & profile', icon: 7, body: true }
];

export const PAGE_SIZE = 12;
