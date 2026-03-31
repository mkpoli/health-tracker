import 'unplugin-icons/types/svelte'
import type { AuthSession, AuthUser } from '$lib/server/auth0';
// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
    namespace App {
        interface Platform {
            env: Env
            cf: CfProperties
            ctx: ExecutionContext
        }

        interface Platform {
            env: Env;
            ctx: ExecutionContext;
            caches: CacheStorage;
            cf?: IncomingRequestCfProperties
        }

		interface Locals { user?: AuthUser; session?: AuthSession | null }

		interface PageData { user?: AuthUser; session?: AuthSession | null }

        // interface Error {}
        // interface PageData {}
        // interface PageState {}
    }
}

export { };
