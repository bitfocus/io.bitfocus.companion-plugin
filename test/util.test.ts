import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PNG } from 'pngjs'
import { dataToImageUrl } from '../src/util.ts'

test('dataToImageUrl encodes a 200x100 bitmap', () => {
	const url = dataToImageUrl(Buffer.alloc(200 * 100 * 3, 0x80), 200, 100)
	const png = PNG.sync.read(Buffer.from(url.replace('data:image/png;base64,', ''), 'base64'))
	assert.equal(png.width, 200)
	assert.equal(png.height, 100)
	assert.equal(png.data[0], 0x80)
})

test('dataToImageUrl defaults to 72x72', () => {
	const png = PNG.sync.read(Buffer.from(dataToImageUrl(Buffer.alloc(72 * 72 * 3)).split(',')[1], 'base64'))
	assert.equal(png.width, 72)
})
