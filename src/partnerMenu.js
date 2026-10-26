// "Choose a partner" menu, laid out like the Mii Maker: generation tabs across
// the top, a paged grid of Pokémon icons, and Back/OK along the bottom.
import { el, symbol } from './dom.js';
import { iconUrl } from './pokemon.js';

/** National Dex ranges for each generation in Pokémon Rumble World. */
const GENERATIONS = [
	{ label: 'Generation I', first: 1, last: 151 },
	{ label: 'Generation II', first: 152, last: 251 },
	{ label: 'Generation III', first: 252, last: 386 },
	{ label: 'Generation IV', first: 387, last: 493 },
	{ label: 'Generation V', first: 494, last: 649 },
	{ label: 'Generation VI', first: 650, last: 721 }
];
const PAGE_SIZE = 16;

const label = entry => `#${String(entry.dex).padStart(4, '0')} ${entry.name}`;

/**
 * @param {object} options
 * @param {import('./pokemon.js').PokemonEntry[]} options.pokemon
 * @param {() => number|null} options.getSelected - Selected entry id, or null for none.
 * @param {(entry: import('./pokemon.js').PokemonEntry|null) => void} options.onSelect
 */
export function createPartnerMenu({ pokemon, getSelected, onSelect }) {
	const tabsEl = document.getElementById('partner-tabs');
	const gridEl = document.getElementById('partner-grid');
	const nameEl = document.getElementById('partner-name');
	const searchEl = /** @type {HTMLInputElement} */ (document.getElementById('partner-search'));
	const noneEl = document.getElementById('partner-none');

	const generations = GENERATIONS
		.map(gen => ({ ...gen, entries: pokemon.filter(p => p.dex >= gen.first && p.dex <= gen.last) }))
		.filter(gen => gen.entries.length);
	let activeGen = generations[0];
	let page = 0;

	/** Opens the generation and page that hold the current partner. */
	function showSelected() {
		const selected = pokemon.find(p => p.id === getSelected());
		if (selected) {
			activeGen = generations.find(gen => gen.entries.includes(selected)) ?? activeGen;
			page = Math.floor(activeGen.entries.indexOf(selected) / PAGE_SIZE);
		}
		searchEl.value = '';
		render();
	}

	function select(entry) {
		onSelect(entry);
		render();
	}

	function render() {
		const query = searchEl.value.trim().toLowerCase();
		const selectedId = getSelected();
		const selected = pokemon.find(p => p.id === selectedId);

		tabsEl.replaceChildren(...generations.map(gen => el('button', {
			type: 'button',
			className: 'tab' + (gen === activeGen && !query ? ' active' : ''),
			title: gen.label,
			ariaLabel: gen.label,
			ariaPressed: String(gen === activeGen && !query),
			onclick: () => {
				activeGen = gen;
				page = 0;
				searchEl.value = '';
				render();
			}
		}, [el('img', { className: 'tab-icon', src: iconUrl(gen.entries[0]), alt: '' })])));

		const list = query
			? pokemon.filter(p => p.name.toLowerCase().includes(query) || String(p.dex) === query.replace(/^#?0*/, ''))
			: activeGen.entries;
		const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
		page = Math.min(page, pages - 1);
		const turnPage = (delta) => {
			page = (page + delta + pages) % pages;
			render();
		};

		const tiles = list.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(entry => el('button', {
			type: 'button',
			className: 'tile pokemon-tile' + (entry.id === selectedId ? ' active' : ''),
			title: label(entry),
			ariaLabel: label(entry),
			ariaPressed: String(entry.id === selectedId),
			onclick: () => select(entry)
		}, [
			el('img', { src: iconUrl(entry), alt: '', loading: 'lazy' }),
			el('span', { className: 'dex-number', textContent: String(entry.dex).padStart(4, '0') })
		]));

		gridEl.replaceChildren(
			el('div', { className: 'pager', hidden: pages < 2 }, [
				el('button', { type: 'button', ariaLabel: 'Previous page', onclick: () => turnPage(-1) }, [symbol('chevron_left')]),
				el('span', { textContent: `${page + 1} / ${pages}` }),
				el('button', { type: 'button', ariaLabel: 'Next page', onclick: () => turnPage(1) }, [symbol('chevron_right')])
			]),
			tiles.length
				? el('div', { className: 'grid pokemon-grid' }, tiles)
				: el('p', { className: 'empty-note', textContent: `No Pokémon match "${searchEl.value.trim()}".` })
		);

		noneEl.classList.toggle('active', selectedId === null);
		noneEl.ariaPressed = String(selectedId === null);
		nameEl.textContent = selected ? label(selected) : 'No partner';
	}

	searchEl.addEventListener('input', () => {
		page = 0;
		render();
	});
	noneEl.addEventListener('click', () => select(null));

	return { show: showSelected };
}
