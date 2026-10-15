'use client';

import * as React from 'react';
import { useOfflineImageSrc } from '@/hooks/use-offline-image';
import { cn } from '@/lib/utils';

type OfflineImageProps = Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  'src'
> & {
  src?: string | null;
  /** When true, fills parent (position absolute inset-0 object-cover) */
  fill?: boolean;
  /** Kept for next/image API compatibility */
  unoptimized?: boolean;
  priority?: boolean;
};

/**
 * Drop-in image that prefers local Cache Storage (blob:) online and offline
 * to avoid re-downloading Firebase Storage bytes on the PWA.
 * Prefer this over next/image for Storage / remote member photos.
 */
export function OfflineImage({
  src,
  alt = '',
  className,
  fill,
  width,
  height,
  style,
  unoptimized: _unoptimized,
  priority: _priority,
  onError,
  ...rest
}: OfflineImageProps) {
  const resolved = useOfflineImageSrc(src ?? undefined);
  const [failed, setFailed] = React.useState(false);
  const [prevResolved, setPrevResolved] = React.useState(resolved);
  if (prevResolved !== resolved) {
    setPrevResolved(resolved);
    setFailed(false);
  }

  if (!resolved || failed) {
    if (fill) {
      return (
        <div
          className={cn('absolute inset-0 bg-muted', className)}
          aria-hidden
        />
      );
    }
    return (
      <div
        className={cn('bg-muted', className)}
        style={{ width, height, ...style }}
        aria-hidden
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={resolved}
      alt={alt}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      className={cn(fill && 'absolute inset-0 h-full w-full object-cover', className)}
      style={style}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={(e) => {
        setFailed(true);
        onError?.(e);
      }}
      {...rest}
    />
  );
}

export default OfflineImage;
