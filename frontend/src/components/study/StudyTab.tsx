import React from "react";
import { useCallsigns, useStudySheet } from "../../lib/queries";
import { CallsignPicker } from "./CallsignPicker";
import styles from "./StudyTab.module.css";

export function StudyTab() {
  const [selected, setSelected] = React.useState<string | null>(null);
  const { data: callsigns = [], isLoading, error } = useCallsigns();
  const sheet = useStudySheet(selected);

  if (error) {
    return <p className={styles.empty}>Unable to load callsigns: {(error as Error).message}</p>;
  }

  return (
    <div className={styles.tab}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Study</h2>
          <p className={styles.subtitle}>
            {isLoading ? "Loading callsigns..." : `${callsigns.length} callsigns`}
          </p>
        </div>
      </div>

      {callsigns.length === 0 && !isLoading ? (
        <p className={styles.empty}>No callsigns available for study.</p>
      ) : (
        <div className={styles.layout}>
          <CallsignPicker callsigns={callsigns} selected={selected} onSelect={setSelected} />
          <section className={styles.sheet}>
            {!selected ? (
              <p className={styles.empty}>Select a callsign.</p>
            ) : sheet.isLoading ? (
              <p className={styles.empty}>Loading study sheet...</p>
            ) : sheet.error ? (
              <p className={styles.empty}>Unable to load study sheet: {(sheet.error as Error).message}</p>
            ) : sheet.data ? (
              <>
                <div className={styles.sheetHead}>
                  <span className={styles.sheetCallsign}>{sheet.data.callsign}</span>
                  <span className={styles.sheetCount}>
                    {sheet.data.transmission_count} transmissions
                  </span>
                </div>
                <div className={styles.sheetBody}>{sheet.data.study_sheet}</div>
              </>
            ) : (
              <p className={styles.empty}>Select a callsign.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
