import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Shield, Loader2, CheckCircle } from 'lucide-react';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';

const passwordSchema = z.string().min(6, 'Password must be at least 6 characters');

const ResetPassword = () => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errors, setErrors] = useState<{ password?: string; confirmPassword?: string }>({});
  const [isValidSession, setIsValidSession] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    // Check if we have a valid session from the reset link
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setIsValidSession(!!session);
      setCheckingSession(false);
      
      if (!session) {
        toast({
          title: 'Invalid or expired link',
          description: 'Please request a new password reset link.',
          variant: 'destructive',
        });
      }
    };

    // Listen for auth state changes (when user clicks the reset link)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
          setIsValidSession(true);
          setCheckingSession(false);
        }
      }
    );

    checkSession();

    return () => subscription.unsubscribe();
  }, [toast]);

  const validateForm = () => {
    const newErrors: { password?: string; confirmPassword?: string } = {};
    
    const passwordResult = passwordSchema.safeParse(password);
    if (!passwordResult.success) {
      newErrors.password = passwordResult.error.errors[0].message;
    }
    
    if (password !== confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;
    
    setIsLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setIsLoading(false);

    if (error) {
      toast({
        title: 'Password reset failed',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      setIsSuccess(true);
      toast({
        title: 'Password updated',
        description: 'Your password has been successfully updated.',
      });
    }
  };

  if (checkingSession) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
            <Shield className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">CyberSentinel</h1>
            <p className="text-sm text-muted-foreground">SOAR Platform</p>
          </div>
        </div>

        <Card className="border-border bg-card">
          <CardHeader className="text-center">
            <CardTitle className="text-foreground">
              {isSuccess ? 'Password Updated' : 'Set New Password'}
            </CardTitle>
            <CardDescription>
              {isSuccess 
                ? 'Your password has been successfully updated'
                : 'Enter your new password below'
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isSuccess ? (
              <div className="space-y-4">
                <div className="flex justify-center">
                  <div className="p-3 rounded-full bg-status-success/10">
                    <CheckCircle className="h-8 w-8 text-status-success" />
                  </div>
                </div>
                <Button className="w-full" onClick={() => navigate('/auth')}>
                  Continue to Sign In
                </Button>
              </div>
            ) : !isValidSession ? (
              <div className="space-y-4">
                <p className="text-center text-muted-foreground">
                  This password reset link is invalid or has expired.
                </p>
                <Button className="w-full" onClick={() => navigate('/auth')}>
                  Back to Sign In
                </Button>
              </div>
            ) : (
              <form onSubmit={handleResetPassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-password">New Password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-input border-border"
                  />
                  {errors.password && (
                    <p className="text-sm text-destructive">{errors.password}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm Password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="bg-input border-border"
                  />
                  {errors.confirmPassword && (
                    <p className="text-sm text-destructive">{errors.confirmPassword}</p>
                  )}
                </div>
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    'Update Password'
                  )}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground mt-6">
          Secure access to your security operations platform
        </p>
      </div>
    </div>
  );
};

export default ResetPassword;
