import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { navigate } from '@/lib/router'

/** The top bar's search box. Enter opens Explore; "/" focuses it from anywhere. */
export function GlobalSearch() {
  const [q, setQ] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault()
        input.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <form
      role="search"
      className="relative hidden w-64 md:block"
      onSubmit={(e) => {
        e.preventDefault()
        navigate(`/explore${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`)
        setQ('')
        input.current?.blur()
      }}
    >
      <Label htmlFor="global-search" className="sr-only">
        Search the catalog
      </Label>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        ref={input}
        id="global-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search"
        className="h-8 pr-8 pl-8"
      />
      <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
        /
      </kbd>
    </form>
  )
}
