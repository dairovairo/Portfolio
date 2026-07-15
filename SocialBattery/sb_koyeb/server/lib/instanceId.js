/**
 * instanceId.js — Fase 72: huella de proceso para detectar despliegues duplicados.
 *
 * La fase 70 arregló una carrera causada por dos procesos corriendo a la vez
 * en Railway (bucle de reinicios). El fix de BD (INSERT ... ON CONFLICT DO
 * NOTHING) hace que eso ya no pueda causar dobles envíos AUNQUE vuelva a
 * pasar — pero si sigue pasando (p.ej. un deploy viejo que no se apagó,
 * o dos servicios de Railway apuntando al mismo repo), vale la pena poder
 * verlo directamente en los logs en vez de deducirlo.
 *
 * Un id aleatorio de 6 caracteres, generado una vez al arrancar el proceso,
 * que se antepone a los logs de los ticks de pacing. Si en Railway ves DOS
 * ids distintos logueando ticks casi al mismo tiempo, hay dos procesos
 * activos — ve a Railway → tu proyecto → Settings y comprueba que solo hay
 * un servicio/deploy sirviendo tráfico (no un rollback antiguo ni un
 * segundo entorno apuntando a la misma base de datos).
 */
const INSTANCE_ID = Math.random().toString(36).slice(2, 8);

module.exports = { INSTANCE_ID };
