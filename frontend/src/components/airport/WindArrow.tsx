import styles from "./WindArrow.module.css";

export function WindArrow({ deg, size = 28 }: { deg: number; size?: number }) {
  const r = size * 0.38;
  const cx = size / 2;
  const cy = size / 2;
  const rad = ((deg - 90) * Math.PI) / 180;
  const tx = cx + r * Math.cos(rad);
  const ty = cy + r * Math.sin(rad);
  const bx = cx - r * Math.cos(rad);
  const by = cy - r * Math.sin(rad);
  return (
    <svg width={size} height={size} className={styles.arrow}>
      <line className={styles.stroke} x1={bx} y1={by} x2={tx} y2={ty} strokeWidth={1.5} strokeLinecap="round" />
      <polygon className={styles.fill} points={`${tx},${ty} ${tx - 5 * Math.cos(rad - 0.5)},${ty - 5 * Math.sin(rad - 0.5)} ${tx - 5 * Math.cos(rad + 0.5)},${ty - 5 * Math.sin(rad + 0.5)}`} />
    </svg>
  );
}
