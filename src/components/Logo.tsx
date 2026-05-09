import Image from 'next/image';

// Logo FoxO — deux variantes officielles selon le fond :
//   - 'noir'  (défaut) : logo noir transparent, pour fonds clairs
//                        (sand, cream, sable doré #E2C9A1)
//   - 'blanc'           : logo blanc transparent, pour fonds sombres
//                        (sidebar navy, hub, hero techPWA, login dark)
//
// Les deux assets sont des PNG 1024×1024 carrés transparents servis
// depuis /public/. Ne plus utiliser de filter CSS brightness-0/invert
// hack — la version blanche officielle est désormais disponible et
// garantit un rendu propre (anti-aliasing préservé).
export function Logo({
  size = 80,
  priority = false,
  className,
  variant = 'noir',
  style,
}: {
  size?: number;
  priority?: boolean;
  className?: string;
  variant?: 'noir' | 'blanc';
  /** Style inline additionnel (rare — la plupart des cas n'en ont
   *  pas besoin). Mergé avec display/objectFit gérés en interne. */
  style?: React.CSSProperties;
}) {
  const src = variant === 'blanc'
    ? '/foxo-logo-blanc-transparent.png'
    : '/foxo-logo-noir-transparent.png';
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
