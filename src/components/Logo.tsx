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
}: {
  size?: number;
  priority?: boolean;
  className?: string;
  variant?: 'blue' | 'black';
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
      style={{ display: 'block', objectFit: 'contain' }}
    />
  );
}
