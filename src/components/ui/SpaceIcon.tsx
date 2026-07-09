'use client';

interface SpaceIconProps {
  icon?: string | null;
  spaceKey: string;
  spaceName?: string | null;
  spaceType?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

// Parse icon JSON: { emoji, bg } or plain emoji string
function parseIcon(icon?: string | null): { emoji: string; bg: string } | null {
  if (!icon) return null;
  try {
    const parsed = JSON.parse(icon);
    if (parsed.emoji) return parsed;
  } catch {}
  // Plain emoji string
  if (icon.length <= 4) return { emoji: icon, bg: '#6366f1' };
  return null;
}

const TYPE_GRADIENTS: Record<string, string> = {
  scrum:        'linear-gradient(135deg, #2563eb, #1d4ed8)',
  kanban:       'linear-gradient(135deg, #7c3aed, #6d28d9)',
  service_desk: 'linear-gradient(135deg, #1264A3, #1565C0)',
};

function getNameInitials(name?: string | null, key?: string): string {
  if (name && name.trim()) {
    const words = name.trim().split(/\s+/);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  return (key || '').slice(0, 2).toUpperCase();
}

export default function SpaceIcon({ icon, spaceKey, spaceName, spaceType, size = 'sm', className = '' }: SpaceIconProps) {
  const parsed = parseIcon(icon);

  const dim = size === 'lg' ? 'w-10 h-10 rounded-lg' : size === 'md' ? 'w-8 h-8 rounded-lg' : 'w-6 h-6 rounded-md';

  if (parsed) {
    return (
      <span
        className={`${dim} flex items-center justify-center flex-shrink-0 ${className}`}
        style={{ lineHeight: 1, fontSize: size === 'lg' ? '18px' : size === 'md' ? '14px' : '12px' }}
      >
        {parsed.emoji}
      </span>
    );
  }

  // Fallback: gradient background with bold 2-letter initials — always 7px
  const gradient = spaceType
    ? TYPE_GRADIENTS[spaceType] || 'linear-gradient(135deg, #1264A3, #1565C0)'
    : 'linear-gradient(135deg, #1264A3, #1565C0)';

  return (
    <span
      className={`${dim} flex items-center justify-center flex-shrink-0 font-bold text-white ${className}`}
      style={{ background: gradient, fontSize: '7px', letterSpacing: '0.02em' }}
    >
      {getNameInitials(spaceName, spaceKey)}
    </span>
  );
}
