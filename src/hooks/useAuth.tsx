import { createContext, useContext, useEffect, useRef, useCallback, useState, ReactNode } from 'react';
import { getBackendBaseUrl } from '@/lib/api-client';
import { getSecondsUntilExpiry, isTokenExpired, isTokenExpiringSoon, EXPIRY_WARNING_SECONDS } from '@/lib/token-utils';
import { toast } from 'sonner';

interface User {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  session: { token: string } | null;
  loading: boolean;
  signIn: (username: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (username: string, password: string, fullName: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_TOKEN_KEY = 'cybersentinel_auth_token';
const AUTH_USER_KEY = 'cybersentinel_auth_user';

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<{ token: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for existing session in localStorage
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    const userData = localStorage.getItem(AUTH_USER_KEY);

    if (token && userData) {
      try {
        const parsedUser = JSON.parse(userData);
        setUser(parsedUser);
        setSession({ token });
      } catch (error) {
        console.error('Failed to parse stored user data:', error);
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem(AUTH_USER_KEY);
      }
    }

    setLoading(false);
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // SESSION EXPIRY MONITOR
  // Checks JWT expiry every 30 seconds; warns 5 minutes before expiry,
  // auto-logs out when the token has expired.
  // ═══════════════════════════════════════════════════════════════════════════
  const expiryWarningShown = useRef(false);

  const handleSessionExpired = useCallback(() => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    setUser(null);
    setSession(null);
    toast.error('Session expired', {
      description: 'Your session has expired. Please log in again.',
      duration: 8000,
    });
    // Navigate to auth — use window.location since we are outside Router context
    if (window.location.pathname !== '/auth') {
      window.location.href = '/auth';
    }
  }, []);

  useEffect(() => {
    if (!session?.token) {
      expiryWarningShown.current = false;
      return;
    }

    const checkExpiry = () => {
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      if (!token) return;

      if (isTokenExpired(token)) {
        handleSessionExpired();
        return;
      }

      if (isTokenExpiringSoon(token) && !expiryWarningShown.current) {
        expiryWarningShown.current = true;
        const remaining = getSecondsUntilExpiry(token);
        const minutes = remaining ? Math.ceil(remaining / 60) : EXPIRY_WARNING_SECONDS / 60;
        toast.warning('Session expiring soon', {
          description: `Your session will expire in ~${minutes} minute${minutes !== 1 ? 's' : ''}. Save your work and log in again to continue.`,
          duration: 15000,
        });
      }
    };

    // Check immediately on mount
    checkExpiry();

    // Then check every 30 seconds
    const intervalId = setInterval(checkExpiry, 30_000);

    return () => clearInterval(intervalId);
  }, [session?.token, handleSessionExpired]);

  const signIn = async (username: string, password: string) => {
    try {
      // Use dynamic backend URL (no nginx proxy)
      const response = await fetch(`${getBackendBaseUrl()}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        return { error: new Error(data.error || 'Login failed') };
      }

      // Store token and user data
      localStorage.setItem(AUTH_TOKEN_KEY, data.token);
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));

      setUser(data.user);
      setSession({ token: data.token });
      expiryWarningShown.current = false; // Reset warning for fresh token

      return { error: null };
    } catch (error) {
      console.error('Sign in error:', error);
      return { error: error as Error };
    }
  };

  const signUp = async (username: string, password: string, fullName: string) => {
    try {
      // Use dynamic backend URL (no nginx proxy)
      const response = await fetch(`${getBackendBaseUrl()}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password, fullName }),
      });

      const data = await response.json();

      if (!response.ok) {
        return { error: new Error(data.error || 'Registration failed') };
      }

      // Auto sign in after registration
      return await signIn(username, password);
    } catch (error) {
      console.error('Sign up error:', error);
      return { error: error as Error };
    }
  };

  const signOut = async () => {
    try {
      // Use dynamic backend URL (no nginx proxy)
      await fetch(`${getBackendBaseUrl()}/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.token}`,
        },
      });
    } catch (error) {
      console.error('Sign out error:', error);
    } finally {
      // Clear local storage
      localStorage.removeItem(AUTH_TOKEN_KEY);
      localStorage.removeItem(AUTH_USER_KEY);
      setUser(null);
      setSession(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
