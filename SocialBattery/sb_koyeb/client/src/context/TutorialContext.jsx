import { createContext, useContext, useState } from 'react';
import { useAuth } from './AuthContext';

const TUTORIAL_KEY = 'sb_tutorial_done_v1';

const TutorialContext = createContext(null);

export function TutorialProvider({ children }) {
  const { profile } = useAuth();
  const [active, setActive] = useState(false);
  const [step, setStep]     = useState(0);

  // Llamar desde OnboardingPage justo tras crear el perfil
  function startTutorial() {
    setStep(0);
    setActive(true);
  }

  function advance() {
    setStep(s => s + 1);
  }

  function dismiss() {
    if (profile?.id) {
      localStorage.setItem(`${TUTORIAL_KEY}_${profile.id}`, '1');
    }
    setActive(false);
    setStep(0);
  }

  return (
    <TutorialContext.Provider value={{ active, step, advance, dismiss, startTutorial }}>
      {children}
    </TutorialContext.Provider>
  );
}

export function useTutorial() {
  const ctx = useContext(TutorialContext);
  if (!ctx) throw new Error('useTutorial must be used inside TutorialProvider');
  return ctx;
}
