// Wordmark "SocialBattery" con la "y" final sustituida por un rayo — mismo
// tratamiento que el logo (ver public/logo-full.png / public/logo-icon.png).
// El tamaño se hereda del font-size del contenedor (unidades `em`), así que
// basta con aplicar las clases de texto habituales (text-3xl, font-bold...)
// al propio componente para que el rayo escale con el texto.
export default function LogoWordmark({ className = '', boltClassName = 'text-accent-glow', ...rest }) {
  return (
    <span className={`inline-flex items-baseline ${className}`} {...rest}>
      SocialBatter
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        className={`inline-block h-[0.8em] w-[0.8em] -ml-[0.03em] translate-y-[0.04em] ${boltClassName}`}
      >
        <path d="M13 2 3 14h6.5l-1.5 8 10-12H11.5L13 2z" />
      </svg>
    </span>
  );
}
