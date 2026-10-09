import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useUiLayout } from "@/hooks/useUiLayout";
import { cn } from "@/lib/utils";

/** Seção recolhível com título, contador e estado lembrado entre visitas. */
export function Section({
  id,
  title,
  count,
  description,
  defaultOpen = true,
  children,
  className,
}: {
  id: string;
  title: ReactNode;
  count?: number | string | null;
  description?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const { ui, setSection } = useUiLayout();
  const open = ui.sections[id] ?? defaultOpen;
  return (
    <section id={id} className={cn("ypx-card", className)}>
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={() => setSection(id, !open)}
          className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left"
        >
          <span className="tv-headline text-body text-foreground">{title}</span>
          {count != null && (
            <span className="ypx-num rounded-full bg-surface-3 px-2 py-0.5 text-caption text-muted-foreground">{count}</span>
          )}
          {description && !open && (
            <span className="hidden truncate text-caption text-muted-foreground md:inline">{description}</span>
          )}
          <ChevronDown
            aria-hidden
            strokeWidth={1.75}
            className={cn("ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-180")}
          />
        </button>
      </h2>
      {open && (
        <div id={`${id}-body`} className="border-t border-border p-4">
          {children}
        </div>
      )}
    </section>
  );
}
