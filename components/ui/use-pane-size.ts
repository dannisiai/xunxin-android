"use client";

import { useLayoutEffect, useRef, useState } from "react";

/** Measure the host, not the device. Neither rotation nor resizing remounts content. */
export function usePaneSize<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      setSize(previous => previous.width === next.width && previous.height === next.height ? previous : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element); measure();
    return () => observer.disconnect();
  }, []);
  return { ref, ...size };
}
