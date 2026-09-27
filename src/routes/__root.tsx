import { useEffect } from 'react'
import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import appCss from '../styles.css?url'
import { ThemeProvider } from '../components/theme-provider'
import { installClientErrorReporting, reportReactError } from '../lib/client-error-reporting'

// F004: a route-render error still gets reported (see client-error-reporting.ts's own comment
// for why this needs a separate path from window.onerror), and the visitor gets a plain
// "something went wrong" screen with a reload button instead of a blank crashed page.
function RootErrorComponent({ error, reset }: ErrorComponentProps) {
  useEffect(() => {
    reportReactError(error)
  }, [error])

  return (
    <div className="p-8">
      <h1 className="text-h1">Something went wrong</h1>
      <p className="text-body text-muted-foreground mt-2">
        This has been logged. Try reloading the page.
      </p>
      <button
        type="button"
        onClick={reset}
        className="border-input mt-4 rounded-md border px-3 py-1.5 text-sm"
      >
        Try again
      </button>
    </div>
  )
}

export const Route = createRootRoute({
  errorComponent: RootErrorComponent,
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'ExamPrep AI',
      },
      // Installable as a PWA (F009-adjacent, no dedicated F-number -- see chat/commit for the
      // 2026-09-27 request): theme-color and the apple-* tags are what let a browser's install UI
      // and iOS's "Add to Home Screen" pick up the right colour and app name, on top of the
      // manifest link below.
      {
        name: 'theme-color',
        content: '#4338ca',
      },
      {
        name: 'apple-mobile-web-app-capable',
        content: 'yes',
      },
      {
        name: 'apple-mobile-web-app-title',
        content: 'ExamPrep AI',
      },
      {
        name: 'apple-mobile-web-app-status-bar-style',
        content: 'default',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      {
        rel: 'manifest',
        href: '/manifest.webmanifest',
      },
      {
        rel: 'icon',
        href: '/favicon-32.png',
        type: 'image/png',
      },
      {
        rel: 'apple-touch-icon',
        href: '/apple-touch-icon.png',
      },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    installClientErrorReporting()
  }, [])

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider>
          {children}
          <TanStackDevtools
            config={{
              position: 'bottom-right',
            }}
            plugins={[
              {
                name: 'Tanstack Router',
                render: <TanStackRouterDevtoolsPanel />,
              },
            ]}
          />
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}
