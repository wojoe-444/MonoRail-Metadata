import { PageHeader } from '@/components/layout/PageHeader'
import { AppearanceCard } from '@/components/theme/ThemePicker'
import { ConnectionCard } from '@/features/admin/ConnectionCard'

/** Settings: a stack of cards, one per topic. Add the app's own settings cards above Appearance. */
export function SettingsPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Settings" description="What the server is connected to, and preferences for this browser." />
      <ConnectionCard />
      <AppearanceCard />
    </div>
  )
}
