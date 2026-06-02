import styles from "./StudyTab.module.css";

interface CallsignRow {
  callsign: string;
  count: number;
}

interface Props {
  callsigns: CallsignRow[];
  selected: string | null;
  onSelect: (callsign: string) => void;
}

export function CallsignPicker({ callsigns, selected, onSelect }: Props) {
  return (
    <div className={styles.picker} aria-label="Callsigns">
      {callsigns.map(row => (
        <button
          key={row.callsign}
          type="button"
          className={`${styles.callsignBtn} ${selected === row.callsign ? styles.callsignBtnActive : ""}`}
          onClick={() => onSelect(row.callsign)}
        >
          <span className={styles.callsign}>{row.callsign}</span>
          <span className={styles.callsignCount}>{row.count}</span>
        </button>
      ))}
    </div>
  );
}
