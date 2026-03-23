import { useState, useMemo } from 'react';
import { toast } from 'sonner';
import {
  Users,
  UserPlus,
  Pencil,
  UserX,
  KeyRound,
  ArrowUpDown,
  Shield,
  CheckCircle2,
  XCircle,
  Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  useUsers,
  useCreateUser,
  useUpdateUser,
  useDeactivateUser,
  useResetPassword,
  type User,
} from '@/hooks/useUsers';

// ============================================================================
// CONSTANTS
// ============================================================================

const ROLES = ['viewer', 'analyst', 'senior_analyst', 'engineer', 'admin'] as const;

const ROLE_LABELS: Record<string, string> = {
  viewer: 'Viewer',
  analyst: 'Analyst',
  senior_analyst: 'Senior Analyst',
  engineer: 'Engineer',
  admin: 'Admin',
};

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-red-500/15 text-red-400 border-red-500/30',
  engineer: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  senior_analyst: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  analyst: 'bg-green-500/15 text-green-400 border-green-500/30',
  viewer: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  active: { label: 'Active', color: 'bg-green-500/15 text-green-400 border-green-500/30', icon: CheckCircle2 },
  inactive: { label: 'Inactive', color: 'bg-gray-500/15 text-gray-400 border-gray-500/30', icon: XCircle },
  locked: { label: 'Locked', color: 'bg-red-500/15 text-red-400 border-red-500/30', icon: Lock },
};

type SortField = 'fullName' | 'username' | 'email' | 'role' | 'status' | 'last_login';
type SortDirection = 'asc' | 'desc';

// ============================================================================
// COMPONENT
// ============================================================================

