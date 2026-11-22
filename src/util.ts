import type { FillImageMessage } from './companion-connection'
import { PNG } from 'pngjs'

// TODO - this is very inefficient
export function dataToImageUrl(data: Buffer | { data: number[] }, width = 72, height = 72): string {
	const png = new PNG({
		width,
		height,
	})

	const inputData = Buffer.isBuffer(data) ? data : Buffer.from(data.data)

	// Transform the received RGB to RGBA
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const from = (y * width + x) * 3
			const to = (y * width + x) * 4

			png.data.writeUint8(inputData.readUint8(from), to)
			png.data.writeUint8(inputData.readUint8(from + 1), to + 1)
			png.data.writeUint8(inputData.readUint8(from + 2), to + 2)
			png.data.writeUint8(255, to + 3)
		}
	}

	return 'data:image/png;base64,' + PNG.sync.write(png, { deflateLevel: 1 }).toString('base64')
}

/** Raw RGB bitmaps carry no size, so tell a wide one by its length (a bitmap from before a re-registration may still arrive) */
export function isWideRawBitmap(data: Buffer | { data: number[] }): boolean {
	return (Buffer.isBuffer(data) ? data.length : data.data.length) === 200 * 100 * 3
}

export function combineBankNumber(row: number, column: number): number | null {
	if (row < 0 || row >= 4) return null
	if (column < 0 || column >= 8) return null

	return row * 8 + column
}

export function bankIndexToRowAndColumn(bankOrIndex: number): { row: number; column: number } {
	const row = Math.floor(bankOrIndex / 8)
	const column = bankOrIndex % 8

	return { row, column }
}

export function extractRowAndColumn(props: FillImageMessage): { row: number; column: number } | null {
	if (props.column != null && props.row != null) {
		return { row: props.row, column: props.column }
	}

	const bankOrIndex = props.bank || props.keyIndex
	if (bankOrIndex != null) {
		return bankIndexToRowAndColumn(bankOrIndex)
	}

	return null
}
