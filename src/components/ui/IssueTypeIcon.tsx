'use client';

export const TYPE_META: Record<string, { color: string; bg: string; label: string }> = {
  epic:            { color: '#6554C0', bg: '#6554C0', label: 'Epic'            },
  story:           { color: '#36B37E', bg: '#36B37E', label: 'Story'           },
  task:            { color: '#36B37E', bg: '#36B37E', label: 'Task'            },
  bug:             { color: '#FF5630', bg: '#FF5630', label: 'Bug'             },
  subtask:         { color: '#0065FF', bg: '#0065FF', label: 'Sub-task'        },
  service_request: { color: '#00B8D9', bg: '#00B8D9', label: 'Service Request' },
  incident:        { color: '#FF7452', bg: '#FF7452', label: 'Incident'        },
};

/** Jira-style SVG icon — returns the inner <path/><circle/> etc. elements */
function TypeSVG({ type, size }: { type: string; size: number }) {
  const s = size;
  const t = type?.toLowerCase();

  if (t === 'epic') {
    // Lightning bolt
    return (
      <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
        <rect width="16" height="16" rx="3" fill="#6554C0"/>
        <path d="M9.5 2.5L4.5 9H7.5L6.5 13.5L11.5 7H8.5L9.5 2.5Z" fill="white"/>
      </svg>
    );
  }

  if (t === 'story') {
    // Bookmark shape
    return (
      <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
        <rect width="16" height="16" rx="3" fill="#36B37E"/>
        <path d="M4 3.5H12V13L8 10.5L4 13V3.5Z" fill="white"/>
      </svg>
    );
  }

  if (t === 'task') {
    // Checkmark in circle — green
    return (
      <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
        <rect width="16" height="16" rx="3" fill="#36B37E"/>
        <circle cx="8" cy="8" r="4.5" stroke="white" strokeWidth="1.4" fill="none"/>
        <path d="M5.5 8L7 9.5L10.5 6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  }

  if (t === 'bug') {
    // Bug / circle with legs
    return (
      <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
        <rect width="16" height="16" rx="3" fill="#FF5630"/>
        <circle cx="8" cy="8.5" r="3" fill="white"/>
        <path d="M6.5 5.5C6.5 4.67 7.17 4 8 4C8.83 4 9.5 4.67 9.5 5.5" stroke="white" strokeWidth="1.3" fill="none" strokeLinecap="round"/>
        <line x1="5" y1="7.5" x2="3.5" y2="6.5" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
        <line x1="11" y1="7.5" x2="12.5" y2="6.5" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
        <line x1="5" y1="9" x2="3.5" y2="9" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
        <line x1="11" y1="9" x2="12.5" y2="9" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
        <line x1="5" y1="10.5" x2="3.5" y2="11.5" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
        <line x1="11" y1="10.5" x2="12.5" y2="11.5" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
    );
  }

  if (t === 'service_request') {
    // Jira-style headset icon
    return (
      <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
        <rect width="16" height="16" rx="3" fill="#00B8D9"/>
        {/* Headband arc */}
        <path d="M4 8.5C4 5.74 5.79 4 8 4C10.21 4 12 5.74 12 8.5" stroke="white" strokeWidth="1.4" fill="none" strokeLinecap="round"/>
        {/* Left ear cup */}
        <rect x="3" y="8.5" width="2" height="3" rx="1" fill="white"/>
        {/* Right ear cup */}
        <rect x="11" y="8.5" width="2" height="3" rx="1" fill="white"/>
        {/* Chin/cord */}
        <path d="M13 10.5C13 12 11.5 13 10 13H9" stroke="white" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
      </svg>
    );
  }

  if (t === 'incident') {
    // Warning triangle
    return (
      <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
        <rect width="16" height="16" rx="3" fill="#FF7452"/>
        <path d="M8 3.5L13.5 12.5H2.5L8 3.5Z" stroke="white" strokeWidth="1.4" fill="none" strokeLinejoin="round"/>
        <line x1="8" y1="7" x2="8" y2="10" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="8" cy="11.5" r="0.7" fill="white"/>
      </svg>
    );
  }

  if (t === 'subtask' || t === 'sub-task' || t === 'sub_task') {
    // Small checkmark — same as task but smaller/lighter bg
    return (
      <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
        <rect width="16" height="16" rx="3" fill="#0065FF" fillOpacity="0.75"/>
        <path d="M4.5 8.5L6.5 10.5L11.5 5.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  }

  // Fallback — generic task
  return (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <rect width="16" height="16" rx="3" fill="#0065FF"/>
      <path d="M4.5 8.5L6.5 10.5L11.5 5.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export default function IssueTypeIcon({
  type,
  size = 16,
}: {
  type: string;
  size?: number;
}) {
  return (
    <span
      title={TYPE_META[type?.toLowerCase()]?.label ?? type}
      className="inline-flex flex-shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <TypeSVG type={type} size={size} />
    </span>
  );
}
