export function dataToImageUrl(data: number[]): string {
	const sourceData = new Uint8Array(data)
	const imageData = new ImageData(72, 72)

	let si = 0
	let di = 0
	for (var y = 0; y < 72; ++y) {
		for (var x = 0; x < 72; ++x) {
			imageData.data[di++] = sourceData[si++]
			imageData.data[di++] = sourceData[si++]
			imageData.data[di++] = sourceData[si++]
			imageData.data[di++] = 255
		}
	}

	const canvas = document.createElement('canvas')
	canvas.width = 72
	canvas.height = 72

	const ctx = canvas.getContext('2d')
	if (!ctx) throw new Error('Failed to get canvas context')
	ctx.putImageData(imageData, 0, 0)

	return canvas.toDataURL('image/png')
}

export async function loadImageAsDataUri(url: string): Promise<string> {
	return new Promise<string>((resolve) => {
		const image = new Image()

		image.onload = () => {
			var canvas = document.createElement('canvas')

			canvas.width = image.naturalWidth
			canvas.height = image.naturalHeight

			const ctx = canvas.getContext('2d')
			if (!ctx) throw new Error('Failed to get canvas context')

			ctx.drawImage(image, 0, 0)
			resolve(canvas.toDataURL('image/png'))
		}

		image.src = url
	})
}

export function combineBankNumber(row: number, column: number): number | null {
	if (row < 0 || row >= 4) return null
	if (column < 0 || column >= 8) return null

	return row * 8 + column
}
