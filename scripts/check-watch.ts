import { spawn, type ChildProcess } from 'node:child_process';

const children = new Set<ChildProcess>();
let stopping = false;
let interrupted = false;

function start(args: string[], piped = false) {
	const child = spawn(process.execPath, args, {
		stdio: piped ? ['inherit', 'pipe', 'pipe'] : 'inherit',
	});
	children.add(child);
	child.once('exit', () => children.delete(child));
	return child;
}

function waitForExit(child: ChildProcess) {
	return new Promise<number>((resolve, reject) => {
		child.once('error', reject);
		child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
	});
}

async function run(args: string[]) {
	const code = await waitForExit(start(args));
	if (code !== 0) throw new Error(`Command failed: bun ${args.join(' ')}`);
}

function stop(signal: NodeJS.Signals = 'SIGTERM') {
	if (stopping) return;
	stopping = true;
	for (const child of children) child.kill(signal);
}

process.once('SIGINT', () => {
	interrupted = true;
	stop('SIGINT');
});
process.once('SIGTERM', () => {
	interrupted = true;
	stop('SIGTERM');
});

await run(['run', 'messages']);
await run(['x', 'svelte-kit', 'sync']);

const messageWatcher = start(
	[
		'x',
		'paraglide-js',
		'compile',
		'--project',
		'./project.inlang',
		'--outdir',
		'./src/lib/paraglide',
		'--watch',
	],
	true,
);

await new Promise<void>((resolve, reject) => {
	let output = '';
	const forward = (target: NodeJS.WriteStream) => (chunk: Buffer) => {
		target.write(chunk);
		output = `${output}${chunk}`.slice(-4_096);
		if (output.includes('Watching for changes')) resolve();
	};

	messageWatcher.stdout?.on('data', forward(process.stdout));
	messageWatcher.stderr?.on('data', forward(process.stderr));
	messageWatcher.once('error', reject);
	messageWatcher.once('exit', (code) => reject(new Error(`Message watcher exited with code ${code}`)));
});

const svelteWatcher = start(['x', 'svelte-check', '--tsconfig', './tsconfig.json', '--watch']);
const exitCode = await Promise.race([waitForExit(messageWatcher), waitForExit(svelteWatcher)]);
stop();
process.exitCode = interrupted ? 0 : exitCode;
