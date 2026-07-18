// Tests unitarios de client/src/lib/authFlow.js — las decisiones puras
// del flujo de registro / login que antes vivían inline en AuthContext.
//
// Correr con:
//   node --test client/src/lib/authFlow.test.js
//
// Cubre:
//   1. interpretSignUpResult — clasificar la respuesta de signUp en
//      created / obfuscated / unknown, incluidos casos frontera.
//   2. isAlreadyConfirmedError — detectar los distintos mensajes de
//      Supabase para "email ya confirmado" sin dar falsos positivos con
//      otros errores.
//   3. isEmailUnconfirmed — puerta client-side para bloquear login de
//      cuentas sin verificar, robusta a cambios de nombre de campo.
//
// Simula además a alto nivel las dos ramas del flujo real de signUp
// (created directo vs obfuscated → resend → confirmado / no confirmado)
// componiendo los helpers, para asegurar que la orquestación funciona
// como espera el AuthContext.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  interpretSignUpResult,
  isAlreadyConfirmedError,
  isEmailUnconfirmed,
} from './authFlow.js';

// ─── interpretSignUpResult ────────────────────────────────────────────

test('interpretSignUpResult: usuario nuevo con identities pobladas → created', () => {
  const data = {
    user: {
      id: 'uuid-1',
      email: 'nuevo@example.com',
      identities: [{ provider: 'email', id: 'id-1' }],
    },
  };
  assert.deepEqual(interpretSignUpResult(data), { kind: 'created' });
});

test('interpretSignUpResult: identities=[] → obfuscated (email ya existe)', () => {
  // Este es el caso que Supabase devuelve cuando intentas registrar un
  // email ya usado. NO viene error, viene un user con identities vacío.
  const data = {
    user: {
      id: 'uuid-fake',
      email: 'existe@example.com',
      identities: [],
    },
  };
  assert.deepEqual(interpretSignUpResult(data), { kind: 'obfuscated' });
});

test('interpretSignUpResult: sin user → unknown', () => {
  assert.deepEqual(interpretSignUpResult({}), { kind: 'unknown' });
  assert.deepEqual(interpretSignUpResult(null), { kind: 'unknown' });
  assert.deepEqual(interpretSignUpResult(undefined), { kind: 'unknown' });
});

test('interpretSignUpResult: identities ausente (no [] pero undefined) → created', () => {
  // Algunas versiones antiguas de gotrue no incluían identities en la
  // respuesta. Preferimos no marcar esto como obfuscated (sería un
  // falso positivo) — sólo consideramos obfuscated el caso explícito
  // de array vacío.
  const data = { user: { id: 'uuid-2', email: 'x@x.com' } };
  assert.deepEqual(interpretSignUpResult(data), { kind: 'created' });
});

test('interpretSignUpResult: identities no-array (defensivo) → created', () => {
  // Nunca debería pasar, pero si Supabase devuelve algo raro (null,
  // objeto), no lo tratamos como obfuscated para no lanzar "ya en uso"
  // por accidente sobre un registro válido.
  const data = { user: { id: 'uuid-3', identities: null } };
  assert.deepEqual(interpretSignUpResult(data), { kind: 'created' });
});

// ─── isAlreadyConfirmedError ──────────────────────────────────────────

test('isAlreadyConfirmedError: variantes conocidas de Supabase', () => {
  // Todas las cadenas reales que Supabase / gotrue devuelve para este
  // caso en distintas versiones y contextos.
  const variantes = [
    'User already confirmed',
    'Email has already been confirmed',
    'This email has been confirmed',
    'user has already been confirmed',
    'Already confirmed',
  ];
  for (const message of variantes) {
    assert.equal(
      isAlreadyConfirmedError({ message }),
      true,
      `debería detectar: "${message}"`,
    );
  }
});

test('isAlreadyConfirmedError: no falsea con otros errores', () => {
  // Errores comunes que NO deben interpretarse como "ya confirmado":
  // rate limits, credenciales, red. Si tratáramos éstos como
  // confirmados, echaríamos al usuario del flujo con "cuenta ya en uso"
  // aunque la cuenta sea válida y sin confirmar.
  const otros = [
    'Email rate limit exceeded',
    'For security purposes, you can only request this after 60 seconds',
    'Invalid email',
    'Network error',
    '',
  ];
  for (const message of otros) {
    assert.equal(
      isAlreadyConfirmedError({ message }),
      false,
      `no debería falsear con: "${message}"`,
    );
  }
});

