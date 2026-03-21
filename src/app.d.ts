import type { User, Session } from 'better-auth/minimal';
import 'unplugin-icons/types/svelte'
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

        interface Locals { user?: User; session?: Session }

        // interface Error {}
        // interface PageData {}
        // interface PageState {}
    }
}

export { };