export function UserManagement() {
  const { data: users = [], isLoading, error } = useUsers();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deactivateUser = useDeactivateUser();
  const resetPassword = useResetPassword();

  // Dialog state
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deactivateDialogOpen, setDeactivateDialogOpen] = useState(false);
  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // Sort state
  const [sortField, setSortField] = useState<SortField>('fullName');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Form state for Add User
  const [newUser, setNewUser] = useState({
    username: '',
    email: '',
    fullName: '',
    password: '',
    role: 'analyst',
  });

  // Form state for Edit User
  const [editData, setEditData] = useState({
    fullName: '',
    email: '',
    role: '',
    status: '',
  });

  // Form state for Reset Password
  const [passwordData, setPasswordData] = useState({
    newPassword: '',
    confirmPassword: '',
  });

  // Stats
  const stats = useMemo(() => {
    const total = users.length;
    const active = users.filter(u => u.status === 'active').length;
    const inactive = users.filter(u => u.status === 'inactive').length;
    const locked = users.filter(u => u.status === 'locked').length;
    return { total, active, inactive, locked };
  }, [users]);

  // Sort logic
  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) => {
      let aVal = a[sortField] ?? '';
      let bVal = b[sortField] ?? '';
      if (typeof aVal === 'string') aVal = aVal.toLowerCase();
      if (typeof bVal === 'string') bVal = bVal.toLowerCase();
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [users, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Handlers
  const handleAddUser = async () => {
    if (!newUser.username || !newUser.password || !newUser.email || !newUser.fullName) {
      toast.error('All fields are required');
      return;
    }
    try {
      await createUser.mutateAsync(newUser);
      toast.success(`User "${newUser.username}" created successfully`);
      setAddDialogOpen(false);
      setNewUser({ username: '', email: '', fullName: '', password: '', role: 'analyst' });
    } catch (err: any) {
      toast.error(err.message || 'Failed to create user');
    }
  };

  const handleEditUser = async () => {
    if (!selectedUser) return;
    try {
      await updateUser.mutateAsync({ id: selectedUser.id, data: editData });
      toast.success(`User "${selectedUser.username}" updated successfully`);
      setEditDialogOpen(false);
      setSelectedUser(null);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update user');
    }
  };

  const handleDeactivateUser = async () => {
    if (!selectedUser) return;
    try {
      await deactivateUser.mutateAsync(selectedUser.id);
      toast.success(`User "${selectedUser.username}" deactivated`);
      setDeactivateDialogOpen(false);
      setSelectedUser(null);
    } catch (err: any) {
      toast.error(err.message || 'Failed to deactivate user');
    }
  };

  const handleResetPassword = async () => {
    if (!selectedUser) return;
    if (!passwordData.newPassword) {
      toast.error('Password is required');
      return;
    }
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    if (passwordData.newPassword.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    try {
      await resetPassword.mutateAsync({ id: selectedUser.id, newPassword: passwordData.newPassword });
      toast.success(`Password reset for "${selectedUser.username}"`);
      setResetPasswordDialogOpen(false);
      setSelectedUser(null);
      setPasswordData({ newPassword: '', confirmPassword: '' });
    } catch (err: any) {
      toast.error(err.message || 'Failed to reset password');
    }
  };

  const openEditDialog = (user: User) => {
    setSelectedUser(user);
    setEditData({
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      status: user.status,
    });
    setEditDialogOpen(true);
  };

  const openDeactivateDialog = (user: User) => {
    setSelectedUser(user);
    setDeactivateDialogOpen(true);
  };

  const openResetPasswordDialog = (user: User) => {
    setSelectedUser(user);
    setPasswordData({ newPassword: '', confirmPassword: '' });
    setResetPasswordDialogOpen(true);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    try {
      return new Date(dateStr).toLocaleString();
    } catch {
      return 'Unknown';
    }
  };

  const SortHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <TableHead>
      <button
        className="flex items-center gap-1 hover:text-foreground transition-colors"
        onClick={() => handleSort(field)}
      >
        {children}
        <ArrowUpDown className="h-3 w-3" />
      </button>
    </TableHead>
  );

  // ============================================================================
  // RENDER
  // ============================================================================

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Shield className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h3 className="text-lg font-semibold">Failed to load users</h3>
          <p className="text-muted-foreground mt-1">{(error as Error).message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">User Management</h2>
          <p className="text-muted-foreground mt-1">Manage user accounts, roles, and access control</p>
        </div>
        <Button onClick={() => setAddDialogOpen(true)}>
          <UserPlus className="h-4 w-4 mr-2" />
          Add User
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Users</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
              <Users className="h-8 w-8 text-muted-foreground/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active</p>
                <p className="text-2xl font-bold text-green-400">{stats.active}</p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-green-500/30" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Inactive</p>
                <p className="text-2xl font-bold text-gray-400">{stats.inactive}</p>
              </div>
              <XCircle className="h-8 w-8 text-gray-500/30" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Locked</p>
                <p className="text-2xl font-bold text-red-400">{stats.locked}</p>
              </div>
              <Lock className="h-8 w-8 text-red-500/30" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* User Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : sortedUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Users className="h-12 w-12 mb-4 opacity-50" />
              <p>No users found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHeader field="fullName">Name</SortHeader>
                  <SortHeader field="username">Username</SortHeader>
                  <SortHeader field="email">Email</SortHeader>
                  <SortHeader field="role">Role</SortHeader>
                  <SortHeader field="status">Status</SortHeader>
                  <SortHeader field="last_login">Last Login</SortHeader>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedUsers.map((user) => {
                  const statusCfg = STATUS_CONFIG[user.status] || STATUS_CONFIG.inactive;
                  const StatusIcon = statusCfg.icon;
                  return (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.fullName || '-'}</TableCell>
                      <TableCell className="font-mono text-sm">{user.username}</TableCell>
                      <TableCell>{user.email || '-'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={ROLE_COLORS[user.role] || ROLE_COLORS.viewer}>
                          {ROLE_LABELS[user.role] || user.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusCfg.color}>
                          <StatusIcon className="h-3 w-3 mr-1" />
                          {statusCfg.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(user.last_login)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditDialog(user)}
                            title="Edit user"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openResetPasswordDialog(user)}
                            title="Reset password"
                          >
                            <KeyRound className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openDeactivateDialog(user)}
                            title="Deactivate user"
                            disabled={user.status === 'inactive'}
                          >
                            <UserX className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ================================================================== */}
      {/* ADD USER DIALOG                                                    */}
      {/* ================================================================== */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
            <DialogDescription>Create a new user account for CyberSentinel SOAR.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="add-fullName">Full Name</Label>
              <Input
                id="add-fullName"
                value={newUser.fullName}
                onChange={e => setNewUser(prev => ({ ...prev, fullName: e.target.value }))}
                placeholder="Jane Smith"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-username">Username</Label>
              <Input
                id="add-username"
                value={newUser.username}
                onChange={e => setNewUser(prev => ({ ...prev, username: e.target.value }))}
                placeholder="jsmith"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-email">Email</Label>
              <Input
                id="add-email"
                type="email"
                value={newUser.email}
                onChange={e => setNewUser(prev => ({ ...prev, email: e.target.value }))}
                placeholder="jsmith@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-password">Password</Label>
              <Input
                id="add-password"
                type="password"
                value={newUser.password}
                onChange={e => setNewUser(prev => ({ ...prev, password: e.target.value }))}
                placeholder="Minimum 8 characters"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-role">Role</Label>
              <Select
                value={newUser.role}
                onValueChange={val => setNewUser(prev => ({ ...prev, role: val }))}
              >
                <SelectTrigger id="add-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map(role => (
                    <SelectItem key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleAddUser} disabled={createUser.isPending}>
              {createUser.isPending ? 'Creating...' : 'Create User'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================================================== */}
      {/* EDIT USER DIALOG                                                   */}
      {/* ================================================================== */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>
              Update details for <span className="font-mono font-semibold">{selectedUser?.username}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-fullName">Full Name</Label>
              <Input
                id="edit-fullName"
                value={editData.fullName}
                onChange={e => setEditData(prev => ({ ...prev, fullName: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-email">Email</Label>
              <Input
                id="edit-email"
                type="email"
                value={editData.email}
                onChange={e => setEditData(prev => ({ ...prev, email: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-role">Role</Label>
              <Select
                value={editData.role}
                onValueChange={val => setEditData(prev => ({ ...prev, role: val }))}
              >
                <SelectTrigger id="edit-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map(role => (
                    <SelectItem key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-status">Status</Label>
              <Select
                value={editData.status}
                onValueChange={val => setEditData(prev => ({ ...prev, status: val }))}
              >
                <SelectTrigger id="edit-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="locked">Locked</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleEditUser} disabled={updateUser.isPending}>
              {updateUser.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================================================== */}
      {/* DEACTIVATE CONFIRMATION DIALOG                                     */}
      {/* ================================================================== */}
      <AlertDialog open={deactivateDialogOpen} onOpenChange={setDeactivateDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to deactivate <span className="font-semibold">{selectedUser?.username}</span>?
              This will set their status to inactive and they will no longer be able to log in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeactivateUser}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deactivateUser.isPending ? 'Deactivating...' : 'Deactivate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ================================================================== */}
      {/* RESET PASSWORD DIALOG                                              */}
      {/* ================================================================== */}
      <Dialog open={resetPasswordDialogOpen} onOpenChange={setResetPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Set a new password for <span className="font-mono font-semibold">{selectedUser?.username}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="reset-password">New Password</Label>
              <Input
                id="reset-password"
                type="password"
                value={passwordData.newPassword}
                onChange={e => setPasswordData(prev => ({ ...prev, newPassword: e.target.value }))}
                placeholder="Minimum 8 characters"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reset-confirm">Confirm Password</Label>
              <Input
                id="reset-confirm"
                type="password"
                value={passwordData.confirmPassword}
                onChange={e => setPasswordData(prev => ({ ...prev, confirmPassword: e.target.value }))}
                placeholder="Repeat password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetPasswordDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleResetPassword} disabled={resetPassword.isPending}>
              {resetPassword.isPending ? 'Resetting...' : 'Reset Password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default UserManagement;
