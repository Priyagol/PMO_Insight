import {
  KeyRound,
  Keyboard,
  LogOut,
  MonitorSmartphone,
  Monitor,
  Moon,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { UserAvatar } from '@/components/common/UserAvatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuthActions } from '@/features/auth/use-auth-actions';
import { useAppDispatch, useAppSelector } from '@/store';
import { setCommandPaletteOpen, setTheme, type ThemePreference } from '@/store/ui-slice';

const AccountSecurityDialog = lazy(() =>
  import('@/features/security/AccountSecurityDialog').then((m) => ({
    default: m.AccountSecurityDialog,
  })),
);
const ChangePasswordDialog = lazy(() =>
  import('@/features/auth/ChangePasswordDialog').then((m) => ({ default: m.ChangePasswordDialog })),
);

export function UserMenu() {
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.session.user);
  const theme = useAppSelector((s) => s.ui.theme);
  const { signOut, signOutEverywhere } = useAuthActions();
  const [changingPassword, setChangingPassword] = useState(false);
  const [security, setSecurity] = useState(false);

  if (!user) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label="Open user menu"
        >
          <UserAvatar name={user.name} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="font-normal">
            <p className="text-sm font-semibold">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {user.roles.map((r) => r.name).join(', ')}
            </p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={theme}
            onValueChange={(v) => dispatch(setTheme(v as ThemePreference))}
          >
            <DropdownMenuRadioItem value="light">
              <Sun /> Light
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              <Moon /> Dark
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">
              <Monitor /> System
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => dispatch(setCommandPaletteOpen(true))}>
            <Keyboard /> Command palette
            <DropdownMenuShortcut>Ctrl K</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setChangingPassword(true)}>
            <KeyRound /> Change password
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setSecurity(true)}>
            <ShieldCheck /> Security &amp; API tokens
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void signOutEverywhere()}>
            <MonitorSmartphone /> Sign out of all devices
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void signOut()}>
            <LogOut /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {security ? (
        <Suspense fallback={null}>
          <AccountSecurityDialog onClose={() => setSecurity(false)} />
        </Suspense>
      ) : null}
      {changingPassword ? (
        <Suspense fallback={null}>
          <ChangePasswordDialog open onOpenChange={setChangingPassword} />
        </Suspense>
      ) : null}
    </>
  );
}
