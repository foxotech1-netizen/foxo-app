import Image from 'next/image';

// Deux variantes du logo selon le fond :
//   - 'blue' (défaut) : logo bleu, pour fonds sombres (login navy, gradient
//     sidebar) ou fonds clairs (cream, sand)
//   - 'black' : logo noir, élégant sur le sable doré #E2C9A1
//
// Les deux PNG sont transparents 1024×1024 carré.
export function Logo({
  size = 80,
  priority = false,
  className,
  variant = 'blue',
  style,
}: {
  size?: number;
  priority?: boolean;
  className?: string;
  variant?: 'blue' | 'black';
  /** Style inline additionnel (ex: filter pour rendre le logo blanc sur
   *  fond sombre). Mergé avec display/objectFit gérés en interne. */
  style?: React.CSSProperties;
}) {
  const src = variant === 'black'
    ? '/foxo-logo-noir-transparent.png'
    : '/foxo-logo-transparent.png';
  return (
    <Image
      src={src}
      alt="FoxO"
      width={size}
      height={size}
      priority={priority}
      className={className}
      style={{ display: 'block', objectFit: 'contain', ...style }}
    />
  );
}
