import React from "react";
import { DateFilter } from "../../lib/format";
import { visibleTabs, type TabKey } from "../../lib/tabs";
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
  tab: TabKey;
  onTab: (tab: TabKey) => void;
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
          {visibleTabs().map(t => (
            <button
              key={t.key}
              onClick={() => onTab(t.key)}
              className={tab === t.key ? styles.tabActive : styles.tab}
            >
              {isMobile ? t.mobileLabel : t.label}
            </button>
          ))}
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
