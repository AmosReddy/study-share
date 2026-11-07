"use client";

import { Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { Button } from "@/client/components/ui/button";
import { inputClassName } from "./text-field";

/** The old way to copy, for browsers that refuse the Clipboard API. Must run during the tap. */
function copyWithSelection(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

/**
 * Shown instead of the Google button inside apps like Instagram, where Google refuses
 * to sign in. It offers to copy this page's address so it can be opened in a real browser.
 */
export function InAppBrowserNotice() {
  const [result, setResult] = useState<{ status: "idle" | "copied" | "manual"; url: string }>({
    status: "idle",
    url: "",
  });

  async function copyLink() {
    const url = window.location.href;
    let copied = false;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch {
      copied = copyWithSelection(url);
    }
    setResult({ status: copied ? "copied" : "manual", url });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted p-4 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
        Open in your browser
      </p>
      <p>
        Google sign-in does not work inside this app. Copy the link, then open it in Chrome or Safari. You can
        also use your email here.
      </p>
      <Button type="button" variant="outline" className="h-11 w-full gap-2 text-base" onClick={copyLink}>
        <Copy className="size-4" aria-hidden="true" />
        Copy link
      </Button>
      <p role="status" className="empty:-mt-3">
        {result.status === "copied" ? "Link copied. Paste it into your browser's address bar." : ""}
      </p>
      {result.status === "manual" ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="page-link">Copying did not work. Press and hold the link to copy it:</label>
          <input
            id="page-link"
            readOnly
            value={result.url}
            onFocus={(event) => event.currentTarget.select()}
            className={inputClassName}
          />
        </div>
      ) : null}
    </div>
  );
}
