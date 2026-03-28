import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const vendorDir = path.join(rootDir, 'io.bitfocus.companion-plugin.sdPlugin', 'js', 'vendor')
const outputFile = path.join(vendorDir, 'sdpi-components.js')

const url = 'https://sdpi-components.dev/releases/v3/sdpi-components.js'

fs.mkdirSync(vendorDir, { recursive: true })

console.log(`Downloading ${url}`)

https
	.get(url, (res) => {
		if (res.statusCode !== 200) {
			console.error(`Download failed: HTTP ${res.statusCode}`)
			res.resume()
			process.exit(1)
		}

		const file = fs.createWriteStream(outputFile)
		res.pipe(file)
		file.on('finish', () => {
			file.close()
			console.log(`Saved to ${path.relative(rootDir, outputFile)}`)
		})
		file.on('error', (err) => {
			fs.unlinkSync(outputFile)
			console.error(`File write error: ${err.message}`)
			process.exit(1)
		})
	})
	.on('error', (err) => {
		console.error(`Request error: ${err.message}`)
		process.exit(1)
	})
