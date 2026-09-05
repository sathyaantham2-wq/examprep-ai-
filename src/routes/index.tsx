import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <div className="p-8">
      <h1 className="text-4xl font-bold">ExamPrep AI</h1>
      <p className="mt-4 text-lg">
        Scaffold running. Screens land feature by feature — see{' '}
        <code>docs/ExamPrep_AI_Module_Development_Plan.xlsx</code>.
      </p>
    </div>
  )
}
