"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/client/components/ui/button";

type CopyButtonProps = {
  value: string;
  /** The button's name, for example "Copy link". */
  label: string;
};

/** How long "Copied" stays, in ms. */
const SHOWN_FOR = 2500;

/**
 * Copies `value` to the clipboard. The result is said in a live region next to the button
 * ("Copied", or how to copy by hand), so the button keeps one name a screen reader can find.
 */
export function CopyButton({ value, label }: CopyButtonProps) {
  const [outcome, setOutcome] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (outcome !== "copied") return;
    const timer = setTimeout(() => setOutcome("idle"), SHOWN_FOR);
    return () => clearTimeout(timer);
  }, [outcome]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setOutcome("copied");
    } catch {
      setOutcome("failed");
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button type="button" variant="outline" className="h-11 gap-2 px-4 text-base" onClick={copy}>
        {outcome === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {label}
      </Button>
      <span role="status" className="text-sm text-muted-foreground">
        {outcome === "copied" ? "Copied" : outcome === "failed" ? "Could not copy. Select the text and copy it." : ""}
      </span>
    </span>
  );
}
