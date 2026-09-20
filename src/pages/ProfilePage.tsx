import { useState } from "react";
import { User as UserIcon, KeyRound } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { useUserStore } from "@/stores/user";
import { changePasswordSchema, updateProfileSchema } from "@/types/user";
import type { UpdateProfileInput } from "@/types/user";

export function ProfilePage() {
  const { user, setUser } = useUserStore();
  const [profile, setProfile] = useState<UpdateProfileInput>({
    name: user?.name ?? "",
    email: user?.email ?? "",
    phone: user?.phone ?? "",
  });
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileDone, setProfileDone] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordDone, setPasswordDone] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  if (!user) return null;

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError(null);
    setProfileDone(false);
    const parsed = updateProfileSchema.safeParse(profile);
    if (!parsed.success) {
      setProfileError(parsed.error.issues[0]?.message ?? "Please check the form.");
      return;
    }
    setSavingProfile(true);
    try {
      const updated = await api.auth.updateProfile(user.id, parsed.data);
      setUser(updated);
      setProfileDone(true);
    } catch (err) {
      setProfileError(String(err));
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordDone(false);
    const parsed = changePasswordSchema.safeParse(passwords);
    if (!parsed.success) {
      setPasswordError(parsed.error.issues[0]?.message ?? "Please check the form.");
      return;
    }
    setSavingPassword(true);
    try {
      await api.auth.changePassword(user.id, parsed.data.currentPassword, parsed.data.newPassword);
      setPasswords({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setPasswordDone(true);
    } catch (err) {
      setPasswordError(String(err));
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Profile" description="Manage your account details and password." />

      <Card>
        <CardHeader className="flex-row items-center gap-4 space-y-0">
          <Avatar name={user.name} className="h-14 w-14 text-lg" />
          <div>
            <CardTitle className="flex items-center gap-2">
              {user.name}
              <Badge variant="outline">{user.role}</Badge>
            </CardTitle>
            <CardDescription>{user.email}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveProfile} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <fieldset className="space-y-1.5">
                <Label htmlFor="p-name">Full name</Label>
                <Input id="p-name" value={profile.name} onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))} />
              </fieldset>
              <fieldset className="space-y-1.5">
                <Label htmlFor="p-email">Email</Label>
                <Input id="p-email" type="email" value={profile.email} onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))} />
              </fieldset>
              <fieldset className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="p-phone">Phone</Label>
                <Input id="p-phone" value={profile.phone} onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))} />
              </fieldset>
            </div>

            {profileError && <p className="text-sm text-destructive">{profileError}</p>}
            {profileDone && <p className="text-sm text-[var(--success)]">Profile updated.</p>}

            <div className="flex justify-end">
              <Button type="submit" disabled={savingProfile}>
                {savingProfile && <Spinner size={16} />}
                <UserIcon />
                Save Profile
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            Change Password
          </CardTitle>
          <CardDescription>Use at least 8 characters. All seeded demo accounts share Password123!.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={savePassword} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <fieldset className="space-y-1.5">
                <Label htmlFor="pw-current">Current password</Label>
                <Input id="pw-current" type="password" value={passwords.currentPassword} onChange={(e) => setPasswords((p) => ({ ...p, currentPassword: e.target.value }))} />
              </fieldset>
              <fieldset className="space-y-1.5">
                <Label htmlFor="pw-new">New password</Label>
                <Input id="pw-new" type="password" value={passwords.newPassword} onChange={(e) => setPasswords((p) => ({ ...p, newPassword: e.target.value }))} />
              </fieldset>
              <fieldset className="space-y-1.5">
                <Label htmlFor="pw-confirm">Confirm new password</Label>
                <Input id="pw-confirm" type="password" value={passwords.confirmPassword} onChange={(e) => setPasswords((p) => ({ ...p, confirmPassword: e.target.value }))} />
              </fieldset>
            </div>

            {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}
            {passwordDone && <p className="text-sm text-[var(--success)]">Password changed.</p>}

            <div className="flex justify-end">
              <Button type="submit" disabled={savingPassword}>
                {savingPassword && <Spinner size={16} />}
                Change Password
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}