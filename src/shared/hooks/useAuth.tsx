import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: { display_name: string; role: string } | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

const PROFILE_CACHE_KEY = 'auth_profile_cache_v1';
const PROFILE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function readProfileCache(userId: string): AuthState['profile'] | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { userId: string; profile: AuthState['profile']; ts: number };
    if (cached.userId !== userId) return null;
    if (Date.now() - cached.ts > PROFILE_CACHE_TTL_MS) return null;
    return cached.profile;
  } catch {
    return null;
  }
}

function writeProfileCache(userId: string, profile: AuthState['profile']) {
  try {
    localStorage.setItem(
      PROFILE_CACHE_KEY,
      JSON.stringify({ userId, profile, ts: Date.now() }),
    );
  } catch { /* private mode etc. */ }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AuthState['profile']>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let lastLoadedUserId: string | null = null;

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        loadProfile(session.user.id);
        lastLoadedUserId = session.user.id;
      } else {
        setLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) {
        // Don't refetch on token refresh / window-focus events that fire onAuthStateChange
        // for the same already-known user. Browser-side fan-out (every component mounting)
        // was causing dozens of identical user_profiles requests in flight at once.
        if (session.user.id !== lastLoadedUserId) {
          loadProfile(session.user.id);
          lastLoadedUserId = session.user.id;
        }
      } else {
        lastLoadedUserId = null;
        setProfile(null);
        try { localStorage.removeItem(PROFILE_CACHE_KEY); } catch {}
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function loadProfile(userId: string) {
    // Hydrate from cache first — instant UI, no waterfall on REST.
    const cached = readProfileCache(userId);
    if (cached) {
      setProfile(cached);
      setLoading(false);
    }
    const { data } = await supabase
      .from('user_profiles')
      .select('display_name, role')
      .eq('id', userId)
      .single();
    setProfile(data);
    setLoading(false);
    if (data) writeProfileCache(userId, data);
  }

  async function signIn(email: string, password: string): Promise<string | null> {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        loading,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
