import { createFileRoute } from '@tanstack/react-router'
import { Button } from '../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card'
import { ThemeToggle } from '../components/theme-toggle'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-display">ExamPrep AI</h1>
        <div className="no-print">
          <ThemeToggle />
        </div>
      </div>
      <p className="text-body text-muted-foreground">
        Scaffold running. Screens land feature by feature — see{' '}
        <code>docs/ExamPrep_AI_Module_Development_Plan.xlsx</code>.
      </p>

      <Card className="mt-8 max-w-md">
        <CardHeader>
          <CardTitle className="text-h3">Design system (F005)</CardTitle>
          <CardDescription>
            shadcn/ui tokens, light/dark, type scale and a print stylesheet —
            defined once here for every screen to reuse.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="destructive">Destructive</Button>
        </CardContent>
      </Card>
    </div>
  )
}
