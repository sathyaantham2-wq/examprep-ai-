import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
// Side-effect only: pulls in the `server.handlers` type augmentation that @tanstack/start-client-
// core declares on route options. Without an import from @tanstack/react-start somewhere in the
// program, TypeScript never loads that augmentation and `server` is rejected on every route.
import type {} from '@tanstack/react-start'

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
