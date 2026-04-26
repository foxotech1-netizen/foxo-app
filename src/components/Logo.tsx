import Image from 'next/image';

// Le PNG est transparent, format carré 1024×1024.
// Affichage carré contraint via height. Pas de fond — il s'adapte aux fonds
// sable, navy, cream sans mise en boîte.
export function Logo({
  size = 80,
  priority = false,
  className,
}: {
  size?: number;
  priority?: boolean;
  className?: string;
}) {
  return (
    <Image
      src="/foxo-logo-transparent.png"
      alt="FoxO"
      width={size}
      height={size}
      priority={priority}
      className={className}
      style={{ display: 'block', objectFit: 'contain' }}
    />
  );
}
