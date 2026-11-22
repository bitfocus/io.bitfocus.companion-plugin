// Pure helpers for the satellite surface layout. No runtime imports, so they can be unit tested with plain node.

export const WIDE_BITMAP = { w: 200, h: 100 } as const
export const SQUARE_BITMAP = { w: 72, h: 72 } as const

export interface LayoutManifest {
	stylePresets: Record<string, { bitmap: { w: number; h: number } }>
	controls: Record<string, { row: number; column: number; stylePreset?: string }>
}

/** A per-control layout (and so wide bitmaps) needs both a LAYOUT_MANIFEST and non-square bitmap support */
export function useManifest(features: { surfaceManifest: boolean; nonSquareBitmaps: boolean }): boolean {
	return features.surfaceManifest && features.nonSquareBitmaps
}

/** Describe a rows x cols grid, where the `row/column` cells in `wideKeys` get wide bitmaps */
export function buildLayoutManifest(rows: number, cols: number, wideKeys: Iterable<string>): LayoutManifest {
	const wide = new Set(wideKeys)
	const controls: LayoutManifest['controls'] = {}
	for (let row = 0; row < rows; row++) {
		for (let column = 0; column < cols; column++) {
			const id = `${row}/${column}`
			controls[id] = wide.has(id) ? { row, column, stylePreset: 'wide' } : { row, column }
		}
	}
	return {
		stylePresets: { default: { bitmap: { ...SQUARE_BITMAP } }, wide: { bitmap: { ...WIDE_BITMAP } } },
		controls,
	}
}

export function encodeBase64Json(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString('base64')
}

export function parseControlId(id: string): { row: number; column: number } | null {
	const match = /^(\d+)\/(\d+)$/.exec(id)
	return match ? { row: Number(match[1]), column: Number(match[2]) } : null
}

/** SUBID for a wide subscription, kept distinct from the square one for the same button */
export function wideSubId(page: number, row: number, column: number): string {
	return `${page}/${row}/${column}-w`
}

export function parseSubId(subId: string): { page: number; row: number; column: number; wide: boolean } | null {
	const match = /^(\d+)\/(\d+)\/(\d+)(-w)?$/.exec(subId)
	if (!match) return null
	return { page: Number(match[1]), row: Number(match[2]), column: Number(match[3]), wide: !!match[4] }
}

/** Image cache key for a button; dials (wide) get their own entry so they subscribe separately from keys */
export function imageKeyId(page: number | null, row: number, column: number, wide: boolean): string {
	return `${page === null ? 'dynamic' : page}/${row}/${column}${wide ? '/w' : ''}`
}

/** Image cache key for the static page subscription `subId`, or null if it isn't one of ours */
export function subIdToKeyId(subId: string): string | null {
	const parsed = parseSubId(subId)
	return parsed ? imageKeyId(parsed.page, parsed.row, parsed.column, parsed.wide) : null
}