test('isAlreadyConfirmedError: null/undefined → false', () => {
  assert.equal(isAlreadyConfirmedError(null), false);
  assert.equal(isAlreadyConfirmedError(undefined), false);
  assert.equal(isAlreadyConfirmedError({}), false);
});

// ─── isEmailUnconfirmed ───────────────────────────────────────────────

test('isEmailUnconfirmed: ambos campos vacíos → true (bloquear login)', () => {
  assert.equal(isEmailUnconfirmed({ id: 'x' }), true);
  assert.equal(isEmailUnconfirmed({ id: 'x', email_confirmed_at: null }), true);
  assert.equal(
    isEmailUnconfirmed({ id: 'x', email_confirmed_at: null, confirmed_at: null }),
    true,
  );
});

test('isEmailUnconfirmed: email_confirmed_at seteado → false (dejar pasar)', () => {
  assert.equal(
    isEmailUnconfirmed({ id: 'x', email_confirmed_at: '2026-07-01T00:00:00Z' }),
    false,
  );
});

test('isEmailUnconfirmed: solo confirmed_at (gotrue viejo) → false', () => {
  // Compatibilidad con versiones antiguas del cliente/servidor Supabase
  // donde el timestamp de confirmación se llamaba confirmed_at.
  assert.equal(
    isEmailUnconfirmed({ id: 'x', confirmed_at: '2026-07-01T00:00:00Z' }),
    false,
  );
});

test('isEmailUnconfirmed: user null/undefined → false (no bloquear si no hay user)', () => {
  // Si no hay user es que algo raro pasó antes; no es competencia de
  // esta puerta bloquearlo — lo hará el resto del flujo.
  assert.equal(isEmailUnconfirmed(null), false);
  assert.equal(isEmailUnconfirmed(undefined), false);
});

// ─── Integración: simula el signUp completo del AuthContext ───────────
//
// El AuthContext hace:
//   1. supabase.auth.signUp(...)
//   2. si interpretSignUpResult === 'obfuscated' → resend
//   3. si el resend falla con isAlreadyConfirmedError → throw "ya en uso"
//   4. si el resend falla con otro error → seguir al "revisa email"
//   5. si NO había obfuscated → seguir al "revisa email" directo
//
// Estos tests reconstruyen el orquestador con supabase fake para
// verificar que las 4 ramas se comportan como espera AuthPage
// (registered=true sin error vs error "ya en uso").

/**
 * Orquestador equivalente a AuthContext.signUp, para poder testear la
 * secuencia entera sin importar React ni el módulo real de supabase.
 * Devuelve { registered: true } si la UI debe mostrar "revisa tu email",
 * o lanza el error correspondiente.
 */
async function runSignUpFlow({ signUpImpl, resendImpl }) {
  const { data, error } = await signUpImpl();
  if (error) throw error;
  const result = interpretSignUpResult(data);
  if (result.kind === 'obfuscated') {
    const { error: resendError } = await resendImpl();
    if (resendError) {
      if (isAlreadyConfirmedError(resendError)) {
        throw new Error('Esta cuenta ya pertenece a un usuario');
      }
      // otros errores: caemos al "revisa tu email" igualmente
    }
  }
  return { registered: true };
}

test('flujo signUp: email nuevo → registered=true, no se llama a resend', async () => {
  let resendCalls = 0;
  const out = await runSignUpFlow({
    signUpImpl: async () => ({
      data: { user: { id: 'u1', identities: [{ provider: 'email' }] } },
      error: null,
    }),
    resendImpl: async () => {
      resendCalls++;
      return { error: null };
    },
  });
  assert.deepEqual(out, { registered: true });
  assert.equal(resendCalls, 0, 'no debería llamar a resend en cuentas nuevas');
});

