/** Creates an element with properties and children. */
export function el(tag, props = {}, children = []) {
	const node = Object.assign(document.createElement(tag), props);
	node.append(...children);
	return node;
}

/** A Material Symbols icon (the font is loaded in index.html). */
export const symbol = (name, extraClass = '') =>
	el('span', { className: `material-symbols-rounded ${extraClass}`, textContent: name, ariaHidden: 'true' });
