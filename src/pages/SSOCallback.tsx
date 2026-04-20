import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { getBackendBaseUrl } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Shield, AlertCircle } from 'lucide-react';

const AUTH_TOKEN_KEY = 'cybersentinel_auth_token';
const AUTH_USER_KEY = 'cybersentinel_auth_user';

const SSOCallback = () => {
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [exchanging, setExchanging] = useState(true);

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setError('No SSO token provided in URL.');
      setExchanging(false);
      return;
    }

    const exchange = async () => {
      try {
        const response = await fetch(`${getBackendBaseUrl()}/auth/sso/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        const data = await response.json();

        if (!response.ok) {
          setError(data.error || `SSO exchange failed (HTTP ${response.status})`);
          setExchanging(false);
          return;
        }

        // Store token and user in localStorage (same as normal login)
        localStorage.setItem(AUTH_TOKEN_KEY, data.token);
        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));

        // Redirect to dashboard - full page reload so AuthProvider picks up session
        window.location.href = '/';
      } catch (err) {
        setError('Failed to connect to SOAR backend. Please try again.');
        setExchanging(false);
      }
    };

    exchange();
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
            <Shield className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">CyberSentinel</h1>
            <p className="text-sm text-muted-foreground">SOAR Platform - SSO</p>
          </div>
        </div>

        <Card className="border-border bg-card">
          <CardHeader className="text-center">
            <CardTitle className="text-foreground">
              {exchanging ? 'Signing you in...' : 'SSO Login Failed'}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            {exchanging ? (
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            ) : (
              <>
                <div className="flex items-center gap-2 text-destructive">
                  <AlertCircle className="h-5 w-5" />
                  <p className="text-sm">{error}</p>
                </div>
                <Button asChild variant="outline" className="mt-2">
                  <Link to="/auth">Go to Login</Link>
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default SSOCallback;
