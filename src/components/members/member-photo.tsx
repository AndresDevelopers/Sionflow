'use client';

/**
 * Foto de perfil de miembro.
 * Render simple (img nativo) para URLs de Firebase Storage — sin lógica que
 * oculte la imagen al primer error de carga.
 */

type MemberPhotoProps = {
  photoURL?: string | null;
  name?: string;
  size?: number;
  className?: string;
};

function resolvePhotoURL(photoURL?: string | null): string | undefined {
  if (typeof photoURL !== 'string') return undefined;
  const trimmed = photoURL.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function MemberPhoto({
  photoURL,
  name = '',
  size = 40,
  className = '',
}: MemberPhotoProps) {
  const src = resolvePhotoURL(photoURL);
  const initial = name.trim().charAt(0).toUpperCase() || '?';

  if (!src) {
    return (
      <div
        className={`rounded-full bg-muted flex items-center justify-center shrink-0 text-sm font-medium text-muted-foreground ${className}`}
        style={{ width: size, height: size }}
        aria-hidden
        title={name || undefined}
      >
        {initial}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={src}
      src={src}
      alt={name || 'Foto de perfil'}
      width={size}
      height={size}
      className={`rounded-full object-cover shrink-0 bg-muted ${className}`}
      style={{ width: size, height: size }}
      loading="lazy"
      decoding="async"
    />
  );
}
