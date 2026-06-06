import { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';

const TUTORIAL_KEY = 'sb_tutorial_done_v1';

const TutorialContext = createContext(null);

export function TutorialProvider({ children }) {
  const { profile } = useAuth();
  const [active, setActive]   = useState(false);
  const [step, setStep]       = useState(0);

  // Arrancar el tutorial si el usuario nunca lo ha visto
  useEffect(() => {
    if (!profile?.id) return;
    const key = `${TUTORIAL_KEY}_${profile.id}`;
    if (!localStorage.getItem(key)) {
      const t = setTimeout(() => setActive(true), 600);
      return () => clearTimeout(t);
    }
  }, [profile?.id]);

  function advance() {
    setStep(s => s + 1);   // el componente receptor decide qué hace con el nuevo step
  }

  function dismiss() {
    if (!profile?.id) return;
    localStorage.setItem(`${TUTORIAL_KEY}_${profile.id}`, '1');
    setActive(false);
    setStep(0);
  }

  return (
    <TutorialContext.Provider value={{ active, step, advance, dismiss }}>
      {children}
    </TutorialContext.Provider>
  );
}

export function useTutorial() {
  const ctx = useContext(TutorialContext);
  if (!ctx) throw new Error('useTutorial must be used inside TutorialProvider');
  return ctx;
}
