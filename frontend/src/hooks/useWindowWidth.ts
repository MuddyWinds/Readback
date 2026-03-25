import { useEffect, useState } from "react";

/** mobile < 640 · tablet 640–1023 · desktop 1024–1439 · large ≥ 1440 */
export type Breakpoint = "mobile" | "tablet" | "desktop" | "large";

export function useWindowWidth(): { width: number; bp: Breakpoint } {
  const [width, setWidth] = useState(window.innerWidth);

  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const bp: Breakpoint =
    width < 640  ? "mobile"  :
    width < 1024 ? "tablet"  :
    width < 1440 ? "desktop" :
                   "large";

  return { width, bp };
}
