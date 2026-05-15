import styles from './ScoreCircle.module.css';

interface ScoreCircleProps {
  score: number;
  max?: number;
  size?: number;
}

export function ScoreCircle({ score, max = 10, size = 36 }: ScoreCircleProps) {
  const ratio = score / max;
  const tone =
    ratio >= 0.75 ? styles.danger :
    ratio >= 0.5  ? styles.warning :
    ratio >= 0.25 ? styles.brand :
                    styles.success;

  return (
    <div
      className={`${styles.circle} ${tone} mono tnum`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
      }}
    >
      {score}
    </div>
  );
}
