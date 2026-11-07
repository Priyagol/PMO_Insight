import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn, initials } from '@/lib/utils';

interface UserAvatarProps {
  name: string;
  src?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE = { sm: 'size-6 text-[10px]', md: 'size-8 text-xs', lg: 'size-10 text-sm' };

export function UserAvatar({ name, src, size = 'md', className }: UserAvatarProps) {
  return (
    <Avatar className={cn(SIZE[size], className)}>
      {src ? <AvatarImage src={src} alt={name} /> : null}
      <AvatarFallback className="bg-gradient-to-br from-primary to-violet font-semibold text-white">
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

export function AvatarGroup({ names, max = 4 }: { names: string[]; max?: number }) {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return (
    <div className="flex -space-x-2">
      {shown.map((n) => (
        <UserAvatar key={n} name={n} size="sm" className="ring-2 ring-card" />
      ))}
      {rest > 0 ? (
        <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium ring-2 ring-card">
          +{rest}
        </span>
      ) : null}
    </div>
  );
}
