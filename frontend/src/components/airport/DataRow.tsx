import React from "react";

import styles from "./DataRow.module.css";

export function DataRow({ label, value, warn = false }: { label: string; value: React.ReactNode; warn?: boolean }) {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <span className={`${styles.value} ${warn ? styles.warn : ""}`}>{value}</span>
    </div>
  );
}
