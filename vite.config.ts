import { paraglideVitePlugin } from '@inlang/paraglide-js';
import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import Icons from 'unplugin-icons/vite'

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		devtoolsJson(),
		paraglideVitePlugin({ project: './project.inlang', outdir: './src/lib/paraglide' }),
		Icons({
			compiler: 'svelte',
		})
	],
	// The suite covers the read model and the metric library — pure functions over
	// records, no DOM and no network. It runs against this config rather than one
	// of its own because those modules import the compiled messages, which the
	// paraglide plugin above writes.
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
		// An age is whole years in UTC, and a date-only birthday falls either side
		// of one depending on where the machine thinks it is.
		env: { TZ: 'UTC' }
	}
});
