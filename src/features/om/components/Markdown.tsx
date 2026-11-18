import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { cn } from '@/lib/utils'

/** Descriptions in OpenMetadata are Markdown. This renders them with the theme's type scale. */
export function Markdown({
  children,
  className,
  placeholder = 'No description yet.',
}: {
  children?: string
  className?: string
  placeholder?: string
}) {
  if (!children?.trim()) return <p className={cn('text-sm text-muted-foreground italic', className)}>{placeholder}</p>
  return (
    <div
      className={cn(
        'max-w-none text-sm leading-relaxed [&_a]:text-primary [&_a]:underline-offset-2 hover:[&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:font-medium [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p+p]:mt-2 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_table]:my-2 [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_ul]:list-disc [&_ul]:pl-5',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  )
}
