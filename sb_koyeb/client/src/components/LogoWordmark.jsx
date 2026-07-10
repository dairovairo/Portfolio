// Wordmark "SocialBattery" con la "y" final sustituida por el rayo del logo
// oficial (recortado directamente de public/logo-full.png, mismo asset que
// ya usa el resto de la app, para que la forma y el color sean idénticos a
// los del logo real y no una reinterpretación en SVG).
// El tamaño se hereda del font-size del contenedor (unidades `em`), así que
// basta con aplicar las clases de texto habituales (text-3xl, font-bold...)
// al propio componente para que el rayo escale junto con el texto.
export default function LogoWordmark({ className = '', ...rest }) {
  return (
    <span className={`inline-flex items-baseline ${className}`} {...rest}>
      SocialBatter
      <img
        src="/logo-bolt.png"
        alt=""
        aria-hidden="true"
        draggable={false}
        className="inline-block h-[0.74em] w-auto -ml-[0.02em] translate-y-[0.22em] select-none pointer-events-none"
      />
      {/* Para lectores de pantalla el nombre se sigue leyendo completo */}
      <span className="sr-only">y</span>
    </span>
  );
}
