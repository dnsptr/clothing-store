"use client";

import { PointerEvent, useRef } from "react";
import styles from "./EditorialCursor.module.css";

export function useEditorialCursor() {
  const cursorRef = useRef<HTMLDivElement>(null);

  const moveCursor = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse" || !cursorRef.current) return;

    cursorRef.current.style.transform = `translate3d(${event.clientX + 16}px, ${event.clientY + 10}px, 0)`;
    cursorRef.current.dataset.visible = "true";
  };

  const hideCursor = () => {
    if (cursorRef.current) cursorRef.current.dataset.visible = "false";
  };

  return {
    cursorRef,
    cursorHandlers: {
      onPointerEnter: moveCursor,
      onPointerMove: moveCursor,
      onPointerLeave: hideCursor,
      onPointerCancel: hideCursor,
    },
  };
}

export default function EditorialCursor({
  cursorRef,
  isDragging,
}: {
  cursorRef: React.RefObject<HTMLDivElement | null>;
  isDragging: boolean;
}) {
  return (
    <div
      ref={cursorRef}
      className={`${styles.cursor} ${isDragging ? styles.cursorDragging : ""}`}
      data-visible="false"
      aria-hidden="true"
    >
      <span>{isDragging ? "Листать" : "Смотреть"}</span>
      <svg className={styles.arrow} fill="none" stroke="currentColor" viewBox="0 0 28 12">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.2" d="M1 6h25m-5-5 5 5-5 5" />
      </svg>
    </div>
  );
}
