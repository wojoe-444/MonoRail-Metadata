import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@/styles/theme.css'
// Applies the saved palette and mode before the first render.
import '@/lib/theme'

import { NAV } from '@/app/routes'
import { AppShell } from '@/components/layout/AppShell'
import { GlobalSearch } from '@/features/explore/GlobalSearch'
import { BackendStatus } from '@/features/team/BackendStatus'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppShell
      sections={NAV}
      topBarActions={
        <>
          <BackendStatus />
          <GlobalSearch />
        </>
      }
    />
  </StrictMode>,
)
