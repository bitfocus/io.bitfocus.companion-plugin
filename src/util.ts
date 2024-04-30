import { FillImageMessage } from './companion-connection'
import { PNG } from 'pngjs'

// TODO - this is very inefficient
export function dataToImageUrl(data: number[]): string {
	const png = new PNG({
		width: 72,
		height: 72,
	})

	const inputData = Buffer.from(data)

	// Transform the received RGB to RGBA
	for (let y = 0; y < 72; y++) {
		for (let x = 0; x < 72; x++) {
			const from = (y * 72 + x) * 3
			const to = (y * 72 + x) * 4

			png.data.writeUint8(inputData.readUint8(from), to)
			png.data.writeUint8(inputData.readUint8(from + 1), to + 1)
			png.data.writeUint8(inputData.readUint8(from + 2), to + 2)
			png.data.writeUint8(255, to + 3)
		}
	}

	return 'data:image/png;base64,' + PNG.sync.write(png).toString('base64')
}

export function combineBankNumber(row: number, column: number): number | null {
	if (row < 0 || row >= 4) return null
	if (column < 0 || column >= 8) return null

	return row * 8 + column
}

export function extractRowAndColumn(props: FillImageMessage): { row: number; column: number } | null {
	if (props.column != null && props.row != null) {
		return { row: props.row, column: props.column }
	}

	const bankOrIndex = props.bank || props.keyIndex
	if (bankOrIndex != null) {
		const row = Math.floor(bankOrIndex / 8)
		const column = bankOrIndex % 8

		return { row, column }
	}

	return null
}
