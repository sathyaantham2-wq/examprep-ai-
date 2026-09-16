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
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
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
