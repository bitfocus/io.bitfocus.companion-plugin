import commonjs from '@rollup/plugin-commonjs'
import nodeResolve from '@rollup/plugin-node-resolve'
import terser from '@rollup/plugin-terser'
import typescript from '@rollup/plugin-typescript'
import image from '@rollup/plugin-image'
import path from 'node:path'
import url from 'node:url'

const isWatching = !!process.env.ROLLUP_WATCH
const sdPlugin = 'io.bitfocus.companion-plugin.sdPlugin'

/**
 * @type {import('rollup').RollupOptions}
 */
const pluginConfig = {
	input: 'src/plugin.ts',
	output: {
		file: `${sdPlugin}/bin/plugin.js`,
		sourcemap: isWatching,
		sourcemapPathTransform: (relativeSourcePath, sourcemapPath) => {
			return url.pathToFileURL(path.resolve(path.dirname(sourcemapPath), relativeSourcePath)).href
		},
	},
	plugins: [
		{
			name: 'watch-externals',
			buildStart: function () {
				this.addWatchFile(`${sdPlugin}/manifest.json`)
			},
		},
		typescript({
			mapRoot: isWatching ? './' : undefined,
		}),
		nodeResolve({
			browser: false,
			exportConditions: ['node'],
			preferBuiltins: true,
		}),
		commonjs(),
		image(),
		!isWatching && terser(),
		{
			name: 'emit-module-package-file',
			generateBundle() {
				this.emitFile({ fileName: 'package.json', source: `{ "type": "module" }`, type: 'asset' })
			},
		},
	],
}

/**
 * @type {import('rollup').RollupOptions}
 */
const inspectorConfig = {
	input: 'src/inspector.ts',
	output: {
		file: `${sdPlugin}/bin/inspector.js`,
		sourcemap: isWatching,
		sourcemapPathTransform: (relativeSourcePath, sourcemapPath) => {
			return url.pathToFileURL(path.resolve(path.dirname(sourcemapPath), relativeSourcePath)).href
		},
	},
	plugins: [
		typescript({
			mapRoot: isWatching ? './' : undefined,
		}),
		nodeResolve({
			browser: true,
			exportConditions: ['node'],
			preferBuiltins: true,
		}),
		commonjs(),
		!isWatching && terser(),
		// {
		// 	name: "emit-module-package-file",
		// 	generateBundle() {
		// 		this.emitFile({ fileName: "package.json", source: `{ "type": "module" }`, type: "asset" });
		// 	}
		// }
	],
}

export default [pluginConfig, inspectorConfig]
