import { CircleAlert, CircleCheck, Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/client/lib/utils";

type FormMessageProps = {
  tone: "error" | "info" | "success";
  title?: string;
  children?: ReactNode;
  className?: string;
};

const ICONS = { error: CircleAlert, info: Info, success: CircleCheck };

/** A message about the whole form. Errors are announced at once; the others politely. */
export function FormMessage({ tone, title, children, className }: FormMessageProps) {
  const Icon = ICONS[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex gap-3 rounded-lg border p-3 text-sm",
        tone === "error" && "border-destructive/40 bg-destructive/5",
        tone === "info" && "border-border bg-muted",
        tone === "success" && "border-border bg-highlight/25",
        className,
      )}
    >
      <Icon
        className={cn("mt-0.5 size-4 shrink-0", tone === "error" ? "text-destructive" : "text-foreground")}
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-col gap-1">
        {title ? <p className={cn("font-medium", tone === "error" && "text-destructive")}>{title}</p> : null}
        {children ? <div className="text-foreground">{children}</div> : null}
      </div>
    </div>
  );
}
