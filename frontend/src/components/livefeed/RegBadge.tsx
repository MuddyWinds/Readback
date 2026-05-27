import React from "react";
import { truncateAtChapter } from "../../lib/regs";
import styles from "./RegBadge.module.css";

/** Inline regulation badge for a single observation. Truncates at chapter level; hover shows full citation. */
export function RegBadge({ regulation }: { regulation: string }) {
  if (!regulation) return null;
  const display = truncateAtChapter(regulation);
  return (
    <span
      title={regulation}
      className={styles.badge}
    >
      {display}
    </span>
  );
}
