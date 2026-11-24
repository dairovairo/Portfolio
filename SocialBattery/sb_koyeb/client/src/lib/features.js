// Interruptor de pagos. Apagado (por defecto) la app es gratis: no se enseña
// nada de saldo, precios, suscripciones ni aportaciones, y la promoción tiene
// un tope por cuenta (server/lib/freePromo.js).
//
// Para encenderlo: VITE_PAYMENTS_ENABLED=true al compilar la web (Render) y
// PAYMENTS_ENABLED=true en el servidor (Railway). Ver PAGOS_SETUP.md.
export const PAYMENTS_ENABLED = import.meta.env.VITE_PAYMENTS_ENABLED === 'true';
