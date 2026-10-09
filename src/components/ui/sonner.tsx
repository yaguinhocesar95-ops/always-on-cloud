import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-surface-2 group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          success: "group-[.toaster]:border-success/40 [&_[data-icon]]:text-success",
          error: "group-[.toaster]:border-destructive/40 [&_[data-icon]]:text-destructive",
          warning: "group-[.toaster]:border-warning/40 [&_[data-icon]]:text-warning",
          info: "group-[.toaster]:border-info/40 [&_[data-icon]]:text-info",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
