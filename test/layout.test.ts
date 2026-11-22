import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	buildLayoutManifest,
	encodeBase64Json,
	imageKeyId,
	parseControlId,
	parseSubId,
	subIdToKeyId,
	useManifest,
	wideSubId,
} from '../src/satellite/layout.ts'

test('buildLayoutManifest marks only wide cells', () => {
	const m = buildLayoutManifest(2, 3, ['1/2'])
	assert.deepEqual(m.stylePresets, { default: { bitmap: { w: 72, h: 72 } }, wide: { bitmap: { w: 200, h: 100 } } })
	assert.equal(Object.keys(m.controls).length, 6)
	assert.deepEqual(m.controls['1/2'], { row: 1, column: 2, stylePreset: 'wide' })
	assert.deepEqual(m.controls['0/0'], { row: 0, column: 0 })
})

test('buildLayoutManifest ignores out-of-grid and duplicate keys', () => {
	const m = buildLayoutManifest(1, 1, ['0/0', '0/0', '5/5'])
	assert.deepEqual(Object.keys(m.controls), ['0/0'])
	assert.equal(m.controls['0/0'].stylePreset, 'wide')
})

test('useManifest needs both features', () => {
	assert.equal(useManifest({ surfaceManifest: true, nonSquareBitmaps: true }), true)
	assert.equal(useManifest({ surfaceManifest: true, nonSquareBitmaps: false }), false)
	assert.equal(useManifest({ surfaceManifest: false, nonSquareBitmaps: true }), false)
})

test('parseControlId', () => {
	assert.deepEqual(parseControlId('4/7'), { row: 4, column: 7 })
	assert.equal(parseControlId('x'), null)
	assert.equal(parseControlId('1/2/3'), null)
})

test('wide sub ids round-trip and match Companion SUBID rule', () => {
	const id = wideSubId(2, 5, 0)
	assert.match(id, /^[a-zA-Z0-9\-/]+$/)
	assert.deepEqual(parseSubId(id), { page: 2, row: 5, column: 0, wide: true })
	assert.deepEqual(parseSubId('2/5/0'), { page: 2, row: 5, column: 0, wide: false })
	assert.equal(parseSubId('2/5'), null)
})

test('encodeBase64Json round-trips', () => {
	assert.deepEqual(JSON.parse(Buffer.from(encodeBase64Json({ a: 1 }), 'base64').toString()), { a: 1 })
})

test('imageKeyId separates wide entries', () => {
	assert.equal(imageKeyId(null, 5, 0, false), 'dynamic/5/0')
	assert.equal(imageKeyId(null, 5, 0, true), 'dynamic/5/0/w')
	assert.equal(imageKeyId(2, 5, 0, true), '2/5/0/w')
})

test('subIdToKeyId maps subscription ids to cache keys', () => {
	assert.equal(subIdToKeyId('2/5/0-w'), '2/5/0/w')
	assert.equal(subIdToKeyId('2/5/0'), '2/5/0')
	assert.equal(subIdToKeyId('nope'), null)
})