test('flujo signUp: email existe sin confirmar → resend OK → registered=true', async () => {
  let resendCalls = 0;
  const out = await runSignUpFlow({
    signUpImpl: async () => ({
      data: { user: { id: 'fake', identities: [] } },
      error: null,
    }),
    resendImpl: async () => {
      resendCalls++;
      return { error: null };
    },
  });
  assert.deepEqual(out, { registered: true });
  assert.equal(resendCalls, 1, 'debería llamar a resend exactamente una vez');
});

test('flujo signUp: email existe Y confirmado → throw "ya pertenece a un usuario"', async () => {
  await assert.rejects(
    runSignUpFlow({
      signUpImpl: async () => ({
        data: { user: { id: 'fake', identities: [] } },
        error: null,
      }),
      resendImpl: async () => ({
        error: { message: 'User already confirmed' },
      }),
    }),
    (err) => err.message === 'Esta cuenta ya pertenece a un usuario',
  );
});

test('flujo signUp: existe sin confirmar pero resend con rate limit → registered=true', async () => {
  // Escenario real: usuario se registró hace 10s, sale de la app,
  // vuelve a intentar registrarse. Supabase devuelve obfuscated, y el
  // resend cae en rate limit ("only request this after 60 seconds").
  // Queremos que igualmente le llevemos a "revisa tu email" — el correo
  // ya está en su bandeja, y desde esa pantalla podrá reintentar con el
  // botón de reenvío con cooldown.
  const out = await runSignUpFlow({
    signUpImpl: async () => ({
      data: { user: { id: 'fake', identities: [] } },
      error: null,
    }),
    resendImpl: async () => ({
      error: {
        message: 'For security purposes, you can only request this after 60 seconds',
      },
    }),
  });
  assert.deepEqual(out, { registered: true });
});

test('flujo signUp: error real del signUp (contraseña débil) → propaga tal cual', async () => {
  await assert.rejects(
    runSignUpFlow({
      signUpImpl: async () => ({
        data: null,
        error: { message: 'Password should be at least 6 characters' },
      }),
      resendImpl: async () => ({ error: null }),
    }),
    (err) => /at least 6 characters/i.test(err.message),
  );
});

// ─── Integración: puerta de login ─────────────────────────────────────

/**
 * Equivalente a AuthContext.signIn: comprueba la puerta de email
 * confirmado y llama a signOut si procede.
 */
async function runSignInFlow({ signInImpl, signOutImpl }) {
  const { data, error } = await signInImpl();
  if (error) throw error;
  if (isEmailUnconfirmed(data?.user)) {
    await signOutImpl();
    throw new Error('Debes confirmar tu correo antes de iniciar sesión. Revisa tu bandeja de entrada (y la carpeta de spam).');
  }
  return data;
}

test('flujo signIn: usuario confirmado → devuelve data, no hace signOut', async () => {
  let signOutCalls = 0;
  const data = await runSignInFlow({
    signInImpl: async () => ({
      data: { user: { id: 'u1', email_confirmed_at: '2026-07-01T00:00:00Z' } },
      error: null,
    }),
    signOutImpl: async () => { signOutCalls++; },
  });
  assert.ok(data.user);
  assert.equal(signOutCalls, 0);
});

test('flujo signIn: usuario SIN confirmar → signOut y throw', async () => {
  let signOutCalls = 0;
  await assert.rejects(
    runSignInFlow({
      signInImpl: async () => ({
        data: { user: { id: 'u1', email_confirmed_at: null } },
        error: null,
      }),
      signOutImpl: async () => { signOutCalls++; },
    }),
    (err) => /Debes confirmar tu correo/.test(err.message),
  );
  assert.equal(signOutCalls, 1, 'signOut debe llamarse exactamente una vez');
});

test('flujo signIn: signInWithPassword devuelve error → propaga sin tocar signOut', async () => {
  let signOutCalls = 0;
  await assert.rejects(
    runSignInFlow({
      signInImpl: async () => ({
        data: null,
        error: { message: 'Invalid login credentials' },
      }),
      signOutImpl: async () => { signOutCalls++; },
    }),
    (err) => /Invalid login credentials/.test(err.message),
  );
  assert.equal(signOutCalls, 0, 'no debe llamar signOut si el login falló antes');
});
