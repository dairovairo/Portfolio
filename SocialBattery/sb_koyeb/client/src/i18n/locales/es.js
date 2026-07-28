// ─────────────────────────────────────────────────────────────────────────────
// Diccionario de traducciones — Español (idioma por defecto y "source of truth"
// del proyecto). El resto de locales (en, fr) tienen que mantener las mismas
// claves; si añades una nueva aquí, añádela también allí — el helper `t()`
// (src/i18n/index.jsx) hace fallback a español si falta la clave en el idioma
// activo, pero es mejor evitarlo.
//
// Estructura: agrupado por superficie de UI (auth, onboarding, settings, common).
// Para strings genéricos (botones, "Cargando…", "Guardar", "Cancelar"…) se usa
// `common.*`. Las plantillas admiten `{param}` — ver `t('foo', { param: 'x' })`.
// ─────────────────────────────────────────────────────────────────────────────

export default {
  common: {
    continue:     'Continuar',
    back:         'Atrás',
    save:         'Guardar',
    saving:       'Guardando…',
    cancel:       'Cancelar',
    close:        'Cerrar',
    loading:      'Cargando…',
    retry:        'Reintentar',
    error:        'Algo salió mal',
    ok:           'OK',
    yes:          'Sí',
    no:           'No',
    delete:       'Eliminar',
    edit:         'Editar',
    next:         'Siguiente',
    previous:     'Anterior',
    done:         'Listo',
    optional:     'Opcional',
    required:     'Obligatorio',
    logout:       'Cerrar sesión',
    loggingOut:   'Cerrando…',
    sessionClosed:'Sesión cerrada',
  },

  languages: {
    label:        'Idioma',
    subtitle:     'Elige el idioma de la app',
    es:           'Español',
    en:           'English',
    fr:           'Français',
  },

  auth: {
    tagline:          'Sé honesto con tu energía social',
    tabLogin:         'Entrar',
    tabRegister:      'Registro',
    signInTitle:      'Inicia sesión',
    signUpTitle:      'Crea tu cuenta',
    signInCta:        'Entrar',
    signUpCta:        'Crear cuenta',
    signingIn:        'Entrando…',
    signingUp:        'Creando cuenta…',
    submitLoading:    '…',
    email:            'Email',
    emailPlaceholder: 'tu@email.com',
    password:         'Contraseña',
    passwordPlaceholder: '••••••••',
    forgotPassword:   '¿Olvidaste tu contraseña?',
    forgotIntro:      'Introduce tu email y te enviaremos un enlace para restablecerla.',
    forgotCta:        'Enviar enlace',
    backToLogin:      '← Volver al login',
    resetSentTitle:   'Revisa tu email',
    resetSentBody:    'Hemos enviado un enlace para restablecer tu contraseña a {email}. Revisa también la carpeta de spam.',
    checkEmailTitle:  'Revisa tu email',
    checkEmailBody:   'Te hemos enviado un enlace de confirmación a {email}. Confírmalo y vuelve aquí para iniciar sesión.',
    checkEmailSpam:   'Si no lo ves en unos minutos, revisa la carpeta de Spam / No deseado antes de reenviarlo.',
    resendConfirm:    'Reenviar correo de confirmación',
    resending:        'Reenviando…',
    resendCooldown:   'Reenviar correo ({s}s)',
    resendDone:       '✓ Reenviado — reenviar de nuevo',
    orSeparator:      'o',
    signInWithGoogle: 'Entrar con Google',
    signUpWithGoogle: 'Registrarse con Google',
    signInWithApple:  'Entrar con Apple',
    signUpWithApple:  'Registrarse con Apple',
    termsConfirm:     'Confirmo que tengo al menos 16 años y acepto los',
    termsLinkText:    'Términos y Condiciones',
    andPrivacyText:   'y la',
    privacyLinkText:  'Política de Privacidad',
    errAcceptTerms:   'Debes aceptar los términos y confirmar que tienes al menos 16 años.',
    errGoogle:        'No se pudo iniciar sesión con Google',
    errApple:         'No se pudo iniciar sesión con Apple',
    errResend:        'No se pudo reenviar el correo',
    footerVersion:    'SocialBattery v1.0 · Hecho con ⚡',
    footerPrivacy:    'Política de privacidad',
  },

  onboarding: {
    stepWelcome:      '¡Hola!',
    stepUsername:     'Tu nombre',
    stepInterests:    'Intereses',
    stepAvatar:       'Tu foto',
    stepDone:         '¡Listo!',

    welcomeTitle:     'Bienvenido a',
    welcomeIntro:     'Comparte tu nivel de energía social del día y queda con personas que tienen la misma actitud que tú en este momento.',
    highlightBattery: 'Actualiza tu batería diaria',
    highlightFriends: 'Conéctate con amigos',
    highlightPools:   'Organiza quedadas',

    usernameTitle:    '¿Cómo te llaman?',
    usernameSubtitle: 'Elige tu nombre de usuario único',
    usernameLabel:    'Nombre de usuario',
    usernamePlaceholder:'tu_nombre',
    usernameHint:     'Letras, números y _ · Permanente',
    bioLabel:         'Bio (opcional)',
    bioPlaceholder:   'Cuéntanos algo sobre ti… 🙂',

    interestsTitle:   '¿Qué te gusta?',
    interestsSubtitle:'Elige tus categorías favoritas — mínimo 3 categorías',
    interestsSelectedOne: '{n} seleccionado',
    interestsSelectedMany:'{n} seleccionados',
    interestsMinRemaining:'* Selecciona al menos 3 categorías para continuar ({n}/3)',
    interestsMinEmpty:   '* Selecciona al menos 3 categorías para continuar',

    avatarTitle:      'Pon una foto',
    avatarSubtitle:   'Opcional — puedes añadirla después',
    avatarChange:     'Cambiar foto',
    avatarUpload:     'Subir foto',
    avatarRemove:     'Quitar',
    avatarHint:       'JPG, PNG · Máx. 2MB',

    doneTitle:        '¡Todo listo, {name}!',
    doneSubtitle:     'Tu perfil está creado. Ahora añade amigos y empieza a sincronizar energías.',
    doneCardFriendsTitle: 'Añade amigos',
    doneCardFriendsDesc:  'Busca por username',
    doneCardBatteryTitle: 'Actualiza tu batería',
    doneCardBatteryDesc:  'Cada día al entrar',
    doneCardPoolTitle:    'Crea un pool',
    doneCardPoolDesc:     'Propón una quedada',
    doneCardBadgesTitle:  'Gana insignias',
    doneCardBadgesDesc:   'Por tus hábitos sociales',

    goHome:           'Ir al inicio 🚀',
    start:            '¡Empezar! 🚀',
    creating:         'Creando…',
    backToSignIn:     '← Volver a inicio de sesión',

    errUsernameShort: 'Mínimo 3 caracteres',
    errUsernameChars: 'Solo letras, números y _',
    errUsernameLong:  'Máximo 16 caracteres',
    errInterestsMin:  'Elige al menos 3 intereses para continuar',
    errAvatarSize:    'Imagen máximo 2MB',
  },

  settings: {
    title:            'Ajustes',

    // Section headers (accordion)
    sectionPersonalizationTitle:    'Personalización',
    sectionPersonalizationSubtitle: 'Tema, fondos y colores de mensajes',
    sectionNotificationsTitle:      'Notificaciones',
    sectionNotificationsSubtitle:   'Silenciar y preferencias de aviso',
    sectionPrivacyTitle:            'Privacidad',
    sectionPrivacySubtitle:         'Qué muestras y quién puede verte',
    sectionAccountTitle:            'Cuenta',
    sectionAccountSubtitle:         'Contraseña, sesión y borrado',
    sectionLanguageTitle:           'Idioma',
    sectionLanguageSubtitle:        'Idioma de la interfaz',

    languageBody:     'La app se mostrará en este idioma en todos tus dispositivos.',

    logoutFailed:     'No se pudo cerrar sesión',
  },
};
