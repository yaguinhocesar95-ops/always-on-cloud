import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/** 0 a 5 estrelinhas: preenchidas em ouro, vazias com borda discreta. */
export function StarRating({
  value,
  size = "sm",
  className,
}: {
  value: number;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const n = Math.max(0, Math.min(5, Math.round(Number.isFinite(value) ? value : 0)));
  const cls = { xs: "size-3", sm: "size-3.5", md: "size-4", lg: "size-5" }[size];
  return (
    <span
      role="img"
      aria-label={`${n} de 5 estrelinhas`}
      className={cn("inline-flex items-center gap-0.5", className)}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden
          data-filled={i <= n}
          strokeWidth={1.75}
          className={cn(cls, i <= n ? "fill-gold text-gold" : "text-muted-foreground/50")}
        />
      ))}
    </span>
  );
}
