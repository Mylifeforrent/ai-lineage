import { useCallback, useEffect, useState } from 'react';
import type { Session } from './types';
import {
  AUTH_EXPIRED_EVENT,
  clearSession,
  loadSession,
} from './lib/api';
import { LoginPage } from './components/LoginPage';
import { useI18n } from './i18n';
import { Workspace } from './components/Workspace';

export default function App() {
  const { t } = useI18n();
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    function handleAuthExpired() {
      clearSession();
      setSession(null);
      setNotice(t('app.sessionExpired'));
    }

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () =>
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  }, []);

  const handleLoggedIn = useCallback((nextSession: Session) => {
    setSession(nextSession);
    setNotice(null);
  }, []);

  const handleLogout = useCallback(() => {
    clearSession();
    setSession(null);
    setNotice(null);
  }, []);

  if (!session) {
    return <LoginPage notice={notice} onLoggedIn={handleLoggedIn} />;
  }

  return (
    <Workspace
      key={session.access_token}
      session={session}
      onLogout={handleLogout}
    />
  );
}
