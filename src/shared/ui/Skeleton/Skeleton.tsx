import clsx from 'clsx';
import styles from './Skeleton.module.css';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  variant?: 'text' | 'card' | 'chart';
}

export function Skeleton({ width, height, variant = 'text' }: SkeletonProps) {
  const style: React.CSSProperties = {};
  if (width !== undefined) style.width = typeof width === 'number' ? `${width}px` : width;
  if (height !== undefined) style.height = typeof height === 'number' ? `${height}px` : height;

  return (
    <div
      className={clsx(styles.skeleton, styles[variant])}
      style={style}
      aria-hidden="true"
    />
  );
}
