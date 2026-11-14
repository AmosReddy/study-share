"use client";

import { SendHorizontal } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/client/components/ui/button";
import { hasVisibleCharacter } from "@/shared/message-schemas";
import { CHAT_LIMITS } from "@/shared/messages";

/** The most lines the box grows to before it scrolls inside. */
const MAX_LINES = 5;
/** Show the character count once a message is this long. */
const COUNT_FROM = 1800;

/** Whether the main way of pointing is a finger (a phone or tablet): there, Enter is a new line. */
const usesTouch = () => window.matchMedia("(pointer: coarse)").matches;

/**
 * The box at the bottom of the chat: a labelled text area that grows up to five lines (2000
 * characters at most) and a Send button at least 44px high. On a computer Enter sends and
 * Shift+Enter adds a line; on a touch screen Enter always adds a line and the Send button sends.
 * The button does not take the focus from the box on a press, so the on-screen keyboard stays up.
 */
export function ChatComposer({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  // Spaces, zero-width characters and "blank" letters alone are not a message.
  const empty = !hasVisibleCharacter(text);

  // Grow with the text (and shrink back when it is cleared), up to MAX_LINES.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const style = getComputedStyle(box);
    const lineHeight = parseFloat(style.lineHeight) || 24;
    const chrome =
      parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight + (box.offsetHeight - box.clientHeight), lineHeight * MAX_LINES + chrome)}px`;
  }, [text]);

  function submit() {
    if (empty) return;
    onSend(text);
    setText("");
    boxRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    if (usesTouch()) return;
    event.preventDefault();
    submit();
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col border-t bg-background"
    >
      {text.length >= COUNT_FROM ? (
        <p className="px-3 pt-1 text-right text-xs text-muted-foreground">
          {text.length}/{CHAT_LIMITS.maxBody}
        </p>
      ) : null}
      <div className="flex items-end gap-2 p-2">
        <label htmlFor={id} className="sr-only">
          Write a message
        </label>
        <textarea
          id={id}
          ref={boxRef}
          rows={1}
          value={text}
          maxLength={CHAT_LIMITS.maxBody}
          placeholder="Write a message"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          className="min-h-11 min-w-0 flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2.5 text-base leading-6 outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <Button
          type="submit"
          disabled={empty}
          // A press must not move the focus out of the box (that would close the phone's keyboard).
          onMouseDown={(event) => event.preventDefault()}
          className="h-11 shrink-0 gap-2 px-4 text-base"
        >
          <SendHorizontal className="size-4" aria-hidden="true" />
          Send
        </Button>
      </div>
    </form>
  );
}
