import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Inbox, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

/** Estado vazio (ou de erro, com "Tentar de novo"). */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  onRetry,
  tone = "default",
  className,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  onRetry?: () => void;
  tone?: "default" | "error";
  className?: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center",
        tone === "error" ? "border-destructive/40 bg-destructive/5" : "border-border bg-surface-2/40",
        className,
      )}
    >
      <span
        className={cn(
          "grid size-11 place-items-center rounded-full",
          tone === "error" ? "bg-destructive/15 text-destructive" : "bg-gold-soft text-gold",
        )}
      >
        <Icon className="size-5" strokeWidth={1.75} aria-hidden />
      </span>
      <p className="text-body font-semibold text-foreground">{title}</p>
      {description && <p className="max-w-sm text-body text-muted-foreground">{description}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-body text-foreground hover:bg-surface-2"
        >
          <RotateCcw className="size-4" strokeWidth={1.75} aria-hidden /> Tentar de novo
        </button>
      )}
    </div>
  );
}

export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Carregando">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="ypx-skeleton h-12" />
      ))}
    </div>
  );
}
