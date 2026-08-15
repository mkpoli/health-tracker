import { readdir } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = resolve(fileURLToPath(new URL('../src', import.meta.url)));
const generatedRoot = join(sourceRoot, 'lib', 'paraglide');
const javascriptExtensions = new Set(['.cjs', '.js', '.jsx', '.mjs']);

async function findAuthoredJavaScript(directory: string): Promise<string[]> {
	if (directory === generatedRoot) return [];

	const matches: string[] = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			matches.push(...await findAuthoredJavaScript(path));
		} else if (entry.isFile() && javascriptExtensions.has(extname(entry.name))) {
			matches.push(relative(sourceRoot, path));
		}
	}
	return matches;
}

const authoredJavaScript = await findAuthoredJavaScript(sourceRoot);
if (authoredJavaScript.length > 0) {
	console.error('Authored JavaScript under src cannot be type-checked while checkJs is disabled:');
	for (const path of authoredJavaScript.sort()) console.error(`- src/${path}`);
	process.exitCode = 1;
}
