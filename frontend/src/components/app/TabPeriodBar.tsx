import React from "react";
import { DateFilter } from "../../lib/format";
import styles from "./TabPeriodBar.module.css";

const DATE_FILTERS: { key: DateFilter; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d",    label: "Last 7 days" },
  { key: "30d",   label: "Last 30 days" },
  { key: "ytd",   label: "YTD" },
  { key: "all",   label: "All time" },
];

const MOBILE_LABELS: Record<DateFilter, string> = {
  today: "Today",
  "7d": "7d",
  "30d": "30d",
  ytd: "YTD",
  all: "All",
};

export interface TabPeriodBarProps {
  tab: "live" | "settings";
  onTab: (tab: "live" | "settings") => void;
  dateFilter: DateFilter;
  onDateFilter: (f: DateFilter) => void;
  isMobile: boolean;
}

export function TabPeriodBar({
  tab,
  onTab,
  dateFilter,
  onDateFilter,
  isMobile,
}: TabPeriodBarProps) {
  return (
    <div className={styles.tabBar}>
      <div className={`${styles.tabBarInner} ${isMobile ? styles.tabBarInnerMobile : styles.tabBarInnerDesktop}`}>
        <div className={`${styles.tabRow} ${isMobile ? styles.tabRowMobile : ""}`}>
          <button
            onClick={() => onTab("live")}
            className={tab === "live" ? styles.tabActive : styles.tab}
          >
            {isMobile ? "Feed" : "Live Feed"}
          </button>
          <button
            onClick={() => onTab("settings")}
            className={tab === "settings" ? styles.tabActive : styles.tab}
          >
            {isMobile ? "Setup" : "Settings"}
          </button>
        </div>
        <div className={`${styles.periodRow} ${isMobile ? styles.periodRowMobile : ""}`}>
          {DATE_FILTERS.filter(({ key }) => !(isMobile && key === "ytd")).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => onDateFilter(key)}
              className={dateFilter === key ? styles.periodActive : styles.period}
            >
              {isMobile ? MOBILE_LABELS[key] : label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
